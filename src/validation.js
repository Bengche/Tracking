import { randomInt } from "node:crypto";

export const STATUSES = [
  "Pending",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Delayed",
  "On Hold",
  "Returned",
  "Cancelled",
];
export const CONFIRMED_STATUS = "Delivered - Confirmed";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUIRED = [
  "sender_name",
  "sender_address",
  "sender_email",
  "receiver_name",
  "receiver_address",
  "receiver_phone",
  "receiver_email",
  "origin_country",
  "destination_country",
  "shipment_status",
  "expected_delivery",
];

const TEXT_FIELDS = {
  tracking_number: 40,
  sender_name: 120,
  sender_address: 400,
  sender_email: 160,
  sender_phone: 40,
  receiver_name: 120,
  receiver_address: 400,
  receiver_phone: 40,
  receiver_email: 160,
  receiver_country: 80,
  origin_country: 80,
  origin_location: 120,
  destination_country: 80,
  destination_location: 120,
  current_location: 160,
  shipment_status: 40,
  shipment_type: 60,
  weight: 40,
  dimensions: 80,
  contents: 1000,
  custom_status: 160,
  remarks: 1000,
};

const clean = (v) => (typeof v === "string" ? v.trim() : v);

export const CUSTOMS_CATEGORIES = [
  "Sale of goods",
  "Gift",
  "Commercial sample",
  "Documents",
  "Returned goods",
  "Other",
];

/** Validates the itemised contents list. Returns { items } or { errors } keyed like "items.0.description". */
export function validateItems(raw) {
  const errors = {};
  if (!Array.isArray(raw)) return { errors: { items: "Items must be a list." } };
  if (raw.length > 100) return { errors: { items: "A shipment can have at most 100 items." } };
  const items = [];
  raw.forEach((row, i) => {
    const description = clean(row?.description);
    const quantityRaw = clean(row?.quantity);
    const err = (field, message) => {
      errors[`items.${i}.${field}`] = message;
    };
    if (!description) err("description", "Enter a description.");
    else if (description.length > 200) err("description", "Use 200 characters or fewer.");
    const quantity = Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) err("quantity", "Enter a whole number of at least 1.");
    const item = { description, quantity };
    const weight = clean(row?.weight);
    if (weight) {
      if (String(weight).length > 40) err("weight", "Use 40 characters or fewer.");
      else item.weight = String(weight);
    }
    const unit = clean(row?.unit_value);
    if (unit !== undefined && unit !== null && unit !== "") {
      if (!Number.isFinite(Number(unit)) || Number(unit) < 0 || Number(unit) > 1e9) err("unit_value", "Enter a valid amount.");
      else item.unit_value = Number(Number(unit).toFixed(2));
    }
    const hs = clean(row?.hs_code);
    if (hs) {
      if (!/^[0-9A-Za-z .\-]{2,20}$/.test(hs)) err("hs_code", "Use 2-20 letters, numbers, dots or hyphens.");
      else item.hs_code = String(hs);
    }
    const origin = clean(row?.origin_country);
    if (origin) {
      if (String(origin).length > 80) err("origin_country", "Use 80 characters or fewer.");
      else item.origin_country = String(origin);
    }
    items.push(item);
  });
  return Object.keys(errors).length ? { errors } : { items };
}

/**
 * Validates and normalises a shipment payload.
 * Returns { value } on success or { fields } with per-field messages.
 */
export function validateShipment(body = {}) {
  const fields = {};
  const value = {};

  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    const raw = clean(body[key]);
    if (raw === undefined || raw === null || raw === "") {
      value[key] = null;
    } else if (typeof raw !== "string") {
      fields[key] = "Must be text.";
    } else if (raw.length > max) {
      fields[key] = `Must be ${max} characters or fewer.`;
    } else {
      value[key] = raw;
    }
  }

  // The destination country doubles as the receiver country unless supplied.
  if (!value.receiver_country) value.receiver_country = value.destination_country;

  for (const key of REQUIRED) {
    if (key !== "expected_delivery" && !value[key] && !fields[key]) fields[key] = "This field is required.";
  }

  for (const key of ["sender_email", "receiver_email"]) {
    if (value[key] && !EMAIL_RE.test(value[key])) fields[key] = "Enter a valid email address.";
  }

  if (value.shipment_status && !STATUSES.includes(value.shipment_status)) {
    fields.shipment_status = "Choose one of the listed statuses.";
  }

  if (value.tracking_number) {
    value.tracking_number = value.tracking_number.toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(value.tracking_number)) {
      fields.tracking_number = "Use 4-40 letters, numbers or hyphens.";
    }
  }

  const date = clean(body.expected_delivery);
  if (!date) {
    fields.expected_delivery = "This field is required.";
  } else if (!/^\d{4}-\d{2}-\d{2}/.test(date) || Number.isNaN(Date.parse(date))) {
    fields.expected_delivery = "Enter a valid date.";
  } else {
    value.expected_delivery = date.slice(0, 10);
  }

  const pieces = clean(body.pieces);
  if (pieces === undefined || pieces === null || pieces === "") {
    value.pieces = null;
  } else if (!Number.isInteger(Number(pieces)) || Number(pieces) < 1 || Number(pieces) > 100000) {
    fields.pieces = "Enter a whole number of at least 1.";
  } else {
    value.pieces = Number(pieces);
  }

  const declared = clean(body.declared_value);
  if (declared === undefined || declared === null || declared === "") {
    value.declared_value = null;
  } else if (!Number.isFinite(Number(declared)) || Number(declared) < 0 || Number(declared) > 1e11) {
    fields.declared_value = "Enter a valid amount.";
  } else {
    value.declared_value = Number(declared).toFixed(2);
  }

  const currency = clean(body.currency);
  if (!currency) {
    value.currency = "USD";
  } else if (!/^[A-Za-z]{3}$/.test(currency)) {
    fields.currency = "Use a 3-letter currency code.";
  } else {
    value.currency = currency.toUpperCase();
  }

  const note = clean(body.event_note);
  value.event_note = typeof note === "string" && note ? note.slice(0, 500) : null;

  // items / customs_category stay undefined when absent so that an update does not wipe them.
  if (body.items !== undefined) {
    const parsed = validateItems(body.items);
    if (parsed.errors) Object.assign(fields, parsed.errors);
    else value.items = parsed.items;
  }
  const category = clean(body.customs_category);
  if (body.customs_category !== undefined) {
    if (!category) value.customs_category = null;
    else if (!CUSTOMS_CATEGORIES.includes(category)) fields.customs_category = "Choose one of the listed categories.";
    else value.customs_category = category;
  }

  return Object.keys(fields).length ? { fields } : { value };
}

export function isEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

export function generateTrackingNumber() {
  let digits = "";
  for (let i = 0; i < 10; i += 1) digits += randomInt(0, 10);
  return `VLZ${digits}`;
}

export function generateShipmentId() {
  return String(randomInt(100000, 1000000));
}
