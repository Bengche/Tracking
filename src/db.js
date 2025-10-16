import { Client } from "pg";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const db = new Client({
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 1998,
  database: process.env.DB_NAME || "Tracking_db",
  host: process.env.DB_HOST || "localhost",
});
db.connect();

export default db;
