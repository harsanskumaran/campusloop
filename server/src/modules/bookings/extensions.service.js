// src/modules/bookings/extensions.service.js
import { pool, withTransaction } from "../../config/db.js";

export class ExtensionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Borrower requests one extra rental slot for an item this month
export async function requestExtension(requestedBy, itemId, note) {
  return withTransaction(async (client) => {
    const itemResult = await client.query("SELECT owner_id FROM item WHERE id = $1", [itemId]);
    const item = itemResult.rows[0];
    if (!item) throw new ExtensionError("Item not found", 404);
    if (item.owner_id === requestedBy) throw new ExtensionError("You own this item");

    const month = currentMonthKey();

    const existing = await client.query(
      `SELECT id FROM extension_request WHERE item_id = $1 AND month_year = $2 AND status = 'PENDING'`,
      [itemId, month]
    );
    if (existing.rows.length > 0) {
      throw new ExtensionError("An extension request is already pending for this item this month");
    }

    const result = await client.query(
      `INSERT INTO extension_request (item_id, requested_by, lender_id, month_year, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, month_year, created_at`,
      [itemId, requestedBy, item.owner_id, month, note ?? null]
    );
    return result.rows[0];
  });
}

// Lender approves or rejects
export async function respondToExtension(lenderId, requestId, approve) {
  const result = await pool.query(
    `UPDATE extension_request
     SET status = $1, decided_at = now()
     WHERE id = $2 AND lender_id = $3 AND status = 'PENDING'
     RETURNING id, status, month_year`,
    [approve ? "APPROVED" : "REJECTED", requestId, lenderId]
  );
  if (result.rows.length === 0) {
    throw new ExtensionError("Request not found, not yours, or already decided", 404);
  }
  return result.rows[0];
}

export async function listExtensionsForLender(lenderId) {
  const result = await pool.query(
    `SELECT er.*, i.title AS item_title, u.name AS requested_by_name
     FROM extension_request er
     JOIN item i ON i.id = er.item_id
     JOIN app_user u ON u.id = er.requested_by
     WHERE er.lender_id = $1
     ORDER BY er.created_at DESC`,
    [lenderId]
  );
  return result.rows;
}
