const db = require("./lib/db");
async function check() {
  try {
    const users = await db.query("SELECT * FROM dashboard_users LIMIT 1");
    console.log(JSON.stringify(users.rows[0], null, 2));
  } catch (e) {
    console.error(e);
  }
  process.exit();
}
check();
