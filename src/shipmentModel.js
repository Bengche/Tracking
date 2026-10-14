import { CONFIRMED_STATUS } from "./validation.js";

const norm = (v) => (v || "").trim().toLowerCase();

export function isInternational(row) {
  return !!row.origin_country && !!row.destination_country && norm(row.origin_country) !== norm(row.destination_country);
}

export function isDeliveredStatus(status) {
  return norm(status).startsWith("delivered");
}

/** Which PDF documents can be produced for this shipment right now. */
export function documentsFor(row) {
  const docs = ["waybill", "label"];
  const hasContents = (Array.isArray(row.items) && row.items.length > 0) || !!(row.contents && row.contents.trim());
  if (isInternational(row) && Number(row.declared_value) > 0) docs.push("invoice");
  if (hasContents) docs.push("packing_list");
  if (isInternational(row) && hasContents) docs.push("customs");
  if (row.signed_by && (row.signature_data || row.pod_photo)) docs.push("pod");
  return docs;
}

/** Shipment as seen by staff: everything except bulky binary-ish columns. */
export function adminShipment(row) {
  // eslint-disable-next-line no-unused-vars
  const { qr_code, signature_data, pod_photo, ...rest } = row;
  return { ...rest, items: row.items || [], has_pod_photo: !!pod_photo, documents: documentsFor(row) };
}

/** "Jane Smith" -> "Jane S."; single names are shortened to an initial. */
export function maskName(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return `${parts[0][0]}.`;
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function publicEvent(e) {
  return {
    id: e.id,
    status: e.status,
    location: e.location,
    description: e.description,
    occurred_at: e.occurred_at,
  };
}

/** Shipment as seen by anyone holding the tracking number: no contact details or full addresses. */
export function publicShipment(row, events = []) {
  const confirmed = row.shipment_status === CONFIRMED_STATUS || !!row.signed_by;
  return {
    tracking_number: row.tracking_number,
    shipment_status: row.shipment_status,
    custom_status: row.custom_status,
    shipment_type: row.shipment_type,
    current_location: row.current_location,
    origin_country: row.origin_country,
    origin_location: row.origin_location,
    destination_country: row.destination_country,
    destination_location: row.destination_location,
    expected_delivery: row.expected_delivery,
    created_at: row.created_at,
    last_update: row.last_update,
    delivered_at: row.delivered_at,
    weight: row.weight,
    dimensions: row.dimensions,
    pieces: row.pieces,
    remarks: row.remarks,
    sender_name: maskName(row.sender_name),
    receiver_name: maskName(row.receiver_name),
    is_confirmed: confirmed,
    confirmed_by: row.signed_by ? maskName(row.signed_by) : null,
    events: events.map(publicEvent),
  };
}
