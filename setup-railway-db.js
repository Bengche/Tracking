import { Client } from "pg";

// Railway database configuration
const railwayClient = new Client({
  user: "postgres",
  password: "NtELPNgGYKDcwlUwBYbwEGnaJuBXogqy",
  host: "postgres-production-187f.up.railway.app",
  port: 5432,
  database: "railway",
  ssl: {
    rejectUnauthorized: false,
  },
});

const createTablesSQL = `
-- Create admins table (exact match to local)
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT,
    is_admin BOOLEAN DEFAULT false,
    is_owner BOOLEAN DEFAULT false
);

-- Create shipments table (exact match to local)
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
);

-- Insert sample data
INSERT INTO shipments (
    tracking_number, shipment_id, sender_name, sender_address, sender_email, sender_phone,
    receiver_name, receiver_address, receiver_phone, receiver_email, receiver_country,
    origin_country, origin_location, destination_country, destination_location,
    current_location, shipment_status, shipment_type, weight, expected_delivery,
    dimensions, contents, custom_status, remarks, qr_code
) VALUES 
(
    'TR123456789', '123456', 'Test Sender', '123 Test St, City', 'test@example.com', '123456789',
    'Test Receiver', '456 Test Ave, City', '987654321', 'receiver@example.com', 'USA',
    'USA', 'Test Origin', 'USA', 'Test Destination', 'In Transit Location',
    'In Transit', 'Standard', '1kg', CURRENT_DATE + INTERVAL '3 days',
    '20x20x20 cm', 'Test Package', 'Normal', 'Test shipment',
    'data:image/png;base64,test_qr_code'
) ON CONFLICT (tracking_number) DO NOTHING;
`;

async function createRailwayTables() {
  try {
    console.log("🔌 Connecting to Railway PostgreSQL database...");
    await railwayClient.connect();

    console.log("📋 Creating tables...");
    await railwayClient.query(createTablesSQL);

    console.log("✅ Tables created successfully!");

    // Verify tables
    const result = await railwayClient.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' ORDER BY table_name;
    `);

    console.log("\\n📊 Tables in Railway database:");
    result.rows.forEach((row) => console.log(`  - ${row.table_name}`));

    // Check record counts
    const shipmentCount = await railwayClient.query(
      "SELECT COUNT(*) FROM shipments"
    );
    const adminCount = await railwayClient.query("SELECT COUNT(*) FROM admins");

    console.log(`\\n📦 Shipments: ${shipmentCount.rows[0].count}`);
    console.log(`👥 Admins: ${adminCount.rows[0].count}`);
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await railwayClient.end();
    console.log("\\n🔌 Connection closed");
  }
}

createRailwayTables();
