import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import shipmentRoutes from "./addShipments.js";
import trackShipment from "./trackShipment.js";

// Load environment variables
dotenv.config();

const app = express();

// Configure CORS with environment variables
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://172.26.160.1:5173",
      "http://192.168.1.151:5173",
      process.env.FRONTEND_URL,
      process.env.FRONTEND_URL_WWW,
    ].filter(Boolean); // Remove undefined values

const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // Allow cookies if needed
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
