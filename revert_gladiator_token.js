const { query } = require('./lib/db');

async function revert() {
  const originalToken = 'EAAbgJTWZC5wEBQCWPxQcHAyHj1WyvK2qhET62i63l4TLkWMg7gbUo9hYeNboufhsrRa47Lyi6hSpY9UI01oprTZASjTDS7rJZCNtZCyOolu4mGzaSVZCUDL6USggX3PJAxLVxKyxzHQV8swnbXS0ppw8hI46ovgDuMx274fFGOZCpqL3Rt9Lv4Vs6xxGDIx3FDkmidewZDZD';
  try {
    await query("UPDATE tenants SET facebook_page_access_token = $1 WHERE facebook_page_id = '566954113178482'", [originalToken]);
    console.log("Reverted Gladiator Painting token in DB");
  } catch (err) {
    console.error("Revert failed:", err.message);
  } finally {
    process.exit();
  }
}

revert();
