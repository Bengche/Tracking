import pg from "pg";
import { isProd } from "./config.js";

const { Pool } = pg;

// DATE columns are calendar days: return "YYYY-MM-DD" instead of a timezone-shifted Date.
pg.types.setTypeParser(1082, (value) => value);

// DATABASE_URL (Railway) wins; otherwise fall back to the discrete DB_* variables.
const useSsl = process.env.DB_SSL === "true" || (isProd && !!process.env.DATABASE_URL);

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        max: 10,
      }
    : {
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || "Tracking_db",
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        max: 10,
      },
);

pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

export default pool;
