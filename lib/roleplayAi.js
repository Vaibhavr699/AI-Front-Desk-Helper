"use strict";

const OpenAI = require("openai");
const scorecards = require("./scorecards");

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

function buildScoringSystemPrompt(dimensions) {
  const dimLines = dimensions
    .map((d) => `- ${d.key}: ${d.criteria || d.label}`)
    .join("\n");
  const keys = dimensions.map((d) => d.key).join('", "');
  return `You score in-home sales roleplay sessions, using the SAME scoring rubric the rep is measured on during real customer visits.

Score on these ${dimensions.length} dimensions, each 0-10:
${dimLines}

A roleplay is a phone/voice practice session, so some dimensions cannot be exercised here (e.g. a physical property walkthrough). For any dimension that had no opportunity to occur in this practice format, score it 5.0 (neutral, no opportunity) and say so in its note — do not penalize the rep for it.

Output a JSON object with:
- overall_score: number 0-10 (average across the dimensions that had a real opportunity)
- dimensions: object mapping each of these exact keys to a number 0-10: "${keys}"
- what_worked: array of 2-4 short bullets, each 1 sentence
- what_to_improve: array of 2-4 short bullets, each 1 sentence
- outcome: one of "closed", "warm_followup", "stalled", "lost"`;
}

const CUSTOM_SCENARIO_SYSTEM_PROMPT = `You build in-home sales roleplay scenarios for field sales reps.

Given a short description from the rep, output a JSON object with:
- title: short scenario name (3-6 words)
- caller_persona_prompt: a detailed second-person prompt that will be used as the system prompt when YOU later play this customer. Specify their personality, what they want, what they push back on, and how they speak. End with: "Stay in character — do not coach the rep."
- initial_opening: the first line the customer would say, 1-3 sentences, written in their voice.
- disc_type: best fit out of "D", "I", "S", "C", or null if unclear.

Stay grounded in real home-services sales situations (painting, roofing, fence, HVAC, plumbing, electrical, general contractor).`;

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

async function scoreRoleplay(scenario, transcript, tenantId) {
  const openai = getOpenAI();
  const dims = await scorecards.getScoringDimensions(tenantId);

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
      { role: "system", content: buildScoringSystemPrompt(dims) },
      { role: "user", content: userContent },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty scoring response");
  const parsed = JSON.parse(raw);

  const dimensions = {};
  for (const d of dims) {
    const v = Number(parsed.dimensions?.[d.key]);
    dimensions[d.key] = Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : null;
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
  generateCustomPersona,
  generateAiTurn,
  scoreRoleplay,
};
