require("dotenv").config();
const db = require("./lib/db");

async function check() {
  try {
    const res = await db.query("SELECT phone FROM phone_numbers");
    console.log("Assigned Numbers in DB:");
    console.log(res.rows.map(r => r.phone));
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    process.exit(0);
  }
}

check();
