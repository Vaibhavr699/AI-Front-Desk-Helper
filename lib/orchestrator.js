const { isWithinBusinessHours } = require("./timeUtils");

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "book_appointment",
    description: "Finalize and save the booking. Call this ONLY when you have real details from the caller: contact name, contact phone, contact email, and address OR city. NEVER use placeholder or dummy data. Include EVERY detail the caller gave: contact_name, contact_phone, contact_email, address, city, state, scope, job_type, preferred_date, appointment_time, notes, estimated_value, lead_score, and ai_summary.",
    parameters: {
      type: "object",
      properties: {
        contact_name: { type: "string" },
        contact_phone: { type: "string" },
        contact_email: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        scope: { type: "string" },
        job_type: { type: "string" },
        preferred_date: { type: "string", description: "YYYY-MM-DD" },
        appointment_time: { type: "string" },
        notes: { type: "string" },
        estimated_value: { type: "number", description: "Estimated job value in dollars." },
        lead_score: { type: "integer", description: "Score from 1 to 100 based on lead quality." },
        ai_summary: { type: "string" },
      },
      required: ["contact_name", "contact_phone", "address", "estimated_value"],
    },
  },
  {
    type: "function",
    name: "check_availability",
    description: "Check if a specific date and time is available for an appointment.",
    parameters: {
      type: "object",
      properties: {
        appointment_date: { type: "string", description: "YYYY-MM-DD" },
        appointment_time: { type: "string" },
      },
      required: ["appointment_date", "appointment_time"],
    },
  },
  {
    type: "function",
    name: "request_human_transfer",
    description: "Transfer the caller to a live team member. Trigger this for commercial, high-value ($10k+), frustrated callers, or VIPs.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["commercial_job", "high_value_over_10k", "frustrated_caller", "vip_repeat_customer", "caller_requested_human"] },
        summary: { type: "string" },
      },
      required: ["reason", "summary"],
    },
  },
  {
    type: "function",
    name: "change_language",
    description: "Switch to another language (ISO 639-1 code).",
    parameters: {
      type: "object",
      properties: { language: { type: "string" } },
      required: ["language"],
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // cancel_appointment — Phase 4B (May 4, 2026)
  //
  // TWO-PHASE protocol:
  //   PHASE 1 (lookup):  AI calls with just caller_phone. Backend returns
  //                      one of three actions: transfer_to_human (no
  //                      booking found), confirm_with_caller (one match),
  //                      or ask_which_booking (multiple matches).
  //   PHASE 2 (commit):  After explicit caller confirmation, AI calls
  //                      again with confirmed=true + target_booking_id +
  //                      optional cancellation_reason. Backend fires the
  //                      full Phase 1+2+3 cancellation chain (status flip
  //                      + email + bell + customer SMS + lead reset +
  //                      recovery cancel) with cancelled_via='voice'.
  //
  // The split prevents the AI from cancelling on a "maybe" or on the wrong
  // booking when multiple exist. Backend ignores the AI's caller_phone and
  // uses the call's actual From: number — prevents the AI from being
  // tricked into looking up someone else's appointments.
  // ─────────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "cancel_appointment",
    description: "Cancel an upcoming appointment in two phases. PHASE 1 (lookup): call with just caller_phone (the From: number of this call) to find their upcoming bookings. The tool will return whether to transfer to human, confirm a single booking with the caller, or ask which booking. PHASE 2 (commit): AFTER the caller has explicitly confirmed they want to cancel, call this tool AGAIN with confirmed=true, target_booking_id (from the lookup result), and cancellation_reason if you captured one.",
    parameters: {
      type: "object",
      properties: {
        caller_phone: {
          type: "string",
          description: "The caller's phone number — use the From: number of this call. Backend will verify against the actual From: regardless.",
        },
        confirmed: {
          type: "boolean",
          description: "Set to true ONLY in Phase 2, after the caller has explicitly said yes to cancelling a specific appointment.",
        },
        target_booking_id: {
          type: "string",
          description: "The booking_id returned from the Phase 1 lookup. Required when confirmed=true.",
        },
        cancellation_reason: {
          type: "string",
          description: "Optional reason the caller gave for cancelling. Internal-only — never shared with the customer in the SMS. Skip if the caller declined to share.",
        },
      },
      required: ["caller_phone"],
    },
  },
  {
    type: "function",
    name: "reschedule_appointment",
    description: "Reschedule an existing appointment.",
    parameters: {
      type: "object",
      properties: { contact_phone: { type: "string" }, new_date: { type: "string" }, new_time: { type: "string" } },
      required: ["contact_phone", "new_date", "new_time"],
    },
  },
  {
    type: "function",
    name: "hang_up",
    description: "End the call.",
    parameters: { type: "object", properties: {} },
  },
];

const RECOVERY_TOOLS = [
  ...REALTIME_TOOLS.filter(t => ["book_appointment", "check_availability", "change_language", "hang_up"].includes(t.name)),
  {
    type: "function",
    name: "detect_objection",
    description: "Call this when the customer expresses an objection (price, thinking, spouse).",
    parameters: {
      type: "object",
      properties: {
        objection_type: { type: "string", enum: ["price", "thinking", "spouse"] },
        details: { type: "string" },
      },
      required: ["objection_type"],
    },
  },
];

function getAIConfig(context) {
  const { tenant, isOutbound, isRecovery, isNurturing, recoveryScript, outboundScript, format = "realtime" } = context;
  const useRecoveryFlow = isRecovery || isOutbound || (isNurturing && recoveryScript);

  const instructions = buildInstructions(context);
  let tools = useRecoveryFlow ? RECOVERY_TOOLS : REALTIME_TOOLS;
  const voice = isOutbound ? (tenant?.outbound_voice || "ash") : (tenant?.inbound_voice || process.env.OPENAI_REALTIME_VOICE || "shimmer");

  if (format === "chat") {
    tools = tools.map(t => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  return { instructions, tools, voice };
}

// ═════════════════════════════════════════════════════════════════════
// Cancellation flow rules — Phase 4B (May 4, 2026)
//
// Walks the AI through the two-phase cancel_appointment protocol. Only
// applied to inbound calls (REALTIME_TOOLS path) — recovery/outbound
// flows don't expose cancel_appointment.
//
// Decisions locked May 4, 2026 (Drew):
//   • Hybrid resolver (1 booking → confirm; multiple → list; 0 → transfer)
//   • Repeat back date+time, wait for explicit yes
//   • Ask casually for reason (option B)
//   • Offer reschedule + wrap-up
//   • Edge cases: no booking found OR booking in past → transfer
//   • Different number than booking → transfer (handled implicitly:
//     backend filters to caller's actual From: number, so no match ⇒
//     transfer)
// ═════════════════════════════════════════════════════════════════════
const CANCELLATION_FLOW_RULES = [
  "",
  "CANCELLATION FLOW: When the caller says they want to cancel an appointment, follow this two-phase protocol exactly.",
  "PHASE 1 — LOOKUP: Immediately call cancel_appointment with caller_phone set to the call's From: number. Do NOT ask the caller for their phone or appointment date first — the lookup handles it. The tool will return one of three actions:",
  "  (a) action=transfer_to_human → Tell the caller something like 'I don't see any upcoming appointments under this number — let me transfer you to someone who can help.' Then call request_human_transfer with reason='caller_requested_human'.",
  "  (b) action=confirm_with_caller → The tool returns ONE booking with a friendly date/time string. Repeat it back to confirm: 'I see you have an appointment [friendly]. Should I go ahead and cancel that for you?' Wait for an explicit YES (yes / yeah / correct / please / go ahead). If they say no or hesitate, do NOT cancel — clarify what they want instead.",
  "  (c) action=ask_which_booking → The tool returns multiple bookings. List them naturally: 'I see a few appointments under this number — the first is [friendly1], the second is [friendly2]. Which one would you like to cancel?' After they pick, confirm: 'Just to make sure, you want to cancel the [chosen friendly] one — is that right?' Wait for explicit yes.",
  "PHASE 1.5 — REASON CAPTURE (after explicit yes, before commit): Ask casually, in one short sentence: 'No problem — was there anything specific that came up, just so we can let the team know?' If they share a reason, capture it. If they decline or just say no, move on without pushing.",
  "PHASE 2 — COMMIT: Call cancel_appointment AGAIN with: confirmed=true, target_booking_id=<id from lookup>, caller_phone=<same as before>, cancellation_reason=<what they said, or omit if they declined>. The tool will fire the cancellation and return success.",
  "AFTER CANCEL: Once the tool returns success, say: 'Got it — you'll get a text confirmation in a moment. Would you like to set up a new time, or just leave things for now?' If they want to reschedule → start the booking flow. If not → say something brief and warm like 'No problem, have a good one!' and STOP. Do NOT call hang_up — let the call end naturally.",
  "STRICT RULES: Never cancel without explicit yes. Never skip the date repeat-back. Never invent a booking that wasn't in the lookup result. Never use the cancellation reason in anything you say to the caller — it's internal-only.",
];

function buildInstructions(context) {
  const { tenant, isOutbound, isRecovery, isNurturing, recoveryScript, outboundScript } = context;
  const useRecoveryFlow = isRecovery || isOutbound || (isNurturing && recoveryScript);

  const baseInboundRules = [
    `You are a professional receptionist for ${tenant?.company_name || 'the business'}. Be warm and helpful.`,
    "FLOW: (1) Welcome, (2) Ask name/need, (3) Answer FAQs, (4) Get details, (5) Ask budget, (6) Book.",
  ];

  const baseOutboundRules = [
    `You are ${tenant?.outbound_agent_name || 'Alex'} for ${tenant?.company_name || 'the business'}.`,
    "MANDATORY OPENING: 'Hi, this is [Name] from [Business]...'",
    `STRATEGY: ${outboundScript || "Follow up on previous request."}`,
  ];

  const universalRules = [
    `TONE: ${tenant?.tone_of_voice || 'professional'}.`,
    "Always collect: Name, Phone, Email, Address, Scope.",
    "MANDATORY BUDGET: Always ask 'Do you have a specific budget range?' before booking. Estimate $500 per room if unknown.",
    "STRICT: No placeholder data. No hallucinations.",
    "OFFICE STATUS: " + (isWithinBusinessHours(tenant) ? "OPEN. Transfer allowed for high-value/commercial." : "CLOSED. No transfers."),
  ];

  let rules = [...(isOutbound ? baseOutboundRules : baseInboundRules), ...universalRules];

  // Cancellation flow — inbound only. Recovery/outbound flows don't have
  // cancel_appointment in their tool list, so the rules would be confusing
  // there. Order: append AFTER universal rules so the cancellation
  // protocol shows up as a distinct, clearly-marked subsection.
  if (!useRecoveryFlow) {
    rules = rules.concat(CANCELLATION_FLOW_RULES);
  }

  // Tenant specific
  if (tenant?.instructions) rules.push("GUIDELINES: " + tenant.instructions);
  if (isOutbound && tenant?.outbound_instructions) rules.push("OUTBOUND GUIDELINES: " + tenant.outbound_instructions);

  // Time context
  const tz = tenant?.timezone || "America/Chicago";
  const now = new Date();
  rules.push(`CONTEXT: Today is ${now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Time is ${now.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}.`);

  let instructions = rules.join("\n");

  if (useRecoveryFlow && recoveryScript) {
    instructions = `START BY SAYING EXACTLY: "${recoveryScript}"\n\n${instructions}\n\nGOAL: Move them toward booking. Call detect_objection if they hesitate due to price, thinking, or spouse.`;
  }

  return instructions;
}

module.exports = { getAIConfig, REALTIME_TOOLS, RECOVERY_TOOLS };
