"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");

// ─────────────────────────────────────────────────────────
// SEQUENCE DEFINITIONS
// ─────────────────────────────────────────────────────────

/**
 * REVISED 21-day Ghost Sequence
 *
 * Day 0  → SMS: estimate confirmation
 * Day 1  → SMS: check-in / questions
 * Day 3  → SMS: value reminder (what makes us different)
 * Day 5  → CALL + voicemail: first AI call attempt
 * Day 7  → SMS: urgency — schedule filling up
 * Day 10 → CALL + voicemail: second AI call attempt
 * Day 14 → SMS: soft close
 * Day 17 → CALL + voicemail: final AI call attempt
 * Day 21 → SMS: hard close → DORMANT → seasonal campaigns
 */
const GHOST_SEQUENCE = [
  {
    step: "estimate_sent",
    channel: "sms",
    delayHours: 0,
    message: (v) =>
      `Hi ${v.first_name}! Your estimate from ${v.company_name} is ready. Take a look and let us know if you have any questions — we'd love to get you on the schedule!`,
    next: "day1_checkin",
  },
  {
    step: "day1_checkin",
    channel: "sms",
    delayHours: 24,
    message: (v) =>
      `Hey ${v.first_name}, just checking in — did you get a chance to review your estimate? Happy to answer any questions or adjust anything before we lock in your spot.`,
    next: "day3_value",
  },
  {
    step: "day3_value",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Quick note from ${v.company_name} — every project includes a detailed walkthrough, color consultation, and our satisfaction guarantee. We want to make sure you feel great about every detail. Still interested?`,
    next: "day5_call",
  },
  {
    step: "day5_call",
    channel: "call",
    delayHours: 48,
    script:
      "Hi {{first_name}}, this is the AI assistant from {{company_name}}. I'm just calling to follow up on the estimate we sent over. Did you have a chance to look at it, or do you have any questions I can help with? We'd love to get your project on the schedule.",
    voicemail:
      "Hi {{first_name}}, this is {{company_name}} calling about your recent estimate. We wanted to make sure you had a chance to review it and answer any questions. Give us a call back or just reply to our last text whenever you're ready. We look forward to hearing from you!",
    next: "day7_urgency",
  },
  {
    step: "day7_urgency",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Hi ${v.first_name}! ${v.company_name} here — our schedule is starting to fill up for the coming weeks. If you'd like to lock in your spot, now is a great time. Just reply YES and we'll get you scheduled!`,
    next: "day10_call",
  },
  {
    step: "day10_call",
    channel: "call",
    delayHours: 72,
    script:
      "Hi {{first_name}}, this is {{company_name}} reaching out again about your project estimate. I wanted to personally make sure you had everything you need to feel comfortable moving forward. Is there anything holding you back or any questions I can answer?",
    voicemail:
      "Hi {{first_name}}, calling again from {{company_name}} about your estimate. Our schedule is filling up and we want to make sure you don't lose your spot. Please give us a call back or just reply to our text. We're here to help — hope to hear from you soon!",
    next: "day14_softclose",
  },
  {
    step: "day14_softclose",
    channel: "sms",
    delayHours: 96,
    message: (v) =>
      `Hi ${v.first_name}, still thinking things over? Totally understood — it's a big decision. We're here when you're ready. Just reply anytime and we'll pick right up where we left off. — ${v.company_name}`,
    next: "day17_call",
  },
  {
    step: "day17_call",
    channel: "call",
    delayHours: 72,
    script:
      "Hi {{first_name}}, this is {{company_name}} with one final follow-up on your project estimate. We want to make sure we haven't missed you. If now isn't the right time, no worries at all — we just want to make sure you're taken care of whenever you're ready.",
    voicemail:
      "Hi {{first_name}}, this is {{company_name}} with one last message about your estimate. We completely understand if the timing isn't right. Whenever you're ready to move forward — even months from now — just reach out and we'll be happy to help. Have a great day!",
    next: "day21_hardclose",
  },
  {
    step: "day21_hardclose",
    channel: "sms",
    delayHours: 96,
    message: (v) =>
      `Hi ${v.first_name}, we'll go ahead and close out this estimate request for now. If you ever want to revisit your project, we'd love to hear from you — just reach out anytime. Thanks for considering ${v.company_name}!`,
    next: null, // → DORMANT → seasonal campaigns
  },
];

/**
 * "Need to think about it" objection sequence.
 */
const THINKING_SEQUENCE = [
  {
    step: "thinking_ack",
    channel: "sms",
    delayHours: 0,
    message: (v) =>
      `Totally understand — it's a big decision. Is there anything specific you're weighing that I can help with?`,
    next: "thinking_48h_sms",
  },
  {
    step: "thinking_48h_sms",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Just checking back — are you still considering getting this done soon, or waiting a bit?`,
    next: "thinking_48h_call",
  },
  {
    step: "thinking_48h_call",
    channel: "call",
    delayHours: 4,
    script:
      "Just wanted to see where this sits for you so I can plan our schedule properly.",
    voicemail:
      "Hi {{first_name}}, just calling to check in — still here whenever you're ready to talk through the project. Give us a call back or just reply to our text. Talk soon!",
    next: null,
  },
];

/**
 * "Price is high / getting other quotes" objection sequence.
 */
const PRICE_SEQUENCE = [
  {
    step: "price_ack",
    channel: "sms",
    delayHours: 0,
    message: (v) =>
      `I completely understand — most homeowners compare 2–3 options. Besides price, is there anything else important in your decision?`,
    next: "price_48h_sms",
  },
  {
    step: "price_48h_sms",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Quick question — if everything else felt right, would you feel comfortable moving forward?`,
    next: "price_48h_call",
  },
  {
    step: "price_48h_call",
    channel: "call",
    delayHours: 4,
    script:
      "If there's a budget target you're trying to hit, I can see if there's any flexibility.",
    voicemail:
      "Hi {{first_name}}, calling
