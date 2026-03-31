"use strict";

const { google } = require("googleapis");
const db = require("./lib/db");
const { getTenantById } = require("./lib/tenant");

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

/** Check if a date/time is available on Google Calendar AND Local DB. */
async function checkAvailability(date, time, tenant = null) {
  const result = { available: false, suggestedTimes: [] };
  
  try {
    const tz = (tenant && tenant.timezone) || "America/Chicago";
    const normalizedTime = normalizeTime(time);
    // 1. Check Local DB for overlapping bookings using strict time comparison
    const localRes = await db.query(
      "SELECT id FROM bookings WHERE tenant_id = $1 AND preferred_date = $2 AND appointment_time::time = $3::time AND status != 'Cancelled'",
      [tenant?.id, date, normalizedTime]
    );
    if (localRes.rows.length > 0) {
      const alternatives = await getAvailableSlots(date, tenant);
      return { available: false, suggestedTimes: alternatives };
    }

    // 2. Check Google Calendar
    const cal = tenant ? getCalendarForTenant(tenant) : calendar;
    if (!cal) return { available: true, suggestedTimes: [] };

    // Calculate end time correctly (1 hour duration)
    const [h, m, s] = normalizedTime.split(":").map(Number);
    const endH = (h + 1) % 24;
    const endStr = `${date}T${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

    const calendarId = (tenant && tenant.google_calendar_id) || "primary";

    const freebusy = await cal.freebusy.query({
      requestBody: {
        timeMin: startStr,
        timeMax: endStr,
        timeZone: tz,
        items: [{ id: calendarId }],
      },
    });

    const busy = freebusy.data.calendars[calendarId].busy || [];
    if (busy.length > 0) {
      const alternatives = await getAvailableSlots(date, tenant);
      return { available: false, suggestedTimes: alternatives };
    }

    return { available: true, suggestedTimes: [] };
  } catch (error) {
    console.error("[Calendar] Availability check failed:", error.message);
    return { available: true, suggestedTimes: [] };
  }
}

/** 
 * Finds available 60-minute slots within business hours for a given day.
 * Respects both local DB and Google Calendar.
 */
async function getAvailableSlots(date, tenant) {
  if (!tenant) return ["9:00 AM", "10:00 AM", "1:00 PM", "2:00 PM"];
  
  try {
    const tz = tenant.timezone || "America/Chicago";
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const [year, month, day] = date.split("-").map(Number);
    const dayDate = new Date(year, month - 1, day);
    const dayName = days[dayDate.getDay()];
    
    const bh = (tenant.business_hours && tenant.business_hours[dayName]) || { open: "08:00", close: "17:00", closed: false };
    if (bh.closed) return [];

    const [openH, openM] = (bh.open || "08:00").split(":").map(Number);
    const [closeH, closeM] = (bh.close || "17:00").split(":").map(Number);

    const busyTimes = [];

    // Local DB Busy - Use time cast for robust matching
    const localBusy = await db.query(
      "SELECT appointment_time::text FROM bookings WHERE tenant_id = $1 AND preferred_date = $2 AND status != 'Cancelled'",
      [tenant.id, date]
    );
    localBusy.rows.forEach(b => {
      const t = normalizeTime(b.appointment_time);
      busyTimes.push({ start: t, end: addHour(t) });
    });

    // Google Busy
    const cal = getCalendarForTenant(tenant);
    if (cal) {
      const startOfDay = `${date}T${String(openH).padStart(2, "0")}:${String(openM).padStart(2, "0")}:00`;
      const endOfDay = `${date}T${String(closeH).padStart(2, "0")}:${String(closeM).padStart(2, "0")}:00`;
      const calendarId = tenant.google_calendar_id || "primary";
      const fb = await cal.freebusy.query({
        requestBody: {
          timeMin: startOfDay,
          timeMax: endOfDay,
          timeZone: tz,
          items: [{ id: calendarId }],
        },
      });
      (fb.data.calendars[calendarId].busy || []).forEach(b => {
        // Extract local time part from Google ISO string (e.g. 2026-03-31T13:30:00-05:00 -> 13:30:00)
        const sTime = b.start.split("T")[1].slice(0, 8);
        const eTime = b.end.split("T")[1].slice(0, 8);
        busyTimes.push({ start: sTime, end: eTime });
      });
    }

    // Generate possible 1-hour slots
    const available = [];
    for (let h = openH; h < closeH; h++) {
      const slotStart = `${String(h).padStart(2, "0")}:00:00`;
      const slotEnd = `${String(h + 1).padStart(2, "0")}:00:00`;
      
      const isBusy = busyTimes.some(b => {
        return (slotStart < b.end && slotEnd > b.start);
      });

      if (!isBusy) {
        const displayH = h % 12 || 12;
        const ampm = h >= 12 ? "PM" : "AM";
        available.push(`${displayH}:00 ${ampm}`);
      }
    }

    return available.slice(0, 5); // Return top 5
  } catch (err) {
    console.error("[Calendar] getAvailableSlots failed:", err.message);
    return [];
  }
}

function addHour(timeStr) {
  const [h, m, s] = timeStr.split(":").map(Number);
  const nextH = (h + 1) % 24;
  return `${String(nextH).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
