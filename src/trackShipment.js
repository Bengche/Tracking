import express from "express";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import db from "./db.js";
import { publicShipment } from "./shipmentModel.js";
import { geocode } from "./geocode.js";
import { SHIPMENT_DOCUMENTS } from "./documents.js";
import { isEmail } from "./validation.js";
import { emailEnabled, sendSubscriptionConfirmation, sendChangeRequestAlert } from "./emailService.js";

const router = express.Router();

const limiter = (windowMs, limit, error) =>
  rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error } });

const lookupLimiter = limiter(60 * 1000, 40, "Too many lookups. Please wait a moment and try again.");
const routeLimiter = limiter(60 * 1000, 20, "Too many requests. Please wait a moment and try again.");
const subscribeLimiter = limiter(15 * 60 * 1000, 5, "Too many attempts. Please try again later.");
const verifyLimiter = limiter(15 * 60 * 1000, 15, "Too many attempts. Please try again later.");

const clean = (v, max = 60) => String(v || "").trim().slice(0, max);
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

async function findShipment(trackingNumber) {
  const { rows } = await db.query("SELECT * FROM shipments WHERE UPPER(tracking_number) = UPPER($1) LIMIT 1", [
    clean(trackingNumber),
  ]);
  return rows[0] || null;
}

router.get("/shipment_details/:trackingNumber", lookupLimiter, async (req, res) => {
  const trackingNumber = clean(req.params.trackingNumber);
  if (!trackingNumber) return res.status(400).json({ error: "Enter a tracking number." });

  const shipment = await findShipment(trackingNumber);
  if (!shipment) return res.status(404).json({ error: "Shipment not found", tracking_number: trackingNumber });

  const events = await db.query(
    "SELECT * FROM shipment_events WHERE shipment_id = $1 ORDER BY occurred_at DESC, id DESC",
    [shipment.id],
  );
  res.set("Cache-Control", "no-store");
  res.json(publicShipment(shipment, events.rows));
});

// ------------------------------------------------------------------ route map
const norm = (s) => String(s || "").trim().toLowerCase();

router.get("/route/:trackingNumber", routeLimiter, async (req, res) => {
  const s = await findShipment(req.params.trackingNumber);
  if (!s) return res.status(404).json({ error: "Shipment not found" });

  const events = await db.query(
    "SELECT status, location, occurred_at FROM shipment_events WHERE shipment_id = $1 ORDER BY occurred_at ASC, id ASC",
    [s.id],
  );

  const raw = [];
  const push = (label, kind, status = null, occurredAt = null) => {
    const text = String(label || "").trim();
    if (text) raw.push({ label: text, kind, status, occurred_at: occurredAt });
  };
  push([s.origin_location, s.origin_country].filter(Boolean).join(", "), "origin", null, s.created_at);
  events.rows.forEach((e) => push(e.location, "event", e.status, e.occurred_at));
  push(s.current_location, "current", s.shipment_status, s.last_update);
  push([s.destination_location, s.destination_country].filter(Boolean).join(", "), "destination");

  // Merge consecutive duplicates; the later entry wins so "current" and "destination" keep their meaning.
  const merged = [];
  for (const stop of raw) {
    const last = merged[merged.length - 1];
    if (last && norm(last.label) === norm(stop.label)) {
      merged[merged.length - 1] = { ...last, ...stop, kind: stop.kind === "event" ? last.kind : stop.kind };
    } else merged.push(stop);
  }

  const stops = [];
  for (const stop of merged.slice(0, 14)) {
    // Retry with progressively less specific text, e.g. "Lekki, Lagos, Nigeria" -> "Lagos, Nigeria".
    const parts = stop.label.split(",").map((p) => p.trim()).filter(Boolean);
    let point = null;
    for (let i = 0; i < Math.min(parts.length, 3) && !point; i += 1) point = await geocode(parts.slice(i).join(", "));
    if (point) stops.push({ ...stop, lat: point.lat, lng: point.lng });
  }

  res.set("Cache-Control", "public, max-age=300");
  res.json({ stops, approximate: true });
});

// ------------------------------------------------------------ email updates
router.post("/:trackingNumber/subscribe", subscribeLimiter, async (req, res) => {
  const shipment = await findShipment(req.params.trackingNumber);
  if (!shipment) return res.status(404).json({ error: "Shipment not found" });
  const email = clean(req.body?.email, 160).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });

  const reply = { success: true, message: "If that address is valid we have sent a confirmation link." };
  const existing = await db.query("SELECT * FROM tracking_subscriptions WHERE shipment_id = $1 AND email = $2", [
    shipment.id,
    email,
  ]);
  const row = existing.rows[0];
  if (row?.confirmed_at && !row.unsubscribed_at) return res.status(202).json(reply);

  const token = crypto.randomBytes(24).toString("hex");
  if (row) {
    await db.query(
      "UPDATE tracking_subscriptions SET confirm_token = $1, unsubscribed_at = NULL, confirmed_at = NULL, created_at = NOW() WHERE id = $2",
      [token, row.id],
    );
  } else {
    await db.query(
      "INSERT INTO tracking_subscriptions (shipment_id, email, confirm_token, unsubscribe_token) VALUES ($1, $2, $3, $4)",
      [shipment.id, email, token, crypto.randomBytes(24).toString("hex")],
    );
  }
  if (emailEnabled()) {
    sendSubscriptionConfirmation(shipment, email, token).catch((e) =>
      console.error("[email] subscription confirmation failed:", e.message),
    );
  }
  res.status(202).json(reply);
});

router.post("/subscriptions/confirm", verifyLimiter, async (req, res) => {
  const token = clean(req.body?.token, 100);
  const { rows } = await db.query(
    `UPDATE tracking_subscriptions SET confirmed_at = COALESCE(confirmed_at, NOW()), unsubscribed_at = NULL
      WHERE confirm_token = $1 AND created_at > NOW() - INTERVAL '7 days' RETURNING shipment_id`,
    [token],
  );
  if (!rows[0]) return res.status(400).json({ error: "This confirmation link is invalid or has expired." });
  const s = await db.query("SELECT tracking_number FROM shipments WHERE id = $1", [rows[0].shipment_id]);
  res.json({ success: true, tracking_number: s.rows[0]?.tracking_number });
});

router.post("/subscriptions/unsubscribe", verifyLimiter, async (req, res) => {
  const token = clean(req.body?.token, 100);
  const { rows } = await db.query(
    "UPDATE tracking_subscriptions SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()) WHERE unsubscribe_token = $1 RETURNING shipment_id",
    [token],
  );
  if (!rows[0]) return res.status(400).json({ error: "This unsubscribe link is not valid." });
  const s = await db.query("SELECT tracking_number FROM shipments WHERE id = $1", [rows[0].shipment_id]);
  res.json({ success: true, tracking_number: s.rows[0]?.tracking_number });
});

// ----------------------------------------------------- verified proof download
router.post("/:trackingNumber/proof", verifyLimiter, async (req, res) => {
  const s = await findShipment(req.params.trackingNumber);
  if (!s) return res.status(404).json({ error: "Shipment not found" });
  if (!s.signed_by) {
    return res.status(409).json({ error: "Delivery has not been confirmed yet, so there is no proof of delivery." });
  }
  if (!same(s.receiver_email, req.body?.receiver_email)) {
    return res.status(403).json({ error: "That email address does not match the receiver on this shipment." });
  }
  const pdf = await SHIPMENT_DOCUMENTS.pod.build(s);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${s.tracking_number}-proof-of-delivery.pdf"`,
    "Cache-Control": "private, no-store",
  });
  res.send(pdf);
});

// ------------------------------------------------------------ change requests
export const REQUEST_KINDS = {
  hold: "Hold the shipment",
  reschedule: "Reschedule delivery",
  leave_with_neighbour: "Leave with a neighbour or safe place",
  other: "Other",
};

router.post("/:trackingNumber/change-request", verifyLimiter, async (req, res) => {
  const s = await findShipment(req.params.trackingNumber);
  if (!s) return res.status(404).json({ error: "Shipment not found" });
  if (!same(s.receiver_email, req.body?.receiver_email)) {
    return res.status(403).json({ error: "That email address does not match the receiver on this shipment." });
  }
  if (/^(delivered|returned|cancelled)/i.test(s.shipment_status)) {
    return res.status(409).json({ error: "This shipment is already complete, so its delivery can no longer be changed." });
  }
  const kind = clean(req.body?.kind, 30);
  const message = clean(req.body?.message, 1000);
  if (!REQUEST_KINDS[kind]) return res.status(400).json({ error: "Choose the type of change you need." });
  if (message.length < 5) return res.status(400).json({ error: "Tell us what you need (at least 5 characters)." });
  let preferred = null;
  if (req.body?.preferred_date) {
    preferred = String(req.body.preferred_date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(preferred) || Number.isNaN(Date.parse(`${preferred}T00:00:00Z`))) {
      return res.status(400).json({ error: "Enter a valid preferred date." });
    }
  }

  const { rows } = await db.query(
    "INSERT INTO change_requests (shipment_id, kind, preferred_date, message) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
    [s.id, kind, preferred, message],
  );
  const reference = `VLZ-REQ-${new Date(rows[0].created_at).getUTCFullYear()}-${String(rows[0].id).padStart(5, "0")}`;
  await db.query("UPDATE change_requests SET reference = $1 WHERE id = $2", [reference, rows[0].id]);

  res.status(201).json({ success: true, reference });
  sendChangeRequestAlert(s, {
    reference,
    kind_label: REQUEST_KINDS[kind],
    preferred_date: preferred,
    message,
  }).catch((e) => console.error("[email] change request alert failed:", e.message));
});

export default router;
