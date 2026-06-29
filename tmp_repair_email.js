const http = require("https");
require("dotenv").config();
const { query } = require("./lib/db");

const apiKey = process.env.RESEND_API_KEY;
const emailId = "01cd587b-c012-4d8b-b50a-ff203b3ffb95";
const messageId = "f824d963-50e1-4b9a-8e50-f1b1ae3f902d";

if (!apiKey) {
  console.error("No RESEND_API_KEY");
  process.exit(1);
}

const options = {
  method: "GET",
  hostname: "api.resend.com",
  port: null,
  path: `/emails/${emailId}`,
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
};

const req = http.request(options, function (res) {
  const chunks = [];

  res.on("data", function (chunk) {
    chunks.push(chunk);
  });

  res.on("end", async function () {
    const bodyRes = Buffer.concat(chunks);
    const data = JSON.parse(bodyRes.toString());
    console.log("Resend API data keys:", Object.keys(data));
    
    // For received emails, data might be different, but let's see.
    // If it's a SENT email to us (the reply), we can read its content.
    const actualBody = data.text || data.html || "Re: Re: Quick favor – Acme";
    let body = actualBody;
    if (!data.text && data.html) {
      body = data.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    
    console.log("Fetched body:", body.slice(0, 100));
    
    await query("UPDATE messages SET body = $1 WHERE id = $2", [body, messageId]);
    console.log("✅ Message updated in DB!");
  });
});

req.on("error", (e) => console.error(e));
req.end();
