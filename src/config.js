import dotenv from "dotenv";
import crypto from "node:crypto";

dotenv.config();

export const isProd = process.env.NODE_ENV === "production";

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    console.error("FATAL: JWT_SECRET must be set in production.");
    process.exit(1);
  }
  // Development only: sessions are invalidated on every restart.
  jwtSecret = crypto.randomBytes(48).toString("hex");
  console.warn("JWT_SECRET is not set; using a temporary secret for this run.");
}

const frontendUrl = (process.env.FRONTEND_URL || "https://velizon.com").replace(/\/$/, "");

export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret,
  jwtExpiresInSeconds: 12 * 60 * 60,
  frontendUrl,
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        frontendUrl,
        process.env.FRONTEND_URL_WWW,
      ].filter(Boolean),
  company: {
    name: "Velizon Logistics",
    brand: "Velizon",
    address: process.env.COMPANY_ADDRESS || "1 World Way, Los Angeles, CA 90045, USA",
    supportEmail: process.env.SUPPORT_EMAIL || "support@velizon.com",
    phone: process.env.SUPPORT_PHONE || "+1 (315) 202-9671",
  },
  email: {
    apiKey: process.env.SENDGRID_API_KEY,
    from: process.env.FROM_EMAIL || process.env.SUPPORT_EMAIL || "support@velizon.com",
    adminTo: process.env.ADMIN_EMAIL,
  },
};
