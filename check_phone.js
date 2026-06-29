const db = require("./lib/db");
async function check() {
  try {
    const res = await db.query("SELECT * FROM phone_numbers WHERE phone LIKE '%918076055898%'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error(e);
  }
  process.exit();
}
check();
