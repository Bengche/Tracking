import {
  C,
  PAGE,
  CONTENT_W,
  createPdf,
  finish,
  header,
  ensure,
  field,
  label,  fieldRow,
  parties,
  sectionTitle,
  rule,
  table,
  totals,
  paragraph,
  bullets,
  callout,
  stamp,
  verification,
  qrBuffer,
  documentNotes,
  place,
  money,
  fmtDay,
  fmtInstant,
  signatureBlock,
  imageBuffer,
} from "./pdfKit.js";
import { config } from "./config.js";
import { loadCompany } from "./settings.js";

const issuerParty = (company) => ({
  heading: "From",
  lines: [
    { text: company.display_name, bold: true },
    { text: company.registered_address },
    { text: company.registration_number ? `Reg. no. ${company.registration_number}` : "" },
    { text: company.tax_id ? `Tax ID: ${company.tax_id}` : "" },
    { text: config.company.supportEmail },
    { text: config.company.phone },
  ],
});

/** Velizon's authorised signature, placed at the foot of the document. */
function companySignature(doc, y, company, heading = "Authorised signature") {
  y = ensure(doc, y + 6, 100);
  return signatureBlock(doc, {
    x: PAGE.mx,
    y,
    width: 230,
    heading: `${heading} - ${company.display_name}`,
    image: imageBuffer(company.signature),
    name: company.signatory_name,
    title: company.signatory_title,
    date: company.signature ? fmtDay(new Date().toISOString()) : null,
  });
}

const billTo = (s) => ({
  heading: "Billed to",
  lines: [
    { text: s.receiver_name, bold: true },
    { text: s.receiver_address },
    { text: place(s.destination_location, s.destination_country) },
    { text: s.receiver_email },
  ],
});

function shipmentReference(doc, y, s) {
  return fieldRow(doc, y, [
    ["Shipment reference", s.tracking_number, { bold: true, mono: true }],
    ["Route", `${place(s.origin_location, s.origin_country)} to ${place(s.destination_location, s.destination_country)}`, { bold: true }],
    ["Service", s.shipment_type || "Standard", { bold: true }],
  ]);
}

// --------------------------------------------------------------- fee invoice
export async function buildFeeInvoice(s, fee) {
  const company = await loadCompany();
  const { doc, done } = createPdf({
    company,
    title: "Invoice",
    number: fee.invoice_number || "DRAFT",
    subject: `Invoice for shipment ${s.tracking_number}`,
  });
  const qr = qrBuffer(s);
  const issued = fee.sent_at || fee.created_at;
  let y = header(doc, { title: "Invoice", number: fee.invoice_number || "DRAFT", issued: fmtDay(issued) });

  y = fieldRow(doc, y, [
    ["Invoice number", fee.invoice_number || "Draft", { bold: true }],
    ["Date of issue", fmtDay(issued), { bold: true }],
    ["Payment due", fee.due_date ? fmtDay(fee.due_date) : "On receipt", { bold: true }],
    ["Currency", fee.currency, { bold: true }],
  ]);
  rule(doc, y);
  y = parties(doc, y + 14, issuerParty(company), billTo(s));
  rule(doc, y);
  y = shipmentReference(doc, y + 14, s);

  y = sectionTitle(doc, fee.category, y + 4);
  const rows = (fee.items || []).map((i) => ({ description: i.description, amount: money(i.amount, fee.currency) }));
  y = table(
    doc,
    y,
    [
      { key: "description", title: "Description", width: CONTENT_W - 150 },
      { key: "amount", title: `Amount (${fee.currency})`, width: 150, align: "right" },
    ],
    rows,
  );
  // Keep the totals (and the PAID stamp beside them) together on one page.
  y = ensure(doc, y + 14, fee.status === "paid" ? 96 : 56);
  const totalsTop = y;
  y = totals(doc, y, [
    { name: "Subtotal", value: money(fee.total, fee.currency) },
    { name: fee.status === "paid" ? "Total paid" : "Total due", value: money(fee.total, fee.currency), strong: true },
  ]);
  if (fee.status === "paid") {
    stamp(doc, "PAID", PAGE.mx + 8, totalsTop + 4);
    doc.font("Helvetica").fontSize(8.6).fillColor(C.muted);
    doc.text(`Payment received ${fmtDay(fee.received_on || fee.paid_at)}`, PAGE.mx + 8, totalsTop + 56, { lineBreak: false });
    y = Math.max(y, totalsTop + 72);
  }
  const d = fee.details || {};
  if (d.insured_value || d.coverage || d.policy_reference) {
    y = ensure(doc, y + 18, 90);
    y = sectionTitle(doc, "Insurance details", y);
    y = fieldRow(doc, y, [
      ["Insured value", d.insured_value ? money(d.insured_value, fee.currency) : "-"],
      ["Policy reference", d.policy_reference],
    ]);
    if (d.coverage) {
      y = ensure(doc, y, 40);
      label(doc, "Coverage", PAGE.mx, y, CONTENT_W);
      y = paragraph(doc, d.coverage, y + 12, { size: 9.8, color: C.ink });
    }
  }

  y = ensure(doc, y + 12, 110);
  y = sectionTitle(doc, "Payment instructions", y);
  y = paragraph(
    doc,
    fee.payment_instructions ||
      `Please contact ${config.company.supportEmail} for payment instructions, quoting invoice number ${fee.invoice_number || ""}.`.trim(),
    y,
  );
  y = paragraph(doc, `Please quote invoice number ${fee.invoice_number || ""} with your payment so that it can be matched.`, y, {
    size: 8.8,
    color: C.muted,
  });

  y = companySignature(doc, y, company);
  verification(doc, y + 2, s, qr, { optional: true });

  finish(doc, {
    notes: documentNotes(fee.status === "draft" ? "DRAFT: not yet issued." : `Invoice ${fee.invoice_number}`),
  });
  return done;
}

// ------------------------------------------------------------------- receipt
export async function buildReceipt(s, fee) {
  const company = await loadCompany();
  const { doc, done } = createPdf({
    company,
    title: "Payment receipt",
    number: fee.receipt_number,
    subject: `Receipt for invoice ${fee.invoice_number}`,
  });
  const qr = qrBuffer(s);
  let y = header(doc, { title: "Payment receipt", number: fee.receipt_number, issued: fmtDay(fee.received_on || fee.paid_at) });

  y = fieldRow(doc, y, [
    ["Receipt number", fee.receipt_number, { bold: true }],
    ["Date received", fmtDay(fee.received_on || fee.paid_at), { bold: true }],
    ["Invoice paid", fee.invoice_number, { bold: true }],
  ]);
  rule(doc, y);
  y = parties(
    doc,
    y + 14,
    { heading: "Received from", lines: billTo(s).lines },
    { heading: "Received by", lines: issuerParty(company).lines },
  );
  rule(doc, y);
  y = shipmentReference(doc, y + 14, s);

  y = sectionTitle(doc, "Payment", y + 4);
  y = fieldRow(doc, y, [
    ["Payment method", fee.payment_method, { bold: true }],
    ["Payment reference", fee.payment_reference],
    ["Recorded", fmtInstant(fee.paid_at)],
  ]);

  y = sectionTitle(doc, `Paid for: ${fee.category}`, y + 4);
  y = table(
    doc,
    y,
    [
      { key: "description", title: "Description", width: CONTENT_W - 150 },
      { key: "amount", title: `Amount (${fee.currency})`, width: 150, align: "right" },
    ],
    (fee.items || []).map((i) => ({ description: i.description, amount: money(i.amount, fee.currency) })),
  );
  y = totals(doc, y + 14, [{ name: "Amount received", value: money(fee.total, fee.currency), strong: true }]);

  y = ensure(doc, y + 14, 80);
  stamp(doc, "PAID IN FULL", PAGE.mx + 4, y + 2);
  y += 70;
  y = paragraph(doc, "Thank you. This receipt confirms that the payment above has been received in full.", y, { size: 9.6 });
  y = companySignature(doc, y, company);
  verification(doc, y + 2, s, qr, { optional: true });

  finish(doc, { notes: documentNotes(`Receipt ${fee.receipt_number} for invoice ${fee.invoice_number}`) });
  return done;
}

// -------------------------------------------------------------------- notices
export async function buildPreArrivalNotice(s, notice) {
  const company = await loadCompany();
  const d = notice.data || {};
  const { doc, done } = createPdf({
    company,
    title: "Pre-arrival notice",
    number: notice.reference_number,
    subject: `Pre-arrival notice for shipment ${s.tracking_number}`,
  });
  const qr = qrBuffer(s);
  let y = header(doc, {
    title: "Pre-arrival notice",
    number: notice.reference_number,
    issued: fmtDay(notice.sent_at || notice.created_at),
  });

  y = paragraph(
    doc,
    `Dear ${s.receiver_name}, your shipment is approaching its destination. Please read the details below so that delivery can go smoothly.`,
    y,
    { size: 10.4 },
  );
  y = callout(
    doc,
    y + 4,
    d.eta_date ? `Expected arrival: ${fmtDay(d.eta_date)}` : `Expected delivery: ${fmtDay(s.expected_delivery)}`,
    d.eta_window ? `Delivery window: ${d.eta_window}` : "",
  );

  y = fieldRow(doc, y, [
    ["Tracking number", s.tracking_number, { bold: true, mono: true }],
    ["Service", s.shipment_type || "Standard", { bold: true }],
    ["Pieces", s.pieces, { bold: true }],
    ["Weight", s.weight, { bold: true }],
  ]);
  rule(doc, y);
  y = parties(
    doc,
    y + 14,
    { heading: "Shipper", lines: [{ text: s.sender_name, bold: true }, { text: place(s.origin_location, s.origin_country) }] },
    {
      heading: "Deliver to",
      lines: [
        { text: s.receiver_name, bold: true },
        { text: s.receiver_address },
        { text: place(s.destination_location, s.destination_country) },
      ],
    },
  );

  if (Array.isArray(d.requirements) && d.requirements.length > 0) {
    y = sectionTitle(doc, "Please have ready", y + 2);
    y = bullets(doc, d.requirements, y);
    y += 6;
  }
  if (d.notes) {
    y = sectionTitle(doc, "Additional information", y + 2);
    y = paragraph(doc, d.notes, y);
  }
  y = paragraph(
    doc,
    `If you need to change anything, contact ${config.company.supportEmail} or ${config.company.phone} and quote the tracking number.`,
    y + 4,
    { size: 9, color: C.muted },
  );
  y = companySignature(doc, y, company);
  verification(doc, y + 2, s, qr, { optional: true });

  finish(doc, { notes: documentNotes(`Reference ${notice.reference_number}`) });
  return done;
}

export async function buildExceptionNotice(s, notice) {
  const company = await loadCompany();
  const d = notice.data || {};
  const { doc, done } = createPdf({
    company,
    title: "Delivery exception notice",
    number: notice.reference_number,
    subject: `Delivery exception for shipment ${s.tracking_number}`,
  });
  const qr = qrBuffer(s);
  let y = header(doc, {
    title: "Delivery exception notice",
    number: notice.reference_number,
    issued: fmtDay(notice.sent_at || notice.created_at),
  });

  y = paragraph(
    doc,
    `Dear ${s.receiver_name}, we are writing about an issue with your shipment that needs your attention.`,
    y,
    { size: 10.4 },
  );
  y = callout(doc, y + 4, d.reason || "Delivery exception", d.details || "");

  if (d.action_required) {
    y = sectionTitle(doc, "Action required", y + 2);
    y = paragraph(doc, d.action_required, y, { size: 10 });
  }
  y = fieldRow(doc, y + 4, [
    ["Tracking number", s.tracking_number, { bold: true, mono: true }],
    ["Current status", s.shipment_status, { bold: true }],
    ["Current location", s.current_location, { bold: true }],
  ]);
  y = fieldRow(doc, y, [
    ["Previous expected delivery", fmtDay(s.expected_delivery)],
    ["New expected delivery", d.new_expected_delivery ? fmtDay(d.new_expected_delivery) : "To be confirmed", { bold: true }],
    ["Service", s.shipment_type || "Standard"],
  ]);
  rule(doc, y);
  y = parties(
    doc,
    y + 14,
    { heading: "Shipper", lines: [{ text: s.sender_name, bold: true }, { text: place(s.origin_location, s.origin_country) }] },
    {
      heading: "Consignee",
      lines: [
        { text: s.receiver_name, bold: true },
        { text: s.receiver_address },
        { text: place(s.destination_location, s.destination_country) },
      ],
    },
  );
  y = paragraph(
    doc,
    `Questions? Contact ${config.company.supportEmail} or ${config.company.phone} and quote the tracking number.`,
    y,
    { size: 9, color: C.muted },
  );
  y = companySignature(doc, y, company);
  verification(doc, y + 2, s, qr, { optional: true });

  finish(doc, { notes: documentNotes(`Reference ${notice.reference_number}`) });
  return done;
}

export const NOTICE_BUILDERS = { pre_arrival: buildPreArrivalNotice, exception: buildExceptionNotice };
