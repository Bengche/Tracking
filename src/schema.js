import db from "./db.js";

/**
 * Idempotent schema upgrades, run at start-up. Safe on both fresh and existing databases:
 * it only adds what is missing and never drops or rewrites existing data.
 */
export async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT,
      is_admin BOOLEAN DEFAULT false,
      is_owner BOOLEAN DEFAULT false
    )`);
  await db.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shipments (
      id SERIAL PRIMARY KEY,
      tracking_number TEXT UNIQUE NOT NULL,
      shipment_id TEXT,
      sender_name TEXT NOT NULL,
      sender_address TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      sender_phone TEXT,
      receiver_name TEXT NOT NULL,
      receiver_address TEXT NOT NULL,
      receiver_phone TEXT NOT NULL,
      receiver_email TEXT NOT NULL,
      receiver_country TEXT NOT NULL,
      origin_country TEXT NOT NULL,
      origin_location TEXT,
      destination_country TEXT NOT NULL,
      destination_location TEXT,
      current_location TEXT,
      shipment_status TEXT NOT NULL,
      shipment_type TEXT,
      weight TEXT,
      expected_delivery DATE NOT NULL,
      last_update TIMESTAMP,
      created_at TIMESTAMP,
      updated_at TIMESTAMP,
      dimensions TEXT,
      contents TEXT,
      custom_status TEXT,
      remarks TEXT,
      qr_code TEXT NOT NULL
    )`);

  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pieces INTEGER`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS declared_value NUMERIC(14,2)`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD'`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS signed_by TEXT`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS signature_data TEXT`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS customs_category TEXT`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pod_photo TEXT`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pod_method TEXT`);
  await db.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pod_note TEXT`);
  await db.query(
    `UPDATE shipments SET pod_method = 'signature' WHERE pod_method IS NULL AND signature_data IS NOT NULL`,
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS shipment_fees (
      id SERIAL PRIMARY KEY,
      shipment_id INTEGER NOT NULL,
      invoice_number TEXT UNIQUE,
      receipt_number TEXT UNIQUE,
      category TEXT NOT NULL,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      currency TEXT NOT NULL DEFAULT 'USD',
      total NUMERIC(14,2) NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      due_date DATE,
      payment_instructions TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      subject TEXT,
      message TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      sent_to TEXT,
      paid_at TIMESTAMPTZ,
      received_on DATE,
      payment_method TEXT,
      payment_reference TEXT,
      receipt_sent_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS shipment_fees_shipment_idx ON shipment_fees (shipment_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS shipment_fees_status_idx ON shipment_fees (status)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shipment_notices (
      id SERIAL PRIMARY KEY,
      shipment_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      reference_number TEXT UNIQUE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      subject TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      sent_to TEXT
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS shipment_notices_shipment_idx ON shipment_notices (shipment_id)`);

  // Store instants with a time zone so they render correctly for every visitor.
  for (const column of ["created_at", "updated_at", "last_update"]) {
    const { rows } = await db.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'shipments' AND column_name = $1`,
      [column],
    );
    if (rows[0]?.data_type === "timestamp without time zone") {
      await db.query(`ALTER TABLE shipments ALTER COLUMN ${column} TYPE TIMESTAMPTZ`);
    }
  }

  await db.query(`ALTER TABLE shipments ALTER COLUMN created_at SET DEFAULT NOW()`);
  await db.query(`ALTER TABLE shipments ALTER COLUMN updated_at SET DEFAULT NOW()`);
  await db.query(`ALTER TABLE shipments ALTER COLUMN last_update SET DEFAULT NOW()`);
  await db.query(`
    UPDATE shipments
       SET created_at = COALESCE(created_at, NOW()),
           updated_at = COALESCE(updated_at, NOW()),
           last_update = COALESCE(last_update, updated_at, created_at, NOW())
     WHERE created_at IS NULL OR updated_at IS NULL OR last_update IS NULL`);

  await db.query(`CREATE INDEX IF NOT EXISTS shipments_shipment_id_idx ON shipments (shipment_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shipment_events (
      id SERIAL PRIMARY KEY,
      shipment_id INTEGER NOT NULL,
      status TEXT,
      location TEXT,
      description TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS shipment_events_lookup_idx ON shipment_events (shipment_id, occurred_at DESC)`,
  );

  // Give pre-existing shipments a first history entry so their timeline is not empty.
  await db.query(`
    INSERT INTO shipment_events (shipment_id, status, location, description, occurred_at)
    SELECT s.id, s.shipment_status, COALESCE(s.current_location, s.origin_location),
           'Latest recorded status', COALESCE(s.last_update, s.created_at, NOW())
      FROM shipments s
     WHERE NOT EXISTS (SELECT 1 FROM shipment_events e WHERE e.shipment_id = s.id)`);
}
