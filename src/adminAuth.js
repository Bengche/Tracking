import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// Database connection
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// JWT Secret - should be in environment variables
const JWT_SECRET =
  process.env.JWT_SECRET || "your-super-secure-jwt-secret-key-2024";
const JWT_EXPIRES_IN = "12h"; // 12 hours session

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const token =
    req.cookies?.adminToken ||
    req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};

// POST /auth/login - Admin login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // Find admin by email
    const adminQuery =
      "SELECT * FROM admins WHERE email = $1 AND is_admin = true";
    const adminResult = await pool.query(adminQuery, [email.toLowerCase()]);

    if (adminResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    const admin = adminResult.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    // Generate JWT token
    const tokenPayload = {
      adminId: admin.id,
      email: admin.email,
      name: admin.name,
      isAdmin: admin.is_admin,
      isOwner: admin.is_owner,
      loginTime: new Date().toISOString(),
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    // Set HTTP-only cookie for security
    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 12 * 60 * 60 * 1000, // 12 hours in milliseconds
    });

    // Note: Update last login time if column exists
    try {
      await pool.query("UPDATE admins SET last_login = NOW() WHERE id = $1", [
        admin.id,
      ]);
    } catch (error) {
      // Column might not exist, continue anyway
      console.log("Note: last_login column not updated:", error.message);
    }

    console.log(
      `✅ Admin login successful: ${admin.email} at ${new Date().toISOString()}`
    );

    res.json({
      success: true,
      message: "Login successful",
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        isAdmin: admin.is_admin,
        isOwner: admin.is_owner,
        loginTime: tokenPayload.loginTime,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
    });
  }
});

// GET /auth/debug - Debug database connection (REMOVE IN PRODUCTION)
router.get("/debug", async (req, res) => {
  try {
    // Test database connection
    const connectionTest = await pool.query("SELECT NOW()");
    console.log("✅ Database connection successful");

    // Check if admins table exists
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'admins'
    `);

    if (tableCheck.rows.length === 0) {
      return res.json({
        success: false,
        message: "❌ ISSUE FOUND: 'admins' table does not exist",
        solution: "Run the setupAdmin.js script to create the table and admin user"
      });
    }

    // Check table structure
    const structureCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'admins'
    `);

    // Check if admin user exists
    const adminCheck = await pool.query("SELECT email, is_admin FROM admins WHERE email = $1", ["support@velizon.com"]);

    res.json({
      success: true,
      database: {
        connection: "✅ Connected",
        timestamp: connectionTest.rows[0].now,
        table_exists: "✅ admins table exists",
        columns: structureCheck.rows,
        admin_user: adminCheck.rows.length > 0 ? "✅ Admin user exists" : "❌ Admin user missing",
        admin_data: adminCheck.rows[0] || null
      }
    });

  } catch (error) {
    console.error("❌ Database debug error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      hint: "Check DATABASE_URL environment variable"
    });
  }
});

// POST /auth/logout - Admin logout
router.post("/logout", authenticateToken, (req, res) => {
  try {
    // Clear the admin token cookie
    res.clearCookie("adminToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    console.log(
      `🚪 Admin logout: ${req.admin.email} at ${new Date().toISOString()}`
    );

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Error during logout",
    });
  }
});

// GET /auth/verify - Verify admin session
router.get("/verify", authenticateToken, (req, res) => {
  try {
    res.json({
      success: true,
      message: "Session valid",
      admin: {
        id: req.admin.adminId,
        email: req.admin.email,
        name: req.admin.name,
        isAdmin: req.admin.isAdmin,
        isOwner: req.admin.isOwner,
        loginTime: req.admin.loginTime,
      },
    });
  } catch (error) {
    console.error("Session verification error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying session",
    });
  }
});

// GET /auth/profile - Get admin profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const adminQuery =
      "SELECT id, email, name, is_admin, is_owner FROM admins WHERE id = $1";
    const adminResult = await pool.query(adminQuery, [req.admin.adminId]);

    if (adminResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    res.json({
      success: true,
      admin: adminResult.rows[0],
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching profile",
    });
  }
});

export default router;
export { authenticateToken };
