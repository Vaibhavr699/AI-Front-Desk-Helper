const express = require("express");
const OpenAI = require("openai");

// -------------------- Config --------------------
const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory call state (V1). Replace with DB later.
const callState = new Map(); // key: CallSid -> { lead, transcript, createdAt, pushedToZapier }

// Lead template
function emptyLead() {
  return {
    name: null,
    caller_phone: null,
    email: null,
    address: null,
    project_type: null,
    property_type: null,
    rooms_or_scope: null,
    square_footage: null,
    timeline: null,
    repairs_needed: null,
    decision_stage: null,
    estimate_requested: null,
    notes: null
  };
}

// Basic server health check
app.get("/health", (req, res) => res.status(200).send("OK"));

// -------------------- Twilio: Entry --------------------
app.post("/twilio-voice", (req, res) => {
  const callSid = req.body.CallSid;
  const from = req.body.From;

  const base = process.env.BASE_URL; // must be set in Render
  const wsUrl = base.replace("https://", "wss://") + "/twilio-media";

  if (callSid && !callState.has(callSid)) {
    callState.set(callSid, {
      lead: { ...emptyLead(), caller_phone: from || null },
      transcript: [],
      createdAt: Date.now(),
      pushedToZapier: false
    });
  }

  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Say voice="Polly.Joanna">Connecting you now.</Say>
      <Connect>
        <Stream url="${wsUrl}" />
      </Connect>
    </Response>
  `);
});
// -------------------- Core AI Loop --------------------
app.post("/process-speech", async (req, res) => {
  const callSid = req.body.CallSid;
  const from = req.body.From;
  const speech = (req.body.SpeechResult || "").trim();

  res.set("Content-Type", "text/xml");

  if (!callSid || !callState.has(callSid)) {
    return res.send(`
      <Response>
        <Say voice="alice">Sorry—please call back and try again.</Say>
      </Response>
    `);
  }

  const state = callState.get(callSid);
  if (from && !state.lead.caller_phone) state.lead.caller_phone = from;

  if (speech) state.transcript.push({ role: "caller", text: speech, ts: Date.now() });

  try {
    // 1) Ask OpenAI for:
    //    - a short spoken response
    //    - an updated lead JSON (merge-friendly)
    //    - a boolean "ready_to_push"
    const ai = await runReceptionistTurn({
      lead: state.lead,
      transcript: state.transcript
    });

    // merge lead updates
    state.lead = { ...state.lead, ...ai.lead_update };

    // store assistant response to transcript
    state.transcript.push({ role: "assistant", text: ai.say, ts: Date.now() });

    // 2) If ready, push to Zapier once
    let pushedMsg = "";
    if (ai.ready_to_push && !state.pushedToZapier) {
      const zapierOk = await pushLeadToZapier({
        callSid,
        lead: state.lead,
        transcript: state.transcript
      });

      if (zapierOk) {
        state.pushedToZapier = true;
        pushedMsg = " I’ve got your info and we’ll reach out shortly.";
      } else {
        pushedMsg = " I’m having trouble saving the details—if you can, please text or call us back shortly.";
      }
    }

    // 3) Respond to caller + continue gathering unless we’re “done”
    // If lead already pushed, we can close politely.
    if (state.pushedToZapier) {
      return res.send(`
        <Response>
          <Say voice="alice">${escapeForTwiML(ai.say + pushedMsg)} Thanks for calling Gladiators Painting.</Say>
        </Response>
      `);
    }

    // Otherwise continue conversation loop
    return res.send(`
      <Response>
        <Say voice="alice">${escapeForTwiML(ai.say + pushedMsg)}</Say>
        <Gather input="speech" action="/process-speech" method="POST" timeout="4" speechTimeout="auto">
          <Say voice="alice">What else can I help you with?</Say>
        </Gather>
        <Say voice="alice">Sorry, I didn’t catch that. Goodbye.</Say>
      </Response>
    `);
  } catch (err) {
    console.error("AI loop error:", err);
    return res.send(`
      <Response>
        <Say voice="alice">Sorry, something went wrong. Please call back in a moment.</Say>
      </Response>
    `);
  }
});

// -------------------- OpenAI Turn --------------------
async function runReceptionistTurn({ lead, transcript }) {
  const systemPrompt = `
You are the AI receptionist for Gladiators Painting.

Goals:
1) Be friendly and concise (1–2 sentences max spoken).
2) Ask ONE question at a time.
3) Collect these fields (best effort): name, phone, address, interior/exterior, scope/rooms, timeline, repairs.
4) When you have enough to create a lead (name OR phone, address OR city-area description, project_type, and some scope), set ready_to_push=true.

Rules:
- Do NOT mention JSON or “tools”.
- If caller is price-shopping aggressively, respond politely and try to book an estimate; if they insist on cheapest, set decision_stage="just_info" and ready_to_push=true with notes.
- Never invent details. Use null when unknown.

Output MUST be valid JSON with this exact shape:
{
  "say": "string",
  "lead_update": { ...partial lead fields... },
  "ready_to_push": boolean
}
`;

  // Build a compact conversation summary for context
  const lastTurns = transcript.slice(-10).map(t => `${t.role.toUpperCase()}: ${t.text}`).join("\n");

  const userPrompt = `
Current lead data (may contain nulls):
${JSON.stringify(lead, null, 2)}

Recent conversation:
${lastTurns || "(none yet)"}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPrompt.trim() }
    ]
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback if model ever misbehaves
    parsed = {
      say: "Thanks—what’s the address for the project?",
      lead_update: {},
      ready_to_push: false
    };
  }

  // Validate minimal shape
  return {
    say: typeof parsed.say === "string" ? parsed.say : "Thanks—what’s the address for the project?",
    lead_update: typeof parsed.lead_update === "object" && parsed.lead_update ? parsed.lead_update : {},
    ready_to_push: Boolean(parsed.ready_to_push)
  };
}

// -------------------- Zapier Push --------------------
async function pushLeadToZapier({ callSid, lead, transcript }) {
  const url = process.env.ZAPIER_WEBHOOK_URL;
  if (!url) return false;

  // Basic summary (keep it short)
  const summary = buildSummary(lead);

  const payload = {
    source: "gladiators_ai_front_desk",
    callSid,
    lead,
    summary,
    transcript: transcript.slice(-30) // last 30 lines max
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return resp.ok;
  } catch (e) {
    console.error("Zapier push failed:", e);
    return false;
  }
}

function buildSummary(lead) {
  const bits = [];
  if (lead.name) bits.push(`Name: ${lead.name}`);
  if (lead.caller_phone) bits.push(`Phone: ${lead.caller_phone}`);
  if (lead.address) bits.push(`Address: ${lead.address}`);
  if (lead.project_type) bits.push(`Type: ${lead.project_type}`);
  if (lead.rooms_or_scope) bits.push(`Scope: ${lead.rooms_or_scope}`);
  if (lead.timeline) bits.push(`Timeline: ${lead.timeline}`);
  if (lead.repairs_needed) bits.push(`Repairs: ${lead.repairs_needed}`);
  return bits.join(" | ");
}

// TwiML escaping
function escapeForTwiML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// -------------------- Start Server (HTTP + WebSocket) --------------------

const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// Create HTTP server from Express app
const server = http.createServer(app);

// Attach WebSocket server
const wss = new WebSocket.Server({
  server,
  path: "/twilio-media"
});

wss.on("connection", (twilioSocket) => {
  console.log("Twilio Media Stream connected");

  let streamSid = null;
  let openaiSocket = null;

  // Connect to OpenAI Realtime
  const OpenAI = require("ws");

openaiSocket = new OpenAI(
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
  {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  }
);

openaiSocket.on("open", () => {
  console.log("Connected to OpenAI Realtime");

  // Configure session
  openaiSocket.send(JSON.stringify({
    type: "session.update",
    session: {
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: "verse", // more natural than alloy
      instructions: `
You are the professional AI receptionist for Gladiators Painting.

Be warm, confident, and concise.
Ask one question at a time.
Greet the caller immediately and ask how you can help.
Never mention AI.
`
    }
  }));

  // Make AI speak first
 openaiSocket.send(JSON.stringify({
  type: "response.create",
  response: { modalities: ["audio"] }
}));

  // Receive audio from OpenAI and send back to Twilio
  openaiSocket.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === "response.audio.delta" && streamSid) {
        twilioSocket.send(JSON.stringify({
          event: "media",
          streamSid,
          media: {
            payload: data.delta
          }
        }));
      }
    } catch (err) {
      console.error("OpenAI parse error:", err);
    }
  });

  // Receive audio from Twilio and forward to OpenAI
  twilioSocket.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.event === "start") {
        streamSid = data.start.streamSid;
        console.log("Stream started:", streamSid);
      }

      if (data.event === "media" && openaiSocket.readyState === 1) {
        openaiSocket.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload
        }));
      }

      if (data.event === "stop") {
        console.log("Stream stopped");
        if (openaiSocket) openaiSocket.close();
      }

    } catch (err) {
      console.error("Twilio parse error:", err);
    }
  });

  twilioSocket.on("close", () => {
    console.log("Twilio socket closed");
    if (openaiSocket) openaiSocket.close();
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
