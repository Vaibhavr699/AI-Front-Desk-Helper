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

/** Check if a date/time is available on Google Calendar (FreeBusy). */
async function checkAvailability(date, time) {
  if (!calendar) {
    console.log("[Calendar] Google Calendar disabled, assuming available.");
    return true;
  }
  
  try {
    // Combine date and time for start/end
    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // Assume 1 hour default

    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: "primary" }],
      },
    });

    const busy = res.data.calendars.primary.busy || [];
    return busy.length === 0;
  } catch (error) {
    console.error("[Calendar] Availability check failed:", error.message);
    return true; // Fail safe to available if check error
  }
}

/** Create an event on Google Calendar from a booking. */
async function syncToGoogleCalendar(booking) {
  if (!calendar) return;

  try {
    const start = new Date(`${booking.preferred_date}T${booking.appointment_time || "09:00:00"}`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const event = {
      summary: `Booking: ${booking.contact_name} (${booking.job_type || "Service"})`,
      description: `Notes: ${booking.notes || "None"}\nScope: ${booking.scope || "N/A"}`,
      location: booking.address ? `${booking.address}, ${booking.city || ""}` : booking.city || "",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };

    const res = await calendar.events.insert({
      calendarId: "primary",
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
  checkAvailability,
  syncToGoogleCalendar
};
