"use strict";

const { google } = require("googleapis");

function getCalendarClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google Calendar credentials in ENV.");
  }

  const auth = new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/calendar"]
  );

  return google.calendar({
    version: "v3",
    auth,
  });
}

module.exports = {
  getCalendarClient,
};
