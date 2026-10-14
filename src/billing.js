import express from "express";
import db from "./db.js";
import { authenticateToken } from "./adminAuth.js";
import { isEmail } from "./validation.js";
import { buildFeeInvoice, buildReceipt, NOTICE_BUILDERS } from "./billingDocs.js";
import {
  emailEnabled,
  renderComposedEmail,
  sendComposedEmail,
  sendReceiptEmail,
  pdfAttachment,
  feeEmailDefaults,
  noticeEmailDefaults,
} from "./emailService.js";

const router = express.Router();
router.use(authenticateToken);

const logError = (label) => (err) => console.error(`[billing] ${label} failed:`, err.message);
const pad = (n) => String(n).padStart(5, "0");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const todayIso = () => new Date().toISOString().slice(0, 10);
const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

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

async function loadShipment(shipmentId, client = db) {
  const { rows } = await client.query("SELECT * FROM shipments WHERE shipment_id = $1 ORDER BY id LIMIT 1", [
    String(shipmentId),
  ]);
  return rows[0] || null;
}

// ---------------------------------------------------------------- fee views
const feeView = (row, shipment) => ({
  id: row.id,
  shipment_id: shipment.shipment_id,
  tracking_number: shipment.tracking_number,
  receiver_name: shipment.receiver_name,
  receiver_email: shipment.receiver_email,
  invoice_number: row.invoice_number,
  receipt_number: row.receipt_number,
  category: row.category,
  items: row.items,
  currency: row.currency,
  total: row.total,
  details: row.details || {},
  due_date: row.due_date,
  payment_instructions: row.payment_instructions,
  status: row.status,
  subject: row.subject,
  message: row.message,
  created_at: row.created_at,
  sent_at: row.sent_at,
  sent_to: row.sent_to,
  paid_at: row.paid_at,
  received_on: row.received_on,
  payment_method: row.payment_method,
  payment_reference: row.payment_reference,
  receipt_sent_at: row.receipt_sent_at,
  cancelled_at: row.cancelled_at,
  cancel_reason: row.cancel_reason,
});

const feeDefaults = (shipment, row) =>
  row.subject && row.message
    ? { to: shipment.receiver_email, subject: row.subject, message: row.message }
    : feeEmailDefaults(shipment, row);

async function loadFee(shipment, feeId, client = db, { lock = false } = {}) {
  const id = Number.parseInt(feeId, 10);
  if (!Number.isInteger(id)) return null;
  const { rows } = await client.query(
    `SELECT * FROM shipment_fees WHERE id = $1 AND shipment_id = $2${lock ? " FOR UPDATE" : ""}`,
    [id, shipment.id],
  );
  return rows[0] || null;
}

function validateFee(body = {}) {
  const fields = {};
  const category = text(body.category, 60);
  if (!category || category.length < 2) fields.category = "Enter a category (for example Insurance).";

  const items = [];
  let cents = 0;
  if (!Array.isArray(body.items) || body.items.length === 0) {
    fields.items = "Add at least one line item.";
  } else if (body.items.length > 20) {
    fields.items = "A fee can have at most 20 line items.";
  } else {
    body.items.forEach((row, i) => {
      const description = text(row?.description, 200);
      const raw = typeof row?.amount === "string" ? row.amount.trim() : row?.amount;
      const amount = Number(raw);
      if (!description) fields[`items.${i}.description`] = "Enter a description.";
      if (raw === "" || raw === undefined || raw === null || !Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
        fields[`items.${i}.amount`] = "Enter an amount greater than zero.";
      } else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        fields[`items.${i}.amount`] = "Use at most two decimal places.";
      } else if (description) {
        const c = Math.round(amount * 100);
        cents += c;
        items.push({ description, amount: (c / 100).toFixed(2) });
      }
    });
  }

  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) fields.currency = "Use a 3-letter currency code.";

  let dueDate = null;
  if (body.due_date) {
    if (typeof body.due_date !== "string" || !isRealDate(body.due_date.slice(0, 10))) fields.due_date = "Enter a valid date.";
    else dueDate = body.due_date.slice(0, 10);
  }

  const details = {};
  const d = body.details && typeof body.details === "object" ? body.details : {};
  if (d.insured_value !== undefined && d.insured_value !== null && d.insured_value !== "") {
    const v = Number(d.insured_value);
    if (!Number.isFinite(v) || v < 0 || v > 1e11) fields["details.insured_value"] = "Enter a valid amount.";
    else details.insured_value = v.toFixed(2);
  }
  const coverage = text(d.coverage, 300);
  if (coverage) details.coverage = coverage;
  const policy = text(d.policy_reference, 60);
  if (policy) details.policy_reference = policy;

  const instructions = text(body.payment_instructions, 1000);

  if (Object.keys(fields).length) return { fields };
  return {
    value: {
      category,
      items,
      currency,
      total: (cents / 100).toFixed(2),
      details,
      due_date: dueDate,
      payment_instructions: instructions,
    },
  };
}

const badRequest = (res, fields) =>
  res.status(400).json({ error: "Please correct the highlighted fields.", fields });

function validateCompose(body) {
  const subject = text(body?.subject, 200);
  const message = text(body?.message, 5000);
  if (!subject) return { error: "Enter an email subject." };
  if (!message) return { error: "Write the email message." };
  return { subject, message };
}

// ----------------------------------------------- cross-shipment fee list
router.get("/billing/fees", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const status = String(req.query.status || "").trim();
  const search = String(req.query.search || "").trim().slice(0, 100);

  const where = [];
  const params = [];
  if (["draft", "sent", "paid", "cancelled"].includes(status)) {
    params.push(status);
    where.push(`f.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    const p = `$${params.length}`;
    where.push(
      `(f.invoice_number ILIKE ${p} OR s.tracking_number ILIKE ${p} OR s.receiver_name ILIKE ${p} OR s.receiver_email ILIKE ${p} OR f.category ILIKE ${p})`,
    );
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = "FROM shipment_fees f JOIN shipments s ON s.id = f.shipment_id";

  const [count, data, outstanding] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total ${from} ${clause}`, params),
    db.query(
      `SELECT f.*, s.shipment_id AS ship_ref, s.tracking_number, s.receiver_name, s.receiver_email
         ${from} ${clause} ORDER BY f.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    ),
    db.query(
      `SELECT currency, COUNT(*)::int AS count, SUM(total)::text AS total
         FROM shipment_fees WHERE status = 'sent' GROUP BY currency ORDER BY currency`,
    ),
  ]);
  const total = count.rows[0].total;
  res.json({
    success: true,
    fees: data.rows.map((r) => feeView(r, { ...r, shipment_id: r.ship_ref })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    outstanding: outstanding.rows,
  });
});

// ---------------------------------------------------------- fees: CRUD
router.get("/:shipment_id/fees", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const { rows } = await db.query("SELECT * FROM shipment_fees WHERE shipment_id = $1 ORDER BY id DESC", [shipment.id]);
  res.json({ success: true, fees: rows.map((r) => feeView(r, shipment)) });
});

router.post("/:shipment_id/fees", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const { value, fields } = validateFee(req.body);
  if (fields) return badRequest(res, fields);

  const row = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO shipment_fees (shipment_id, category, items, currency, total, details, due_date, payment_instructions, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, $9) RETURNING id, created_at`,
      [
        shipment.id,
        value.category,
        JSON.stringify(value.items),
        value.currency,
        value.total,
        JSON.stringify(value.details),
        value.due_date,
        value.payment_instructions,
        req.admin.email,
      ],
    );
    const { id, created_at: createdAt } = inserted.rows[0];
    const invoice = `VLZ-INV-${new Date(createdAt).getUTCFullYear()}-${pad(id)}`;
    const updated = await client.query("UPDATE shipment_fees SET invoice_number = $1 WHERE id = $2 RETURNING *", [invoice, id]);
    return updated.rows[0];
  });

  res.status(201).json({ success: true, fee: feeView(row, shipment), defaults: feeDefaults(shipment, row) });
});

router.get("/:shipment_id/fees/:feeId", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const fee = await loadFee(shipment, req.params.feeId);
  if (!fee) return res.status(404).json({ error: "Fee not found." });
  res.json({ success: true, fee: feeView(fee, shipment), defaults: feeDefaults(shipment, fee) });
});

router.put("/:shipment_id/fees/:feeId", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const { value, fields } = validateFee(req.body);
  if (fields) return badRequest(res, fields);

  const outcome = await withTransaction(async (client) => {
    const fee = await loadFee(shipment, req.params.feeId, client, { lock: true });
    if (!fee) return { code: 404, error: "Fee not found." };
    if (fee.status !== "draft") return { code: 409, error: "Only draft fees can be edited. Cancel this fee and create a new one." };
    const { rows } = await client.query(
      `UPDATE shipment_fees
          SET category = $1, items = $2::jsonb, currency = $3, total = $4, details = $5::jsonb,
              due_date = $6, payment_instructions = $7, subject = NULL, message = NULL
        WHERE id = $8 RETURNING *`,
      [
        value.category,
        JSON.stringify(value.items),
        value.currency,
        value.total,
        JSON.stringify(value.details),
        value.due_date,
        value.payment_instructions,
        fee.id,
      ],
    );
    return { row: rows[0] };
  });
  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });
  res.json({ success: true, fee: feeView(outcome.row, shipment), defaults: feeDefaults(shipment, outcome.row) });
});

router.delete("/:shipment_id/fees/:feeId", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const fee = await loadFee(shipment, req.params.feeId);
  if (!fee) return res.status(404).json({ error: "Fee not found." });
  if (fee.status !== "draft") {
    return res.status(409).json({ error: "Only draft fees can be deleted. Cancel a sent fee instead." });
  }
  await db.query("DELETE FROM shipment_fees WHERE id = $1", [fee.id]);
  res.json({ success: true });
});

// -------------------------------------------------- fees: email and PDFs
router.post("/:shipment_id/fees/:feeId/preview-email", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const fee = await loadFee(shipment, req.params.feeId);
  if (!fee) return res.status(404).json({ error: "Fee not found." });
  const compose = validateCompose(req.body);
  if (compose.error) return res.status(400).json({ error: compose.error });
  res.json({ success: true, html: renderComposedEmail({ shipment, subject: compose.subject, message: compose.message }) });
});

router.get("/:shipment_id/fees/:feeId/document/:kind", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const fee = await loadFee(shipment, req.params.feeId);
  if (!fee) return res.status(404).json({ error: "Fee not found." });

  let pdf;
  let name;
  if (req.params.kind === "invoice") {
    pdf = await buildFeeInvoice(shipment, fee);
    name = fee.invoice_number;
  } else if (req.params.kind === "receipt" && fee.status === "paid" && fee.receipt_number) {
    pdf = await buildReceipt(shipment, fee);
    name = fee.receipt_number;
  } else {
    return res.status(404).json({ error: "That document is not available for this fee." });
  }
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${name}.pdf"`,
    "Cache-Control": "private, no-store",
  });
  res.send(pdf);
});

router.post("/:shipment_id/fees/:feeId/send", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const fee = await loadFee(shipment, req.params.feeId);
  if (!fee) return res.status(404).json({ error: "Fee not found." });
  if (!["draft", "sent"].includes(fee.status)) {
    return res.status(409).json({ error: `A ${fee.status} fee cannot be sent.` });
  }
  const compose = validateCompose(req.body);
  if (compose.error) return res.status(400).json({ error: compose.error });
  if (!emailEnabled()) {
    return res.status(503).json({ error: "Email delivery is not configured on this server, so nothing was sent." });
  }
  if (!isEmail(shipment.receiver_email)) {
    return res.status(400).json({ error: "The receiver's email address on this shipment is not valid." });
  }

  const issued = { ...fee, status: "sent", sent_at: fee.sent_at || new Date().toISOString() };
  const pdf = await buildFeeInvoice(shipment, issued);
  const result = await sendComposedEmail({
    to: shipment.receiver_email,
    subject: compose.subject,
    message: compose.message,
    shipment,
    attachments: [pdfAttachment(`${fee.invoice_number}.pdf`, pdf)],
  });
  if (result.sent === 0) {
    return res.status(502).json({ error: "The email provider rejected the message. Nothing was marked as sent." });
  }

  const { rows } = await db.query(
    `UPDATE shipment_fees
        SET status = 'sent', sent_at = COALESCE(sent_at, $1), sent_to = $2, subject = $3, message = $4
      WHERE id = $5 RETURNING *`,
    [issued.sent_at, shipment.receiver_email, compose.subject, compose.message, fee.id],
  );
  res.json({ success: true, fee: feeView(rows[0], shipment) });
});

router.post("/:shipment_id/fees/:feeId/mark-paid", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });

  const method = text(req.body?.method, 60);
  const reference = text(req.body?.reference, 120);
  const receivedOn = req.body?.received_on ? String(req.body.received_on).slice(0, 10) : todayIso();
  const sendReceipt = req.body?.send_receipt !== false;
  if (!method) return res.status(400).json({ error: "Enter the payment method." });
  if (!isRealDate(receivedOn)) return res.status(400).json({ error: "Enter a valid date received." });
  if (receivedOn > todayIso()) return res.status(400).json({ error: "The date received cannot be in the future." });

  const outcome = await withTransaction(async (client) => {
    const fee = await loadFee(shipment, req.params.feeId, client, { lock: true });
    if (!fee) return { code: 404, error: "Fee not found." };
    if (fee.status !== "sent") {
      return { code: 409, error: "Only a fee that has been sent to the receiver can be marked as paid." };
    }
    const receiptNumber = `VLZ-RCT-${new Date().getUTCFullYear()}-${pad(fee.id)}`;
    const { rows } = await client.query(
      `UPDATE shipment_fees
          SET status = 'paid', paid_at = NOW(), received_on = $1, payment_method = $2, payment_reference = $3,
              receipt_number = $4
        WHERE id = $5 RETURNING *`,
      [receivedOn, method, reference, receiptNumber, fee.id],
    );
    return { row: rows[0] };
  });
  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });

  let receipt = { sent: false, message: "No receipt was sent." };
  let row = outcome.row;
  if (sendReceipt) {
    if (!emailEnabled()) {
      receipt = { sent: false, message: "Email delivery is not configured, so the receipt was not emailed. You can download it." };
    } else {
      try {
        const pdf = await buildReceipt(shipment, row);
        const result = await sendReceiptEmail(shipment, row, pdf);
        if (result.sent > 0) {
          const updated = await db.query("UPDATE shipment_fees SET receipt_sent_at = NOW() WHERE id = $1 RETURNING *", [row.id]);
          row = updated.rows[0];
          receipt = { sent: true };
        } else {
          receipt = { sent: false, message: "The email provider rejected the receipt. You can resend it." };
        }
      } catch (err) {
        logError("receipt email")(err);
        receipt = { sent: false, message: "The receipt could not be emailed. You can resend it." };
      }
    }
  }
  res.json({ success: true, fee: feeView(row, shipment), receipt });
});

router.post("/:shipment_id/fees/:feeId/resend-receipt", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const fee = await loadFee(shipment, req.params.feeId);
  if (!fee) return res.status(404).json({ error: "Fee not found." });
  if (fee.status !== "paid") return res.status(409).json({ error: "Only paid fees have a receipt." });
  if (!emailEnabled()) return res.status(503).json({ error: "Email delivery is not configured on this server." });

  const result = await sendReceiptEmail(shipment, fee, await buildReceipt(shipment, fee));
  if (result.sent === 0) return res.status(502).json({ error: "The email provider rejected the message." });
  await db.query("UPDATE shipment_fees SET receipt_sent_at = NOW() WHERE id = $1", [fee.id]);
  res.json({ success: true });
});

router.post("/:shipment_id/fees/:feeId/cancel", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const reason = text(req.body?.reason, 300);
  const { rows } = await db.query(
    `UPDATE shipment_fees SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1
      WHERE id = $2 AND shipment_id = $3 AND status IN ('draft', 'sent') RETURNING *`,
    [reason, Number.parseInt(req.params.feeId, 10) || 0, shipment.id],
  );
  if (!rows[0]) return res.status(409).json({ error: "Only draft or sent fees can be cancelled." });
  res.json({ success: true, fee: feeView(rows[0], shipment) });
});

// ------------------------------------------------------------------ notices
const REASONS = [
  "Delivery attempt unsuccessful",
  "Recipient unavailable",
  "Address incomplete or incorrect",
  "Held at customs",
  "Documents required",
  "Payment required",
  "Weather or transport disruption",
  "Damaged in transit",
  "Other",
];
const PREFIX = { pre_arrival: "PAN", exception: "EXN" };

function validateNotice(kind, raw) {
  const fields = {};
  const d = raw && typeof raw === "object" ? raw : {};
  const data = {};
  const date = (key) => {
    if (!d[key]) return;
    const v = String(d[key]).slice(0, 10);
    if (!isRealDate(v)) fields[`data.${key}`] = "Enter a valid date.";
    else data[key] = v;
  };

  if (kind === "pre_arrival") {
    date("eta_date");
    const window = text(d.eta_window, 100);
    if (window) data.eta_window = window;
    if (d.requirements !== undefined) {
      if (!Array.isArray(d.requirements) || d.requirements.length > 15) {
        fields["data.requirements"] = "Provide up to 15 short items.";
      } else {
        data.requirements = d.requirements.map((r) => text(r, 160)).filter(Boolean);
      }
    }
    const notes = text(d.notes, 1000);
    if (notes) data.notes = notes;
  } else {
    const reason = text(d.reason, 80);
    if (!reason) fields["data.reason"] = "Choose or enter a reason.";
    else data.reason = reason;
    const details = text(d.details, 1000);
    if (!details) fields["data.details"] = "Describe what happened.";
    else data.details = details;
    const action = text(d.action_required, 600);
    if (action) data.action_required = action;
    date("new_expected_delivery");
    data.add_to_history = d.add_to_history !== false;
  }
  return Object.keys(fields).length ? { fields } : { data };
}

const noticeView = (row, shipment) => ({
  id: row.id,
  shipment_id: shipment.shipment_id,
  tracking_number: shipment.tracking_number,
  kind: row.kind,
  reference_number: row.reference_number,
  data: row.data || {},
  subject: row.subject,
  message: row.message,
  status: row.status,
  created_at: row.created_at,
  sent_at: row.sent_at,
  sent_to: row.sent_to,
});

const noticeDefaults = (shipment, row) =>
  row.subject && row.message
    ? { to: shipment.receiver_email, subject: row.subject, message: row.message }
    : noticeEmailDefaults(shipment, row);

async function loadNotice(shipment, noticeId, client = db, { lock = false } = {}) {
  const id = Number.parseInt(noticeId, 10);
  if (!Number.isInteger(id)) return null;
  const { rows } = await client.query(
    `SELECT * FROM shipment_notices WHERE id = $1 AND shipment_id = $2${lock ? " FOR UPDATE" : ""}`,
    [id, shipment.id],
  );
  return rows[0] || null;
}

router.get("/:shipment_id/notices", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const { rows } = await db.query("SELECT * FROM shipment_notices WHERE shipment_id = $1 ORDER BY id DESC", [shipment.id]);
  res.json({ success: true, notices: rows.map((r) => noticeView(r, shipment)) });
});

router.post("/:shipment_id/notices", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const kind = req.body?.kind;
  if (!PREFIX[kind]) return res.status(400).json({ error: "Choose a notice type." });
  const { data, fields } = validateNotice(kind, req.body?.data);
  if (fields) return badRequest(res, fields);

  const row = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO shipment_notices (shipment_id, kind, data, created_by) VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id, created_at`,
      [shipment.id, kind, JSON.stringify(data), req.admin.email],
    );
    const { id, created_at: createdAt } = inserted.rows[0];
    const reference = `VLZ-${PREFIX[kind]}-${new Date(createdAt).getUTCFullYear()}-${pad(id)}`;
    return (await client.query("UPDATE shipment_notices SET reference_number = $1 WHERE id = $2 RETURNING *", [reference, id]))
      .rows[0];
  });
  res.status(201).json({ success: true, notice: noticeView(row, shipment), defaults: noticeDefaults(shipment, row) });
});

router.get("/:shipment_id/notices/:noticeId", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const notice = await loadNotice(shipment, req.params.noticeId);
  if (!notice) return res.status(404).json({ error: "Notice not found." });
  res.json({ success: true, notice: noticeView(notice, shipment), defaults: noticeDefaults(shipment, notice) });
});

router.put("/:shipment_id/notices/:noticeId", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const existing = await loadNotice(shipment, req.params.noticeId);
  if (!existing) return res.status(404).json({ error: "Notice not found." });
  if (existing.status !== "draft") return res.status(409).json({ error: "A sent notice cannot be edited." });
  const { data, fields } = validateNotice(existing.kind, req.body?.data);
  if (fields) return badRequest(res, fields);
  const { rows } = await db.query(
    "UPDATE shipment_notices SET data = $1::jsonb, subject = NULL, message = NULL WHERE id = $2 RETURNING *",
    [JSON.stringify(data), existing.id],
  );
  res.json({ success: true, notice: noticeView(rows[0], shipment), defaults: noticeDefaults(shipment, rows[0]) });
});

router.delete("/:shipment_id/notices/:noticeId", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const notice = await loadNotice(shipment, req.params.noticeId);
  if (!notice) return res.status(404).json({ error: "Notice not found." });
  if (notice.status !== "draft") return res.status(409).json({ error: "A sent notice cannot be deleted." });
  await db.query("DELETE FROM shipment_notices WHERE id = $1", [notice.id]);
  res.json({ success: true });
});

router.post("/:shipment_id/notices/:noticeId/preview-email", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const notice = await loadNotice(shipment, req.params.noticeId);
  if (!notice) return res.status(404).json({ error: "Notice not found." });
  const compose = validateCompose(req.body);
  if (compose.error) return res.status(400).json({ error: compose.error });
  res.json({ success: true, html: renderComposedEmail({ shipment, subject: compose.subject, message: compose.message }) });
});

router.get("/:shipment_id/notices/:noticeId/document", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const notice = await loadNotice(shipment, req.params.noticeId);
  if (!notice) return res.status(404).json({ error: "Notice not found." });
  const pdf = await NOTICE_BUILDERS[notice.kind](shipment, notice);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${notice.reference_number}.pdf"`,
    "Cache-Control": "private, no-store",
  });
  res.send(pdf);
});

router.post("/:shipment_id/notices/:noticeId/send", async (req, res) => {
  const shipment = await loadShipment(req.params.shipment_id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const notice = await loadNotice(shipment, req.params.noticeId);
  if (!notice) return res.status(404).json({ error: "Notice not found." });
  if (notice.status !== "draft") return res.status(409).json({ error: "This notice has already been sent." });
  const compose = validateCompose(req.body);
  if (compose.error) return res.status(400).json({ error: compose.error });
  if (!emailEnabled()) {
    return res.status(503).json({ error: "Email delivery is not configured on this server, so nothing was sent." });
  }
  if (!isEmail(shipment.receiver_email)) {
    return res.status(400).json({ error: "The receiver's email address on this shipment is not valid." });
  }

  const sentAt = new Date().toISOString();
  const issued = { ...notice, sent_at: sentAt };
  const pdf = await NOTICE_BUILDERS[notice.kind](shipment, issued);
  const result = await sendComposedEmail({
    to: shipment.receiver_email,
    subject: compose.subject,
    message: compose.message,
    shipment,
    attachments: [pdfAttachment(`${notice.reference_number}.pdf`, pdf)],
  });
  if (result.sent === 0) {
    return res.status(502).json({ error: "The email provider rejected the message. Nothing was marked as sent." });
  }

  const row = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE shipment_notices SET status = 'sent', sent_at = $1, sent_to = $2, subject = $3, message = $4
        WHERE id = $5 RETURNING *`,
      [sentAt, shipment.receiver_email, compose.subject, compose.message, notice.id],
    );
    if (notice.kind === "exception") {
      const d = notice.data || {};
      if (d.new_expected_delivery) {
        await client.query("UPDATE shipments SET expected_delivery = $1, updated_at = NOW() WHERE id = $2", [
          d.new_expected_delivery,
          shipment.id,
        ]);
      }
      if (d.add_to_history !== false) {
        await client.query(
          `INSERT INTO shipment_events (shipment_id, status, location, description, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [shipment.id, shipment.shipment_status, shipment.current_location, `Delivery exception: ${d.reason}`, req.admin.email],
        );
        await client.query("UPDATE shipments SET last_update = NOW() WHERE id = $1", [shipment.id]);
      }
    }
    return rows[0];
  });
  res.json({ success: true, notice: noticeView(row, shipment) });
});

export { REASONS };
export default router;
