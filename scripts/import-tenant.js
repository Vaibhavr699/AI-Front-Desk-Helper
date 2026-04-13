const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../lib/db');

async function importMigrationData() {
  console.log("Starting import to new database...");
  const dumpPath = path.join(__dirname, '..', 'migration_data.json');
  
  if (!fs.existsSync(dumpPath)) {
    console.error("No migration_data.json found. Please run export-tenant.js first.");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  console.log(`Loaded data: ${data.tenants.length} tenants, ${data.dashboard_users.length} users.`);

  try {
    // Helper to generate SQL INSERT dynamically based ONLY on existing columns
    const insertData = async (tableName, rows) => {
      if (!rows || rows.length === 0) return;
      
      // Get valid columns from the DB
      const colsRes = await db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName]);
      
      const validColumns = new Set(colsRes.rows.map(r => r.column_name));
      if (validColumns.size === 0) {
        console.error(`Table ${tableName} does not exist in target database.`);
        return;
      }
      
      // Filter out any JSON keys that are not valid columns
      const jsonKeys = Object.keys(rows[0]);
      const validKeysToInsert = jsonKeys.filter(k => validColumns.has(k));
      
      if (validKeysToInsert.length === 0) {
         console.warn(`No valid matching columns found for table ${tableName}. Skipping.`);
         return;
      }

      console.log(`Table ${tableName}: Inserting ${validKeysToInsert.length} valid columns (Skipped ${jsonKeys.length - validKeysToInsert.length})`);
      
      const placeholders = validKeysToInsert.map((_, i) => `$${i + 1}`).join(', ');
      const query = `INSERT INTO ${tableName} (${validKeysToInsert.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
      
      let count = 0;
      
      // Special sort for tenants to avoid FK failure (parents before children)
      if (tableName === 'tenants') {
         rows.sort((a, b) => {
            if (!a.parent_id && b.parent_id) return -1;
            if (a.parent_id && !b.parent_id) return 1;
            return 0;
         });
      }

      for (const row of rows) {
        // Serialize objects/arrays to JSON strings to avold "invalid input syntax for type json"
        const values = validKeysToInsert.map(k => {
           let val = row[k];
           if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
               return JSON.stringify(val);
           }
           return val;
        });

        try {
          await db.query(query, values);
          count++;
        } catch (e) {
          console.error(`Error inserting into ${tableName} [ID: ${row.id}]:`, e.message);
        }
      }
      console.log(`Inserted ${count}/${rows.length} rows into ${tableName}.`);
    };

    // The order here STRICTLY MATTERS because of Foreign Keys
    const tablesInOrder = [
      'tenants',
      'dashboard_users',
      'outbound_campaigns',
      'phone_numbers',
      'leads',
      'calls',
      'messages',
      'technicians',
      'bookings',
      'estimate_recoveries',
      'campaign_log',
      'sms_consents',
      'notifications'
    ];

    for (const table of tablesInOrder) {
      if (data[table]) {
        console.log(`Processing table: ${table}`);
        await insertData(table, data[table]);
      } else {
        console.log(`Skipping table: ${table} (no data)`);
      }
    }

    console.log("✅ Data successfully imported into the new database!");
    process.exit(0);

  } catch (error) {
    console.error("Fatal import error:", error);
    process.exit(1);
  }
}

importMigrationData();
