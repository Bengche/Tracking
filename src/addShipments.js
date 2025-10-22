import express from "express";
import db from "./db.js";
import QRCode from "qrcode";

const router = express.Router();

// Test database connection
router.get("/test-db", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW() as current_time");
    res.json({
      success: true,
      message: "Database connection working",
      time: result.rows[0].current_time,
    });
  } catch (error) {
    res.status(500).json({
      error: "Database connection failed",
      details: error.message,
    });
  }
});

router.post("/add_shipment", async (req, res) => {
  const shipment_id = Math.floor(100000 + Math.random() * 900000).toString();
  const {
    tracking_number,

    sender_name,
    sender_address,
    sender_email,
    sender_phone,
    receiver_name,
    receiver_address,
    receiver_phone,
    receiver_email,
    receiver_country,
    origin_country,
    origin_location,
    destination_country,
    destination_location,
    current_location,
    shipment_status,
    shipment_type,
    weight,
    expected_delivery,
    dimensions,
    contents,
    custom_status,
    remarks,
  } = req.body;

  // Generate QR Code with tracking URL - Use environment variable or fallback
  const frontendDomain = process.env.FRONTEND_URL || "https://velizon.com";
  const trackingUrl = `${frontendDomain}?tracking=${tracking_number}`;
  const qrCodeDataURL = await QRCode.toDataURL(trackingUrl);

  db.query(
    "INSERT INTO shipments (tracking_number,shipment_id,sender_name,sender_address,sender_email,sender_phone,receiver_name,receiver_address,receiver_phone,receiver_email,receiver_country,origin_country,origin_location,destination_country,destination_location,current_location,shipment_status,shipment_type,weight,expected_delivery,dimensions,contents,custom_status,remarks,qr_code) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)",
    [
      tracking_number,
      shipment_id,
      sender_name,
      sender_address,
      sender_email,
      sender_phone,
      receiver_name,
      receiver_address,
      receiver_phone,
      receiver_email,
      receiver_country,
      origin_country,
      origin_location,
      destination_country,
      destination_location,
      current_location,
      shipment_status,
      shipment_type,
      weight,
      expected_delivery,
      dimensions,
      contents,
      custom_status,
      remarks,
      qrCodeDataURL,
    ],
    (err, result) => {
      if (err) {
        res.status(500).json({ error: err.message });
        console.log(err.message);
        return;
      } else {
        res.status(201).json({ message: "Shipment added successfully" });
      }
    }
  );
});

// Get all shipments
router.get("/all", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM shipments ORDER BY shipment_id DESC"
    );

    res.json({
      success: true,
      shipments: result.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update shipment
router.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const {
    tracking_number,
    sender_name,
    sender_address,
    sender_email,
    sender_phone,
    receiver_name,
    receiver_address,
    receiver_phone,
    receiver_email,
    receiver_country,
    origin_country,
    origin_location,
    destination_country,
    destination_location,
    current_location,
    shipment_status,
    shipment_type,
    weight,
    expected_delivery,
    dimensions,
    contents,
    custom_status,
    remarks,
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE shipments SET 
        tracking_number=$1, sender_name=$2, sender_address=$3, sender_email=$4, sender_phone=$5,
        receiver_name=$6, receiver_address=$7, receiver_phone=$8, receiver_email=$9, receiver_country=$10,
        origin_country=$11, origin_location=$12, destination_country=$13, destination_location=$14,
        current_location=$15, shipment_status=$16, shipment_type=$17, weight=$18, expected_delivery=$19,
        dimensions=$20, contents=$21, custom_status=$22, remarks=$23
        WHERE shipment_id=$24 RETURNING *`,
      [
        tracking_number,
        sender_name,
        sender_address,
        sender_email,
        sender_phone,
        receiver_name,
        receiver_address,
        receiver_phone,
        receiver_email,
        receiver_country,
        origin_country,
        origin_location,
        destination_country,
        destination_location,
        current_location,
        shipment_status,
        shipment_type,
        weight,
        expected_delivery,
        dimensions,
        contents,
        custom_status,
        remarks,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Shipment not found" });
    }

    res.json({
      success: true,
      shipment: result.rows[0],
      message: "Shipment updated successfully",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Confirm delivery with digital signature
router.put("/confirm-delivery/:tracking_number", async (req, res) => {
  try {
    const { tracking_number } = req.params;
    const {
      recipient_name,
      signature_data,
      delivery_timestamp,
      delivery_status,
    } = req.body;

    console.log(`Attempting delivery confirmation for: ${tracking_number}`);
    console.log("Request body:", JSON.stringify(req.body, null, 2));
    console.log("recipient_name:", recipient_name);
    console.log("signature_data:", signature_data ? "Present" : "Missing");
    console.log("delivery_timestamp:", delivery_timestamp);

    // Simple validation - tracking_number comes from URL params, not body
    console.log("About to validate:");
    console.log("!recipient_name:", !recipient_name);
    console.log("!signature_data:", !signature_data);

    if (!recipient_name || !signature_data) {
      console.log("Validation failed:", {
        tracking_number: !!tracking_number,
        recipient_name: !!recipient_name,
        signature_data: !!signature_data,
      });
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log("Validation passed! Proceeding with database operations...");

    // Check if shipment exists
    const checkQuery =
      "SELECT shipment_status FROM shipments WHERE tracking_number = $1";
    const checkResult = await db.query(checkQuery, [tracking_number]);

    if (checkResult.rows.length === 0) {
      console.log("Shipment not found in database");
      return res.status(404).json({ error: "Shipment not found" });
    }

    console.log(
      "Current shipment status:",
      checkResult.rows[0].shipment_status
    );

    if (checkResult.rows[0].shipment_status === "Delivered - Confirmed") {
      console.log("Shipment already confirmed - returning 400");
      return res.status(400).json({ error: "Shipment already confirmed" });
    }

    // Update shipment with correct column name
    const updateQuery = `
      UPDATE shipments 
      SET shipment_status = $1
      WHERE tracking_number = $2 
      RETURNING tracking_number, shipment_status
    `;

    const result = await db.query(updateQuery, [
      "Delivered - Confirmed",
      tracking_number,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Failed to update shipment" });
    }

    console.log(`Successfully confirmed delivery for: ${tracking_number}`);

    res.json({
      success: true,
      message: "Delivery confirmed successfully",
      shipment: result.rows[0],
    });
  } catch (error) {
    console.error("Error confirming delivery:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

// Delete shipment
router.delete("/delete/:shipment_id", async (req, res) => {
  try {
    const { shipment_id } = req.params;

    // First check if shipment exists
    const checkQuery = "SELECT * FROM shipments WHERE shipment_id = $1";
    const checkResult = await db.query(checkQuery, [shipment_id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Shipment not found" });
    }

    // Delete the shipment
    const deleteQuery =
      "DELETE FROM shipments WHERE shipment_id = $1 RETURNING *";
    const result = await db.query(deleteQuery, [shipment_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Failed to delete shipment" });
    }

    res.json({
      success: true,
      message: "Shipment deleted successfully",
      deleted_shipment: result.rows[0],
    });
  } catch (error) {
    console.error("Error deleting shipment:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
