const express = require("express");
const router = express.Router();
const emailService = require("../services/email");

router.post("/contact", async (req, res) => {
  const { name, phone, email, businessName, enquiry, bestTime } = req.body;
  const message = (enquiry && String(enquiry).trim()) || (businessName && String(businessName).trim()) || "";

  if (!name || !phone || !email || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    console.log("[Public] Contact form submission from:", email);
    await emailService.sendContactLeadEmail({ name, phone, email, enquiry: message, bestTime });
    res.json({ success: true, message: "Enquiry submitted successfully" });
  } catch (error) {
    console.error("[Public] Contact form error:", error.message);
    res.status(500).json({ error: "Failed to submit enquiry" });
  }
});

module.exports = router;
