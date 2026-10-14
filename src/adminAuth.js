import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import db from "./db.js";
import { config } from "./config.js";

const router = express.Router();

// Compared against when the email is unknown so response time does not reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many sign-in attempts. Try again in a few minutes." },
});

/** Express middleware: requires a valid admin Bearer token. */
export function authenticateToken(req, res, next) {
  const header = req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (!decoded.isAdmin) throw new Error("not admin");
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Your session is invalid or has expired." });
  }
}

const publicAdmin = (a) => ({
  id: a.adminId ?? a.id,
  email: a.email,
  name: a.name,
  isAdmin: a.isAdmin ?? a.is_admin,
  isOwner: a.isOwner ?? a.is_owner,
});

router.post("/login", loginLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required." });
  }

  const { rows } = await db.query(
    "SELECT id, email, name, password, is_admin, is_owner FROM admins WHERE email = $1 AND is_admin = true",
    [email],
  );
  const admin = rows[0];
  const valid = await bcrypt.compare(password, admin?.password || DUMMY_HASH);

  if (!admin || !valid) {
    return res.status(401).json({ success: false, message: "Incorrect email or password." });
  }

  const payload = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    isAdmin: admin.is_admin,
    isOwner: admin.is_owner,
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresInSeconds });

  db.query("UPDATE admins SET last_login = NOW() WHERE id = $1", [admin.id]).catch(() => {});

  res.json({
    success: true,
    token,
    expiresIn: config.jwtExpiresInSeconds,
    admin: publicAdmin(payload),
  });
});

router.get("/verify", authenticateToken, (req, res) => {
  res.json({ success: true, admin: publicAdmin(req.admin) });
});

router.get("/profile", authenticateToken, (req, res) => {
  res.json({ success: true, admin: publicAdmin(req.admin) });
});

// Tokens are stateless; the client discards its copy.
router.post("/logout", authenticateToken, (req, res) => {
  res.json({ success: true });
});

export default router;
