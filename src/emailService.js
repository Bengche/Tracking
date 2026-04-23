import sgMail from "@sendgrid/mail";

const FROM_EMAIL = "support@velizon.com";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://velizon.com";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ── Shared layout helpers ───────────────────────────────────────────────────
function emailWrapper(content) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#EEF2F7;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#EEF2F7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
          ${content}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailHeader(title, subtitle) {
  return `
<tr>
  <td style="background-color:#0A1628;border-radius:12px 12px 0 0;padding:36px 40px 32px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td>
          <span style="font-size:13px;font-weight:800;color:#F59E0B;letter-spacing:4px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">VELIZON</span>
        </td>
      </tr>
      <tr>
        <td style="padding-top:20px;">
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#FFFFFF;line-height:1.35;font-family:Arial,Helvetica,sans-serif;">${title}</h1>
        </td>
      </tr>
      ${subtitle ? `<tr><td style="padding-top:8px;"><p style="margin:0;font-size:13px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">${subtitle}</p></td></tr>` : ""}
    </table>
  </td>
</tr>`;
}

function emailBody(inner) {
  return `
<tr>
  <td style="background-color:#FFFFFF;padding:36px 40px;font-family:Arial,Helvetica,sans-serif;">
    ${inner}
  </td>
</tr>`;
}

function emailFooter() {
  const year = new Date().getFullYear();
  return `
<tr>
  <td style="background-color:#0F172A;border-radius:0 0 12px 12px;padding:28px 40px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="center">
          <p style="margin:0;font-size:13px;color:#64748B;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">
            Questions? Contact us at
            <a href="mailto:support@velizon.com" style="color:#F59E0B;text-decoration:none;">support@velizon.com</a>
          </p>
          <p style="margin:10px 0 0;font-size:11px;color:#334155;font-family:Arial,Helvetica,sans-serif;">
            &copy; ${year} Velizon Logistics &middot; All rights reserved
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function ctaButton(label, url) {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px;">
  <tr>
    <td style="border-radius:8px;background-color:#F59E0B;">
      <a href="${url}" target="_blank"
        style="display:inline-block;padding:14px 34px;font-size:15px;font-weight:700;color:#0A1628;text-decoration:none;font-family:Arial,Helvetica,sans-serif;letter-spacing:0.2px;"
      >${label}</a>
    </td>
  </tr>
</table>`;
}

function detailsTable(rows) {
  const visibleRows = rows.filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  const cells = visibleRows
    .map(
      ([label, value]) => `
<tr>
  <td style="padding:11px 16px;font-size:12px;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;width:40%;border-bottom:1px solid #F1F5F9;font-family:Arial,Helvetica,sans-serif;vertical-align:top;">${label}</td>
  <td style="padding:11px 16px;font-size:14px;color:#1E293B;font-weight:500;border-bottom:1px solid #F1F5F9;font-family:Arial,Helvetica,sans-serif;">${value}</td>
</tr>`,
    )
    .join("");

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
  style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin:20px 0;">
  <thead>
    <tr style="background-color:#F8FAFC;">
      <th colspan="2" style="padding:12px 16px;text-align:left;font-size:11px;color:#94A3B8;font-weight:700;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #E2E8F0;font-family:Arial,Helvetica,sans-serif;">
        Shipment Details
      </th>
    </tr>
  </thead>
  <tbody>
    ${cells}
  </tbody>
</table>`;
}

function statusBadge(status) {
  const lower = (status || "").toLowerCase();
  let bg = "#FEF3C7";
  let fg = "#92400E";
  if (lower.includes("delivered")) {
    bg = "#D1FAE5";
    fg = "#065F46";
  } else if (
    lower.includes("transit") ||
    lower.includes("progress") ||
    lower.includes("dispatched")
  ) {
    bg = "#DBEAFE";
    fg = "#1E40AF";
  } else if (lower.includes("pending") || lower.includes("processing")) {
    bg = "#FEF3C7";
    fg = "#92400E";
  } else if (
    lower.includes("exception") ||
    lower.includes("failed") ||
    lower.includes("return")
  ) {
    bg = "#FEE2E2";
    fg = "#991B1B";
  }
  return `<span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;background-color:${bg};color:${fg};font-family:Arial,Helvetica,sans-serif;">${status || "—"}</span>`;
}

function divider() {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr><td style="border-top:1px solid #F1F5F9;"></td></tr>
</table>`;
}

// ── Template builders ───────────────────────────────────────────────────────
function buildSenderCreatedEmail(s, trackingUrl) {
  const expectedDate = s.expected_delivery
    ? new Date(s.expected_delivery).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const table = detailsTable([
    [
      "Tracking Number",
      `<strong style="font-family:monospace,Courier,serif;font-size:15px;color:#0A1628;letter-spacing:1px;">${s.tracking_number}</strong>`,
    ],
    ["Status", statusBadge(s.shipment_status || "Processing")],
    [
      "From",
      s.origin_location
        ? `${s.origin_location}, ${s.origin_country || ""}`
        : s.origin_country,
    ],
    [
      "To",
      s.destination_location
        ? `${s.destination_location}, ${s.destination_country || ""}`
        : s.destination_country,
    ],
    ["Recipient", s.receiver_name],
    ["Expected Delivery", expectedDate],
    ["Shipment Type", s.shipment_type],
    ["Weight", s.weight ? `${s.weight} kg` : null],
  ]);

  const body = `
<p style="margin:0 0 6px;font-size:16px;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">
  Hello <strong>${s.sender_name || "there"}</strong>,
</p>
<p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">
  Your shipment has been registered in our system and is on its way to the next step. Use the tracking number below to monitor its progress at any time.
</p>
${table}
${ctaButton("Track My Shipment", trackingUrl)}
${divider()}
<p style="margin:0;font-size:13px;color:#94A3B8;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
  Share tracking number
  <strong style="color:#64748B;">${s.tracking_number}</strong>
  with your recipient so they can also follow the shipment.
</p>`;

  return emailWrapper(
    emailHeader(
      "Your shipment has been registered",
      "Velizon Logistics &mdash; Shipment Confirmation",
    ) +
      emailBody(body) +
      emailFooter(),
  );
}

function buildReceiverCreatedEmail(s, trackingUrl) {
  const expectedDate = s.expected_delivery
    ? new Date(s.expected_delivery).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const table = detailsTable([
    [
      "Tracking Number",
      `<strong style="font-family:monospace,Courier,serif;font-size:15px;color:#0A1628;letter-spacing:1px;">${s.tracking_number}</strong>`,
    ],
    ["Status", statusBadge(s.shipment_status || "Processing")],
    ["Sender", s.sender_name],
    [
      "From",
      s.origin_location
        ? `${s.origin_location}, ${s.origin_country || ""}`
        : s.origin_country,
    ],
    [
      "Destination",
      s.destination_location
        ? `${s.destination_location}, ${s.destination_country || ""}`
        : s.destination_country,
    ],
    ["Expected Delivery", expectedDate],
    ["Shipment Type", s.shipment_type],
  ]);

  // Use CID reference — the actual image is sent as an inline attachment.
  // Data URLs are blocked by virtually all email clients (Gmail, Outlook, Apple Mail).
  const qrSection = s.qr_code
    ? `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;">
  <tr>
    <td align="center" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:28px 20px;">
      <p style="margin:0 0 16px;font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
        Scan to track your shipment
      </p>
      <img src="cid:velizon-qrcode" alt="Tracking QR Code" width="160" height="160"
        style="display:block;border:none;outline:none;border-radius:6px;" />
      <p style="margin:14px 0 0;font-size:13px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">
        Or use tracking number <strong style="color:#64748B;">${s.tracking_number}</strong>
      </p>
    </td>
  </tr>
</table>`
    : "";

  const body = `
<p style="margin:0 0 6px;font-size:16px;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">
  Hello <strong>${s.receiver_name || "there"}</strong>,
</p>
<p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">
  A shipment from <strong>${s.sender_name || "a sender"}</strong> has been registered and is heading your way.
  You can track its progress in real time using the button below or by scanning the QR code.
</p>
${table}
${qrSection}
${ctaButton("Track My Shipment", trackingUrl)}
${divider()}
<p style="margin:0;font-size:13px;color:#94A3B8;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
  You will receive email updates whenever your shipment status changes.
</p>`;

  return emailWrapper(
    emailHeader(
      "A shipment is on its way to you",
      "Velizon Logistics &mdash; Incoming Shipment",
    ) +
      emailBody(body) +
      emailFooter(),
  );
}

function buildAdminCreatedEmail(s, trackingUrl) {
  const expectedDate = s.expected_delivery
    ? new Date(s.expected_delivery).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const table = detailsTable([
    [
      "Tracking Number",
      `<strong style="font-family:monospace,Courier,serif;color:#0A1628;">${s.tracking_number}</strong>`,
    ],
    ["Shipment ID", s.shipment_id],
    ["Status", statusBadge(s.shipment_status || "Processing")],
    ["Sender", s.sender_name],
    ["Sender Email", s.sender_email],
    ["Sender Phone", s.sender_phone],
    ["Sender Address", s.sender_address],
    ["Receiver", s.receiver_name],
    ["Receiver Email", s.receiver_email],
    ["Receiver Phone", s.receiver_phone],
    ["Receiver Address", s.receiver_address],
    ["Receiver Country", s.receiver_country],
    [
      "Origin",
      s.origin_location
        ? `${s.origin_location}, ${s.origin_country || ""}`
        : s.origin_country,
    ],
    [
      "Destination",
      s.destination_location
        ? `${s.destination_location}, ${s.destination_country || ""}`
        : s.destination_country,
    ],
    ["Current Location", s.current_location],
    ["Expected Delivery", expectedDate],
    ["Type", s.shipment_type],
    ["Weight", s.weight ? `${s.weight} kg` : null],
    ["Dimensions", s.dimensions],
    ["Contents", s.contents],
    ["Remarks", s.remarks],
  ]);

  const body = `
<p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">
  A new shipment has been registered in the system.
</p>
${table}
${ctaButton("View Shipment", trackingUrl)}`;

  return emailWrapper(
    emailHeader(
      "New shipment registered",
      `Admin Notification &mdash; ${new Date().toDateString()}`,
    ) +
      emailBody(body) +
      emailFooter(),
  );
}

function buildStatusUpdateEmail(s, previousStatus, role, trackingUrl) {
  const recipientName = role === "sender" ? s.sender_name : s.receiver_name;
  const expectedDate = s.expected_delivery
    ? new Date(s.expected_delivery).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const contextLine =
    role === "sender"
      ? `Your shipment to <strong>${s.receiver_name || "the recipient"}</strong> in <strong>${s.destination_country || s.destination_location || "the destination"}</strong> has a new update.`
      : `A shipment from <strong>${s.sender_name || "the sender"}</strong> addressed to you has a new update.`;

  const tableRows = [
    [
      "Tracking Number",
      `<strong style="font-family:monospace,Courier,serif;font-size:15px;color:#0A1628;letter-spacing:1px;">${s.tracking_number}</strong>`,
    ],
    ...(previousStatus
      ? [
          [
            "Previous Status",
            `<span style="color:#94A3B8;">${previousStatus}</span>`,
          ],
        ]
      : []),
    ["Current Status", statusBadge(s.shipment_status || "")],
    ["Current Location", s.current_location],
    [
      "Origin",
      s.origin_location
        ? `${s.origin_location}, ${s.origin_country || ""}`
        : s.origin_country,
    ],
    [
      "Destination",
      s.destination_location
        ? `${s.destination_location}, ${s.destination_country || ""}`
        : s.destination_country,
    ],
    ["Expected Delivery", expectedDate],
    ...(s.remarks ? [["Remarks", s.remarks]] : []),
  ];

  const body = `
<p style="margin:0 0 6px;font-size:16px;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">
  Hello <strong>${recipientName || "there"}</strong>,
</p>
<p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">
  ${contextLine}
</p>
${detailsTable(tableRows)}
${ctaButton("Track Shipment", trackingUrl)}
${divider()}
<p style="margin:0;font-size:13px;color:#94A3B8;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
  You will continue to receive updates whenever your shipment status changes.
</p>`;

  return emailWrapper(
    emailHeader(
      "Shipment status updated",
      `Velizon Logistics &mdash; Update for ${s.tracking_number}`,
    ) +
      emailBody(body) +
      emailFooter(),
  );
}

function buildDeliveryConfirmedEmail(
  s,
  recipientName,
  timestamp,
  role,
  trackingUrl,
) {
  const addresseeName =
    role === "sender"
      ? s.sender_name
      : role === "receiver"
        ? s.receiver_name
        : "Admin";

  let intro = "";
  if (role === "sender") {
    intro = `Your shipment to <strong>${s.receiver_name || "the recipient"}</strong> has been successfully delivered and confirmed with a digital signature.`;
  } else if (role === "receiver") {
    intro = `Your delivery from <strong>${s.sender_name || "the sender"}</strong> has been confirmed. Thank you for signing for your shipment.`;
  } else {
    intro = `Shipment <strong>${s.tracking_number}</strong> has been delivered and confirmed by the recipient.`;
  }

  const confirmedBanner = `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td style="background-color:#ECFDF5;border:1px solid #6EE7B7;border-radius:8px;padding:16px 20px;">
      <p style="margin:0;font-size:14px;color:#065F46;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
        &#10003;&nbsp;&nbsp;Delivery confirmed on ${timestamp}
      </p>
    </td>
  </tr>
</table>`;

  const table = detailsTable([
    [
      "Tracking Number",
      `<strong style="font-family:monospace,Courier,serif;font-size:15px;color:#0A1628;letter-spacing:1px;">${s.tracking_number}</strong>`,
    ],
    ["Delivery Status", statusBadge("Delivered - Confirmed")],
    ["Confirmed By", recipientName],
    ["Confirmed On", timestamp],
    [
      "Origin",
      s.origin_location
        ? `${s.origin_location}, ${s.origin_country || ""}`
        : s.origin_country,
    ],
    [
      "Destination",
      s.destination_location
        ? `${s.destination_location}, ${s.destination_country || ""}`
        : s.destination_country,
    ],
    ["Sender", role !== "sender" ? s.sender_name : null],
    ["Recipient", role !== "receiver" ? s.receiver_name : null],
  ]);

  const body = `
<p style="margin:0 0 6px;font-size:16px;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">
  Hello <strong>${addresseeName || "there"}</strong>,
</p>
<p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">
  ${intro}
</p>
${confirmedBanner}
${table}
${ctaButton("View Shipment", trackingUrl)}`;

  return emailWrapper(
    emailHeader(
      "Delivery confirmed",
      `Velizon Logistics &mdash; ${s.tracking_number}`,
    ) +
      emailBody(body) +
      emailFooter(),
  );
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a contact inquiry from the /contact page to ADMIN_EMAIL.
 */
export async function sendContactInquiry({ name, email, subject, message }) {
  if (!process.env.SENDGRID_API_KEY) return;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const html = emailWrapper(
    emailHeader(
      `New Contact Inquiry: ${subject}`,
      `Submitted via the website contact form`,
    ) +
      emailBody(`
<p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">
  A visitor has submitted a message through the contact form.
</p>
${detailsTable([
  ["Name", name],
  [
    "Email",
    `<a href="mailto:${email}" style="color:#F59E0B;text-decoration:none;">${email}</a>`,
  ],
  ["Subject", subject],
])}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
  <tr>
    <td style="padding:16px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-size:14px;color:#1E293B;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">
      ${message.replace(/\n/g, "<br />")}
    </td>
  </tr>
</table>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0;">
  <tr>
    <td style="border-radius:8px;background-color:#0A1628;">
      <a href="mailto:${email}?subject=Re: ${encodeURIComponent(subject)}" target="_blank"
        style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#F59E0B;text-decoration:none;font-family:Arial,Helvetica,sans-serif;"
      >Reply to ${name}</a>
    </td>
  </tr>
</table>`) +
      emailFooter(),
  );

  try {
    await sgMail.send({
      to: adminEmail,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      replyTo: email,
      subject: `[Contact] ${subject} — from ${name}`,
      html,
    });
  } catch (err) {
    console.error("[email] sendContactInquiry failed:", err.message);
  }
}

/**
 * Fire emails to sender, receiver, and admin when a shipment is created.
 * Non-blocking — call without await from route handlers.
 */
export async function notifyShipmentCreated(shipment) {
  if (!process.env.SENDGRID_API_KEY) return;

  const trackingUrl = `${FRONTEND_URL}/track?tracking=${shipment.tracking_number}`;
  const adminEmail = process.env.ADMIN_EMAIL;
  const messages = [];

  if (shipment.sender_email) {
    messages.push({
      to: shipment.sender_email,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `Shipment registered — ${shipment.tracking_number}`,
      html: buildSenderCreatedEmail(shipment, trackingUrl),
    });
  }

  if (shipment.receiver_email) {
    const receiverMsg = {
      to: shipment.receiver_email,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `A shipment is on its way to you — ${shipment.tracking_number}`,
      html: buildReceiverCreatedEmail(shipment, trackingUrl),
    };
    // Attach QR code as a CID inline image so email clients can render it.
    // The HTML references it as src="cid:velizon-qrcode".
    if (shipment.qr_code) {
      const base64Content = shipment.qr_code.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      receiverMsg.attachments = [
        {
          content: base64Content,
          type: "image/png",
          filename: "tracking-qr.png",
          disposition: "inline",
          content_id: "velizon-qrcode",
        },
      ];
    }
    messages.push(receiverMsg);
  }

  if (adminEmail) {
    messages.push({
      to: adminEmail,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `[Admin] New shipment — ${shipment.tracking_number}`,
      html: buildAdminCreatedEmail(shipment, trackingUrl),
    });
  }

  const results = await Promise.allSettled(messages.map((m) => sgMail.send(m)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const sgErrors = r.reason?.response?.body?.errors;
      const detail = sgErrors
        ? JSON.stringify(sgErrors)
        : r.reason?.message;
      console.error(
        `[email] Failed sending to ${messages[i].to}:`,
        detail,
      );
    }
  });
}

/**
 * Fire emails to sender and receiver when shipment status or location changes.
 * Pass previousStatus (string | null) to show the change in the email.
 */
export async function notifyStatusUpdate(shipment, previousStatus) {
  if (!process.env.SENDGRID_API_KEY) return;

  const trackingUrl = `${FRONTEND_URL}/track?tracking=${shipment.tracking_number}`;
  const messages = [];

  if (shipment.sender_email) {
    messages.push({
      to: shipment.sender_email,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `Shipment update — ${shipment.tracking_number}`,
      html: buildStatusUpdateEmail(
        shipment,
        previousStatus,
        "sender",
        trackingUrl,
      ),
    });
  }

  if (shipment.receiver_email) {
    messages.push({
      to: shipment.receiver_email,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `Your shipment has been updated — ${shipment.tracking_number}`,
      html: buildStatusUpdateEmail(
        shipment,
        previousStatus,
        "receiver",
        trackingUrl,
      ),
    });
  }

  const results = await Promise.allSettled(messages.map((m) => sgMail.send(m)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const sgErrors = r.reason?.response?.body?.errors;
      const detail = sgErrors ? JSON.stringify(sgErrors) : r.reason?.message;
      console.error(`[email] Failed sending to ${messages[i].to}:`, detail);
    }
  });
}

/**
 * Fire emails to sender, receiver, and admin when delivery is confirmed
 * with a digital signature.
 */
export async function notifyDeliveryConfirmed(shipment, recipientName) {
  if (!process.env.SENDGRID_API_KEY) return;

  const trackingUrl = `${FRONTEND_URL}/track?tracking=${shipment.tracking_number}`;
  const adminEmail = process.env.ADMIN_EMAIL;
  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const messages = [];

  if (shipment.sender_email) {
    messages.push({
      to: shipment.sender_email,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `Delivery confirmed — ${shipment.tracking_number}`,
      html: buildDeliveryConfirmedEmail(
        shipment,
        recipientName,
        timestamp,
        "sender",
        trackingUrl,
      ),
    });
  }

  if (shipment.receiver_email) {
    messages.push({
      to: shipment.receiver_email,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `Your delivery has been confirmed — ${shipment.tracking_number}`,
      html: buildDeliveryConfirmedEmail(
        shipment,
        recipientName,
        timestamp,
        "receiver",
        trackingUrl,
      ),
    });
  }

  if (adminEmail) {
    messages.push({
      to: adminEmail,
      from: { email: FROM_EMAIL, name: "Velizon Logistics" },
      subject: `[Admin] Delivery confirmed — ${shipment.tracking_number}`,
      html: buildDeliveryConfirmedEmail(
        shipment,
        recipientName,
        timestamp,
        "admin",
        trackingUrl,
      ),
    });
  }

  const results = await Promise.allSettled(messages.map((m) => sgMail.send(m)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const sgErrors = r.reason?.response?.body?.errors;
      const detail = sgErrors ? JSON.stringify(sgErrors) : r.reason?.message;
      console.error(`[email] Failed sending to ${messages[i].to}:`, detail);
    }
  });
}
