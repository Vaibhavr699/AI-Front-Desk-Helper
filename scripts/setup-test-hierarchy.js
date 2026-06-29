require('dotenv').config();
const db = require('../lib/db');

async function setup() {
  const GLADIATOR_ID = 'a2942de5-5bfd-4cb1-8071-9207fe290a4b';
  const ACME_ID = '6513da73-0adb-441d-b74a-6086bed43b5c';

  // 1. Set Gladiator Painting as parent
  await db.query(
    "UPDATE tenants SET business_type = 'parent' WHERE id = $1",
    [GLADIATOR_ID]
  );
  console.log('✅ Gladiator Painting → parent');

  // 2. Create Gladiators NY (child of Gladiator)
  const ny = await db.query(
    `INSERT INTO tenants (name, slug, company_name, business_type, parent_id)
     VALUES ('Gladiators NY', 'gladiators-ny', 'Gladiators Painting', 'location', $1)
     ON CONFLICT (slug) DO UPDATE SET business_type = 'location', parent_id = $1
     RETURNING id, name`,
    [GLADIATOR_ID]
  );
  console.log('✅ Created/updated:', ny.rows[0]);

  // 3. Create Gladiators NJ (child of Gladiator)
  const nj = await db.query(
    `INSERT INTO tenants (name, slug, company_name, business_type, parent_id)
     VALUES ('Gladiators NJ', 'gladiators-nj', 'Gladiators Painting', 'location', $1)
     ON CONFLICT (slug) DO UPDATE SET business_type = 'location', parent_id = $1
     RETURNING id, name`,
    [GLADIATOR_ID]
  );
  console.log('✅ Created/updated:', nj.rows[0]);

  // 4. Set Acme Painting as parent
  await db.query(
    "UPDATE tenants SET business_type = 'parent' WHERE id = $1",
    [ACME_ID]
  );
  console.log('✅ Acme Painting → parent');

  // 5. Create Acme Downtown (child of Acme)
  const acmeDown = await db.query(
    `INSERT INTO tenants (name, slug, company_name, business_type, parent_id)
     VALUES ('Acme Downtown', 'acme-downtown', 'Acme', 'location', $1)
     ON CONFLICT (slug) DO UPDATE SET business_type = 'location', parent_id = $1
     RETURNING id, name`,
    [ACME_ID]
  );
  console.log('✅ Created/updated:', acmeDown.rows[0]);

  // Verify
  const all = await db.query(
    "SELECT id, name, company_name, business_type, parent_id FROM tenants ORDER BY business_type, name"
  );
  console.log('\n📋 All tenants:');
  console.table(all.rows);

  process.exit(0);
}

setup().catch(e => { console.error(e); process.exit(1); });
