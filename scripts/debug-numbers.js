"use strict";
require("dotenv").config();
const db = require("../lib/db");
async function run() {
    const nums = ["+14027738795", "+19187232665"];
    console.log("--- Phone Number Assignments ---");
    for (const n of nums) {
        const res = await db.query(
            `SELECT pn.phone, t.name as tenant_name, t.id as tenant_id 
       FROM phone_numbers pn 
       JOIN tenants t ON t.id = pn.tenant_id 
       WHERE pn.phone = $1`,
            [n]
        );
        if (res.rows.length === 0) {
            console.log(`Phone: ${n} - NOT FOUND`);
        } else {
            console.log(`Phone: ${n}`);
            console.log(JSON.stringify(res.rows, null, 2));
        }
    }
    process.exit(0);
}
run().catch(console.error);
