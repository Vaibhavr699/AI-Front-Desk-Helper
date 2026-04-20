const fetch = require("node-fetch");
const token = "EAAbgJTWZC5wEBRG427tOaZCN8VFakl2KH9rJKlzZAFWcxiN4wpH2Pi87FrcEERwzC74wmUACnedvfoZBM7m7QzOeXPqxOouvUPWxEiD9qZBIJ9DNX1voGf4I4vm9hzCt6CIZAmM8WsvFZCRrNNzgKnvlSiMRC19ne9ek47WeqbM6TjTyqOV3MNt3uZBtPkMKzqZCVxsBHogZDZD";

async function testToken() {
  try {
    const url = `https://graph.facebook.com/v18.0/me?access_token=${token}`;
    const resp = await fetch(url);
    const data = await resp.json();
    console.log("Token check response for Acme Painting:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Fetch failed:", err.message);
  }
}

testToken();
