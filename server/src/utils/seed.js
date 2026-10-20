// src/utils/seed.js
// Run once: node src/utils/seed.js
import dotenv from "dotenv";
dotenv.config();
import { pool } from "../config/db.js";
import { hashPassword } from "./auth.js";

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create an active semester if none exists
    const semCheck = await client.query("SELECT id FROM semester WHERE is_active = TRUE LIMIT 1");
    let semesterId = semCheck.rows[0]?.id;

    if (!semesterId) {
      const now = new Date();
      const endsOn = new Date();
      endsOn.setMonth(endsOn.getMonth() + 6); // 6-month semester, adjust as needed

      const semResult = await client.query(
        `INSERT INTO semester (name, starts_on, ends_on, is_active)
         VALUES ($1, $2, $3, TRUE) RETURNING id`,
        ["2026 Semester", now, endsOn]
      );
      semesterId = semResult.rows[0].id;
      console.log(`Created active semester (id=${semesterId})`);
    } else {
      console.log(`Active semester already exists (id=${semesterId})`);
    }

    // 2. Create the first admin user if none exists
    const adminCheck = await client.query("SELECT id FROM app_user WHERE role = 'ADMIN' LIMIT 1");
    if (adminCheck.rows.length === 0) {
      const adminEmail = "admin@campusloop.local";
      const adminPassword = "ChangeMe123!"; // CHANGE THIS after first login
      const passwordHash = await hashPassword(adminPassword);

      const adminResult = await client.query(
        `INSERT INTO app_user (name, email, password_hash, role, status, semester_id)
         VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE', $4)
         RETURNING id`,
        ["Admin", adminEmail, passwordHash, semesterId]
      );
      const adminId = adminResult.rows[0].id;

      await client.query("INSERT INTO wallet (user_id) VALUES ($1)", [adminId]);

      console.log("Created admin user:");
      console.log(`  email:    ${adminEmail}`);
      console.log(`  password: ${adminPassword}`);
      console.log("  (change this password after first login)");
    } else {
      console.log("Admin user already exists, skipping.");
    }

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
