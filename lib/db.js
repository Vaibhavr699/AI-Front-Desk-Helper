"use strict";

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => console.error("DB pool error:", err));

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (process.env.NODE_ENV === "development" && ms > 100) {
    console.log("Query time:", ms, "ms", text.slice(0, 80));
  }
  return res;
}

function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
