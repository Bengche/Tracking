import express from "express";
import rateLimit from "express-rate-limit";
import { sendContactInquiry } from "./emailService.js";
import { isEmail } from "./validation.js";

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many messages. Please try again later." },
});

router.post("/", contactLimiter, (req, res) => {
  const { name, email, subject, message, website } = req.body || {};

  // Hidden honeypot field: real visitors leave it empty.
  if (website) return res.json({ success: true, message: "Your message has been received." });

  if (![name, email, message].every((v) => typeof v === "string" && v.trim())) {
    return res.status(400).json({ error: "Name, email and message are required." });
  }
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (name.length > 120 || email.length > 160 || message.length > 5000) {
    return res.status(400).json({ error: "One of the fields is too long." });
  }

  res.json({
    success: true,
    message: "Your message has been received. We will reply by email.",
  });

  sendContactInquiry({
    name: name.trim(),
    email: email.trim(),
    subject: (typeof subject === "string" && subject.trim().slice(0, 160)) || "General enquiry",
    message: message.trim(),
  }).catch((err) => console.error("[email] sendContactInquiry failed:", err.message));
});

export default router;
