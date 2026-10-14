/**
 * Creates or updates an admin account. Credentials come from the environment or arguments, never from source:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-passphrase' ADMIN_NAME='Your Name' node src/setupAdmin.js
 */
import bcrypt from "bcrypt";
import db from "./db.js";
import { ensureSchema } from "./schema.js";

const email = (process.env.SETUP_ADMIN_EMAIL || process.argv[2] || "").trim().toLowerCase();
const password = process.env.SETUP_ADMIN_PASSWORD || process.argv[3] || "";
const name = process.env.SETUP_ADMIN_NAME || process.argv[4] || "Administrator";

async function main() {
  if (!email || password.length < 12) {
    console.error(
      "Usage: SETUP_ADMIN_EMAIL=<email> SETUP_ADMIN_PASSWORD=<12+ characters> [SETUP_ADMIN_NAME=<name>] node src/setupAdmin.js",
    );
    process.exitCode = 1;
    return;
  }

  await ensureSchema();
  const hash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO admins (email, name, password, is_admin, is_owner)
     VALUES ($1, $2, $3, true, true)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password, is_admin = true`,
    [email, name, hash],
  );
  console.log(`Admin account ready: ${email}`);
}

main()
  .catch((err) => {
    console.error("Setup failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
