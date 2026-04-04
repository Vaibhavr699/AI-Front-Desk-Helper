const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'follow_ups\';')
  .then(res => { console.log("follow_ups columns:", res.rows); return pool.query('SELECT * FROM follow_ups LIMIT 1'); })
  .then(res => { console.log("follow_ups sample:", res.rows); pool.end(); })
  .catch(err => { console.error(err); pool.end(); });
