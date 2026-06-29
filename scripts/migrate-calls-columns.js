require('dotenv').config();
const { pool } = require("../lib/db");

async function migrate() {
    try {
        console.log("Starting migration: status, disposition, and transcript columns...");

        // Add columns if they don't exist
        await pool.query(`
      ALTER TABLE calls 
      ADD COLUMN IF NOT EXISTS disposition TEXT,
      ADD COLUMN IF NOT EXISTS transcript TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_progress';
    `);

        console.log("Migration complete!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err.message);
        process.exit(1);
    }
}

migrate();
