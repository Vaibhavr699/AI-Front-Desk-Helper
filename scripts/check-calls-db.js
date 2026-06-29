require('dotenv').config();
const { pool } = require("../lib/db");

async function check() {
    try {
        const res = await pool.query("SELECT id, status, disposition, transcript FROM calls ORDER BY started_at DESC LIMIT 5");
        console.log(JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error("Check failed:", err.message);
        process.exit(1);
    }
}

check();
