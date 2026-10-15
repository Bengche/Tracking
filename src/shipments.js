import express from "express";
import QRCode from "qrcode";
import rateLimit from "express-rate-limit";
import db from "./db.js";
import { config } from "./config.js";
import { authenticateToken } from "./adminAuth.js";
import {
  validateShipment,
  generateTrackingNumber,
  generateShipmentId,
  isEmail,
  STATUSES,
  CONFIRMED_STATUS,
  OPTIONAL_COLUMNS,
} from "./validation.js";
import { adminShipment, documentsFor, isDeliveredStatus, publicEvent } from "./shipmentModel.js";
import { SHIPMENT_DOCUMENTS } from "./documents.js";
import {
  emailEnabled,
  notifyShipmentCreated,
  notifyStatusUpdate,
  notifyDeliveryConfirmed,
} from "./emailService.js";

const router = express.Router();

const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

const logEmailError = (label) => (err) => console.error(`[email] ${label} failed:`, err.message);

async function withTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function findByShipmentId(shipmentId, client = db, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM shipments WHERE shipment_id = $1 ORDER BY id LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [String(shipmentId)],
  );
  return rows[0] || null;
}

async function addEvent(client, shipmentRowId, { status, location, description, occurredAt, by }) {
  const { rows } = await client.query(
    `INSERT INTO shipment_events (shipment_id, status, location, description, occurred_at, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6) RETURNING *`,
    [shipmentRowId, status || null, location || null, description || null, occurredAt || null, by || null],
  );
  return rows[0];
}

const SHIPMENT_COLUMNS = [
  "sender_name",
  "sender_address",
  "sender_email",
  "sender_phone",
  "receiver_name",
  "receiver_address",
  "receiver_phone",
  "receiver_email",
  "receiver_country",
  "origin_country",
  "origin_location",
  "destination_country",
  "destination_location",
  "current_location",
  "shipment_status",
  "shipment_type",
  "weight",
  "expected_delivery",
  "dimensions",
  "contents",
  "custom_status",
  "remarks",
  "pieces",
  "declared_value",
  "currency",
  "customs_category",
  "items",
];

// items is JSONB; pg would send a JS array as a Postgres array, so serialise it explicitly.
const columnValue = (column, data) => (column === "items" ? JSON.stringify(data.items ?? []) : data[column] ?? null);

const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

// Everything is staff-only except the recipient's own delivery confirmation.
router.use((req, res, next) => {
  if (req.method === "PUT" && req.path.startsWith("/confirm-delivery/")) return next();
  return authenticateToken(req, res, next);
});

// ---------------------------------------------------------------- create
router.post("/add_shipment", async (req, res) => {
  const { value, fields } = validateShipment(req.body);
  if (fields) {
    return res.status(400).json({ error: "Please correct the highlighted fields.", fields });
  }
  const notify = req.body.notify !== false;
  const providedTracking = !!value.tracking_number;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const trackingNumber = value.tracking_number || generateTrackingNumber();
    const shipmentId = generateShipmentId();
    const url = `${config.frontendUrl}/track?tracking=${encodeURIComponent(trackingNumber)}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    const currentLocation = value.current_location || value.origin_location || value.origin_country;

    try {
      const shipment = await withTransaction(async (client) => {
        const exists = await client.query("SELECT 1 FROM shipments WHERE shipment_id = $1", [shipmentId]);
        if (exists.rowCount) throw Object.assign(new Error("shipment id collision"), { code: "RETRY" });

        const data = { ...value, current_location: currentLocation };
        const optional = OPTIONAL_COLUMNS.filter((c) => data[c] !== undefined);
        const columns = ["tracking_number", "shipment_id", ...SHIPMENT_COLUMNS, ...optional, "qr_code"];
        const params = [
          trackingNumber,
          shipmentId,
          ...SHIPMENT_COLUMNS.map((c) => columnValue(c, data)),
          ...optional.map((c) => data[c]),
          qr,
        ];
        const placeholders = params.map((_, i) => `$${i + 1}`);
        const { rows } = await client.query(
          `INSERT INTO shipments (${columns.join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`,
          params,
        );
        const created = rows[0];
        if (isDeliveredStatus(created.shipment_status)) {
          await client.query("UPDATE shipments SET delivered_at = NOW() WHERE id = $1", [created.id]);
        }
        await addEvent(client, created.id, {
          status: created.shipment_status,
          location: currentLocation,
          description: value.event_note || "Shipment registered",
          by: req.admin.email,
        });
        return created;
      });

      res.status(201).json({
        success: true,
        message: "Shipment created.",
        shipment: adminShipment(shipment),
        emails: { queued: notify && emailEnabled() },
      });

      if (notify) notifyShipmentCreated(shipment).catch(logEmailError("notifyShipmentCreated"));
      return;
    } catch (err) {
      if (err.code === "23505" && providedTracking) {
        return res.status(409).json({
          error: "That tracking number already exists.",
          fields: { tracking_number: "This tracking number is already in use." },
        });
      }
      if (err.code === "23505" || err.code === "RETRY") continue;
      throw err;
    }
  }
  res.status(500).json({ error: "Could not allocate a unique tracking number. Please try again." });
});

// ------------------------------------------------------------------ read
router.get("/all", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const search = String(req.query.search || "").trim().slice(0, 100);
  const status = String(req.query.status || "").trim();

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    const p = `$${params.length}`;
    where.push(
      `(tracking_number ILIKE ${p} OR sender_name ILIKE ${p} OR sender_email ILIKE ${p} OR receiver_name ILIKE ${p} OR receiver_email ILIKE ${p} OR destination_country ILIKE ${p} OR shipment_id ILIKE ${p})`,
    );
  }
  if (status) {
    params.push(status);
    where.push(`shipment_status ILIKE $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [count, data] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM shipments ${clause}`, params),
    db.query(
      `SELECT * FROM shipments ${clause} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    ),
  ]);
  const total = count.rows[0].total;

  res.json({
    success: true,
    shipments: data.rows.map(adminShipment),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});

router.get("/stats", async (req, res) => {
  const [byStatus, recent] = await Promise.all([
    db.query("SELECT shipment_status, COUNT(*)::int AS n FROM shipments GROUP BY shipment_status"),
    db.query("SELECT COUNT(*)::int AS n FROM shipments WHERE created_at >= NOW() - INTERVAL '7 days'"),
  ]);
  const by_status = {};
  let total = 0;
  for (const row of byStatus.rows) {
    by_status[row.shipment_status] = row.n;
    total += row.n;
  }
  res.json({ success: true, total, recent: recent.rows[0].n, by_status });
});

// ---------------------------------------------------------------- update
router.put("/update/:shipment_id", async (req, res) => {
  const body = { ...req.body };
  if (body.shipment_status === CONFIRMED_STATUS) body.shipment_status = "Delivered";

  const { value, fields } = validateShipment(body);
  if (fields) {
    return res.status(400).json({ error: "Please correct the highlighted fields.", fields });
  }

  let outcome;
  try {
    outcome = await withTransaction(async (client) => {
      const existing = await findByShipmentId(req.params.shipment_id, client, { lock: true });
      if (!existing) return null;

      if (existing.signed_by && isDeliveredStatus(value.shipment_status)) {
        value.shipment_status = CONFIRMED_STATUS;
      }
      const delivered = isDeliveredStatus(value.shipment_status);
      const currentLocation = value.current_location;

      const sets = [];
      const params = [];
      const push = (col, v) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      for (const c of SHIPMENT_COLUMNS) {
        if ((c === "items" || c === "customs_category") && value[c] === undefined) continue;
        push(c, c === "current_location" ? currentLocation : columnValue(c, value));
      }
      for (const c of OPTIONAL_COLUMNS) if (value[c] !== undefined) push(c, value[c]);
      if (value.tracking_number) push("tracking_number", value.tracking_number);
      sets.push("updated_at = NOW()");

      const statusChanged = existing.shipment_status !== value.shipment_status;
      const locationChanged = (existing.current_location || "") !== (currentLocation || "");
      if (statusChanged || locationChanged) sets.push("last_update = NOW()");
      if (delivered && !existing.delivered_at) sets.push("delivered_at = NOW()");
      if (!delivered && !existing.signed_by) sets.push("delivered_at = NULL");

      params.push(existing.id);
      const { rows } = await client.query(
        `UPDATE shipments SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params,
      );

      if (statusChanged || locationChanged) {
        await addEvent(client, existing.id, {
          status: value.shipment_status,
          location: currentLocation,
          description: value.event_note,
          by: req.admin.email,
        });
      }
      return { shipment: rows[0], previousStatus: existing.shipment_status, changed: statusChanged || locationChanged };
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "That tracking number already exists.",
        fields: { tracking_number: "This tracking number is already in use." },
      });
    }
    throw err;
  }

  if (!outcome) return res.status(404).json({ error: "Shipment not found." });

  res.json({ success: true, message: "Shipment updated.", shipment: adminShipment(outcome.shipment) });

  if (outcome.changed) {
    notifyStatusUpdate(outcome.shipment, outcome.previousStatus, value.event_note).catch(
      logEmailError("notifyStatusUpdate"),
    );
  }
});

// ---------------------------------------------------------------- delete
router.delete("/delete/:shipment_id", async (req, res) => {
  const removed = await withTransaction(async (client) => {
    const existing = await findByShipmentId(req.params.shipment_id, client, { lock: true });
    if (!existing) return false;
    await client.query("DELETE FROM shipment_events WHERE shipment_id = $1", [existing.id]);
    await client.query("DELETE FROM shipment_fees WHERE shipment_id = $1", [existing.id]);
    await client.query("DELETE FROM shipment_notices WHERE shipment_id = $1", [existing.id]);
    await client.query("DELETE FROM shipments WHERE id = $1", [existing.id]);
    return true;
  });
  if (!removed) return res.status(404).json({ error: "Shipment not found." });
  res.json({ success: true, message: "Shipment deleted." });
});

// ---------------------------------------------------------------- events
router.get("/:shipment_id/events", async (req, res) => {
  const shipment = await findByShipmentId(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const { rows } = await db.query(
    "SELECT * FROM shipment_events WHERE shipment_id = $1 ORDER BY occurred_at DESC, id DESC",
    [shipment.id],
  );
  res.json({ success: true, events: rows.map(publicEvent) });
});

router.post("/:shipment_id/events", async (req, res) => {
  const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const status = text(req.body?.status, 40);
  const location = text(req.body?.location, 160);
  const description = text(req.body?.description, 500);
  const occurredAt = req.body?.occurred_at ? new Date(req.body.occurred_at) : null;

  if (!status && !location && !description) {
    return res.status(400).json({ error: "Provide a status, a location or a description." });
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Choose one of the listed statuses." });
  }
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    return res.status(400).json({ error: "The date and time are not valid." });
  }

  const outcome = await withTransaction(async (client) => {
    const existing = await findByShipmentId(req.params.shipment_id, client, { lock: true });
    if (!existing) return null;

    const latest = await client.query(
      "SELECT MAX(occurred_at) AS latest FROM shipment_events WHERE shipment_id = $1",
      [existing.id],
    );
    const isLatest = !occurredAt || !latest.rows[0].latest || occurredAt >= latest.rows[0].latest;

    const nextStatus = status && !(existing.signed_by && isDeliveredStatus(status)) ? status : existing.shipment_status;
    const event = await addEvent(client, existing.id, {
      status: nextStatus,
      location,
      description,
      occurredAt: occurredAt?.toISOString(),
      by: req.admin.email,
    });

    let shipment = existing;
    let changed = false;
    if (isLatest && (status || location)) {
      const delivered = isDeliveredStatus(nextStatus);
      const { rows } = await client.query(
        `UPDATE shipments
            SET shipment_status = $1,
                current_location = COALESCE($2, current_location),
                last_update = NOW(), updated_at = NOW(),
                delivered_at = CASE WHEN $3 THEN COALESCE(delivered_at, NOW()) WHEN signed_by IS NULL THEN NULL ELSE delivered_at END
          WHERE id = $4 RETURNING *`,
        [nextStatus, location, delivered, existing.id],
      );
      shipment = rows[0];
      changed = existing.shipment_status !== nextStatus || (location && location !== existing.current_location);
    }
    return { event, shipment, previousStatus: existing.shipment_status, changed };
  });

  if (!outcome) return res.status(404).json({ error: "Shipment not found." });

  res.status(201).json({ success: true, event: publicEvent(outcome.event), shipment: adminShipment(outcome.shipment) });

  if (outcome.changed) {
    notifyStatusUpdate(outcome.shipment, outcome.previousStatus, description).catch(logEmailError("notifyStatusUpdate"));
  }
});

// ------------------------------------------------------------- documents
router.get("/:shipment_id/documents/:type", async (req, res) => {
  const shipment = await findByShipmentId(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });

  const builder = SHIPMENT_DOCUMENTS[req.params.type];
  if (!builder || !documentsFor(shipment).includes(req.params.type)) {
    return res.status(404).json({ error: "That document is not available for this shipment." });
  }

  const pdf = await builder.build(shipment);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${shipment.tracking_number}-${builder.file}.pdf"`,
    "Cache-Control": "private, no-store",
  });
  res.send(pdf);
});

// -------------------------------------------- proof of delivery by photo
router.post("/:shipment_id/proof-of-delivery", async (req, res) => {
  const receivedBy = typeof req.body?.received_by === "string" ? req.body.received_by.trim() : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
  const photo = req.body?.photo_data;

  if (receivedBy.length < 2 || receivedBy.length > 120) {
    return res.status(400).json({ error: "Enter the name of the person who received the shipment." });
  }
  if (
    typeof photo !== "string" ||
    !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo) ||
    photo.length > 1_600_000
  ) {
    return res.status(400).json({ error: "Attach a JPEG or PNG photo of the delivery (up to about 1.5 MB)." });
  }

  const outcome = await withTransaction(async (client) => {
    const existing = await findByShipmentId(req.params.shipment_id, client, { lock: true });
    if (!existing) return { code: 404, error: "Shipment not found." };
    if (existing.signed_by || existing.shipment_status === CONFIRMED_STATUS) {
      return { code: 409, error: "Delivery has already been confirmed for this shipment." };
    }
    const { rows } = await client.query(
      `UPDATE shipments
          SET shipment_status = $1, signed_by = $2, pod_photo = $3, pod_method = 'photo', pod_note = $4,
              delivered_at = COALESCE(delivered_at, NOW()), last_update = NOW(), updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [CONFIRMED_STATUS, receivedBy, photo, note, existing.id],
    );
    await addEvent(client, existing.id, {
      status: CONFIRMED_STATUS,
      location: existing.destination_location || existing.current_location,
      description: "Delivered. Proof of delivery recorded with a photograph",
      by: req.admin.email,
    });
    return { shipment: rows[0] };
  });

  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });
  res.json({ success: true, shipment: adminShipment(outcome.shipment) });
  notifyDeliveryConfirmed(outcome.shipment).catch(logEmailError("notifyDeliveryConfirmed"));
});

router.post("/:shipment_id/resend", async (req, res) => {
  const shipment = await findByShipmentId(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  if (!emailEnabled()) {
    return res.status(503).json({ error: "Email delivery is not configured on this server." });
  }
  const result = await notifyShipmentCreated(shipment, { resend: true });
  if (result.sent === 0) {
    return res.status(502).json({ error: "The email provider rejected the message. Check the server logs." });
  }
  res.json({ success: true, message: "Confirmation email sent to the sender and the receiver." });
});

// ------------------------------------------------ recipient confirmation
router.put("/confirm-delivery/:tracking_number", confirmLimiter, async (req, res) => {
  const trackingNumber = String(req.params.tracking_number || "").trim();
  const recipientName = typeof req.body?.recipient_name === "string" ? req.body.recipient_name.trim() : "";
  const receiverEmail = typeof req.body?.receiver_email === "string" ? req.body.receiver_email.trim() : "";
  const signature = req.body?.signature_data;

  if (recipientName.length < 2 || recipientName.length > 120) {
    return res.status(400).json({ error: "Enter the full name of the person who received the shipment." });
  }
  if (!isEmail(receiverEmail)) {
    return res.status(400).json({ error: "Enter the receiver's email address as it appears on the shipment." });
  }
  if (
    typeof signature !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) ||
    signature.length > 600_000
  ) {
    return res.status(400).json({ error: "A signature is required." });
  }

  const outcome = await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM shipments WHERE UPPER(tracking_number) = UPPER($1) FOR UPDATE",
      [trackingNumber],
    );
    const shipment = rows[0];
    if (!shipment) return { code: 404, error: "Shipment not found." };
    if (shipment.signed_by || shipment.shipment_status === CONFIRMED_STATUS) {
      return { code: 409, error: "This delivery has already been confirmed." };
    }
    if (!["out for delivery", "delivered"].includes(shipment.shipment_status.toLowerCase())) {
      return { code: 409, error: "Receipt can only be confirmed once the shipment is out for delivery or delivered." };
    }
    if (shipment.receiver_email.trim().toLowerCase() !== receiverEmail.toLowerCase()) {
      return { code: 403, error: "That email address does not match the receiver on this shipment." };
    }

    const updated = await client.query(
      `UPDATE shipments
          SET shipment_status = $1, signed_by = $2, signature_data = $3, pod_method = 'signature',
              delivered_at = COALESCE(delivered_at, NOW()), last_update = NOW(), updated_at = NOW()
        WHERE id = $4 RETURNING *`,
      [CONFIRMED_STATUS, recipientName, signature, shipment.id],
    );
    await addEvent(client, shipment.id, {
      status: CONFIRMED_STATUS,
      location: shipment.destination_location || shipment.current_location,
      description: "Delivery confirmed by the recipient with a signature",
      by: "recipient",
    });
    return { shipment: updated.rows[0] };
  });

  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });

  res.json({ success: true, message: "Thank you. Your delivery has been confirmed." });
  notifyDeliveryConfirmed(outcome.shipment).catch(logEmailError("notifyDeliveryConfirmed"));
});

export default router;
