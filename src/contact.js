import express from "express";
import { sendContactInquiry } from "./emailService.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res
      .status(400)
      .json({ error: "Name, email and message are required." });
  }

  // Basic email format check at the boundary
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  res.json({
    success: true,
    message: "Your message has been received. We'll be in touch shortly.",
  });

  // Fire email non-blocking after responding
  sendContactInquiry({
    name: name.trim(),
    email: email.trim(),
    subject: subject?.trim() || "(No subject)",
    message: message.trim(),
  }).catch((err) =>
    console.error("[email] sendContactInquiry failed:", err.message),
  );
});

export default router;
