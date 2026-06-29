"use strict";

const db = require("../lib/db");

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;
const TOKEN_PREFIX = "ExponentPushToken[";

function isValidExpoToken(token) {
  return typeof token === "string" && token.startsWith(TOKEN_PREFIX) && token.endsWith("]");
}

async function fetchTokensForUsers(userIds) {
  if (!userIds || userIds.length === 0) return [];
  const r = await db.query(
    `SELECT id, expo_push_token
       FROM dashboard_users
      WHERE id = ANY($1::uuid[])
        AND expo_push_token IS NOT NULL`,
    [userIds],
  );
  return r.rows
    .filter((row) => isValidExpoToken(row.expo_push_token))
    .map((row) => ({ user_id: row.id, token: row.expo_push_token }));
}

async function clearToken(token) {
  try {
    await db.query(
      "UPDATE dashboard_users SET expo_push_token = NULL WHERE expo_push_token = $1",
      [token],
    );
    console.log("[pushNotifications] cleared invalid token %s", token);
  } catch (err) {
    console.error("[pushNotifications] failed to clear token: %s", err.message);
  }
}

async function postBatch(messages) {
  const res = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    throw new Error(`Expo push HTTP ${res.status}`);
  }
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

async function sendPushToUsers(userIds, payload) {
  const list = Array.isArray(userIds) ? userIds : [userIds];
  const unique = [...new Set(list.filter(Boolean))];
  if (unique.length === 0) return { sent: 0, dropped: 0 };

  const targets = await fetchTokensForUsers(unique);
  if (targets.length === 0) return { sent: 0, dropped: unique.length };

  const { title, body, data, sound = "default", priority = "high", channelId = "default" } = payload;
  const messages = targets.map((t) => ({
    to: t.token,
    sound,
    title,
    body,
    data: data || {},
    priority,
    channelId,
  }));

  let sent = 0;
  let dropped = 0;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const slice = messages.slice(i, i + BATCH_SIZE);
    try {
      const tickets = await postBatch(slice);
      tickets.forEach((ticket, idx) => {
        if (ticket?.status === "ok") {
          sent++;
        } else {
          dropped++;
          const code = ticket?.details?.error;
          if (code === "DeviceNotRegistered") {
            clearToken(slice[idx].to);
          } else {
            console.warn(
              "[pushNotifications] ticket error code=%s message=%s",
              code || "unknown",
              ticket?.message || "no message",
            );
          }
        }
      });
    } catch (err) {
      dropped += slice.length;
      console.error("[pushNotifications] batch send failed: %s", err.message);
    }
  }
  return { sent, dropped };
}

async function notifyAppointmentBooked(booking) {
  if (!booking?.technician_id) return { sent: 0, dropped: 0 };
  const when = formatAppointmentWhen(booking);
  const who = booking.contact_name || "a new customer";
  return sendPushToUsers(booking.technician_id, {
    title: "New appointment booked",
    body: `${when} with ${who}.`,
    data: {
      type: "appointment_booked",
      booking_id: booking.id,
      lead_id: booking.lead_id || null,
      deep_link: booking.lead_id ? `/(tabs)/leads/${booking.lead_id}` : "/(tabs)",
    },
  });
}

async function notifyBriefingReady(booking) {
  if (!booking?.technician_id || !booking?.lead_id) return { sent: 0, dropped: 0 };
  const when = formatAppointmentWhen(booking);
  return sendPushToUsers(booking.technician_id, {
    title: "Pre-visit briefing ready",
    body: `Heads-up for your ${when} appointment.`,
    data: {
      type: "briefing_ready",
      booking_id: booking.id,
      lead_id: booking.lead_id,
      deep_link: `/(tabs)/leads/${booking.lead_id}`,
    },
  });
}

function formatAppointmentWhen(booking) {
  const t = booking.appointment_time || "";
  const hm = typeof t === "string" ? t.slice(0, 5) : "";
  if (!hm) return "Your appointment";
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  if (!Number.isFinite(h)) return "Your appointment";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

module.exports = {
  sendPushToUsers,
  notifyAppointmentBooked,
  notifyBriefingReady,
};
