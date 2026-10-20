// src/modules/blocklist/blocklist.service.js
import { pool } from "../../config/db.js";

export class BlockListError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function blockBorrower(lenderId, borrowerId) {
  if (lenderId === borrowerId) throw new BlockListError("You cannot block yourself");

  const existing = await pool.query(
    "SELECT id FROM block_list WHERE lender_id = $1 AND borrower_id = $2",
    [lenderId, borrowerId]
  );
  if (existing.rows.length > 0) throw new BlockListError("This borrower is already blocked");

  await pool.query(
    "INSERT INTO block_list (lender_id, borrower_id) VALUES ($1, $2)",
    [lenderId, borrowerId]
  );
  return { lenderId, borrowerId, blocked: true };
}

export async function releaseBorrower(lenderId, borrowerId) {
  const result = await pool.query(
    "DELETE FROM block_list WHERE lender_id = $1 AND borrower_id = $2 RETURNING id",
    [lenderId, borrowerId]
  );
  if (result.rows.length === 0) throw new BlockListError("This borrower was not blocked", 404);
  return { lenderId, borrowerId, blocked: false };
}

export async function listMyBlocked(lenderId) {
  const result = await pool.query(
    `SELECT bl.id, bl.borrower_id, u.name, u.email
     FROM block_list bl JOIN app_user u ON u.id = bl.borrower_id
     WHERE bl.lender_id = $1`,
    [lenderId]
  );
  return result.rows;
}

// Admin view: every blocked pairing across the whole platform
export async function listAllBlocked() {
  const result = await pool.query(
    `SELECT bl.id, bl.lender_id, lu.name AS lender_name,
            bl.borrower_id, bu.name AS borrower_name
     FROM block_list bl
     JOIN app_user lu ON lu.id = bl.lender_id
     JOIN app_user bu ON bu.id = bl.borrower_id
     ORDER BY bl.id DESC`
  );
  return result.rows;
}
