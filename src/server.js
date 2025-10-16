import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import shipmentRoutes from "./addShipments.js";
import trackShipment from "./trackShipment.js";

// Load environment variables
dotenv.config();

const app = express();

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://172.26.160.1:5173",
    "http://192.168.1.151:5173",
  ], // Allow multiple frontend origins
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 4000;

app.use("/shipment", shipmentRoutes);
app.use("/track", trackShipment);

app.listen(PORT, () => {
  console.log(`Server is running on Port ${PORT}`);
});
