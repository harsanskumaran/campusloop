// src/modules/quota/quota.service.js
import { pool } from "../../config/db.js";

const QUOTA_LIMIT = 10;
const WARNING_THRESHOLD = 8;

export class QuotaError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

// Count how many non-restored activities a user has used this semester
export async function getUsage(userId, semesterId, client = pool) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS used
     FROM quota_usage
     WHERE user_id = $1 AND semester_id = $2 AND restored = FALSE`,
    [userId, semesterId]
  );
  return result.rows[0].used;
}

// Call this BEFORE letting a user post or book.
// Throws if they're at/over the limit or already EXCEEDED.
export async function assertCanAct(userId, client = pool) {
  const userResult = await client.query(
    "SELECT status, semester_id FROM app_user WHERE id = $1",
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) throw new QuotaError("User not found", 404);
  if (!user.semester_id) throw new QuotaError("No active semester assigned to this user");

  if (user.status === "EXCEEDED") {
    throw new QuotaError("You have reached your semester limit (10 activities). Posting and booking are disabled.");
  }
  if (user.status === "SUSPENDED") {
    throw new QuotaError("Your account is suspended. Contact admin.");
  }

  const used = await getUsage(userId, user.semester_id, client);
  if (used >= QUOTA_LIMIT) {
    throw new QuotaError("You have reached your semester limit (10 activities).");
  }
  return { semesterId: user.semester_id, used };
}

// Record one counted activity (a POST or a BOOKING). Call this at the moment
// the action is finalized (item published, booking confirmed) — pass the
// same `client` as the surrounding transaction so it's atomic with that action.
export async function recordUsage(userId, semesterId, kind, refId, client) {
  await client.query(
    `INSERT INTO quota_usage (user_id, semester_id, kind, ref_id) VALUES ($1, $2, $3, $4)`,
    [userId, semesterId, kind, refId]
  );

  const used = await getUsage(userId, semesterId, client);

  if (used >= QUOTA_LIMIT) {
    await client.query("UPDATE app_user SET status = 'EXCEEDED' WHERE id = $1", [userId]);
  }

  return { used, warning: used >= WARNING_THRESHOLD && used < QUOTA_LIMIT };
}

// Restore one counted activity (e.g. booking cancelled before pickup, or
// lender rejected / request expired without ever being counted — in that
// case just don't call recordUsage at all).
export async function restoreUsage(userId, semesterId, kind, refId, client) {
  const result = await client.query(
    `UPDATE quota_usage
     SET restored = TRUE
     WHERE user_id = $1 AND semester_id = $2 AND kind = $3 AND ref_id = $4 AND restored = FALSE
     RETURNING id`,
    [userId, semesterId, kind, refId]
  );
  if (result.rows.length === 0) return; // nothing to restore, fine

  // If the user had been pushed to EXCEEDED, check whether they're back under the limit
  const userResult = await client.query("SELECT status FROM app_user WHERE id = $1", [userId]);
  if (userResult.rows[0]?.status === "EXCEEDED") {
    const used = await getUsage(userId, semesterId, client);
    if (used < QUOTA_LIMIT) {
      await client.query("UPDATE app_user SET status = 'ACTIVE' WHERE id = $1", [userId]);
    }
  }
}

// Admin: manually lift a user out of EXCEEDED status (with a reason logged)
export async function adminLift(userId, reason) {
  const result = await pool.query(
    "UPDATE app_user SET status = 'ACTIVE' WHERE id = $1 AND status = 'EXCEEDED' RETURNING id",
    [userId]
  );
  if (result.rows.length === 0) {
    throw new QuotaError("User is not currently in EXCEEDED status", 400);
  }
  // A simple audit trail — reuses coin_ledger-style logging pattern via console for now.
  // For a real audit log, add an `admin_action` table later.
  console.log(`Admin lifted user ${userId} from EXCEEDED. Reason: ${reason}`);
  return { userId, status: "ACTIVE" };
}
