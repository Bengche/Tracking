import express from "express";
import rateLimit from "express-rate-limit";
import db from "./db.js";
import { publicShipment } from "./shipmentModel.js";

const router = express.Router();

const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many lookups. Please wait a moment and try again." },
});

router.get("/shipment_details/:trackingNumber", lookupLimiter, async (req, res) => {
  const trackingNumber = String(req.params.trackingNumber || "").trim().slice(0, 60);
  if (!trackingNumber) return res.status(400).json({ error: "Enter a tracking number." });

  const { rows } = await db.query(
    "SELECT * FROM shipments WHERE UPPER(tracking_number) = UPPER($1) LIMIT 1",
    [trackingNumber],
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "Shipment not found", tracking_number: trackingNumber });
  }

  const events = await db.query(
    "SELECT * FROM shipment_events WHERE shipment_id = $1 ORDER BY occurred_at DESC, id DESC",
    [rows[0].id],
  );

  res.set("Cache-Control", "no-store");
  res.json(publicShipment(rows[0], events.rows));
});

export default router;
