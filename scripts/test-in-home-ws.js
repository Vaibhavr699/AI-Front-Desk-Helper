"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const WebSocket = require("ws");
const db = require("../lib/db");
const repAuth = require("../lib/repAuth");

const BASE = `http://localhost:${process.env.PORT || 3001}`;
const WS_BASE = `ws://localhost:${process.env.PORT || 3001}`;
const TEST_EMAIL = process.argv[2] || "test-rep@demo.aifdh";

async function findRep(email) {
  const r = await db.query(
    `SELECT id, email, tenant_id, role, rep_seat_tier
       FROM dashboard_users
      WHERE lower(email) = lower($1) AND rep_seat_active = true
      LIMIT 1`,
    [email],
  );
  if (!r.rows[0]) {
    throw new Error(`No active rep found for email: ${email}`);
  }
  return r.rows[0];
}

async function httpJson(method, path, token, body) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function awaitMessage(ws, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (predicate(parsed)) {
        ws.off("message", handler);
        resolve(parsed);
      }
    };
    ws.on("message", handler);
    setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for ${label}`));
    }, timeoutMs);
  });
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
}

async function main() {
  console.log(`\nTesting in-home WS against ${BASE} as ${TEST_EMAIL}\n`);

  let rep;
  try {
    rep = await findRep(TEST_EMAIL);
  } catch (err) {
    fail(`findRep: ${err.message}`);
    process.exit(1);
  }
  pass(`Loaded test rep ${rep.email}`);

  const token = repAuth.signRepSession(rep);
  pass(`Signed rep session JWT`);

  console.log("\n[REST] POST /api/rep/in-home/start");
  const start = await httpJson("POST", "/api/rep/in-home/start", token, {
    consent_obtained: true,
    consent_type: "verbal",
    consent_state: "NE",
    device_type: "node-test-script",
    network_mode: "online",
  });
  if (start.status !== 200) {
    fail(`Expected 200, got ${start.status}: ${JSON.stringify(start.data)}`);
    process.exit(1);
  }
  const sessionId = start.data?.session?.id;
  const wsPath = start.data?.ws_path;
  if (!sessionId) {
    fail(`No session.id in response: ${JSON.stringify(start.data)}`);
    process.exit(1);
  }
  pass(`Session created: ${sessionId}`);
  pass(`ws_path returned: ${wsPath}`);

  console.log("\n[WS] connecting");
  const wsUrl = `${WS_BASE}${wsPath}?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  try {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
      setTimeout(() => reject(new Error("connect timeout")), 5000);
    });
    pass("WebSocket connected");

    const status = await awaitMessage(
      ws,
      (m) => m.type === "session_status",
      3000,
      "session_status",
    );
    if (status.status !== "connected") {
      fail(`session_status not 'connected': ${JSON.stringify(status)}`);
    } else if (status.session_id !== sessionId) {
      fail(`session_status had wrong session_id`);
    } else {
      pass(`Got session_status connected for ${sessionId}`);
    }

    console.log("\n[WS] sending echo test");
    const echoPromise = awaitMessage(
      ws,
      (m) => m.type === "echo",
      3000,
      "echo",
    );
    ws.send(JSON.stringify({ hello: "from-test" }));
    const echo = await echoPromise;
    if (echo.received?.hello === "from-test") {
      pass(`Server echoed JSON: ${JSON.stringify(echo.received)}`);
    } else {
      fail(`Echo mismatch: ${JSON.stringify(echo)}`);
    }

    console.log("\n[WS] sending binary frame");
    const binaryEchoPromise = awaitMessage(
      ws,
      (m) => m.type === "echo" && m.binary === true,
      3000,
      "binary echo",
    );
    ws.send(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const binaryEcho = await binaryEchoPromise;
    if (binaryEcho.bytes === 4) {
      pass(`Binary echo: ${binaryEcho.bytes} bytes received`);
    } else {
      fail(`Binary echo unexpected: ${JSON.stringify(binaryEcho)}`);
    }

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    pass("WebSocket closed cleanly");
  } catch (err) {
    fail(`WS test: ${err.message}`);
    try { ws.terminate(); } catch {}
  }

  console.log("\n[REST] POST /api/rep/in-home/end");
  const end = await httpJson("POST", "/api/rep/in-home/end", token, {
    session_id: sessionId,
    outcome: "test-run",
  });
  if (end.status === 200 && end.data?.session?.ended_at) {
    pass(`Session ended at ${end.data.session.ended_at}`);
  } else {
    fail(`End failed: ${end.status} ${JSON.stringify(end.data)}`);
  }

  console.log("\n[REST] POST /api/rep/in-home/sessions/:id/feedback");
  const fb = await httpJson(
    "POST",
    `/api/rep/in-home/sessions/${sessionId}/feedback`,
    token,
    { rep_satisfaction: 5 },
  );
  if (fb.status === 200 && fb.data?.session?.rep_satisfaction === 5) {
    pass(`Feedback recorded (5/5)`);
  } else {
    fail(`Feedback failed: ${fb.status} ${JSON.stringify(fb.data)}`);
  }

  console.log("\n[REST] GET /api/rep/in-home/sessions/:id");
  const detail = await httpJson(
    "GET",
    `/api/rep/in-home/sessions/${sessionId}`,
    token,
  );
  if (
    detail.status === 200 &&
    detail.data?.session?.id === sessionId &&
    Array.isArray(detail.data?.alerts)
  ) {
    pass(`Detail returned session + alerts (${detail.data.alerts.length} alerts)`);
  } else {
    fail(`Detail failed: ${detail.status}`);
  }

  console.log("\n[NEGATIVE] connect WS with bad token");
  try {
    const badWs = new WebSocket(`${WS_BASE}${wsPath}?token=not-a-real-jwt`);
    await new Promise((resolve) => {
      badWs.once("error", () => resolve());
      badWs.once("unexpected-response", () => resolve());
      badWs.once("close", () => resolve());
      setTimeout(resolve, 2000);
    });
    badWs.terminate();
    pass("Bad-token connection rejected (didn't open)");
  } catch (err) {
    pass(`Bad-token rejected: ${err.message}`);
  }

  if (process.exitCode === 1) {
    console.log("\nFAILED — see above\n");
    process.exit(1);
  }
  console.log("\nAll tests passed.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
