"use strict";

function clientKey(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  return function (req, res, next) {
    const now = Date.now();

    if (hits.size > 10000) {
      for (const [key, entry] of hits) {
        if (entry.reset <= now) hits.delete(key);
      }
    }

    const key = clientKey(req);
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.reset - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: message || "Too many requests. Please try again in a moment.",
        code: "RATE_LIMITED",
        retry_after_seconds: retryAfter,
      });
    }

    next();
  };
}

module.exports = { rateLimit };
