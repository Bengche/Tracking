import bcrypt from "bcrypt";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function createAdminUser() {
  try {
    console.log("🔐 Creating admin user...");

    const adminData = {
      email: "support@velizon.com",
      password: "Boyalinco$10",
      name: "Beng Brandon",
      isAdmin: true,
      isOwner: true,
    };

    // Hash the password with bcrypt (12 rounds for high security)
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(adminData.password, saltRounds);
    console.log("✅ Password hashed successfully");

    // Check if admin already exists
    const existingAdmin = await pool.query(
      "SELECT id FROM admins WHERE email = $1",
      [adminData.email.toLowerCase()]
    );

    if (existingAdmin.rows.length > 0) {
      console.log("⚠️  Admin user already exists. Updating password...");

      // Update existing admin
      await pool.query(
        `UPDATE admins 
         SET password = $1, name = $2, is_admin = $3, is_owner = $4
         WHERE email = $5`,
        [
          hashedPassword,
          adminData.name,
          adminData.isAdmin,
          adminData.isOwner,
          adminData.email.toLowerCase(),
        ]
      );

      console.log("✅ Admin user updated successfully!");
    } else {
      // Create new admin user (adapt to existing table structure)
      await pool.query(
        `INSERT INTO admins (email, password, name, is_admin, is_owner)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          adminData.email.toLowerCase(),
          hashedPassword,
          adminData.name,
          adminData.isAdmin,
          adminData.isOwner,
        ]
      );

      console.log("✅ Admin user created successfully!");
    }

    // Verify the admin was created/updated
    const verifyAdmin = await pool.query(
      "SELECT id, email, name, is_admin, is_owner FROM admins WHERE email = $1",
      [adminData.email.toLowerCase()]
    );

    if (verifyAdmin.rows.length > 0) {
      const admin = verifyAdmin.rows[0];
      console.log("📋 Admin Details:");
      console.log(`   ID: ${admin.id}`);
      console.log(`   Email: ${admin.email}`);
      console.log(`   Name: ${admin.name}`);
      console.log(`   Is Admin: ${admin.is_admin}`);
      console.log(`   Is Owner: ${admin.is_owner}`);
    }

    console.log("🎉 Admin setup completed!");
  } catch (error) {
    console.error("❌ Error creating admin user:");
    console.error("   Message:", error.message);
    console.error("   Code:", error.code);
    console.error("   Stack:", error.stack);

    if (error.code === "42P01") {
      console.log("💡 The 'admins' table doesn't exist. Creating it now...");
      await createAdminsTable();
      // Retry creating the admin user
      console.log("🔄 Retrying admin user creation...");
      return await createAdminUser();
    }
  } finally {
    await pool.end();
  }
}

async function createAdminsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        is_owner BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
      )
    `);

    console.log("✅ Admins table created successfully!");
  } catch (error) {
    console.error("❌ Error creating admins table:", error.message);
    throw error;
  }
}

// Run the script
createAdminUser();
