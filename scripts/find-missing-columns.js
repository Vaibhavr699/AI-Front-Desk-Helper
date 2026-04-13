const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../lib/db');

async function findMissingColumns() {
  const dumpPath = path.join(__dirname, '..', 'migration_data.json');
  const data = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  
  for (const table of Object.keys(data)) {
    if (!data[table] || data[table].length === 0) continue;
    
    // Get cols from DB
    const colsRes = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
    `, [table]);
    
    const validColumns = new Set(colsRes.rows.map(r => r.column_name));
    
    // Get cols from JSON
    const jsonKeys = Object.keys(data[table][0]);
    
    const missing = jsonKeys.filter(k => !validColumns.has(k));
    if (missing.length > 0) {
      console.log(`Table ${table} is missing columns:`);
      for (const m of missing) {
        // Guess type
        let sample = null;
        for (const row of data[table]) {
            if (row[m] !== null && row[m] !== undefined) {
                sample = row[m];
                break;
            }
        }
        console.log(` - ${m} (Sample: ${sample}, Type: ${typeof sample})`);
      }
    }
  }
  process.exit();
}

findMissingColumns();
