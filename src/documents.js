import {
  C,
  PAGE,
  CONTENT_W,
  createPdf,
  finish,
  header,
  ensure,
  field,
  fieldRow,
  label,
  parties,
  sectionTitle,
  rule,
  table,
  totals,
  paragraph,
  callout,
  signatureLine,
  verification,
  qrBuffer,
  barcode,
  drawMark,
  drawWordmark,
  trackingBand,
  documentNotes,
  txt,
  place,
  money,
  fmtDay,
  fmtInstant,
  trackingUrl,
} from "./pdfKit.js";
import { config } from "./config.js";
import { isInternational } from "./shipmentModel.js";
import { CUSTOMS_CATEGORIES } from "./validation.js";

/** Itemised goods, falling back to the free-text contents when no items were entered. */
export function itemsOf(s) {
  if (Array.isArray(s.items) && s.items.length > 0) return s.items;
  if (s.contents && String(s.contents).trim()) return [{ description: String(s.contents).trim(), quantity: null }];
  return [];
}

const sumQuantity = (items) => {
  const q = items.map((i) => Number(i.quantity)).filter(Number.isFinite);
  return q.length === items.length && q.length > 0 ? q.reduce((a, b) => a + b, 0) : null;
};

const shipper = (s) => ({
  heading: "Shipper",
  lines: [
    { text: s.sender_name, bold: true },
    { text: s.sender_address },
    { text: place(s.origin_location, s.origin_country) },
    { text: s.sender_email },
    { text: s.sender_phone },
  ],
});

const consignee = (s) => ({
  heading: "Consignee",
  lines: [
    { text: s.receiver_name, bold: true },
    { text: s.receiver_address },
    { text: place(s.destination_location, s.destination_country) },
    { text: s.receiver_email },
    { text: s.receiver_phone },
  ],
});

const routeText = (s) => `${place(s.origin_location, s.origin_country)}  to  ${place(s.destination_location, s.destination_country)}`;

// ------------------------------------------------------------------ waybill
export async function buildWaybill(s) {
  const number = s.tracking_number;
  const { doc, done } = createPdf({ title: "Shipping waybill", number, subject: "Shipping waybill" });
  const qr = qrBuffer(s);
  let y = header(doc, { title: "Shipping waybill", number, issued: fmtDay(s.created_at) });

  y = trackingBand(doc, y, s, qr);
  rule(doc, y);
  y = parties(doc, y + 14, shipper(s), consignee(s));
  rule(doc, y);

  y = sectionTitle(doc, "Shipment particulars", y + 14);
  y = fieldRow(doc, y, [
    ["Origin", place(s.origin_location, s.origin_country), { bold: true }],
    ["Destination", place(s.destination_location, s.destination_country), { bold: true }],
    ["Service", s.shipment_type || "Standard", { bold: true }],
    ["Expected delivery", fmtDay(s.expected_delivery), { bold: true }],
  ]);
  y = fieldRow(doc, y, [
    ["Pieces", s.pieces],
    ["Weight", s.weight],
    ["Dimensions", s.dimensions],
    ["Status at issue", s.shipment_status],
  ]);
  y = field(doc, "Description of contents", s.contents, PAGE.mx, y, CONTENT_W);
  if (Number(s.declared_value) > 0) {
    y = field(doc, "Declared value", money(s.declared_value, s.currency), PAGE.mx, y, CONTENT_W, { bold: true });
  }
  if (s.remarks) y = field(doc, "Remarks", s.remarks, PAGE.mx, y, CONTENT_W);

  y = ensure(doc, y + 6, 150);
  y = paragraph(
    doc,
    "The shipper confirms that the particulars above are correct and that the shipment contains no prohibited or restricted articles. Carriage is subject to the Terms of Service published at " +
      `${config.frontendUrl}/terms.`,
    y,
    { size: 8.6, color: C.muted },
  );
  y = signatureLine(doc, y + 22, "Issued electronically for and on behalf of Velizon Logistics");
  verification(doc, y + 6, s, qr);

  finish(doc, { notes: documentNotes("Valid without a handwritten signature. Reference: waybill " + number) });
  return done;
}

// --------------------------------------------------------- commercial invoice
export async function buildInvoice(s) {
  const number = `CI-${s.tracking_number}`;
  const { doc, done } = createPdf({ title: "Commercial invoice", number, subject: "Commercial invoice" });
  const qr = qrBuffer(s);
  let y = header(doc, { title: "Commercial invoice", number, issued: fmtDay(new Date().toISOString()) });

  y = fieldRow(doc, y, [
    ["Invoice number", number, { bold: true }],
    ["Shipment reference", s.tracking_number, { bold: true, mono: true }],
    ["Currency", s.currency || "USD", { bold: true }],
  ]);
  rule(doc, y);
  y = parties(
    doc,
    y + 14,
    { ...shipper(s), heading: "Exporter / shipper" },
    { ...consignee(s), heading: "Consignee / importer" },
  );
  rule(doc, y);
  y = fieldRow(doc, y + 14, [
    ["Country of dispatch", s.origin_country],
    ["Country of destination", s.destination_country],
    ["Service", s.shipment_type || "Standard"],
  ]);

  y = sectionTitle(doc, "Goods", y + 4);
  const items = itemsOf(s);
  const priced = items.length > 0 && items.every((i) => Number.isFinite(Number(i.unit_value)));
  let rows;
  let cols;
  if (priced) {
    cols = [
      { key: "description", title: "Description of goods", width: CONTENT_W - 300 },
      { key: "quantity", title: "Qty", width: 50, align: "right" },
      { key: "unit", title: "Unit value", width: 100, align: "right" },
      { key: "total", title: "Line total", width: 150, align: "right" },
    ];
    rows = items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unit: money(i.unit_value, s.currency),
      total: money(Number(i.unit_value) * Number(i.quantity || 1), s.currency),
    }));
  } else {
    cols = [
      { key: "description", title: "Description of goods", width: CONTENT_W - 260 },
      { key: "quantity", title: "Qty / pieces", width: 90, align: "right" },
      { key: "weight", title: "Weight", width: 80, align: "right" },
      { key: "total", title: "Total value", width: 90, align: "right" },
    ];
    rows = [
      {
        description: items.map((i) => i.description).join("; ") || "General merchandise",
        quantity: sumQuantity(items) ?? s.pieces,
        weight: s.weight,
        total: money(s.declared_value, s.currency),
      },
    ];
  }
  y = table(doc, y, cols, rows);
  y = totals(doc, y + 14, [
    { name: "Total declared value", value: money(s.declared_value, s.currency), strong: true },
  ]);

  y = paragraph(
    doc,
    "The shipper declares that the information on this invoice is true and correct, that the goods are described accurately and that the value shown is the declared value for customs purposes. Duties and taxes, where applicable, are determined by the customs authority of the destination country.",
    y + 18,
    { size: 8.8 },
  );
  y = signatureLine(doc, ensure(doc, y + 26, 60) + 0, `Declared by ${s.sender_name}`);
  verification(doc, y + 6, s, qr);

  finish(doc, { notes: documentNotes("Values are as supplied by the shipper. Reference: " + number) });
  return done;
}

// --------------------------------------------------------------- packing list
export async function buildPackingList(s) {
  const number = `PL-${s.tracking_number}`;
  const { doc, done } = createPdf({ title: "Packing list", number, subject: "Packing list" });
  const qr = qrBuffer(s);
  let y = header(doc, { title: "Packing list", number, issued: fmtDay(new Date().toISOString()) });

  y = fieldRow(doc, y, [
    ["Shipment reference", s.tracking_number, { bold: true, mono: true }],
    ["Service", s.shipment_type || "Standard", { bold: true }],
    ["Route", routeText(s), { bold: true }],
  ]);
  rule(doc, y);
  y = parties(doc, y + 14, shipper(s), consignee(s));
  rule(doc, y);

  y = sectionTitle(doc, "Contents", y + 14);
  const items = itemsOf(s);
  const rows = items.map((i, idx) => ({
    no: idx + 1,
    description: i.description,
    quantity: i.quantity,
    weight: i.weight,
    origin: i.origin_country,
  }));
  y = table(
    doc,
    y,
    [
      { key: "no", title: "No.", width: 40 },
      { key: "description", title: "Description", width: CONTENT_W - 270 },
      { key: "quantity", title: "Qty", width: 60, align: "right" },
      { key: "weight", title: "Weight", width: 80, align: "right" },
      { key: "origin", title: "Origin", width: 90 },
    ],
    rows,
  );

  y = totals(doc, y + 14, [
    { name: "Packages", value: txt(s.pieces) },
    { name: "Total quantity", value: txt(sumQuantity(items)) },
    { name: "Gross weight", value: txt(s.weight) },
    { name: "Dimensions", value: txt(s.dimensions) },
  ]);
  y = ensure(doc, y + 20, 100);
  y = signatureLine(doc, y + 20, `Packed and checked by ${s.sender_name}`);
  verification(doc, y + 6, s, qr);

  finish(doc, { notes: documentNotes("Quantities and weights are as supplied by the shipper. Reference: " + number) });
  return done;
}

// ------------------------------------------------------ customs declaration
export async function buildCustomsDeclaration(s) {
  const number = `CD-${s.tracking_number}`;
  const { doc, done } = createPdf({ title: "Customs declaration", number, subject: "Customs declaration" });
  const qr = qrBuffer(s);
  let y = header(doc, { title: "Customs declaration", number, issued: fmtDay(new Date().toISOString()) });

  y = fieldRow(doc, y, [
    ["Shipment reference", s.tracking_number, { bold: true, mono: true }],
    ["Country of dispatch", s.origin_country, { bold: true }],
    ["Country of destination", s.destination_country, { bold: true }],
  ]);
  rule(doc, y);
  y = parties(
    doc,
    y + 14,
    { ...shipper(s), heading: "Sender" },
    { ...consignee(s), heading: "Addressee" },
  );
  rule(doc, y);

  y = sectionTitle(doc, "Category of shipment", y + 14);
  const cols4 = 3;
  const cw = CONTENT_W / cols4;
  CUSTOMS_CATEGORIES.forEach((name, i) => {
    const cx = PAGE.mx + (i % cols4) * cw;
    const cy = y + Math.floor(i / cols4) * 20;
    doc.lineWidth(0.8).strokeColor(C.navy).rect(cx, cy, 10, 10).stroke();
    if (s.customs_category === name) {
      doc.lineWidth(1.6).strokeColor(C.navy).moveTo(cx + 2, cy + 5).lineTo(cx + 4.5, cy + 8).lineTo(cx + 8.5, cy + 2).stroke();
    }
    doc.font(s.customs_category === name ? "Helvetica-Bold" : "Helvetica").fontSize(9.4).fillColor(C.ink);
    doc.text(name, cx + 17, cy + 1.2, { width: cw - 20, lineBreak: false });
  });
  y += 46;

  y = sectionTitle(doc, "Declared goods", y + 4);
  const items = itemsOf(s);
  const rows = items.map((i) => ({
    description: i.description,
    quantity: i.quantity,
    weight: i.weight,
    value: Number.isFinite(Number(i.unit_value)) ? money(Number(i.unit_value) * Number(i.quantity || 1), s.currency) : "-",
    hs: i.hs_code,
    origin: i.origin_country,
  }));
  y = table(
    doc,
    y,
    [
      { key: "description", title: "Description", width: CONTENT_W - 330 },
      { key: "quantity", title: "Qty", width: 40, align: "right" },
      { key: "weight", title: "Net weight", width: 70, align: "right" },
      { key: "value", title: "Value", width: 80, align: "right" },
      { key: "hs", title: "Tariff no.", width: 70 },
      { key: "origin", title: "Origin", width: 70 },
    ],
    rows,
    { fontSize: 8.8 },
  );
  y = totals(doc, y + 14, [
    { name: "Total weight", value: txt(s.weight) },
    { name: "Total declared value", value: money(s.declared_value, s.currency), strong: true },
  ]);

  y = paragraph(
    doc,
    "I, the undersigned sender, certify that the particulars given in this declaration are correct and that this item does not contain any dangerous article or any article prohibited by legislation or by postal or customs regulations.",
    y + 18,
    { size: 8.8 },
  );
  y = ensure(doc, y + 20, 70);
  signatureLine(doc, y + 18, `Sender: ${s.sender_name}`, { width: 230 });
  label(doc, "Date", PAGE.mx + 280, y - 2, 100);
  doc.font("Helvetica").fontSize(9.6).fillColor(C.ink).text(fmtDay(new Date().toISOString()), PAGE.mx + 280, y + 8, {
    width: 200,
    lineBreak: false,
  });
  verification(doc, y + 34, s, qr, { optional: true });

  finish(doc, {
    notes: documentNotes("Prepared by Velizon Logistics from information supplied by the sender, who is responsible for its accuracy."),
  });
  return done;
}

// ------------------------------------------------------------------ delivery
export async function buildProofOfDelivery(s) {
  const number = `POD-${s.tracking_number}`;
  const { doc, done } = createPdf({ title: "Proof of delivery", number, subject: "Proof of delivery" });
  const qr = qrBuffer(s);
  let y = header(doc, { title: "Proof of delivery", number, issued: fmtDay(s.delivered_at) });

  y = trackingBand(doc, y, s, qr);
  y = callout(doc, y, "Delivered and confirmed", `Received by ${txt(s.signed_by)} on ${fmtInstant(s.delivered_at)}.`, {
    tone: "green",
  });

  y = fieldRow(doc, y + 4, [
    ["Delivered on", fmtInstant(s.delivered_at), { bold: true }],
    ["Received by", s.signed_by, { bold: true }],
    ["Confirmation method", s.pod_method === "photo" ? "Photograph taken at delivery" : "Recipient signature", { bold: true }],
  ]);
  y = fieldRow(doc, y, [
    ["Delivery address", `${txt(s.receiver_address)}\n${place(s.destination_location, s.destination_country)}`],
    ["Consignee", s.receiver_name],
    ["Shipper", s.sender_name],
  ]);
  if (s.contents) y = field(doc, "Contents", s.contents, PAGE.mx, y, CONTENT_W);
  if (s.pod_note) y = field(doc, "Delivery note", s.pod_note, PAGE.mx, y, CONTENT_W);

  rule(doc, y);
  y = sectionTitle(doc, s.pod_method === "photo" ? "Delivery photograph" : "Recipient signature", y + 14);
  const boxH = 150;
  y = ensure(doc, y, boxH + 10);
  doc.lineWidth(0.6).strokeColor(C.line).rect(PAGE.mx, y, CONTENT_W, boxH).stroke();
  const data = s.pod_method === "photo" ? s.pod_photo : s.signature_data;
  if (data) {
    try {
      const buf = Buffer.from(data.replace(/^data:image\/\w+;base64,/, ""), "base64");
      doc.image(buf, PAGE.mx + 8, y + 8, { fit: [CONTENT_W - 16, boxH - 16], align: "center", valign: "center" });
    } catch {
      doc.font("Helvetica").fontSize(9).fillColor(C.muted).text("Image unavailable.", PAGE.mx + 12, y + 14, { lineBreak: false });
    }
  }
  y += boxH + 14;
  verification(doc, y, s, qr);

  finish(doc, {
    notes: documentNotes("The delivery was confirmed at the time shown above. Reference: " + number),
  });
  return done;
}

// ------------------------------------------------------------ shipping label
export async function buildLabel(s) {
  const number = s.tracking_number;
  const { doc, done } = createPdf({ title: "Shipping label", number, subject: "Shipping label", size: [288, 432] });
  const W = 288;
  const m = 14;
  const iw = W - m * 2;
  doc.lineWidth(1.4).strokeColor("#000000").rect(8, 8, W - 16, 432 - 16).stroke();

  drawMark(doc, m + 2, 14, 26, { stroke: "#000000", node: "#000000" });
  drawWordmark(doc, m + 34, 21, 11, "#000000");
  doc.font("Helvetica-Bold").fontSize(11).text(txt(s.shipment_type || "Standard").toUpperCase(), m, 21, {
    width: iw - 4,
    align: "right",
    lineBreak: false,
  });
  doc.moveTo(m, 44).lineTo(W - m, 44).lineWidth(1.4).stroke();

  doc.font("Helvetica-Bold").fontSize(7).fillColor("#000000").text("SHIP TO", m + 4, 52, { characterSpacing: 1, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15);
  let y = 63;
  const toLines = [s.receiver_name, s.receiver_address, place(s.destination_location, s.destination_country)];
  toLines.forEach((line, i) => {
    doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(i === 0 ? 15 : 11);
    const h = doc.heightOfString(txt(line), { width: iw - 8 });
    doc.text(txt(line), m + 4, y, { width: iw - 8 });
    y += h + 2;
  });
  doc.font("Helvetica").fontSize(9.5).text(`Tel: ${txt(s.receiver_phone)}`, m + 4, y + 2, { width: iw - 8, lineBreak: false });
  y += 18;

  const destY = Math.max(y + 6, 170);
  doc.moveTo(m, destY).lineTo(W - m, destY).lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(7).text("DESTINATION", m + 4, destY + 7, { characterSpacing: 1, lineBreak: false });
  doc.font("Times-Bold").fontSize(26).text(txt(s.destination_country).toUpperCase(), m + 4, destY + 18, {
    width: iw - 8,
    lineBreak: false,
    ellipsis: true,
  });

  const fy = destY + 56;
  doc.moveTo(m, fy).lineTo(W - m, fy).lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(7).text("FROM", m + 4, fy + 6, { characterSpacing: 1, lineBreak: false });
  doc.font("Helvetica").fontSize(9).text(
    [s.sender_name, place(s.origin_location, s.origin_country)].filter(Boolean).join("\n"),
    m + 4,
    fy + 17,
    { width: iw - 8 },
  );

  const sy = fy + 54;
  doc.moveTo(m, sy).lineTo(W - m, sy).lineWidth(1).stroke();
  const colW = iw / 3;
  [
    ["PIECES", s.pieces ?? "-"],
    ["WEIGHT", s.weight || "-"],
    ["EXP. DELIVERY", s.expected_delivery ? fmtDay(s.expected_delivery).replace(/^0/, "") : "-"],
  ].forEach(([name, value], i) => {
    doc.font("Helvetica-Bold").fontSize(6.5).text(name, m + 4 + i * colW, sy + 6, { characterSpacing: 0.8, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(i === 2 ? 8 : 11).text(String(value), m + 4 + i * colW, sy + 17, {
      width: colW - 6,
      lineBreak: false,
    });
  });

  const by = sy + 40;
  doc.moveTo(m, by).lineTo(W - m, by).lineWidth(1.4).stroke();
  barcode(doc, s.tracking_number, m + 14, by + 12, iw - 28, 58);
  doc.font("Courier-Bold").fontSize(13).fillColor("#000000").text(s.tracking_number, m, by + 76, {
    width: iw,
    align: "center",
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(6.8).fillColor("#333333").text(trackingUrl(s).replace(/^https?:\/\//, ""), m, by + 94, {
    width: iw,
    align: "center",
    lineBreak: false,
  });

  doc.end();
  return done;
}

export const SHIPMENT_DOCUMENTS = {
  waybill: { build: buildWaybill, file: "waybill", name: "Shipping waybill" },
  label: { build: buildLabel, file: "shipping-label", name: "Shipping label" },
  invoice: { build: buildInvoice, file: "commercial-invoice", name: "Commercial invoice" },
  packing_list: { build: buildPackingList, file: "packing-list", name: "Packing list" },
  customs: { build: buildCustomsDeclaration, file: "customs-declaration", name: "Customs declaration" },
  pod: { build: buildProofOfDelivery, file: "proof-of-delivery", name: "Proof of delivery" },
};

export { isInternational };
