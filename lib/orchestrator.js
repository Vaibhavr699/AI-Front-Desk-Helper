const { isWithinBusinessHours } = require("./timeUtils");

// ═══════════════════════════════════════════════════════════════════════════
// REALTIME_TOOLS — full tool catalog, exported as-is for any external code
// that imports it. The actual list of tools sent to OpenAI in a given session
// is built dynamically in getAIConfig() based on tenant.estimator_enabled.
// ═══════════════════════════════════════════════════════════════════════════
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
  // ─────────────────────────────────────────────────────────────────────────
  // send_estimate_link — Phase E1 (May 4, 2026)
  //
  // Sends the caller an SMS with a link to the hosted estimator page. Defined
  // here in the catalog, but only included in the per-session tool list if
  // tenant.estimator_enabled === true (Phase E1.3, May 4, 2026 — see
  // getAIConfig below).
  //
  // Phase E1.1 (May 4, 2026): also exposed in recovery flow via
  // RECOVERY_TOOLS filter, gated by the same estimator_enabled check.
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "send_estimate_link",
    description: "Send the customer an SMS with a link to fill out a free instant estimate. CALL THIS TOOL when the customer asks for a price, quote, estimate, 'how much does it cost', wants to revise the scope of an existing estimate, or has lost their original estimate link. Before calling: verbally confirm the phone number with the customer, e.g., 'Is (xxx) xxx-xxxx still the best number to text the link to?' Wait for their answer, then call this tool ONCE. Default caller_phone to the call's From: number. If the customer gives a different number, use that one instead. CRITICAL: You MUST actually call this tool — do not just describe sending the link in conversation, that does nothing.",
    parameters: {
      type: "object",
      properties: {
        caller_phone: {
          type: "string",
          description: "The phone number to text the link to. Default to the call's From: number, but if the customer asked you to text a different number, use that instead.",
        },
      },
      required: ["caller_phone"],
    },
  },
  // ─────────────────────────────────────────────────────────────────────────
  // request_do_not_contact — TCPA opt-out (Migration 060, May 9, 2026)
  //
  // Flags the caller as do-not-contact, cancels all active recoveries +
  // nurturing schedules for them, and triggers an auto-hangup safety net.
  // Available in BOTH inbound and recovery flows because outbound recovery
  // is the most common place "stop calling me!" is heard.
  //
  // The matching system prompt (DNC_FLOW_RULES) is appended in
  // buildInstructions() below — outside the if(!useRecoveryFlow) gate, so
  // the AI gets the same instructions whether inbound or outbound.
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "request_do_not_contact",
    description: "Flag the caller as do-not-contact (DNC) and stop all future calls, SMS, and nurturing. Call this ONLY when the caller EXPLICITLY requests to be removed from all contact — phrases like 'don't call me again', 'stop calling me', 'take me off your list', 'do not contact me', 'remove me', or 'opt me out'. DO NOT call this for general frustration ('this is annoying', 'I'm busy', 'you're not helping') without explicit opt-out language. DO NOT call this for cancellation requests — use cancel_appointment for those. After this tool returns success, give a brief warm acknowledgment in ONE sentence, then call hang_up. Do NOT argue, do NOT ask for a reason, do NOT try to retain the caller.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Optional: the exact opt-out phrase the caller used, captured for audit log compliance. E.g. 'caller said: take me off your list'. Omit if unclear.",
        },
      },
    },
  },
  {
    type: "function",
    name: "hang_up",
    description: "End the call.",
    parameters: { type: "object", properties: {} },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// RECOVERY_TOOLS — used for outbound recovery + nurturing callbacks.
// Same dynamic-filtering note as REALTIME_TOOLS: the catalog includes
// send_estimate_link, but it's filtered out at session-build time when the
// tenant doesn't have the estimator enabled.
//
// Migration 060 (May 9, 2026): request_do_not_contact added to whitelist.
// Outbound recovery is where "stop calling me!" is most likely to fire, so
// the tool must be available here too — not just inbound.
// ═══════════════════════════════════════════════════════════════════════════
const RECOVERY_TOOLS = [
  ...REALTIME_TOOLS.filter(t => ["book_appointment", "check_availability", "change_language", "hang_up", "send_estimate_link", "request_do_not_contact"].includes(t.name)),
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

  // ─────────────────────────────────────────────────────────────────────────
  // Phase E1.3 (May 4, 2026) — estimator-off fallback.
  //
  // If the tenant doesn't have the estimator enabled, strip send_estimate_link
  // from the tool list. Without this, the AI would fire the tool, the SMS
  // would send, but the customer would tap the link and hit a 404 (the
  // /q/:tenantId route gates on estimator_enabled and returns "This estimator
  // isn't set up yet"). Bad UX.
  //
  // The matching prompt swap (ESTIMATE_LINK_RULES vs IN_PERSON_ESTIMATE_RULES)
  // happens in buildInstructions below — same gate, same flag.
  // ─────────────────────────────────────────────────────────────────────────
  if (!tenant?.estimator_enabled) {
    tools = tools.filter(t => t.name !== "send_estimate_link");
  }

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

// ═══════════════════════════════════════════════════════════════════════════
// Cancellation flow rules — Phase 4B (May 4, 2026)
//
// Inbound-only: cancel_appointment is NOT in RECOVERY_TOOLS, so this
// prompt would reference a tool the recovery AI doesn't have.
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// DNC (do-not-contact) flow rules — Migration 060 (May 9, 2026)
//
// Applied to BOTH inbound and recovery flows. TCPA compliance demands that
// any explicit opt-out request is honored immediately, with no retention
// attempt, no argument, no "are you sure?" probing.
//
// Hard separation from cancel_appointment:
//   - cancel_appointment = remove one specific booking, keep the customer
//   - request_do_not_contact = remove the entire customer from all outreach
//
// Hard separation from frustration handling:
//   - "this is annoying", "you're not helping" = NOT DNC. Offer transfer.
//   - "stop calling me", "take me off your list" = DNC. Fire the tool.
//
// When the AI fires request_do_not_contact, the server also schedules a
// safety-net hangup 5s out in case the AI forgets to call hang_up itself.
// That's a defense-in-depth — Alex SHOULD still call hang_up after the
// acknowledgment, per the rules below.
// ═══════════════════════════════════════════════════════════════════════════
const DNC_FLOW_RULES = [
  "",
  "DO-NOT-CONTACT (DNC) FLOW — TCPA compliance, follow exactly:",
  "Trigger phrases that REQUIRE you to immediately call request_do_not_contact:",
  `  - "don't call me again" / "stop calling me" / "do not call me"`,
  `  - "take me off your list" / "remove me from your list"`,
  `  - "do not contact me" / "don't contact me again" / "never call me again"`,
  `  - "unsubscribe" / "opt me out" / "remove me"`,
  "DO NOT call request_do_not_contact for general frustration without an explicit opt-out phrase:",
  `  - "this is annoying" / "you're not helping" / "this is wasting my time"`,
  `  - "I'm busy right now" (this is a callback request, NOT a removal request)`,
  `  - General rudeness, swearing, or hostility without explicit opt-out language`,
  "DO NOT confuse with cancellation — these go through cancel_appointment, NOT request_do_not_contact:",
  `  - "cancel my appointment" / "I want to cancel" → cancel_appointment`,
  `  - "I don't need the appointment" → cancel_appointment`,
  "When in doubt, ask ONCE before firing the tool: 'Just to confirm — would you like me to remove you from our contact list entirely, or just end this call?' If they say remove from list → fire request_do_not_contact. If they just want the current call to end → call hang_up.",
  "AFTER request_do_not_contact returns success: Say in ONE short sentence, calm and warm, exactly something like 'Got it. I'll make sure you're removed from our list right away. Take care.' Then IMMEDIATELY call hang_up. Do NOT argue. Do NOT try to retain. Do NOT ask why. Do NOT offer alternatives. The opt-out is final.",
  "STRICT RULES: Never call request_do_not_contact without an explicit opt-out phrase. Never call it instead of hang_up when the caller just wants the call to end. Never call it for cancellations.",
];

// ═══════════════════════════════════════════════════════════════════════════
// Estimate link rules — Phase E1 (May 4, 2026)
//
// Applied when tenant.estimator_enabled === true. Tells the AI to use the
// send_estimate_link tool to text customers a link to a self-serve estimate
// instead of trying to quote prices verbally.
//
// Phase E1.1 (May 4, 2026): rules apply to BOTH inbound and recovery flows
// when the estimator is enabled.
// ═══════════════════════════════════════════════════════════════════════════
const ESTIMATE_LINK_RULES = [
  "",
  "ESTIMATE / PRICING REQUESTS: When the customer asks for a price, quote, estimate, 'how much does it cost', wants to revise the scope of an existing estimate, or says they lost the original estimate link, follow this exact flow:",
  "  STEP 1 — Acknowledge briefly: 'Happy to send you a link to a free instant estimate — takes about 60 seconds.' (Or if they're revising: 'No problem, I can send you a fresh link to redo that — takes about 60 seconds.')",
  "  STEP 2 — Confirm the cell number: 'Is the number you're calling from still the best one to text the link to?' (For outbound calls, phrase as: 'Is this still the best number to text it to?') Wait for their answer.",
  "  STEP 3 — Call the send_estimate_link TOOL once. If they confirmed yes → caller_phone = the call's From: number. If they gave a different number → caller_phone = that new number.",
  "  STEP 4 — After the tool returns success, say: 'Just sent it — should be in your messages now. Fill it out and you'll get an instant ballpark range, then you can book a walkthrough right from there.' Briefly confirm they received it.",
  "  STEP 5 — If the tool returns failure, apologize and call request_human_transfer with reason='caller_requested_human'.",
  "CRITICAL: You MUST actually CALL the send_estimate_link tool. Do NOT just describe the action in conversation — saying 'I'll send you a link' without calling the tool does NOTHING. The tool is what sends the actual SMS. Calling it is mandatory.",
  "Do NOT try to give a verbal price estimate yourself, even if pressed. Always route pricing questions through the estimator link.",
];

// ═══════════════════════════════════════════════════════════════════════════
// In-person estimate rules — Phase E1.3 (May 4, 2026)
//
// Applied when tenant.estimator_enabled === false. The send_estimate_link
// tool is NOT available in this state (filtered out in getAIConfig), so the
// AI needs an alternate path when customers ask for pricing. Default
// behavior: offer to schedule a free in-person estimate via book_appointment.
//
// Why this exists: contractors who haven't paid for the estimator add-on
// (or have it temporarily disabled while configuring services) shouldn't
// have their AI fall back to either (a) quoting prices verbally, or
// (b) sending a link that goes to a 404. Both create bad UX. Instead, route
// pricing requests through the existing booking flow.
// ═══════════════════════════════════════════════════════════════════════════
const IN_PERSON_ESTIMATE_RULES = [
  "",
  "ESTIMATE / PRICING REQUESTS: When the customer asks for a price, quote, estimate, or 'how much does it cost', do NOT quote a number verbally. The team needs to see the project to give an accurate price.",
  "Instead, offer a free in-person estimate. Say something like: 'I'd love to give you an exact number — every project is a little different, so the best way is to have someone come out for a free in-person estimate. Want me to find a time that works?'",
  "If they say yes, go through the standard booking flow: collect their name, phone, email, address, and a brief description of the scope. Then ask for a preferred date and time. When you have all the details, call the book_appointment tool.",
  "If they push back asking for a ballpark over the phone, politely hold the line: 'I totally get that — unfortunately every job is different enough that anything I'd say would just be a guess. The free in-person estimate takes about 30 minutes and you'll get an exact, written number. Want me to set that up?'",
  "STRICT RULES: Never quote a price verbally. Never invent a number. Never promise a specific dollar range. Always route pricing questions through the in-person estimate booking.",
];

// ═══════════════════════════════════════════════════════════════════════════
// Contact info & lead capture rules — May 13, 2026
//
// Two related rules bundled together because they both shape how the AI
// handles identifying info from the caller:
//
// 1. CONFIRM SPELLED-OUT CONTACT INFO — Whisper mishears letters frequently.
//    The Mitu Bansal transcript (May 13) showed the AI capturing
//    "munnilata@gmail.com" without reading it back, putting the entire lead
//    at risk if any letter was wrong. We now require letter-by-letter
//    confirmation for emails, unusual names, and addresses.
//
// 2. AGGRESSIVE LEAD CAPTURE — The Winston transcript (May 13) showed the
//    AI using the name "Winston" in its reply but never saving it to the
//    lead record (capture_lead_info was never called). The AI tends to skip
//    capture_lead_info when it doesn't think the caller will book. Fix:
//    explicitly require capture_lead_info to fire on ANY identifying detail,
//    regardless of perceived intent.
//
// Applied to BOTH inbound and recovery flows because both flows can hear
// names/emails from callers. ═══════════════════════════════════════════════════════════════════════════
const CONTACT_INFO_RULES = [
  "",
  "═══ CONFIRM SPELLED-OUT CONTACT INFO ═══",
  "Whisper transcription frequently mishears spelled letters and unusual names. When the caller spells ANY of the following letter-by-letter, you MUST read it back for confirmation BEFORE moving on:",
  "  - Email addresses (ALWAYS confirm — these are the most error-prone)",
  "  - Names that aren't common English names",
  "  - Street addresses with unusual spellings",
  "How to confirm:",
  "  - Read it back EXACTLY as you understood it, letter-by-letter for emails and unusual names",
  "  - Example: 'Got it — let me confirm. That's M, U, N, N, I, L, A, T, A at gmail dot com. Is that correct?'",
  "  - If they correct any letter, repeat the FULL corrected version back and ask again",
  "  - Only proceed to the next question after the caller explicitly confirms (yes, correct, that's right)",
  "DO NOT skip this confirmation step because the caller seems in a hurry. A wrong email means the estimate never reaches them and the lead is lost. Two extra seconds is cheap insurance.",
  "For common English first names spoken normally (Drew, Sarah, John, etc.) — confirmation is NOT required. Only confirm when spelled out or when the name is unusual.",
  "",
  "═══ ALWAYS CAPTURE IDENTIFYING DETAILS ═══",
  "Whenever the caller mentions ANY identifying detail, IMMEDIATELY call the capture_lead_info tool. Do NOT wait for a 'full' set of information. Do NOT gate this on whether the caller seems likely to book.",
  "Trigger capture_lead_info on ANY of these the moment you hear them:",
  "  - The caller says their name (first only, last only, or both): 'Hi, this is Sarah' → call capture_lead_info with contact_name='Sarah'",
  "  - An email address: call with contact_email after you've confirmed it (see spelled-out rule above)",
  "  - A phone number different from the call's From: number",
  "  - A street address or city",
  "  - A project description (interior, exterior, deck, cabinets, etc.) → set scope or project_type",
  "Use the EXACT text the caller provided — do not infer last names, do not guess at spelling, do not 'clean up' what they said.",
  "Call capture_lead_info MULTIPLE TIMES in a single call as new details come in. Each call is incremental — fields you didn't include stay as they were.",
  "Even if the caller says they're 'just asking a question' or 'not ready to book' — STILL capture whatever they shared. The dashboard needs to know who you spoke with.",
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

  // Cancellation flow rules — inbound only. cancel_appointment is NOT in
  // RECOVERY_TOOLS, so adding the prompt to recovery would tell the AI
  // about a tool it doesn't have access to (confusing failure mode).
  if (!useRecoveryFlow) {
    rules = rules.concat(CANCELLATION_FLOW_RULES);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DNC flow rules — Migration 060 (May 9, 2026)
  //
  // Applies to BOTH inbound AND recovery flows, because request_do_not_contact
  // is now in BOTH REALTIME_TOOLS and RECOVERY_TOOLS. Outbound is actually
  // where these phrases are most likely to fire ("stop calling me!") so the
  // recovery AI needs the same playbook the inbound AI has.
  // ─────────────────────────────────────────────────────────────────────────
  rules = rules.concat(DNC_FLOW_RULES);

  // ─────────────────────────────────────────────────────────────────────────
  // Contact info confirmation + aggressive lead capture (May 13, 2026)
  //
  // Applies to both inbound and recovery flows because both hear caller
  // names, emails, and addresses. The two rules in this block fix bugs
  // discovered in the Mitu Bansal + Winston transcripts respectively.
  // ─────────────────────────────────────────────────────────────────────────
  rules = rules.concat(CONTACT_INFO_RULES);

  // ─────────────────────────────────────────────────────────────────────────
  // Phase E1.3 (May 4, 2026) — estimator-on vs estimator-off prompt swap.
  //
  // Same gate as the tool filter in getAIConfig. When the estimator is on,
  // tell the AI to use send_estimate_link. When it's off, tell the AI to
  // route pricing questions through book_appointment for an in-person
  // estimate instead. Both paths are well-defined; the AI never falls back
  // to "improvise a price" or "describe sending a link that does nothing."
  // ─────────────────────────────────────────────────────────────────────────
  if (tenant?.estimator_enabled) {
    rules = rules.concat(ESTIMATE_LINK_RULES);
  } else {
    rules = rules.concat(IN_PERSON_ESTIMATE_RULES);
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
