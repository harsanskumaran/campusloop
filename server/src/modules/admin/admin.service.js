// src/modules/admin/admin.service.js
import { pool } from "../../config/db.js";

export async function getReports() {
  const [listings, bookingsByStatus, disputesByStatus, itemsByTier, usersByStatus] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM item WHERE status = 'LISTED'"),
    pool.query("SELECT status, COUNT(*)::int AS count FROM booking GROUP BY status ORDER BY status"),
    pool.query("SELECT status, COUNT(*)::int AS count FROM dispute GROUP BY status"),
    pool.query("SELECT tier, COUNT(*)::int AS count FROM item GROUP BY tier"),
    pool.query("SELECT status, COUNT(*)::int AS count FROM app_user GROUP BY status"),
  ]);

  return {
    activeListings: listings.rows[0].count,
    bookingsByStatus: bookingsByStatus.rows,
    disputesByStatus: disputesByStatus.rows,
    itemsByTier: itemsByTier.rows,
    usersByStatus: usersByStatus.rows,
  };
}

export async function listExceededUsers() {
  const result = await pool.query(
    "SELECT id, name, email, status, created_at FROM app_user WHERE status = 'EXCEEDED' ORDER BY name"
  );
  return result.rows;
}

export async function listSuspendedUsers() {
  const result = await pool.query(
    "SELECT id, name, email, status, created_at FROM app_user WHERE status = 'SUSPENDED' ORDER BY name"
  );
  return result.rows;
}

export async function listUsers() {
  const result = await pool.query(
    `SELECT id, name, email, phone, room_no, status, created_at
     FROM app_user
     WHERE role = 'USER'
     ORDER BY name`
  );
  return result.rows;
}

export async function listAllDisputes() {
  const result = await pool.query(
    `SELECT d.*, b.item_id, b.borrower_id, b.lender_id, b.rent_coins, b.deposit_coins,
            b.status AS booking_status, i.title AS item_title,
            borrower.name AS borrower_name, borrower.phone AS borrower_phone,
            borrower.room_no AS borrower_room_no,
            lender.name AS lender_name, lender.phone AS lender_phone,
            lender.room_no AS lender_room_no,
            CASE WHEN b.status IN ('ON_HOLD', 'LOST_ESCALATION') THEN b.rent_coins + b.deposit_coins ELSE 0 END AS held_amount,
            CASE WHEN d.raised_by_id = b.lender_id THEN 'LENDER'
                 WHEN d.raised_by_id = b.borrower_id THEN 'BORROWER'
                 ELSE 'SYSTEM' END AS raised_by_role
     FROM dispute d
     JOIN booking b ON b.id = d.booking_id
     JOIN item i ON i.id = b.item_id
     JOIN app_user borrower ON borrower.id = b.borrower_id
     JOIN app_user lender ON lender.id = b.lender_id
     ORDER BY d.created_at DESC`
  );
  return result.rows;
}

export async function suspendUser(userId, reason) {
  const result = await pool.query(
    "UPDATE app_user SET status = 'SUSPENDED' WHERE id = $1 AND role = 'USER' RETURNING id, status",
    [userId]
  );
  if (result.rows.length === 0) throw new Error("User not found or cannot be blocked");
  console.log(`Admin suspended user ${userId}. Reason: ${reason}`);
  return result.rows[0];
}

export async function unsuspendUser(userId) {
  const result = await pool.query(
    `UPDATE app_user u
     SET status = CASE
       WHEN (
         SELECT COUNT(*) FROM quota_usage q
         WHERE q.user_id = u.id
           AND q.semester_id = u.semester_id
           AND q.restored = FALSE
       ) >= 10 THEN 'EXCEEDED'::user_status
       ELSE 'ACTIVE'::user_status
     END
     WHERE u.id = $1 AND u.status = 'SUSPENDED' AND u.role = 'USER'
     RETURNING u.id, u.status`,
    [userId]
  );
  if (result.rows.length === 0) throw new Error("User is not currently suspended");
  return result.rows[0];
}
