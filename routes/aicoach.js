"use strict";

const express = require("express");
const router  = express.Router();
const authLib = require("../lib/auth");
const fetch   = require("node-fetch");

// All requests require a valid login token
router.use((req, res, next) => authLib.authMiddleware(req, res, next));

/**
 * POST /api/ai-coach
 * Streams an OpenAI gpt-4o response back to the client.
 *
 * Request body:
 *   { messages: Array<{role, content}>, system: string }
 *
 * Response:
 *   text/event-stream — raw OpenAI SSE chunks piped straight through
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

  // Prepend the system prompt as the first message
  const openaiMessages = [
    {
      role:    "system",
      content: system || "You are an elite business performance coach specialising in home service businesses.",
    },
    ...messages,
  ];

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:      "gpt-4o",
        max_tokens: 1200,
        stream:     true,
        messages:   openaiMessages,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[AI Coach] OpenAI error:", errText);
      return res.status(upstream.status).json({ error: "AI service error" });
    }

    // Stream the raw SSE bytes straight through to the browser
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");

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
