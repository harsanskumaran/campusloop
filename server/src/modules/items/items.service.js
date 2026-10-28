// src/modules/items/items.service.js
import { pool, withTransaction } from "../../config/db.js";
import crypto from "crypto";
import fs from "fs/promises";
import { assertCanAct, recordUsage } from "../quota/quota.service.js";
import { savePhoto, absolutePathFor } from "../../utils/savePhoto.js";

export class ItemError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const MIN_ITEM_PHOTOS = 4;
export const MAX_ITEM_PHOTOS = 8;
const HIGH_VALUE_THRESHOLD = 5000;
const MAX_BOOKING_AMOUNT = 10000; // wallet cap also applies to what a single booking can cost
const MAX_DEPOSIT = 5000; // leaves room under the booking cap for actual rent days

// Statuses that mean a booking still holds the item, so its dates are NOT free.
// COMPLETED is deliberately absent: once the item is returned and reviewed it is
// back on the shelf, even if the original rental window had not ended yet
// (e.g. a 5-day rental returned after 1 day).
// REQUESTED is also absent: several people may request the same dates; only the
// lender's accept decides who gets them.
// Used by BOTH the booking date check and the "Already booked" list on the item
// page, so what people see is exactly what blocks them.
export const BLOCKING_BOOKING_STATUSES = [
  "CONSENT_PENDING", "CONFIRMED", "PICKUP_READY", "PICKED_UP", "OVERDUE",
  "DROP_SUBMITTED", "VERIFIED", "COOLING", "UNDER_REPAIR", "ON_HOLD",
  "DISPUTED", "LOST_ESCALATION",
];

export async function createItem(ownerId, data, files = []) {
  const { title, description, category, declaredValue, rentPerDay, deposit, knownDefects } = data;

  if (rentPerDay <= 0) throw new ItemError("Per-day rate must be positive");
  if (deposit < 0) throw new ItemError("Deposit cannot be negative");
  if (deposit > MAX_DEPOSIT) {
    throw new ItemError(`Deposit cannot exceed ₹${MAX_DEPOSIT}, so there's always room left for actual rental days under the ₹${MAX_BOOKING_AMOUNT} booking cap.`);
  }
  if (deposit + rentPerDay > MAX_BOOKING_AMOUNT) {
    throw new ItemError(
      `Deposit + one day's rent (₹${deposit + rentPerDay}) already exceeds the ₹${MAX_BOOKING_AMOUNT} booking cap. Lower the deposit or daily rate.`
    );
  }

  // Photos are mandatory: at least 4, and they must be 4 different pictures.
  if (!files || files.length < MIN_ITEM_PHOTOS) {
    throw new ItemError(
      `Please upload at least ${MIN_ITEM_PHOTOS} photos of the item (you added ${files?.length ?? 0}).`
    );
  }
  const distinct = new Set(files.map((f) => crypto.createHash("sha256").update(f.buffer).digest("hex")));
  if (distinct.size < MIN_ITEM_PHOTOS) {
    throw new ItemError(`Please upload at least ${MIN_ITEM_PHOTOS} different photos (the same picture was added more than once).`);
  }

  const tier = declaredValue > HIGH_VALUE_THRESHOLD ? "HIGH_VALUE" : "STANDARD";
  const savedPaths = [];

  try {
    // The item, its photos and the quota usage are saved together: if anything
    // fails, none of it is kept (no half-created listings, no wasted quota).
    return await withTransaction(async (client) => {
      // Quota check: posting an item counts as one of the 10 semester activities
      const quota = await assertCanAct(ownerId, client);

      const result = await client.query(
        `INSERT INTO item (owner_id, title, description, category, declared_value, tier, rent_per_day, deposit, known_defects)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, title, tier, status, declared_value, rent_per_day, deposit, created_at`,
        [ownerId, title, description, category, declaredValue, tier, rentPerDay, deposit, knownDefects ?? null]
      );
      const item = result.rows[0];

      for (const file of files) {
        const { relativePath, sha256, sizeBytes } = await savePhoto(file.buffer, `items/${item.id}`);
        savedPaths.push(relativePath);
        await client.query(
          `INSERT INTO photo (kind, path, sha256, size_bytes, uploaded_by, item_id)
           VALUES ('ITEM', $1, $2, $3, $4, $5)`,
          [relativePath, sha256, sizeBytes, ownerId, item.id]
        );
      }

      const usage = await recordUsage(ownerId, quota.semesterId, "POST", item.id, client);

      return { item: { ...item, photo_count: files.length }, quota: usage };
    });
  } catch (err) {
    // Remove any files already written for the rolled-back listing
    await Promise.all(savedPaths.map((rel) => fs.unlink(absolutePathFor(rel)).catch(() => {})));
    throw err;
  }
}

// Why is this item on hold? (a booking of it is waiting on an admin dispute)
// Only the owner, the borrower involved and admins see the actual reason.
async function getHoldInfo(item, viewer) {
  const result = await pool.query(
    `SELECT b.id AS booking_id, b.borrower_id, d.reason, d.created_at AS held_since,
            CASE WHEN d.raised_by_id = b.lender_id THEN 'LENDER'
                 WHEN d.raised_by_id = b.borrower_id THEN 'BORROWER'
                 ELSE 'SYSTEM' END AS raised_by
     FROM booking b
     JOIN dispute d ON d.booking_id = b.id AND d.status = 'OPEN'
     WHERE b.item_id = $1 AND b.status IN ('ON_HOLD', 'LOST_ESCALATION')
     ORDER BY d.created_at DESC
     LIMIT 1`,
    [item.id]
  );
  const hold = result.rows[0];
  if (!hold) return null;

  const canSee = viewer && (
    viewer.role === "ADMIN" || viewer.id === item.owner_id || viewer.id === hold.borrower_id
  );
  return canSee
    ? { reason: hold.reason, held_since: hold.held_since, raised_by: hold.raised_by, booking_id: hold.booking_id }
    : { reason: null, held_since: hold.held_since, restricted: true };
}

export async function getItem(itemId, viewer = null) {
  const itemResult = await pool.query(
    `SELECT i.*, u.name AS owner_name
     FROM item i JOIN app_user u ON u.id = i.owner_id
     WHERE i.id = $1`,
    [itemId]
  );
  const item = itemResult.rows[0];
  if (!item) throw new ItemError("Item not found", 404);

  const photosResult = await pool.query(
    "SELECT id, path, created_at FROM photo WHERE item_id = $1 AND kind = 'ITEM' ORDER BY created_at",
    [itemId]
  );

  const hold = await getHoldInfo(item, viewer);

  return { ...item, photos: photosResult.rows, hold };
}

export async function listItems({ category, search, limit = 30 }) {
  const conditions = ["status = 'LISTED'"];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`lower(category) = lower($${params.length})`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }

  params.push(limit);
  const result = await pool.query(
    `SELECT id, title, category, declared_value, tier, rent_per_day, deposit, status, created_at,
            (SELECT p.id FROM photo p WHERE p.item_id = item.id AND p.kind = 'ITEM'
             ORDER BY p.created_at, p.id LIMIT 1) AS cover_photo_id,
            (SELECT count(*)::int FROM photo p WHERE p.item_id = item.id AND p.kind = 'ITEM') AS photo_count
     FROM item
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export async function listMyItems(ownerId) {
  const result = await pool.query(
    `SELECT i.id, i.title, i.status, i.tier, i.cooling_until, i.created_at,
            (SELECT p.id FROM photo p WHERE p.item_id = i.id AND p.kind = 'ITEM'
             ORDER BY p.created_at, p.id LIMIT 1) AS cover_photo_id,
            h.booking_id AS hold_booking_id, h.reason AS hold_reason,
            h.created_at AS hold_since, h.raised_by AS hold_raised_by
     FROM item i
     LEFT JOIN LATERAL (
       SELECT b.id AS booking_id, d.reason, d.created_at,
              CASE WHEN d.raised_by_id = b.lender_id THEN 'LENDER'
                   WHEN d.raised_by_id = b.borrower_id THEN 'BORROWER'
                   ELSE 'SYSTEM' END AS raised_by
       FROM booking b
       JOIN dispute d ON d.booking_id = b.id AND d.status = 'OPEN'
       WHERE b.item_id = i.id AND b.status IN ('ON_HOLD', 'LOST_ESCALATION')
       ORDER BY d.created_at DESC
       LIMIT 1
     ) h ON TRUE
     WHERE i.owner_id = $1
     ORDER BY i.created_at DESC`,
    [ownerId]
  );
  return result.rows;
}

// Returns the date ranges this item is already booked for, so the portal
// can grey them out and only allow picking free dates.
export async function getAvailability(itemId) {
  const item = await getItem(itemId);

  const result = await pool.query(
    `SELECT start_date, end_date, status
     FROM booking
     WHERE item_id = $1 AND status = ANY($2::booking_status[])
     ORDER BY start_date`,
    [itemId, BLOCKING_BOOKING_STATUSES]
  );

  return {
    itemId,
    tier: item.tier,
    coolingUntil: item.cooling_until,
    bookedRanges: result.rows,
  };
}

// Price calculation used by the booking flow (Part 5) — exposed here since
// it's tied directly to how an item is priced.
export function calculatePrice(item, days) {
  const rent = item.rent_per_day * days;
  const total = rent + item.deposit;
  if (total > MAX_BOOKING_AMOUNT) {
    throw new ItemError(
      `This booking would cost ₹${total} (₹${rent} rent + ₹${item.deposit} deposit), which exceeds the ₹${MAX_BOOKING_AMOUNT} limit. Choose fewer days.`
    );
  }
  return { rent, deposit: item.deposit, total };
}
