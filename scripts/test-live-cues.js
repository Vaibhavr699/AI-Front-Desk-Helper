"use strict";

require("dotenv").config();
const WebSocket = require("ws");
const db = require("../lib/db");
const auth = require("../lib/auth");

const API_BASE = process.env.BASE_URL || "http://localhost:3001";
const WS_BASE = API_BASE.replace(/^http/, "ws");

const CONVERSATION = [
  { speaker: "rep", text: "Hi there, I'm Mike from Elite Painting. Thanks for having me out today.", delay: 0 },
  { speaker: "customer", text: "Yeah come on in. We've been wanting to get the living room and kitchen repainted.", delay: 4 },
  { speaker: "rep", text: "Great so let me tell you about our premium paint packages. We use Sherwin-Williams Duration which has a 25-year warranty and we also offer cabinet refinishing and we can do exterior too and our crew has been doing this for 15 years and we're the top rated company in the area.", delay: 6 },
  { speaker: "customer", text: "Ok but I just—", delay: 5 },
  { speaker: "rep", text: "And the best part is we include a two-year touch-up guarantee with every job. So if anything chips or peels we come back free of charge. Plus we do color consultations included in the price and we can usually start within two weeks.", delay: 3 },
  { speaker: "customer", text: "That sounds like a lot. Can I ask—", delay: 6 },
  { speaker: "rep", text: "Absolutely and we also do deck staining, pressure washing, and drywall repair. So if you have any other projects we can bundle those together for a discount.", delay: 2 },
  { speaker: "customer", text: "Ok stop for a second. I got a quote from ColorPro last week for $2,800 and honestly that felt high. What are you guys at?", delay: 8 },
  { speaker: "rep", text: "Well every job is different. Let me show you some before and after photos from similar projects we've done.", delay: 5 },
  { speaker: "customer", text: "I don't really need to see photos. I need to know if you're competitive on price. My wife and I have a budget around $2,500.", delay: 6 },
  { speaker: "rep", text: "Sure, sure. So the paint we use is really high quality. Duration by Sherwin-Williams is self-priming and has excellent coverage. One coat usually does it for lighter colors.", delay: 5 },
  { speaker: "customer", text: "Look, I appreciate the quality pitch but I'm asking about price. Can you give me a number or not?", delay: 8 },
  { speaker: "rep", text: "Of course. For your living room and kitchen, looking at about 600 square feet of wall space, I'd estimate around $3,200.", delay: 5 },
  { speaker: "customer", text: "That's even more than the other guy. I don't think that's going to work for us.", delay: 6 },
  { speaker: "rep", text: "I totally understand. You know what, let me also mention that we're running a spring promotion right now...", delay: 5 },
  { speaker: "customer", text: "My wife handles these decisions. She's upstairs, she said to just get the price and she'll think about it.", delay: 8 },
  { speaker: "rep", text: "Got it. Well here's my card. Feel free to call anytime.", delay: 5 },
  { speaker: "customer", text: "Yeah we'll think about it. Thanks for coming out.", delay: 6 },
  { speaker: "rep", text: "Thank you for your time. Have a great day!", delay: 4 },
];

async function run() {
  console.log("\n=== Live Cue Test Script ===\n");

  const userR = await db.query(
    "SELECT id, tenant_id, email FROM dashboard_users WHERE rep_seat_active = true LIMIT 1"
  );
  if (!userR.rows[0]) {
    console.error("No active rep user found. Create one first.");
    process.exit(1);
  }
  const user = userR.rows[0];
  console.log("Rep:", user.email, "(", user.id, ")");

  const token = auth.signToken({
    sub: user.id,
    tenant_id: user.tenant_id,
    scope: "rep",
  });

  console.log("Starting session...");
  const sessionRes = await fetch(`${API_BASE}/api/rep/in-home/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      consent_obtained: true,
      consent_type: "verbal",
      consent_state: "NE",
      device_type: "test_script",
      network_mode: "online",
    }),
  });
  const sessionData = await sessionRes.json();
  if (!sessionData.session) {
    console.error("Failed to start session:", sessionData);
    process.exit(1);
  }
  const sessionId = sessionData.session.id;
  console.log("Session:", sessionId);

  const wsUrl = `${WS_BASE}/ws/rep/in-home/${sessionId}?token=${encodeURIComponent(token)}`;
  console.log("Connecting WebSocket...\n");

  const ws = new WebSocket(wsUrl);
  let cueCount = 0;

  ws.on("open", () => {
    console.log("[WS] Connected — starting conversation simulation\n");
    console.log("─".repeat(60));
    sendConversation(ws);
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "coaching_cue") {
      cueCount++;
      const cue = msg.cue;
      console.log("");
      console.log("┌─ 🎯 CUE #" + cueCount + " ─────────────────────────────────");
      console.log("│  Type:     " + cue.cue_type);
      console.log("│  Watch:    " + cue.watch_label);
      console.log("│  Urgency:  " + cue.urgency);
      console.log("│  Headline: " + cue.headline);
      if (cue.full_text) console.log("│  Advice:   " + cue.full_text);
      console.log("│  Channels: " + (msg.channels || []).join(", "));
      console.log("└─────────────────────────────────────────");
      console.log("");
    }

    if (msg.type === "transcript_update") {
      console.log("  [transcript] " + msg.entry.speaker + ": " + msg.entry.text.slice(0, 60));
    }

    if (msg.type === "session_status") {
      console.log("[WS] Status:", msg.status);
    }
  });

  ws.on("close", () => {
    console.log("\n[WS] Disconnected");
    console.log("Total cues fired:", cueCount);
    setTimeout(() => process.exit(0), 1000);
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err.message);
  });
}

function sendConversation(ws) {
  const timings = [];
  let cumulative = 2000;
  for (const line of CONVERSATION) {
    cumulative += line.delay * 1000;
    timings.push(cumulative);
  }

  CONVERSATION.forEach((line, i) => {
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const sec = Math.floor(timings[i] / 1000);
      const label = line.speaker === "rep" ? "🟦 REP" : "🟩 CUSTOMER";
      console.log(`[${formatTime(sec)}] ${label}: ${line.text}`);

      ws.send(JSON.stringify({
        type: "transcript_manual",
        speaker: line.speaker,
        text: line.text,
        at: new Date().toISOString(),
      }));

      if (i === CONVERSATION.length - 1) {
        console.log("\n" + "─".repeat(60));
        console.log("Conversation complete. Waiting 40s for final cues...\n");
        setTimeout(() => ws.close(), 40_000);
      }
    }, timings[i]);
  });
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
