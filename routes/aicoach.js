"use strict";

const express = require("express");
const router = express.Router();
const authLib = require("../lib/auth");
const fetch = require("node-fetch");

// Require login
router.use((req, res, next) => authLib.authMiddleware(req, res, next));

/**
 * POST /api/ai-coach
 * Proxies streaming requests to OpenAI Chat Completions API (gpt-4o).
 * Body: { messages: [...], system: "..." }
 */
router.post("/", async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[AI Coach] OPENAI_API_KEY not set");
    return res.status(500).json({ error: "AI service not configured" });
  }

  // Prepend system prompt
  const openaiMessages = [
    { role: "system", content: system || "You are a helpful AI business coach." },
    ...messages,
  ];

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1000,
        stream: true,
        messages: openaiMessages,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error("[AI Coach] OpenAI error:", err);
      return res.status(upstream.status).json({ error: "AI service error" });
    }

    // Stream response straight through to the client
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    upstream.body.pipe(res);

    upstream.body.on("error", (err) => {
      console.error("[AI Coach] Stream error:", err.message);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    console.error("[AI Coach] Proxy failed:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

module.exports = router;
