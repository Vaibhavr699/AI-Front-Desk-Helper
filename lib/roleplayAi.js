"use strict";

const OpenAI = require("openai");

const MODEL = "gpt-4o-2024-08-06";

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const DIMENSIONS = [
  "rapport",
  "discovery",
  "presenting",
  "objection_handling",
  "closing",
  "next_steps",
  "listening",
  "assertiveness",
];

const CUSTOM_SCENARIO_SYSTEM_PROMPT = `You build in-home sales roleplay scenarios for field sales reps.

Given a short description from the rep, output a JSON object with:
- title: short scenario name (3-6 words)
- caller_persona_prompt: a detailed second-person prompt that will be used as the system prompt when YOU later play this customer. Specify their personality, what they want, what they push back on, and how they speak. End with: "Stay in character — do not coach the rep."
- initial_opening: the first line the customer would say, 1-3 sentences, written in their voice.
- disc_type: best fit out of "D", "I", "S", "C", or null if unclear.

Stay grounded in real home-services sales situations (painting, roofing, fence, HVAC, plumbing, electrical, general contractor).`;

const SCORING_SYSTEM_PROMPT = `You score in-home sales roleplay sessions.

Score on these 8 dimensions, each 0-10:
- rapport: Did the rep build trust and connection?
- discovery: Did the rep ask enough open-ended questions to understand the customer?
- presenting: Did the rep frame value clearly and concisely?
- objection_handling: Did the rep acknowledge and address concerns?
- closing: Did the rep move toward commitment?
- next_steps: Did the rep secure a concrete follow-up?
- listening: Did the rep let the customer finish and reflect what they heard?
- assertiveness: Did the rep make clear recommendations without being pushy?

Output a JSON object with:
- overall_score: number 0-10 (average of dimensions)
- dimensions: object mapping each of the 8 dimension keys to a number 0-10
- what_worked: array of 2-4 short bullets, each 1 sentence
- what_to_improve: array of 2-4 short bullets, each 1 sentence
- outcome: one of "closed", "warm_followup", "stalled", "lost"`;

function buildScenarioContext(scenario) {
  return [
    scenario.industry ? `Industry: ${scenario.industry}` : null,
    scenario.scenario_type ? `Scenario type: ${scenario.scenario_type}` : null,
    scenario.disc_type ? `Customer DISC: ${scenario.disc_type}` : null,
    scenario.skills_trained && scenario.skills_trained.length
      ? `Skills trained: ${scenario.skills_trained.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function transcriptToMessages(transcript, scenario) {
  const systemContent = [
    scenario.caller_persona_prompt,
    "",
    buildScenarioContext(scenario),
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [{ role: "system", content: systemContent }];
  for (const turn of transcript || []) {
    if (turn.role === "customer") {
      messages.push({ role: "assistant", content: turn.text });
    } else if (turn.role === "rep") {
      messages.push({ role: "user", content: turn.text });
    }
  }
  return messages;
}

async function generateCustomPersona(customText) {
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CUSTOM_SCENARIO_SYSTEM_PROMPT },
      { role: "user", content: customText },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty persona response");
  const parsed = JSON.parse(raw);
  return {
    title: String(parsed.title || "Custom scenario").slice(0, 80),
    caller_persona_prompt: String(parsed.caller_persona_prompt || ""),
    initial_opening: String(parsed.initial_opening || ""),
    disc_type: ["D", "I", "S", "C"].includes(parsed.disc_type)
      ? parsed.disc_type
      : null,
  };
}

async function generateAiTurn(scenario, transcript) {
  const openai = getOpenAI();
  const messages = transcriptToMessages(transcript, scenario);
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.8,
    messages,
  });
  const text = completion.choices?.[0]?.message?.content?.trim() || "";
  return { role: "customer", text, at: new Date().toISOString() };
}

async function scoreRoleplay(scenario, transcript) {
  const openai = getOpenAI();
  const transcriptText = (transcript || [])
    .map((t) => `${t.role === "customer" ? "CUSTOMER" : "REP"}: ${t.text}`)
    .join("\n\n");

  const userContent = [
    buildScenarioContext(scenario),
    "",
    "Transcript:",
    transcriptText,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SCORING_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty scoring response");
  const parsed = JSON.parse(raw);

  const dimensions = {};
  for (const d of DIMENSIONS) {
    const v = Number(parsed.dimensions?.[d]);
    dimensions[d] = Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : null;
  }
  const overall = Number(parsed.overall_score);

  return {
    overall_score: Number.isFinite(overall) ? Math.max(0, Math.min(10, overall)) : null,
    dimensions,
    what_worked: Array.isArray(parsed.what_worked) ? parsed.what_worked.slice(0, 6).map(String) : [],
    what_to_improve: Array.isArray(parsed.what_to_improve) ? parsed.what_to_improve.slice(0, 6).map(String) : [],
    outcome: ["closed", "warm_followup", "stalled", "lost"].includes(parsed.outcome)
      ? parsed.outcome
      : null,
    scored_at: new Date().toISOString(),
  };
}

module.exports = {
  DIMENSIONS,
  generateCustomPersona,
  generateAiTurn,
  scoreRoleplay,
};
