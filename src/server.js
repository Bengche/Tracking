import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import shipmentRoutes from "./addShipments.js";
import trackShipment from "./trackShipment.js";
import adminAuthRoutes from "./adminAuth.js";

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
app.use(cookieParser()); // Parse cookies for JWT sessions

const PORT = process.env.PORT || 4000;

// Health check route
app.get("/", (req, res) => {
  res.json({
    message: "Tracking API is running",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Simple test route without database
app.get("/test", (req, res) => {
  res.json({
    status: "✅ Server is working",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    database_url_exists: !!process.env.DATABASE_URL,
    jwt_secret_exists: !!process.env.JWT_SECRET,
    port: process.env.PORT || 4000
  });
});

// API routes
app.use("/shipment", shipmentRoutes);
app.use("/track", trackShipment);
app.use("/auth", adminAuthRoutes); // Admin authentication routes

app.listen(PORT, () => {
  console.log(`Server is running on Port ${PORT}`);
});
