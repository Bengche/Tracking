import { Client } from "pg";

async function testConnection() {
  const db = new Client({
    user: "postgres",
    password: "Boyalinco$10",
    port: 1998,
    host: "localhost",
  });

  try {
    console.log("Testing connection to PostgreSQL...");
    await db.connect();
    console.log("✅ Connected to PostgreSQL successfully");

    // Test if Tracking_db exists
    const result = await db.query(
      "SELECT datname FROM pg_database WHERE datname = 'Tracking_db'"
    );
    console.log("Database Tracking_db exists:", result.rows.length > 0);

    if (result.rows.length > 0) {
      await db.end();

      // Now test connection to Tracking_db specifically
      const dbWithTracking = new Client({
        user: "postgres",
        password: "Boyalinco$10",
        port: 1998,
        database: "Tracking_db",
        host: "localhost",
      });

      await dbWithTracking.connect();
      console.log("✅ Connected to Tracking_db successfully");

      // Test if shipments table exists
      const tableResult = await dbWithTracking.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'shipments'"
      );
      console.log("Table shipments exists:", tableResult.rows.length > 0);

      if (tableResult.rows.length > 0) {
        // Check column structure
        const columnResult = await dbWithTracking.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'shipments' ORDER BY ordinal_position"
        );
        console.log("Table has", columnResult.rows.length, "columns");
        console.log(
          "Columns:",
          columnResult.rows.map((r) => r.column_name).join(", ")
        );
      }

      await dbWithTracking.end();
    }
  } catch (err) {
    console.log("❌ Error:", err.message);
    console.log("Error code:", err.code);
  } finally {
    if (db._ending === false) {
      await db.end();
    }
  }
}

testConnection();
