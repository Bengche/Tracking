import express from "express";
import db from "./db.js";

const router = express.Router();
router.get("/shipment_details/:trackingNumber", (req, res) => {
  const trackingNumber = req.params.trackingNumber;
  db.query(
    "SELECT * FROM shipments WHERE tracking_number = $1",
    [trackingNumber],
    (err, result) => {
      if (err) {
        console.log(err.message);
        res.status(500).json({ error: "Database error", message: err.message });
      } else if (result.rows.length === 0) {
        // No shipment found - return 404 status
        res.status(404).json({
          error: "Shipment not found",
          message: "Shipment not found",
          tracking_number: trackingNumber,
        });
      } else {
        // Shipment found - return the data
        res.status(200).json(result.rows[0]);
      }
    }
  );
});

export default router;
