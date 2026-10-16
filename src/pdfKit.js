import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { config } from "./config.js";
import { WORDMARK } from "./brandMark.js";

export const C = {
  navy: "#0B1F33",
  navy2: "#12304D",
  gold: "#A8832B",
  goldSoft: "#E9DFC4",
  ink: "#0F1B2A",
  text: "#2A3646",
  muted: "#667385",
  line: "#D5D9DF",
  tint: "#F6F3EB",
  green: "#1F7A4D",
  greenBg: "#E8F4EE",
  red: "#A42A2A",
};

export const PAGE = { w: 595.28, h: 841.89, mx: 54, top: 64, bottom: 100 };
export const CONTENT_W = PAGE.w - PAGE.mx * 2;

// ---------------------------------------------------------------- formatting
export const txt = (v) => (v === null || v === undefined || String(v).trim() === "" ? "-" : String(v));
export const place = (...parts) => parts.filter((p) => p && String(p).trim()).join(", ");

export const fmtInstant = (v) => {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
};

export const fmtDay = (v) => {
  if (!v) return "-";
  // Database timestamps arrive as Date objects; calendar dates arrive as "YYYY-MM-DD" strings.
  const iso = v instanceof Date ? v.toISOString() : String(v);
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
};

export const money = (value, currency = "USD") => {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
};

export const trackingUrl = (shipment) =>
  `${config.frontendUrl}/track?tracking=${encodeURIComponent(shipment.tracking_number)}`;

// ------------------------------------------------------------------ document
export function drawMark(doc, x, y, size, { stroke = C.navy, node = "#B08A2E" } = {}) {
  const s = size / 64;
  doc.save();
  doc
    .lineWidth(9 * s)
    .lineCap("butt")
    .lineJoin("miter")
    .miterLimit(10)
    .moveTo(x + 9 * s, y + 10 * s)
    .lineTo(x + 32 * s, y + 49 * s)
    .lineTo(x + 55 * s, y + 10 * s)
    .stroke(stroke);
  doc.circle(x + 32 * s, y + 54 * s, 5 * s).fill(node);
  doc.restore();
}

/** Draws the outlined VELIZON wordmark with its top-left corner at (x, y) and the given cap height. */
export function drawWordmark(doc, x, y, capHeight, color = C.navy) {
  const k = capHeight / WORDMARK.height;
  doc.save();
  doc.translate(x, y).scale(k).path(WORDMARK.d).fill(color);
  doc.restore();
  return WORDMARK.width * k;
}

/** Large diagonal brand watermark, drawn behind the page content. */
function watermark(doc, { scale = 0.8, opacity = 0.05 } = {}) {
  const { width, height } = doc.page;
  const target = width * scale;
  const k = target / WORDMARK.width;
  doc.save();
  doc.opacity(opacity);
  doc.rotate(-36, { origin: [width / 2, height / 2] });
  drawWordmark(doc, (width - target) / 2, height / 2 - (WORDMARK.height * k) / 2, WORDMARK.height * k);
  doc.restore();
}

function frame(doc) {
  const { width, height } = doc.page;
  doc.save();
  doc.lineWidth(1.1).strokeColor(C.navy).rect(20, 20, width - 40, height - 40).stroke();
  doc.lineWidth(0.4).strokeColor(C.gold).rect(24.5, 24.5, width - 49, height - 49).stroke();
  doc.restore();
}

/**
 * Creates a PDF whose every page carries the brand watermark. A4 pages also get a classic double frame.
 * Layout is positioned explicitly (margin 0), so callers must manage page breaks with ensure().
 */
export function createPdf({ title, number, subject, size = "A4", company = null }) {
  const doc = new PDFDocument({
    size,
    margin: 0,
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: `${title} ${number}`,
      Subject: subject || title,
      Author: config.company.name,
      Producer: config.company.name,
      Creator: config.company.name,
    },
  });
  doc.meta = { title, number, small: size !== "A4", company };

  doc.on("pageAdded", () => {
    if (doc.meta.small) {
      watermark(doc, { scale: 0.9, opacity: 0.045 });
      return;
    }
    watermark(doc);
    frame(doc);
    const index = doc.bufferedPageRange().count;
    if (index > 1) {
      doc.save();
      doc.font("Helvetica").fontSize(7.5).fillColor(C.muted);
      doc.text(`${doc.meta.title.toUpperCase()}   |   ${doc.meta.number}`, PAGE.mx, 38, {
        width: CONTENT_W,
        lineBreak: false,
      });
      doc.restore();
    }
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.addPage();
  return { doc, done };
}

/** Draws footers with page numbers on every page and closes the document. */
export function finish(doc, { notes: extraNotes = [] } = {}) {
  const legal = companyLine(doc.meta.company);
  const notes = legal ? [...extraNotes, legal] : extraNotes;
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const baseY = PAGE.h - 70 - (notes.length > 1 ? (notes.length - 1) * 9.5 : 0);
    doc.save();
    doc.moveTo(PAGE.mx, baseY).lineTo(PAGE.w - PAGE.mx, baseY).lineWidth(0.5).strokeColor(C.line).stroke();
    let y = baseY + 8;
    doc.font("Helvetica").fontSize(7.2).fillColor(C.muted);
    notes.forEach((n) => {
      doc.text(n, PAGE.mx, y, { width: CONTENT_W, lineBreak: false });
      y += 9.5;
    });
    doc.font("Helvetica-Bold").fontSize(7.2).fillColor(C.navy);
    doc.text(
      `${doc.meta.company?.display_name || config.company.name}  |  ${config.company.supportEmail}  |  ${config.company.phone}`,
      PAGE.mx,
      y + 2,
      { width: CONTENT_W - 80, lineBreak: false },
    );
    doc.font("Helvetica").fillColor(C.muted);
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE.mx, y + 2, {
      width: CONTENT_W,
      align: "right",
      lineBreak: false,
    });
    doc.restore();
  }
  doc.end();
}

// --------------------------------------------------------------- components
export function header(doc, { title, number, issued }) {
  const x = PAGE.mx;
  drawMark(doc, x, 44, 44);
  drawWordmark(doc, x + 56, 52, 14.5);
  doc.font("Helvetica-Bold").fontSize(6.4).fillColor(C.gold);
  doc.text("LOGISTICS & TRACKING", x + 56, 73, { characterSpacing: 2.4, lineBreak: false });

  doc.font("Times-Bold").fontSize(15.5).fillColor(C.navy);
  doc.text(title.toUpperCase(), x, 49, { width: CONTENT_W, align: "right", characterSpacing: 1.4, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor(C.muted);
  doc.text(`No. ${number}`, x, 72, { width: CONTENT_W, align: "right", lineBreak: false });
  if (issued) doc.text(`Date of issue: ${issued}`, x, 83, { width: CONTENT_W, align: "right", lineBreak: false });

  doc.moveTo(x, 102).lineTo(PAGE.w - x, 102).lineWidth(1.6).strokeColor(C.navy).stroke();
  doc.moveTo(x, 106).lineTo(PAGE.w - x, 106).lineWidth(0.5).strokeColor(C.gold).stroke();
  return 128;
}

/**
 * Word-wraps text to a width using the current font, honouring line breaks and splitting words that are
 * longer than the line. Used to flow long text across pages instead of letting it run off the page.
 */
export function wrapLines(doc, text, width) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (doc.widthOfString(rest) > width) {
        // Break an over-long word (for example a reference with no spaces) at the last character that fits.
        let n = rest.length;
        while (n > 1 && doc.widthOfString(rest.slice(0, n)) > width) n -= 1;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      const candidate = line ? `${line} ${rest}` : rest;
      if (doc.widthOfString(candidate) <= width) line = candidate;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function ensure(doc, y, needed) {
  if (y + needed > PAGE.h - PAGE.bottom) {
    doc.addPage();
    return PAGE.top;
  }
  return y;
}

export function label(doc, text, x, y, width) {
  doc.font("Helvetica-Bold").fontSize(6.9).fillColor(C.muted);
  doc.text(String(text).toUpperCase(), x, y, { width, characterSpacing: 0.9, lineBreak: false });
}

/** Small-caps label above a value. Returns the y position below the block. */
export function field(doc, name, value, x, y, width, { bold = false, size = 9.8, mono = false } = {}) {
  label(doc, name, x, y, width);
  const font = mono ? (bold ? "Courier-Bold" : "Courier") : bold ? "Helvetica-Bold" : "Helvetica";
  doc.font(font).fontSize(size).fillColor(C.ink);
  const str = txt(value);
  doc.text(str, x, y + 11.5, { width });
  return y + 11.5 + doc.heightOfString(str, { width }) + 9;
}

/** Row of equal-width fields. Returns the y position below the tallest. */
export function fieldRow(doc, y, cells, { gap = 14, ...opts } = {}) {
  const n = cells.length;
  const w = (CONTENT_W - gap * (n - 1)) / n;
  let bottom = y;
  cells.forEach(([name, value, o], i) => {
    bottom = Math.max(bottom, field(doc, name, value, PAGE.mx + i * (w + gap), y, w, { ...opts, ...o }));
  });
  return bottom;
}

export function sectionTitle(doc, text, y, { x = PAGE.mx, width = CONTENT_W } = {}) {
  doc.font("Times-Bold").fontSize(11.5).fillColor(C.navy);
  doc.text(text, x, y, { width, lineBreak: false });
  doc.moveTo(x, y + 16).lineTo(x + width, y + 16).lineWidth(0.5).strokeColor(C.gold).stroke();
  return y + 24;
}

export function rule(doc, y, { color = C.line, width = 0.6 } = {}) {
  doc.moveTo(PAGE.mx, y).lineTo(PAGE.w - PAGE.mx, y).lineWidth(width).strokeColor(color).stroke();
}

export function party(doc, heading, lines, x, y, width) {
  doc.font("Times-Bold").fontSize(10.5).fillColor(C.navy);
  doc.text(heading.toUpperCase(), x, y, { width, characterSpacing: 1, lineBreak: false });
  doc.moveTo(x, y + 15).lineTo(x + 32, y + 15).lineWidth(1).strokeColor(C.gold).stroke();
  let cy = y + 24;
  lines.forEach(({ text, bold }) => {
    if (!text || !String(text).trim()) return;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10.5 : 9.3).fillColor(bold ? C.ink : C.text);
    doc.text(String(text), x, cy, { width });
    cy += doc.heightOfString(String(text), { width }) + 2.5;
  });
  return cy + 8;
}

export function parties(doc, y, left, right) {
  const w = CONTENT_W / 2 - 16;
  const a = party(doc, left.heading, left.lines, PAGE.mx, y, w);
  const b = party(doc, right.heading, right.lines, PAGE.mx + CONTENT_W / 2 + 16, y, w);
  return Math.max(a, b);
}

/**
 * Table with a navy header, hairline rows and automatic page breaks.
 * cols: [{ key, title, width, align }], widths must add up to CONTENT_W.
 */
export function table(doc, y, cols, rows, { fontSize = 9.2, pad = 5.5 } = {}) {
  const drawHead = (top) => {
    doc.rect(PAGE.mx, top, CONTENT_W, 22).fill(C.navy);
    let x = PAGE.mx;
    cols.forEach((c) => {
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#FFFFFF");
      doc.text(c.title.toUpperCase(), x + 8, top + 7.5, {
        width: c.width - 16,
        align: c.align || "left",
        characterSpacing: 0.7,
        lineBreak: false,
      });
      x += c.width;
    });
    return top + 22;
  };

  y = drawHead(y);
  const bottom = PAGE.h - PAGE.bottom;
  const pageRoom = bottom - PAGE.top - 22; // room for rows on a fresh page, below the repeated header

  rows.forEach((row, idx) => {
    doc.font("Helvetica").fontSize(fontSize);
    const heights = cols.map((c) => doc.heightOfString(txt(row[c.key]), { width: c.width - 16 }));
    const h = Math.max(...heights) + pad * 2;

    const drawCells = (top, rowH, cells) => {
      if (idx % 2 === 1) doc.rect(PAGE.mx, top, CONTENT_W, rowH).fill(C.tint);
      let x = PAGE.mx;
      cols.forEach((c) => {
        doc.font(row._bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(C.ink);
        doc.text(cells[c.key], x + 8, top + pad, { width: c.width - 16, align: c.align || "left" });
        x += c.width;
      });
      doc.moveTo(PAGE.mx, top + rowH).lineTo(PAGE.w - PAGE.mx, top + rowH).lineWidth(0.4).strokeColor(C.line).stroke();
      return top + rowH;
    };

    if (h <= pageRoom) {
      if (y + h > bottom) {
        doc.addPage();
        y = drawHead(PAGE.top);
      }
      y = drawCells(y, h, Object.fromEntries(cols.map((c) => [c.key, txt(row[c.key])])));
      return;
    }

    // The row is taller than a whole page (very long description): continue it over as many pages as needed.
    const lineH = doc.currentLineHeight(true);
    const wrapped = cols.map((c) => wrapLines(doc, txt(row[c.key]), c.width - 16));
    const total = Math.max(...wrapped.map((l) => l.length));
    let from = 0;
    while (from < total) {
      let room = bottom - y - pad * 2;
      if (room < lineH * 3) {
        doc.addPage();
        y = drawHead(PAGE.top);
        room = bottom - y - pad * 2;
      }
      const count = Math.max(1, Math.floor(room / lineH));
      const cells = Object.fromEntries(cols.map((c, i) => [c.key, wrapped[i].slice(from, from + count).join("\n")]));
      y = drawCells(y, Math.min(count, total - from) * lineH + pad * 2, cells);
      from += count;
    }
  });  return y;
}

/** Label/value pairs aligned to the right, e.g. totals. */
export function totals(doc, y, lines, { width = 280 } = {}) {
  const x = PAGE.w - PAGE.mx - width;
  lines.forEach(({ name, value, strong }) => {
    y = ensure(doc, y, 28);
    if (strong) {
      doc.rect(x, y, width, 28).fill(C.navy);
      doc.font("Times-Bold").fontSize(10.5).fillColor("#FFFFFF");
      doc.text(name.toUpperCase(), x + 10, y + 9.5, { width: width - 20, characterSpacing: 0.4, lineBreak: false });
      doc.text(value, x, y + 9, { width: width - 10, align: "right", lineBreak: false });
      y += 28;
    } else {
      doc.font("Helvetica").fontSize(9.2).fillColor(C.muted);
      doc.text(name, x + 10, y + 6, { width: width - 20, lineBreak: false });
      doc.font("Helvetica-Bold").fillColor(C.ink);
      doc.text(value, x, y + 7, { width: width - 10, align: "right", lineBreak: false });
      y += 24;
      doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.4).strokeColor(C.line).stroke();
    }
  });
  return y;
}

export function paragraph(doc, text, y, { size = 9.4, color = C.text, width = CONTENT_W, x = PAGE.mx, gap = 8 } = {}) {
  doc.font("Helvetica").fontSize(size).fillColor(color);
  const h = doc.heightOfString(text, { width, lineGap: 2.2 });
  if (y + h + gap > PAGE.h - PAGE.bottom && h > 120) {
    // Does not fit in the space left and is long: flow it line by line, from here, so nothing is cut off
    // and a heading above it is never stranded on its own.
    const lineH = doc.currentLineHeight(true) + 2.2;
    for (const line of wrapLines(doc, text, width)) {
      y = ensure(doc, y, lineH);
      doc.font("Helvetica").fontSize(size).fillColor(color).text(line, x, y, { width, lineBreak: false });
      y += lineH;
    }
    return y + gap;
  }
  y = ensure(doc, y, h + gap);
  doc.text(text, x, y, { width, lineGap: 2.2 });
  return y + h + gap;
}

export function bullets(doc, items, y, { size = 9.6, x = PAGE.mx, width = CONTENT_W } = {}) {
  items.forEach((item) => {
    doc.font("Helvetica").fontSize(size);
    const h = doc.heightOfString(item, { width: width - 16, lineGap: 2 });
    y = ensure(doc, y, h + 6);
    doc.circle(x + 3, y + 5, 1.6).fill(C.gold);
    doc.fillColor(C.text).text(item, x + 14, y, { width: width - 16, lineGap: 2 });
    y += h + 6;
  });
  return y;
}

/** Bordered callout. tone: "gold" | "green". */
export function callout(doc, y, title, body, { tone = "gold" } = {}) {
  const width = CONTENT_W;
  const border = tone === "green" ? C.green : C.gold;
  const fill = tone === "green" ? C.greenBg : C.tint;
  doc.font("Helvetica").fontSize(9.6);
  const bodyH = body ? doc.heightOfString(body, { width: width - 32, lineGap: 2 }) : 0;
  const h = 18 + 15 + bodyH + 14;
  y = ensure(doc, y, h + 8);
  doc.rect(PAGE.mx, y, width, h).fill(fill);
  doc.rect(PAGE.mx, y, 3.2, h).fill(border);
  doc.font("Times-Bold").fontSize(12.5).fillColor(tone === "green" ? C.green : C.navy);
  doc.text(title, PAGE.mx + 16, y + 13, { width: width - 32, lineBreak: false });
  if (body) {
    doc.font("Helvetica").fontSize(9.6).fillColor(C.text);
    doc.text(body, PAGE.mx + 16, y + 33, { width: width - 32, lineGap: 2 });
  }
  return y + h + 12;
}

/** Rotated outline stamp such as PAID. */
export function stamp(doc, text, x, y, { color = C.green } = {}) {
  doc.save();
  doc.rotate(-9, { origin: [x, y] });
  doc.font("Times-Bold").fontSize(26);
  const w = doc.widthOfString(text, { characterSpacing: 4 }) + 28;
  doc.opacity(0.85).lineWidth(2.2).strokeColor(color).roundedRect(x, y, w, 44, 4).stroke();
  doc.lineWidth(0.6).roundedRect(x + 3.5, y + 3.5, w - 7, 37, 2).stroke();
  doc.fillColor(color).text(text, x + 14, y + 9, { characterSpacing: 4, lineBreak: false });
  doc.restore();
  return w;
}

export function signatureLine(doc, y, caption, { x = PAGE.mx, width = 220 } = {}) {
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.7).strokeColor(C.ink).stroke();
  doc.font("Helvetica").fontSize(7.8).fillColor(C.muted).text(caption, x, y + 5, { width, lineBreak: false });
  return y + 22;
}

/** Document verification block: QR code (if available) and URL. */
export function verification(doc, y, shipment, qr, { optional = false } = {}) {
  // Optional blocks are skipped rather than pushed onto a page of their own.
  if (optional && y + 66 > PAGE.h - PAGE.bottom) return y;
  y = ensure(doc, y, 66);
  rule(doc, y);
  y += 10;
  if (qr) doc.image(qr, PAGE.mx, y, { width: 48, height: 48 });
  const x = PAGE.mx + (qr ? 62 : 0);
  doc.font("Times-Bold").fontSize(10.5).fillColor(C.navy).text("Verify this shipment online", x, y + 1, {
    width: CONTENT_W - 70,
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(8.4).fillColor(C.text).text(
    "Scan the code or open the address below to see the current status and movement history.",
    x,
    y + 16,
    { width: CONTENT_W - 70 },
  );
  doc.font("Helvetica-Bold").fontSize(8.4).fillColor(C.navy).text(trackingUrl(shipment), x, y + 34, {
    width: CONTENT_W - 70,
    lineBreak: false,
  });
  return y + 56;
}

export function qrBuffer(shipment) {
  if (!shipment.qr_code) return null;
  return Buffer.from(shipment.qr_code.replace(/^data:image\/\w+;base64,/, ""), "base64");
}

/** Draws a Code 128 barcode as vector bars. Returns the barcode width actually used. */
export function barcode(doc, text, x, y, width, height) {
  const [symbol] = bwipjs.raw("code128", text, "");
  const modules = symbol.sbs.reduce((a, b) => a + b, 0);
  const unit = width / modules;
  let cx = x;
  doc.save().fillColor("#000000");
  symbol.sbs.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(cx, y, w * unit, height).fill();
    cx += w * unit;
  });
  doc.restore();
  return width;
}

/** Page-1 sub-header used by non-invoice documents: tracking number and QR. */
export function trackingBand(doc, y, shipment, qr) {
  label(doc, "Tracking number", PAGE.mx, y, 300);
  doc.font("Courier-Bold").fontSize(22).fillColor(C.navy);
  doc.text(shipment.tracking_number, PAGE.mx, y + 12, { width: 360, lineBreak: false });
  barcode(doc, shipment.tracking_number, PAGE.mx, y + 42, 230, 22);
  if (qr) doc.image(qr, PAGE.w - PAGE.mx - 70, y - 4, { width: 70, height: 70 });
  return y + 74;
}

export const documentNotes = (extra) => [
  ...(extra ? [extra] : []),
  "Generated electronically by Velizon Logistics from the shipment record.",
];

// ------------------------------------------------------------ company/signatures
/** One line of registered details; only what has actually been entered in the company settings. */
export function companyLine(company) {
  if (!company) return "";
  const parts = [];
  if (company.registered_address) parts.push(`Registered office: ${company.registered_address.replace(/\s*\n\s*/g, ", ")}`);
  if (company.registration_number) parts.push(`Reg. no. ${company.registration_number}`);
  if (company.tax_id) parts.push(`Tax ID ${company.tax_id}`);
  return parts.join("  |  ");
}

export const imageBuffer = (dataUrl) =>
  dataUrl ? Buffer.from(String(dataUrl).replace(/^data:image\/\w+;base64,/, ""), "base64") : null;

/**
 * Signature box: caption, the signature image above a rule (or an empty rule to sign by hand), then the
 * signatory's name, title and date. Returns the y position below the block.
 */
export function signatureBlock(doc, { x, y, width = 220, heading, image, name, title, date }) {
  doc.font("Helvetica-Bold").fontSize(6.9).fillColor(C.muted);
  doc.text(String(heading).toUpperCase(), x, y, { width, characterSpacing: 0.9, lineBreak: false });
  const boxTop = y + 12;
  const boxH = 32;
  if (image) {
    try {
      doc.image(image, x + 2, boxTop + 2, { fit: [width - 4, boxH - 4], align: "left", valign: "bottom" });
    } catch {
      // A corrupt image must not break the document; the signature line below stays for a handwritten signature.
    }
  }
  const lineY = boxTop + boxH;
  doc.moveTo(x, lineY).lineTo(x + width, lineY).lineWidth(0.7).strokeColor(C.ink).stroke();
  let cy = lineY + 5;
  if (name) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.ink).text(name, x, cy, { width, lineBreak: false });
    cy += 11.5;
  }
  if (title) {
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(title, x, cy, { width, lineBreak: false });
    cy += 10.5;
  }
  if (date) {
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(`Date: ${date}`, x, cy, { width, lineBreak: false });
    cy += 10.5;
  }
  return Math.max(cy, lineY + 18) + 6;
}

/** Shipper (left) and Velizon (right) signature blocks. Keeps both on the same page. */
export function signaturePair(doc, y, { s, company, shipperHeading = "Signature of shipper", shipperDate }) {
  y = ensure(doc, y, 100);
  const w = CONTENT_W / 2 - 16;
  const left = signatureBlock(doc, {
    x: PAGE.mx,
    y,
    width: w,
    heading: shipperHeading,
    image: imageBuffer(s.sender_signature),
    name: s.sender_signatory || s.sender_name,
    title: s.sender_signatory_title,
    date: s.sender_signed_at ? shipperDate(s.sender_signed_at) : null,
  });
  const right = signatureBlock(doc, {
    x: PAGE.mx + CONTENT_W / 2 + 16,
    y,
    width: w,
    heading: `For and on behalf of ${company.display_name}`,
    image: imageBuffer(company.signature),
    name: company.signatory_name,
    title: company.signatory_title,
    date: company.signature ? shipperDate(new Date().toISOString()) : null,
  });
  return Math.max(left, right);
}