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
const privateKeySource = process.env.GOOGLE_PRIVATE_KEY || serviceAccount?.private_key || "";
const privateKey = privateKeySource ? privateKeySource.replace(/\\n/g, "\n") : "";

let calendar = null;

if (clientEmail && privateKey) {
  const auth = new google.auth.JWT(clientEmail, null, privateKey, [
    "https://www.googleapis.com/auth/calendar"
  ]);

  calendar = google.calendar({
    version: "v3",
    auth
  });
} else {
  console.warn(
    "Google Calendar is disabled. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY."
  );
}

module.exports = calendar;
