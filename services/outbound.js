"use strict";

const db = require("../lib/db");
const { parse } = require("csv-parse/sync");
const OpenAI = require("openai").default;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Parses CSV buffer and inserts contacts for a campaign.
 */
async function processCSV(campaignId, tenantId, buffer) {
  console.log(`[CSV] Processing buffer, size=${buffer.length}`);
  console.log(`[CSV] First 20 bytes HEX: ${buffer.toString('hex', 0, 20)}`);
  console.log(`[CSV] First 20 bytes ASCII: ${buffer.toString('ascii', 0, 20).replace(/\n/g, '\\n')}`);
  
  let records = [];
  try {
    records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });
  } catch (e) {
    console.warn("[CSV] Comma parsing failed. Trying semicolon...");
    try {
      records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: ';',
        relax_column_count: true
      });
    } catch (e2) {
      console.warn("[CSV] Semicolon parsing also failed.");
    }
  }

  console.log(`[CSV] Parsed ${records.length} records.`);
  const contacts = [];
  for (const row of records) {
    // Normalize keys
    const normalizedRow = {};
    Object.keys(row).forEach(k => {
      const cleanKey = k.replace(/^\uFEFF/, "").trim().toLowerCase();
      normalizedRow[cleanKey] = row[k];
    });

    console.log(`[CSV] Row keys recognized: ${Object.keys(normalizedRow).join(", ")}`);

    let name = normalizedRow.name || normalizedRow.fullname || normalizedRow["full name"] || normalizedRow.contact || normalizedRow.customer || "";
    let phone = normalizedRow.phone || normalizedRow.mobile || normalizedRow.tel || normalizedRow.number || normalizedRow.phone_number || normalizedRow["phone number"] || normalizedRow.phonenumber || "";
    
    // Fallback: If phone is still empty, look for ANY key that contains 'phone' or 'number' or looks like a phone number
    if (!phone) {
       for (const key of Object.keys(normalizedRow)) {
          if (key.includes("phone") || key.includes("number") || key.includes("tel")) {
             phone = normalizedRow[key];
             break;
          }
       }
    }
    
    if (phone) {
      console.log(`[CSV] Contact identified: ${name} / ${phone}`);
      contacts.push({ name: String(name), phone: String(phone) });
    } else {
      console.warn(`[CSV] No phone found in row:`, JSON.stringify(normalizedRow));
    }
  }

  if (contacts.length === 0) return 0;

  // Bulk insert using pg-format or multiple queries (simple here)
  for (const c of contacts) {
    await db.query(
      "INSERT INTO outbound_contacts (campaign_id, tenant_id, name, phone) VALUES ($1, $2, $3, $4)",
      [campaignId, tenantId, c.name, c.phone]
    );
  }

  await db.query(
    "UPDATE outbound_campaigns SET total_contacts = total_contacts + $1 WHERE id = $2",
    [contacts.length, campaignId]
  );

  return contacts.length;
}

/**
 * Generates 5 distinct scripts for Auto mode using OpenAI.
 */
async function generateAutoScripts(campaignId, tenantId, description) {
  const prompt = `
    You are an AI sales script generator. The user has a business described as: "${description}".
    Generate 5 distinct, high-converting opening scripts for an outbound AI voice call.
    Each script should be a concise prompt for the AI (1-2 sentences).
    They should vary in tone (warm, professional, direct, curious, urgent).
    Return them as a JSON array of strings: ["script1", "script2", ...]
  `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(completion.choices[0].message.content);
  const scripts = result.scripts || result;

  const inserted = [];
  const list = Array.isArray(scripts) ? scripts : Object.values(scripts);
  
  for (const content of list.slice(0, 5)) {
    const res = await db.query(
      "INSERT INTO outbound_scripts (campaign_id, content) VALUES ($1, $2) RETURNING *",
      [campaignId, content]
    );
    inserted.push(res.rows[0]);
  }

  return inserted;
}

async function getTrackingBoard(campaignId) {
  const cRes = await db.query("SELECT * FROM outbound_campaigns WHERE id = $1", [campaignId]);
  const campaign = cRes.rows[0];
  if (!campaign) throw new Error("Campaign not found");

  const sRes = await db.query(
    "SELECT id, content, performance_pct, status FROM outbound_scripts WHERE campaign_id = $1",
    [campaignId]
  );
  
  const statsRes = await db.query(`
    SELECT 
      status, 
      COUNT(*) as count 
    FROM outbound_contacts 
    WHERE campaign_id = $1 
    GROUP BY status`, 
    [campaignId]
  );

  return {
    campaign,
    scripts: sRes.rows,
    statusCounts: statsRes.rows.reduce((acc, r) => {
      acc[r.status] = parseInt(r.count, 10);
      return acc;
    }, {}),
  };
}

module.exports = {
  processCSV,
  generateAutoScripts,
  getTrackingBoard,
};
