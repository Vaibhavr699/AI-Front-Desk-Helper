"use strict";

const { normalizeE164Phone } = require("./phone");

/** Zap/DripJobs sometimes receive the literal key if mapping is wrong; drop those so CRM gets empty instead of garbage. */
function stripLiteralFieldLeak(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^(full_name|first_name|last_name|phone|email|address|appointment_details|contact_name|contact_phone|contact_email)$/i.test(s)) {
    return "";
  }
  return s;
}

/** Prefer E.164 for US numbers so CRMs stop showing "Not Known". */
function normalizePhoneForCrm(raw) {
  const rawTrim = String(raw ?? "").trim();
  if (!rawTrim) return "";
  return normalizeE164Phone(rawTrim, { allowNonDialable: true }) || rawTrim;
}

function splitDisplayName(displayName) {
  const cleaned = stripLiteralFieldLeak(displayName);
  if (!cleaned) return { first_name: "", last_name: "", full_name: "" };
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || "",
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : "",
    full_name: cleaned,
  };
}

function buildBookingAppointmentDetails(booking) {
  const lines = [];
  const jobType = stripLiteralFieldLeak(booking.job_type);
  const scope = stripLiteralFieldLeak(booking.scope);
  const notes = stripLiteralFieldLeak(booking.notes);
  const email = stripLiteralFieldLeak(booking.contact_email);
  const address = stripLiteralFieldLeak(booking.address);
  if (jobType) lines.push(`Job type: ${jobType}`);
  if (scope) lines.push(`Scope: ${scope}`);
  if (notes) lines.push(notes);
  if (email) lines.push(`Email: ${email}`);
  if (address) lines.push(`Address: ${address}`);
  if (booking.appointment_time) lines.push(`Preferred time: ${booking.appointment_time}`);
  const joined = lines.filter(Boolean).join("\n");
  const fallback = notes || scope || "";
  return joined || fallback;
}

function buildLeadThreadAppointmentDetails({ jobType, scope, details, timeRaw }) {
  const lines = [];
  const jt = stripLiteralFieldLeak(jobType);
  const sc = stripLiteralFieldLeak(scope);
  const det = stripLiteralFieldLeak(details);
  if (jt) lines.push(`Job type: ${jt}`);
  if (sc) lines.push(`Scope: ${sc}`);
  if (det) lines.push(det);
  if (timeRaw) lines.push(`Preferred time: ${timeRaw}`);
  return lines.filter(Boolean).join("\n\n").trim();
}

module.exports = {
  stripLiteralFieldLeak,
  normalizePhoneForCrm,
  splitDisplayName,
  buildBookingAppointmentDetails,
  buildLeadThreadAppointmentDetails,
};
