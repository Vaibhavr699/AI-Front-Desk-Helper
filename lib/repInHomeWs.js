"use strict";

const { WebSocketServer } = require("ws");
const auth = require("./auth");
const db = require("./db");

const HEARTBEAT_INTERVAL_MS = 15_000;
const PATH_PREFIX = "/ws/rep/in-home/";

function createInHomeWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    const ctx = ws.repContext;
    console.log(
      "[repInHomeWs] connected session=%s user=%s",
      ctx.session_id,
      ctx.user_id,
    );

    send(ws, {
      type: "session_status",
      status: "connected",
      session_id: ctx.session_id,
      server_time: new Date().toISOString(),
    });

    const heartbeat = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      send(ws, { type: "heartbeat", t: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        send(ws, { type: "echo", binary: true, bytes: raw.length });
        return;
      }
      let parsed = null;
      const text = raw.toString();
      try {
        parsed = JSON.parse(text);
      } catch {}
      send(ws, { type: "echo", received: parsed ?? text });
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      console.log("[repInHomeWs] closed session=%s", ctx.session_id);
    });

    ws.on("error", (err) => {
      console.error(
        "[repInHomeWs] error session=%s:",
        ctx.session_id,
        err.message,
      );
    });
  });

  async function routeUpgrade(req, socket, head, url) {
    const sessionId = url.pathname.slice(PATH_PREFIX.length).split("/")[0];
    const token = url.searchParams.get("token");

    if (!sessionId || !token) {
      rejectSocket(socket, 401, "Missing session_id or token");
      return;
    }

    let decoded;
    try {
      decoded = auth.verifyToken(token);
    } catch {
      rejectSocket(socket, 401, "Invalid token");
      return;
    }
    if (decoded.scope !== "rep") {
      rejectSocket(socket, 403, "Not a rep token");
      return;
    }

    let session;
    try {
      const r = await db.query(
        `SELECT id, tenant_id, user_id, started_at, ended_at
           FROM in_home_sessions
          WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
        [sessionId, decoded.sub, decoded.tenant_id],
      );
      session = r.rows[0];
    } catch (err) {
      console.error("[repInHomeWs] session lookup failed:", err.message);
      rejectSocket(socket, 500, "Server error");
      return;
    }

    if (!session) {
      rejectSocket(socket, 404, "Session not found");
      return;
    }
    if (session.ended_at) {
      rejectSocket(socket, 409, "Session already ended");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.repContext = {
        session_id: session.id,
        user_id: session.user_id,
        tenant_id: session.tenant_id,
      };
      wss.emit("connection", ws, req);
    });
  }

  return { wss, routeUpgrade, PATH_PREFIX };
}

function send(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error("[repInHomeWs] send failed:", err.message);
  }
}

function rejectSocket(socket, status, reason) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

module.exports = { createInHomeWss };
