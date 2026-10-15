import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import db from "./db.js";
import { ensureSchema } from "./schema.js";
import shipmentRoutes from "./shipments.js";
import billingRoutes from "./billing.js";
import settingsRoutes from "./settings.js";
import trackShipment from "./trackShipment.js";
import adminAuthRoutes from "./adminAuth.js";
import contactRoute from "./contact.js";

const app = express();

// Railway and most hosts terminate TLS in front of the app.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: config.allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
    maxAge: 86400,
  }),
);
// Signature images arrive as base64 data URLs, so allow a little more than the default.
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({ name: "Velizon API", status: "healthy", version: 2 });
});

app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
});

app.use("/shipment", shipmentRoutes);
app.use("/shipment", billingRoutes);
app.use("/settings", settingsRoutes);
app.use("/track", trackShipment);
app.use("/auth", adminAuthRoutes);
app.use("/contact", contactRoute);

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request body is not valid JSON." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "The request is too large." });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    console.error("[db] schema check failed:", err.message);
    process.exit(1);
  }
  const server = app.listen(config.port, () => {
    console.log(`Velizon API listening on port ${config.port}`);
  });

  const shutdown = () => {
    server.close(() => db.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));

start();
