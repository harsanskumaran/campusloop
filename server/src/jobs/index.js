// src/jobs/index.js
import cron from "node-cron";
import { pool } from "../config/db.js";

async function expireStaleRequests() {
  const result = await pool.query(
    `UPDATE booking SET status = 'EXPIRED'
     WHERE status = 'REQUESTED' AND created_at < now() - interval '24 hours'
     RETURNING id`
  );
  if (result.rows.length > 0) {
    console.log(`[jobs] Expired ${result.rows.length} stale booking request(s)`);
  }
}

async function markOverdue() {
  const result = await pool.query(
    `UPDATE booking SET status = 'OVERDUE'
     WHERE status = 'PICKED_UP' AND end_date < now()
     RETURNING id`
  );
  if (result.rows.length > 0) {
    console.log(`[jobs] Marked ${result.rows.length} booking(s) as OVERDUE`);
  }
}

async function lostEscalation() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const overdueResult = await client.query(
      `SELECT id, lender_id FROM booking
       WHERE status = 'OVERDUE' AND end_date < now() - interval '48 hours'
       FOR UPDATE`
    );

    if (overdueResult.rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    // Any admin can "receive" the auto-raised dispute
    const adminResult = await client.query("SELECT id FROM app_user WHERE role = 'ADMIN' LIMIT 1");
    const adminId = adminResult.rows[0]?.id;

    for (const booking of overdueResult.rows) {
      await client.query(
        "UPDATE booking SET status = 'LOST_ESCALATION', deposit_outcome = 'ON_HOLD' WHERE id = $1",
        [booking.id]
      );
      if (adminId) {
        await client.query(
          `INSERT INTO dispute (booking_id, raised_by_id, reason)
           VALUES ($1, $2, 'Item not returned 48+ hours past due date — auto-escalated')`,
          [booking.id, adminId]
        );
      }
    }

    await client.query("COMMIT");
    console.log(`[jobs] Escalated ${overdueResult.rows.length} lost item(s) to admin`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[jobs] lostEscalation failed:", err);
  } finally {
    client.release();
  }
}

async function checkSemesterEnd() {
  const result = await pool.query(
    `UPDATE semester SET is_active = FALSE
     WHERE is_active = TRUE AND ends_on < now()
     RETURNING id, name`
  );
  if (result.rows.length > 0) {
    console.log(`[jobs] Semester ended: ${result.rows.map(r => r.name).join(", ")}. Withdrawals are now open. An admin needs to create the next semester.`);
  }
}

// A failed job (e.g. DB briefly unreachable) must log and carry on, never crash the server.
function safe(name, fn) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[jobs] ${name} failed:`, err.message);
    }
  };
}

export function startJobs() {
  const jobExpire = safe("expireStaleRequests", expireStaleRequests);
  const jobOverdue = safe("markOverdue", markOverdue);
  const jobLost = safe("lostEscalation", lostEscalation);
  const jobSemester = safe("checkSemesterEnd", checkSemesterEnd);

  // Every 5 minutes
  cron.schedule("*/5 * * * *", jobExpire);
  // Every 15 minutes
  cron.schedule("*/15 * * * *", jobOverdue);
  // Every 30 minutes
  cron.schedule("*/30 * * * *", jobLost);
  // Daily at midnight
  cron.schedule("0 0 * * *", jobSemester);

  console.log("[jobs] Background jobs scheduled");

  // Run once immediately on startup too, so a restart catches up on anything missed
  jobExpire();
  jobOverdue();
  jobLost();
  jobSemester();
}
