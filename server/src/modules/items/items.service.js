// src/modules/items/items.service.js
import { pool, withTransaction } from "../../config/db.js";
import { assertCanAct, recordUsage } from "../quota/quota.service.js";

export class ItemError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const HIGH_VALUE_THRESHOLD = 5000;
const MAX_BOOKING_AMOUNT = 10000; // wallet cap also applies to what a single booking can cost
const MAX_DEPOSIT = 5000; // leaves room under the booking cap for actual rent days

// Statuses that mean a booking is "active" and should block its date range
const ACTIVE_BOOKING_STATUSES = [
  "CONFIRMED", "PICKUP_READY", "PICKED_UP", "OVERDUE",
  "DROP_SUBMITTED", "VERIFIED", "COOLING", "UNDER_REPAIR", "ON_HOLD",
];

export async function createItem(ownerId, data) {
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

  const tier = declaredValue > HIGH_VALUE_THRESHOLD ? "HIGH_VALUE" : "STANDARD";

  return withTransaction(async (client) => {
    // Quota check: posting an item counts as one of the 10 semester activities
    const quota = await assertCanAct(ownerId, client);

    const result = await client.query(
      `INSERT INTO item (owner_id, title, description, category, declared_value, tier, rent_per_day, deposit, known_defects)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, tier, status, declared_value, rent_per_day, deposit, created_at`,
      [ownerId, title, description, category, declaredValue, tier, rentPerDay, deposit, knownDefects ?? null]
    );
    const item = result.rows[0];

    const usage = await recordUsage(ownerId, quota.semesterId, "POST", item.id, client);

    return { item, quota: usage };
  });
}

export async function getItem(itemId) {
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

  return { ...item, photos: photosResult.rows };
}

export async function listItems({ category, search, limit = 30 }) {
  const conditions = ["status = 'LISTED'"];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }

  params.push(limit);
  const result = await pool.query(
    `SELECT id, title, category, declared_value, tier, rent_per_day, deposit, status, created_at
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
    `SELECT id, title, status, tier, cooling_until, created_at
     FROM item
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
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
    [itemId, ACTIVE_BOOKING_STATUSES]
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
