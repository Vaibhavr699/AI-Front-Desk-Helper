require('dotenv').config();

async function listPages() {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  console.log(`Testing token: ${token.substring(0, 15)}...`);

  try {
    // If it's a User Token, /me/accounts lists pages they manage
    // If it's a Page Token, /me/accounts might not work, but /me gives the page info
    
    console.log("\n--- Checking /me (Self Identify) ---");
    const meResp = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name,category&access_token=${token}`);
    const meData = await meResp.json();
    console.log(JSON.stringify(meData, null, 2));

    console.log("\n--- Checking /me/accounts (Managed Pages) ---");
    const accResp = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${token}`);
    const accData = await accResp.json();
    if (accData.data) {
      console.log(`Found ${accData.data.length} accounts/pages:`);
      accData.data.forEach(p => {
        console.log(`- ${p.name} (ID: ${p.id})`);
      });
    } else {
      console.log("No accounts/pages found via /me/accounts");
      if (accData.error) console.log("Error:", accData.error.message);
    }

  } catch (err) {
    console.error("List failed:", err.message);
  } finally {
    process.exit();
  }
}

listPages();
