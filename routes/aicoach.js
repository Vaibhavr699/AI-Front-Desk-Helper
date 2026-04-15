"use strict";

const express = require("express");
const router = express.Router();
const authLib = require("../lib/auth");

// Require login — at minimum a valid session
router.use((req, res, next) => authLib.authMiddleware(req, res, next));

/**
 * POST /api/ai-coach
 * Proxies streaming requests to the Anthropic API.
 * Body: { messages: [...], system: "..." }
 */
router.post("/", async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[AI Coach] ANTHROPIC_API_KEY not set");
    return res.status(500).json({ error: "AI service not configured" });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        stream: true,
        system: system || "",
        messages,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error("[AI Coach] Anthropic error:", err);
      return res.status(upstream.status).json({ error: "AI service error" });
    }

    // Stream the response straight through to the client
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }

    res.end();
  } catch (err) {
    console.error("[AI Coach] Proxy failed:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

module.exports = router;
