/**
 * Development helper: creates a test admin and three sample shipments.
 * Refuses to run in production.
 *
 *   node src/seedDemo.js
 */
import bcrypt from "bcrypt";
import QRCode from "qrcode";
import db from "./db.js";
import { config, isProd } from "./config.js";
import { ensureSchema } from "./schema.js";

if (isProd) {
  console.error("seedDemo refuses to run in production.");
  process.exit(1);
}

const base = {
  sender_name: "Northwind Supplies Ltd",
  sender_address: "14 Harbour Road, Southampton SO14 3AA",
  sender_email: "dispatch@example.com",
  sender_phone: "+44 20 7946 0000",
  receiver_name: "Amara Okafor",
  receiver_address: "22 Admiralty Way, Lekki Phase 1",
  receiver_phone: "+234 801 000 0000",
  receiver_email: "amara@example.com",
  origin_country: "United Kingdom",
  origin_location: "Southampton",
  destination_country: "Nigeria",
  destination_location: "Lagos",
  receiver_country: "Nigeria",
  shipment_type: "International",
  weight: "12.5 kg",
  dimensions: "60 x 40 x 35 cm",
  pieces: 2,
  contents: "Laboratory consumables",
  declared_value: "1850.00",
  currency: "USD",
};

const samples = [
  {
    tracking_number: "VLZ0000000001",
    shipment_status: "In Transit",
    current_location: "Frankfurt, Germany",
    expected_delivery: "2026-10-22",
    events: [
      ["Pending", "Southampton, United Kingdom", "Shipment registered", 96],
      ["In Transit", "Southampton, United Kingdom", "Collected from shipper", 72],
      ["In Transit", "London Heathrow, United Kingdom", "Departed origin facility", 40],
      ["In Transit", "Frankfurt, Germany", "Arrived at transit hub", 6],
    ],
  },
  {
    tracking_number: "VLZ0000000002",
    shipment_status: "Out for Delivery",
    current_location: "Lagos, Nigeria",
    expected_delivery: "2026-10-14",
    events: [
      ["Pending", "Southampton, United Kingdom", "Shipment registered", 150],
      ["In Transit", "Frankfurt, Germany", "Arrived at transit hub", 100],
      ["In Transit", "Lagos, Nigeria", "Cleared customs", 20],
      ["Out for Delivery", "Lagos, Nigeria", "With the delivery courier", 2],
    ],
  },
  {
    tracking_number: "VLZ0000000003",
    shipment_status: "Delivered",
    current_location: "Lagos, Nigeria",
    expected_delivery: "2026-10-10",
    delivered: true,
    events: [
      ["Pending", "Southampton, United Kingdom", "Shipment registered", 260],
      ["In Transit", "Frankfurt, Germany", "Arrived at transit hub", 200],
      ["Out for Delivery", "Lagos, Nigeria", "With the delivery courier", 30],
      ["Delivered", "Lagos, Nigeria", "Delivered to the receiver's address", 28],
    ],
  },
];

async function main() {
  await ensureSchema();

  const hash = await bcrypt.hash("LocalTest#2026", 12);
  await db.query(
    `INSERT INTO admins (email, name, password, is_admin, is_owner) VALUES ($1, $2, $3, true, true)
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, is_admin = true`,
    ["admin@velizon.test", "Test Administrator", hash],
  );

  for (const s of samples) {
    const exists = await db.query("SELECT id FROM shipments WHERE tracking_number = $1", [s.tracking_number]);
    if (exists.rowCount) continue;
    const qr = await QRCode.toDataURL(`${config.frontendUrl}/track?tracking=${s.tracking_number}`, { margin: 1, width: 320 });
    const row = { ...base, ...s };
    const cols = [
      "tracking_number", "shipment_id", "sender_name", "sender_address", "sender_email", "sender_phone",
      "receiver_name", "receiver_address", "receiver_phone", "receiver_email", "receiver_country",
      "origin_country", "origin_location", "destination_country", "destination_location", "current_location",
      "shipment_status", "shipment_type", "weight", "dimensions", "pieces", "contents", "declared_value",
      "currency", "expected_delivery", "qr_code",
    ];
    const shipmentId = String(100000 + Math.floor(Math.random() * 900000));
    const values = cols.map((c) => (c === "qr_code" ? qr : c === "shipment_id" ? shipmentId : row[c]));
    const { rows } = await db.query(
      `INSERT INTO shipments (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      values,
    );
    for (const [status, location, description, hoursAgo] of s.events) {
      await db.query(
        `INSERT INTO shipment_events (shipment_id, status, location, description, occurred_at)
         VALUES ($1, $2, $3, $4, NOW() - ($5 || ' hours')::interval)`,
        [rows[0].id, status, location, description, String(hoursAgo)],
      );
    }
    if (s.delivered) {
      await db.query("UPDATE shipments SET delivered_at = NOW() - INTERVAL '28 hours' WHERE id = $1", [rows[0].id]);
    }
  }
  console.log("Seeded admin@velizon.test and VLZ0000000001-3");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
