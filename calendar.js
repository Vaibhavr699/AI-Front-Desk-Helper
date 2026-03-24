"use strict";

const { google } = require("googleapis");

function parseServiceAccountJson(rawValue) {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === "object" && parsed.type === "service_account") {
      return parsed;
    }
  } catch (error) {
    console.error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON:", error.message);
  }

  return null;
}

const serviceAccount = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "");

const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || serviceAccount?.client_email || "";
let privateKey = process.env.GOOGLE_PRIVATE_KEY || serviceAccount?.private_key || "";

let calendar = null;

if (clientEmail && privateKey) {
  // Handle the case where the key is wrapped in quotes or has escaped newlines
  privateKey = privateKey.replace(/^"(.*)"$/, '$1').replace(/\\n/g, "\n");

  try {
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/calendar"]
    });

    calendar = google.calendar({
      version: "v3",
      auth
    });
  } catch (error) {
    console.error("Error initializing Google Calendar authentication:", error.message);
  }
} else {
  console.warn(
    "Google Calendar is disabled. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY."
  );
}

/**
 * Get a Google Calendar client for a specific tenant.
 * Uses the tenant's OAuth2 refresh token if available, otherwise falls back to the global service account.
 * Returns null if neither is configured.
 */
function getCalendarForTenant(tenant) {
  // 1. Try tenant's own OAuth2 refresh token
  if (tenant && tenant.google_refresh_token) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (clientId && clientSecret) {
      try {
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
        oauth2.setCredentials({ refresh_token: tenant.google_refresh_token });
        return google.calendar({ version: "v3", auth: oauth2 });
      } catch (e) {
        console.error("[Calendar] Failed to create tenant OAuth2 calendar:", e.message);
      }
    }
  }

  // 2. Fall back to global service account
  return calendar;
}

/** Normalize a time string into HH:MM:SS format. Handles AM/PM and 24h. */
function normalizeTime(raw) {
  const s = String(raw || "").trim();
  if (!s) return "09:00:00";

  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] || 0);
    const suf = ampm[3].toLowerCase();
    if (suf === "pm" && h < 12) h += 12;
    if (suf === "am" && h === 12) h = 0;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`;
  }

  const h24 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (h24) {
    return `${String(h24[1]).padStart(2,"0")}:${h24[2]}:${h24[3] || "00"}`;
  }

  return "09:00:00";
}

/** Check if a date/time is available on Google Calendar (FreeBusy). */
async function checkAvailability(date, time, tenant = null) {
  const cal = tenant ? getCalendarForTenant(tenant) : calendar;
  if (!cal) {
    console.log("[Calendar] Google Calendar disabled, assuming available.");
    return true;
  }
  
  try {
    const tz = (tenant && tenant.timezone) || "America/Chicago";
    const normalizedTime = normalizeTime(time);
    // Build an ISO-like string with no offset — Google interprets it relative to the timeZone parameter
    const startStr = `${date}T${normalizedTime}`;
    const endDate = new Date(`${startStr}Z`);
    endDate.setUTCHours(endDate.getUTCHours() + 1);
    const endStr = `${date}T${String(endDate.getUTCHours()).padStart(2,"0")}:${String(endDate.getUTCMinutes()).padStart(2,"0")}:00`;

    const calendarId = (tenant && tenant.google_calendar_id) || "primary";

    const res = await cal.freebusy.query({
      requestBody: {
        timeMin: startStr,
        timeMax: endStr,
        timeZone: tz,
        items: [{ id: calendarId }],
      },
    });

    const busy = res.data.calendars[calendarId].busy || [];
    return busy.length === 0;
  } catch (error) {
    console.error("[Calendar] Availability check failed:", error.message);
    return true; // Fail safe to available if check error
  }
}

/** Create an event on Google Calendar from a booking. */
async function syncToGoogleCalendar(booking, tenant = null) {
  const cal = tenant ? getCalendarForTenant(tenant) : calendar;
  if (!cal) return;

  try {
    const tz = (tenant && tenant.timezone) || "America/Chicago";
    const normalizedTime = normalizeTime(booking.appointment_time);
    const dateStr = String(booking.preferred_date || "").trim();

    // Build start/end as plain datetime strings — let Google interpret them in the tenant's timezone
    const startDateTime = `${dateStr}T${normalizedTime}`;
    // Calculate end time (1 hour later) using simple hour math
    const [hh, mm, ss] = normalizedTime.split(":").map(Number);
    const endH = (hh + 1) % 24;
    const endDateTime = `${dateStr}T${String(endH).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;

    const calendarId = (tenant && tenant.google_calendar_id) || "primary";

    const event = {
      summary: `Booking: ${booking.contact_name} (${booking.job_type || "Service"})`,
      description: `Notes: ${booking.notes || "None"}\nScope: ${booking.scope || "N/A"}`,
      location: booking.address ? `${booking.address}, ${booking.city || ""}` : booking.city || "",
      start: { dateTime: startDateTime, timeZone: tz },
      end: { dateTime: endDateTime, timeZone: tz },
    };

    const res = await cal.events.insert({
      calendarId,
      requestBody: event,
    });

    console.log("[Calendar] Event created:", res.data.htmlLink);
    return res.data;
  } catch (error) {
    console.error("[Calendar] Sync failed:", error.message);
  }
}

module.exports = {
  instance: calendar,
  getCalendarForTenant,
  checkAvailability,
  syncToGoogleCalendar
};
