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
      } else {
        res.json(result.rows[0] || { message: "Shipment not found" }); // Return a message if no shipment is found
      }
    }
  );
});

export default router;
