import sgMail from "@sendgrid/mail";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { SHIPMENT_DOCUMENTS } from "./documents.js";
import { trackingUrl, money } from "./pdfKit.js";
import { documentsFor } from "./shipmentModel.js";

if (config.email.apiKey) sgMail.setApiKey(config.email.apiKey);

// Development only: EMAIL_DEV_SINK=<folder> writes every outgoing email (and its PDFs) to disk instead of sending it.
const devSink = process.env.NODE_ENV !== "production" ? process.env.EMAIL_DEV_SINK : undefined;

export const emailEnabled = () => Boolean(config.email.apiKey) || Boolean(devSink);

async function sendOne(message) {
  if (!devSink) return sgMail.send(message);
  await fs.mkdir(devSink, { recursive: true });
  const stamp = `${Date.now()}-${String(message.to).replace(/[^a-z0-9@.]/gi, "_")}`;
  await fs.writeFile(
    path.join(devSink, `${stamp}.json`),
    JSON.stringify({ to: message.to, subject: message.subject, attachments: (message.attachments || []).map((a) => a.filename) }, null, 2),
  );
  await fs.writeFile(path.join(devSink, `${stamp}.html`), message.html);
  for (const a of message.attachments || []) {
    await fs.writeFile(path.join(devSink, `${stamp}-${a.filename}`), Buffer.from(a.content, "base64"));
  }
}

const FROM = { email: config.email.from, name: config.company.name };

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const place = (...parts) => parts.filter((p) => p && String(p).trim()).join(", ");

const fmtDay = (v) => {
  if (!v) return "";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

const fmtInstant = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? ""
    : `${d.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function detailsTable(rows) {
  const body = rows
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(
      ([k, v]) => `<tr>
  <td style="padding:10px 0;width:38%;border-top:1px solid #E3E7EC;font:600 12px ${FONT};color:#7B8696;text-transform:uppercase;letter-spacing:.04em;vertical-align:top;">${esc(k)}</td>
  <td style="padding:10px 0;border-top:1px solid #E3E7EC;font:400 14px/1.5 ${FONT};color:#0F1B2A;">${esc(v)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 4px;">${body}</table>`;
}

const paragraph = (text) =>
  `<p style="margin:0 0 14px;font:400 15px/1.65 ${FONT};color:#2A3646;">${esc(text)}</p>`;

function button(label, url) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 6px;"><tr>
  <td style="border-radius:6px;background:#0B1F33;"><a href="${esc(url)}" style="display:inline-block;padding:13px 24px;font:600 15px ${FONT};color:#FFFFFF;text-decoration:none;">${esc(label)}</a></td>
</tr></table>`;
}

function layout({ preheader, title, inner, note }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F6F7F9;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || title)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F6F7F9;"><tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
    <tr><td style="padding:0 0 16px;font:700 18px ${FONT};color:#0B1F33;letter-spacing:-.01em;">${esc(config.company.brand)}</td></tr>
    <tr><td style="background:#FFFFFF;border:1px solid #E3E7EC;border-radius:8px;padding:32px 32px 26px;">
      <h1 style="margin:0 0 18px;font:600 22px/1.3 ${FONT};color:#0B1F33;letter-spacing:-.01em;">${esc(title)}</h1>
      ${inner}
    </td></tr>
    <tr><td style="padding:20px 4px 0;font:400 12px/1.7 ${FONT};color:#7B8696;">
      ${note ? `${esc(note)}<br>` : ""}
      Questions? Reply to this email or contact <a href="mailto:${esc(config.company.supportEmail)}" style="color:#1B4469;">${esc(config.company.supportEmail)}</a>.<br>
      &copy; ${new Date().getFullYear()} ${esc(config.company.name)}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const pdfAttachment = (filename, content) => ({
  content: content.toString("base64"),
  filename,
  type: "application/pdf",
  disposition: "attachment",
});

/** Builds the requested shipment documents; returns { attachments, names } for those that exist. */
async function buildDocuments(shipment, types) {
  const attachments = [];
  const names = [];
  const available = documentsFor(shipment);
  for (const type of types) {
    if (!available.includes(type)) continue;
    const doc = SHIPMENT_DOCUMENTS[type];
    try {
      attachments.push(pdfAttachment(`${shipment.tracking_number}-${doc.file}.pdf`, await doc.build(shipment)));
      names.push(doc.name.toLowerCase());
    } catch (err) {
      console.error(`[documents] could not build ${type}:`, err.message);
    }
  }
  return { attachments, names };
}

const listNames = (names) =>
  names.length <= 1 ? names[0] || "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

async function deliver(messages) {
  if (!emailEnabled() || messages.length === 0) return { sent: 0, failed: 0 };
  const results = await Promise.allSettled(messages.map((m) => sendOne(m)));
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed += 1;
      const detail = r.reason?.response?.body?.errors
        ? JSON.stringify(r.reason.response.body.errors)
        : r.reason?.message;
      console.error(`[email] failed to send to ${messages[i].to}:`, detail);
    }
  });
  return { sent: messages.length - failed, failed };
}

const route = (s) => `${place(s.origin_location, s.origin_country)} to ${place(s.destination_location, s.destination_country)}`;

function shipmentRows(s) {
  return [
    ["Tracking number", s.tracking_number],
    ["Route", route(s)],
    ["Service", s.shipment_type],
    ["Pieces", s.pieces],
    ["Weight", s.weight],
    ["Expected delivery", fmtDay(s.expected_delivery)],
  ];
}

/** Registration emails with the waybill (and commercial invoice, when applicable) attached. */
export async function notifyShipmentCreated(shipment, { resend = false } = {}) {
  if (!emailEnabled()) return { sent: 0, failed: 0 };
  const url = trackingUrl(shipment);
  const { attachments, names } = await buildDocuments(shipment, ["waybill", "invoice", "packing_list", "customs"]);
  const attached = names.length ? `Attached: ${listNames(names)}.` : "";
  const messages = [];

  if (shipment.sender_email) {
    messages.push({
      to: shipment.sender_email,
      from: FROM,
      subject: `${resend ? "Reminder: " : ""}Shipment registered: ${shipment.tracking_number}`,
      html: layout({
        title: "Your shipment is registered",
        preheader: `Tracking number ${shipment.tracking_number}`,
        inner:
          paragraph(`Hello ${shipment.sender_name}, your shipment to ${shipment.receiver_name} has been registered with ${config.company.brand}. ${attached}`) +
          detailsTable([...shipmentRows(shipment), ["Recipient", shipment.receiver_name]]) +
          button("Track shipment", url) +
          paragraph("You will receive an email whenever the status of this shipment changes."),
      }),
      attachments,
    });
  }

  if (shipment.receiver_email) {
    messages.push({
      to: shipment.receiver_email,
      from: FROM,
      subject: `${resend ? "Reminder: " : ""}A shipment is on its way to you: ${shipment.tracking_number}`,
      html: layout({
        title: "A shipment is on its way to you",
        preheader: `Tracking number ${shipment.tracking_number}`,
        inner:
          paragraph(`Hello ${shipment.receiver_name}, ${shipment.sender_name} has sent you a shipment with ${config.company.brand}. ${attached}`) +
          detailsTable([...shipmentRows(shipment), ["Sender", shipment.sender_name]]) +
          button("Track shipment", url) +
          paragraph("When your shipment is delivered you will be asked to confirm receipt on the tracking page. Please keep the attached waybill for your records."),
      }),
      attachments,
    });
  }

  if (!resend && config.email.adminTo) {
    messages.push({
      to: config.email.adminTo,
      from: FROM,
      subject: `[Staff] New shipment ${shipment.tracking_number}`,
      html: layout({
        title: "New shipment registered",
        inner:
          detailsTable([
            ...shipmentRows(shipment),
            ["Sender", `${shipment.sender_name} (${shipment.sender_email})`],
            ["Recipient", `${shipment.receiver_name} (${shipment.receiver_email})`],
          ]) + button("Open tracking page", url),
      }),
    });
  }

  return deliver(messages);
}

/** Emails sender and receiver after a status or location change. */
export async function notifyStatusUpdate(shipment, previousStatus, note) {
  if (!emailEnabled()) return { sent: 0, failed: 0 };
  const url = trackingUrl(shipment);
  const status = shipment.shipment_status;
  const needsConfirmation = ["out for delivery", "delivered"].includes(status.toLowerCase());

  const rows = [
    ["Tracking number", shipment.tracking_number],
    ["Status", previousStatus && previousStatus !== status ? `${previousStatus} to ${status}` : status],
    ["Current location", shipment.current_location],
    ["Update", note],
    ["Expected delivery", fmtDay(shipment.expected_delivery)],
  ];

  const build = (name, body, extra = "") => ({
    title: `Shipment update: ${status}`,
    preheader: `${shipment.tracking_number} is now ${status}`,
    inner: paragraph(`Hello ${name}, ${body}`) + detailsTable(rows) + button("View tracking history", url) + extra,
  });

  const messages = [];
  if (shipment.sender_email) {
    messages.push({
      to: shipment.sender_email,
      from: FROM,
      subject: `Shipment update: ${status} (${shipment.tracking_number})`,
      html: layout(build(shipment.sender_name, `your shipment to ${shipment.receiver_name} has a new status.`)),
    });
  }
  if (shipment.receiver_email) {
    messages.push({
      to: shipment.receiver_email,
      from: FROM,
      subject: `Your shipment is ${status.toLowerCase()} (${shipment.tracking_number})`,
      html: layout(
        build(
          shipment.receiver_name,
          `your shipment from ${shipment.sender_name} has a new status.`,
          needsConfirmation ? paragraph("When you have received the shipment, please confirm receipt on the tracking page.") : "",
        ),
      ),
    });
  }
  return deliver(messages);
}

/** Proof of delivery to sender, receiver and staff after the recipient signs. */
export async function notifyDeliveryConfirmed(shipment) {
  if (!emailEnabled()) return { sent: 0, failed: 0 };
  const url = trackingUrl(shipment);
  const { attachments } = await buildDocuments(shipment, ["pod"]);
  const rows = [
    ["Tracking number", shipment.tracking_number],
    ["Delivered on", fmtInstant(shipment.delivered_at)],
    ["Received by", shipment.signed_by],
    ["Delivery address", place(shipment.receiver_address, shipment.destination_location, shipment.destination_country)],
  ];
  const message = (to, name, body, subject) => ({
    to,
    from: FROM,
    subject,
    html: layout({
      title: "Delivery confirmed",
      preheader: `${shipment.tracking_number} was received by ${shipment.signed_by}`,
      inner: paragraph(`Hello ${name}, ${body} The proof of delivery is attached.`) + detailsTable(rows) + button("View shipment", url),
    }),
    attachments,
  });

  const messages = [];
  if (shipment.sender_email) {
    messages.push(message(shipment.sender_email, shipment.sender_name, `your shipment to ${shipment.receiver_name} has been delivered and receipt was confirmed.`, `Delivery confirmed: ${shipment.tracking_number}`));
  }
  if (shipment.receiver_email) {
    messages.push(message(shipment.receiver_email, shipment.receiver_name, "thank you for confirming receipt of your shipment.", `Proof of delivery: ${shipment.tracking_number}`));
  }
  if (config.email.adminTo) {
    messages.push(message(config.email.adminTo, "team", `shipment ${shipment.tracking_number} was confirmed as received.`, `[Staff] Delivery confirmed: ${shipment.tracking_number}`));
  }
  return deliver(messages);
}

export async function sendContactInquiry({ name, email, subject, message }) {
  if (!emailEnabled() || !config.email.adminTo) return;
  await deliver([
    {
      to: config.email.adminTo,
      from: FROM,
      replyTo: { email, name },
      subject: `[Contact] ${subject} (${name})`,
      html: layout({
        title: "New message from the website",
        inner:
          detailsTable([
            ["Name", name],
            ["Email", email],
            ["Subject", subject],
          ]) +
          `<div style="margin:16px 0 4px;padding:16px;background:#F6F7F9;border:1px solid #E3E7EC;border-radius:6px;font:400 14px/1.7 ${FONT};color:#0F1B2A;white-space:pre-wrap;">${esc(message)}</div>`,
      }),
    },
  ]);
}


// ------------------------------------------------------------ composed emails
const toParagraphs = (text) =>
  String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font:400 15px/1.65 ${FONT};color:#2A3646;">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

/** Renders admin-written plain text inside the branded template. No HTML from the admin is ever trusted. */
export function renderComposedEmail({ shipment, subject, message, buttonLabel = "Track shipment" }) {
  return layout({
    title: subject,
    preheader: `Tracking number ${shipment.tracking_number}`,
    inner: toParagraphs(message) + button(buttonLabel, trackingUrl(shipment)),
  });
}

/** Sends an admin-reviewed email to one recipient. Returns { sent, failed }. */
export async function sendComposedEmail({ to, subject, message, shipment, attachments = [], buttonLabel }) {
  return deliver([
    {
      to,
      from: FROM,
      replyTo: config.company.supportEmail,
      subject,
      html: renderComposedEmail({ shipment, subject, message, buttonLabel }),
      attachments,
    },
  ]);
}

export async function sendReceiptEmail(shipment, fee, pdf) {
  const url = trackingUrl(shipment);
  return deliver([
    {
      to: shipment.receiver_email,
      from: FROM,
      replyTo: config.company.supportEmail,
      subject: `Payment receipt ${fee.receipt_number}: ${fee.category} (${shipment.tracking_number})`,
      html: layout({
        title: "We have received your payment",
        preheader: `Receipt ${fee.receipt_number}`,
        inner:
          paragraph(
            `Hello ${shipment.receiver_name}, thank you. We have received your payment for invoice ${fee.invoice_number}. Your receipt is attached.`,
          ) +
          detailsTable([
            ["Receipt number", fee.receipt_number],
            ["Invoice", fee.invoice_number],
            ["For", fee.category],
            ["Amount received", money(fee.total, fee.currency)],
            ["Payment method", fee.payment_method],
            ["Reference", fee.payment_reference],
            ["Shipment", shipment.tracking_number],
          ]) +
          button("Track shipment", url),
      }),
      attachments: [pdfAttachment(`${fee.receipt_number}.pdf`, pdf)],
    },
  ]);
}

export { pdfAttachment };

const sign = `Kind regards,\n${config.company.name}`;
const dayText = (v) => fmtDay(v);

export function feeEmailDefaults(shipment, fee) {
  const lines = [`Hello ${shipment.receiver_name},`];
  lines.push(
    `A charge of ${money(fee.total, fee.currency)} (${fee.category}) has been added to your shipment ${shipment.tracking_number}. Invoice ${fee.invoice_number} is attached to this email.`,
  );
  if ((fee.items || []).length > 1) {
    lines.push(`Charges:\n${fee.items.map((i) => `- ${i.description}: ${money(i.amount, fee.currency)}`).join("\n")}`);
  }
  if (fee.due_date) lines.push(`Payment is due by ${dayText(fee.due_date)}.`);
  lines.push(
    fee.payment_instructions
      ? `Payment instructions:\n${fee.payment_instructions}`
      : `To arrange payment, reply to this email or contact ${config.company.supportEmail}, quoting invoice number ${fee.invoice_number}.`,
  );
  lines.push("When we have confirmed your payment, we will send you a receipt.");
  lines.push(sign);
  return {
    to: shipment.receiver_email,
    subject: `Invoice ${fee.invoice_number}: ${fee.category} for shipment ${shipment.tracking_number}`,
    message: lines.join("\n\n"),
  };
}

export function noticeEmailDefaults(shipment, notice) {
  const d = notice.data || {};
  const lines = [`Hello ${shipment.receiver_name},`];
  if (notice.kind === "pre_arrival") {
    lines.push(`Your shipment ${shipment.tracking_number} is approaching its destination.`);
    lines.push(
      d.eta_date
        ? `Expected arrival: ${dayText(d.eta_date)}${d.eta_window ? ` (${d.eta_window})` : ""}.`
        : `Expected delivery: ${dayText(shipment.expected_delivery)}${d.eta_window ? ` (${d.eta_window})` : ""}.`,
    );
    if (Array.isArray(d.requirements) && d.requirements.length) {
      lines.push(`Please have ready:\n${d.requirements.map((r) => `- ${r}`).join("\n")}`);
    }
    if (d.notes) lines.push(d.notes);
    lines.push(`The pre-arrival notice is attached for your records.`);
    lines.push(sign);
    return {
      to: shipment.receiver_email,
      subject: `Your shipment ${shipment.tracking_number} is arriving soon`,
      message: lines.join("\n\n"),
    };
  }
  lines.push(`We need to let you know about an issue with your shipment ${shipment.tracking_number}.`);
  lines.push(`Reason: ${d.reason}\n${d.details || ""}`.trim());
  if (d.action_required) lines.push(`What we need from you:\n${d.action_required}`);
  if (d.new_expected_delivery) lines.push(`New expected delivery date: ${dayText(d.new_expected_delivery)}.`);
  lines.push("The delivery exception notice is attached for your records.");
  lines.push(sign);
  return {
    to: shipment.receiver_email,
    subject: `Delivery exception for shipment ${shipment.tracking_number}: ${d.reason}`,
    message: lines.join("\n\n"),
  };
}
