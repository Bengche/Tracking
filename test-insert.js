import { Client } from "pg";
import QRCode from "qrcode";

async function testShipmentInsert() {
  const db = new Client({
    user: "postgres",
    password: "Boyalinco$10",
    port: 1998,
    database: "Tracking_db",
    host: "localhost",
  });

  try {
    await db.connect();
    console.log("✅ Connected to database");

    // Test QR code generation
    const tracking_number = "TEST123";
    const qrCodeDataURL = await QRCode.toDataURL(tracking_number);
    console.log("✅ QR Code generated");

    // Test the exact same INSERT query as your code
    const shipment_id = Math.floor(100000 + Math.random() * 900000).toString();

    const result = await db.query(
      "INSERT INTO shipments (tracking_number,shipment_id,sender_name,sender_address,sender_email,sender_phone,receiver_name,receiver_address,receiver_phone,receiver_email,receiver_country,origin_country,origin_location,destination_country,destination_location,current_location,shipment_status,shipment_type,weight,expected_delivery,dimensions,contents,custom_status,remarks,qr_code) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)",
      [
        tracking_number,
        shipment_id,
        "Test Sender",
        "Test Address",
        "test@email.com",
        "1234567890",
        "Test Receiver",
        "Test Receiver Address",
        "0987654321",
        "receiver@email.com",
        "Test Country",
        "Origin Country",
        "Origin Location",
        "Destination Country",
        "Destination Location",
        "Current Location",
        "In Transit",
        "Express",
        "5kg",
        "2025-10-15",
        "30x20x10",
        "Test Contents",
        "Cleared",
        "Test Remarks",
        qrCodeDataURL,
      ]
    );

    console.log("✅ Insert successful!");
    console.log("Inserted shipment with ID:", shipment_id);
  } catch (error) {
    console.log("❌ Error:", error.message);
    console.log("Error code:", error.code);
    console.log("Error detail:", error.detail);
  } finally {
    await db.end();
  }
}

testShipmentInsert();
