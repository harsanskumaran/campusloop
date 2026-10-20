// src/modules/bookings/bookings.service.js
import { pool, withTransaction } from "../../config/db.js";
import { assertCanAct, recordUsage, restoreUsage } from "../quota/quota.service.js";
import { holdCash, releaseCash } from "../wallet/wallet.service.js";
import { calculatePrice } from "../items/items.service.js";
import { hasConsent } from "../consent/consent.service.js";

export class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const MONTHLY_BOOKING_LIMIT = 4; // per student, across all items
const HIGH_VALUE_MONTHLY_LIMIT = 2; // per item, can be extended by +1 via approved request

function daysBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// How many bookings has this borrower made this calendar month (confirmed or beyond)?
async function getMonthlyBookingCount(borrowerId, client) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM booking
     WHERE borrower_id = $1
       AND status NOT IN ('REQUESTED','REJECTED','EXPIRED','CANCELLED','NO_SHOW')
       AND date_trunc('month', created_at) = date_trunc('month', now())`,
    [borrowerId]
  );
  return result.rows[0].count;
}

// How many times has this specific item been rented this calendar month
// (based on the booking's start_date), and is there an approved extension?
async function getItemMonthlyRentals(itemId, forMonth, client) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM booking
     WHERE item_id = $1
       AND status NOT IN ('REQUESTED','REJECTED','EXPIRED','CANCELLED','NO_SHOW')
       AND to_char(start_date, 'YYYY-MM') = $2`,
    [itemId, forMonth]
  );
  const extResult = await client.query(
    `SELECT id FROM extension_request WHERE item_id = $1 AND month_year = $2 AND status = 'APPROVED'`,
    [itemId, forMonth]
  );
  return { count: result.rows[0].count, extended: extResult.rows.length > 0 };
}

// Check the requested date range doesn't overlap an existing active booking
// or the item's cooling-off window.
async function assertDatesAvailable(itemId, startDate, endDate, item, client) {
  const overlap = await client.query(
    `SELECT id FROM booking
     WHERE item_id = $1
       AND status NOT IN ('REQUESTED','REJECTED','EXPIRED','CANCELLED','NO_SHOW')
       AND start_date < $3 AND end_date > $2`,
    [itemId, startDate, endDate]
  );
  if (overlap.rows.length > 0) {
    throw new BookingError("Selected dates overlap an existing booking for this item");
  }
  if (item.cooling_until && new Date(item.cooling_until) > new Date(startDate)) {
    throw new BookingError(
      `Item is in its cooling/inspection period until ${new Date(item.cooling_until).toDateString()}`
    );
  }
}

// STEP 1: Borrower requests a booking. No money or quota touched yet.
export async function requestBooking(borrowerId, itemId, startDate, endDate, consentAccepted = false) {
  if (consentAccepted !== true) {
    throw new BookingError(
      "You must accept the item's listed condition and known defects before requesting a booking"
    );
  }

  if (new Date(startDate) >= new Date(endDate)) {
    throw new BookingError("End date must be after start date");
  }

  // Compare calendar dates only (not exact time), so booking for "today" is
  // always allowed regardless of what time it currently is.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requestedStart = new Date(startDate);
  requestedStart.setHours(0, 0, 0, 0);
  if (requestedStart < today) {
    throw new BookingError("Start date cannot be before today");
  }

  return withTransaction(async (client) => {
    const itemResult = await client.query("SELECT * FROM item WHERE id = $1 FOR UPDATE", [itemId]);
    const item = itemResult.rows[0];
    if (!item) throw new BookingError("Item not found", 404);
    if (item.status !== "LISTED") throw new BookingError("Item is not currently available");
    if (item.owner_id === borrowerId) throw new BookingError("You cannot book your own item");

    const blockResult = await client.query(
      "SELECT id FROM block_list WHERE lender_id = $1 AND borrower_id = $2",
      [item.owner_id, borrowerId]
    );
    if (blockResult.rows.length > 0) {
      throw new BookingError("The lender has blocked you from booking their items", 403);
    }

    await assertDatesAvailable(itemId, startDate, endDate, item, client);

    const days = daysBetween(startDate, endDate);
    const price = calculatePrice(item, days); // throws if > ₹10,000

    // Validate the borrower's wallet NOW, so the lender only ever sees requests
    // the borrower can actually pay for. (Cash is still held at accept time,
    // and re-checked there, because the balance can change in between.)
    const walletResult = await client.query(
      "SELECT cash_balance FROM wallet WHERE user_id = $1",
      [borrowerId]
    );
    if (walletResult.rows.length === 0) {
      throw new BookingError("Wallet not found for your account", 404);
    }
    const balance = walletResult.rows[0].cash_balance;
    if (balance < price.total) {
      throw new BookingError(
        `Not enough wallet balance. This booking needs ₹${price.total} ` +
        `(₹${price.rent} rent + ₹${price.deposit} deposit) but your wallet has ₹${balance}. ` +
        `Top up at least ₹${price.total - balance} more to request it.`
      );
    }

    const bookingResult = await client.query(
      `INSERT INTO booking (type, item_id, borrower_id, lender_id, start_date, end_date, rent_coins, deposit_coins, status)
       VALUES ('RENT', $1, $2, $3, $4, $5, $6, $7, 'REQUESTED')
       RETURNING id, status, start_date, end_date, rent_coins, deposit_coins`,
      [itemId, borrowerId, item.owner_id, startDate, endDate, price.rent, price.deposit]
    );
    const booking = bookingResult.rows[0];

    // Consent is signed on the listing page, so it is recorded in the SAME
    // transaction as the request. The note snapshots exactly what the borrower
    // agreed to (defects + deposit), even if the listing is edited later.
    const consentNote =
      `Accepted listed condition. Known defects: ${item.known_defects || "none declared"}. ` +
      `Deposit: ₹${price.deposit}, rent: ₹${price.rent}.`;
    await client.query(
      `INSERT INTO consent (booking_id, stage, note) VALUES ($1, 'BOOKING', $2)`,
      [booking.id, consentNote]
    );

    return { booking, price, consentSigned: true };
  });
}

// STEP 2: Lender responds. This is where quota, monthly caps, wallet balance
// and the cash hold are all enforced together, right before confirming.
export async function respondToRequest(lenderId, bookingId, accept) {
  return withTransaction(async (client) => {
    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [bookingId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new BookingError("Booking not found", 404);
    if (booking.lender_id !== lenderId) throw new BookingError("Not your booking to respond to", 403);
    if (booking.status !== "REQUESTED") throw new BookingError(`Booking is already ${booking.status}`);

    if (!accept) {
      await client.query("UPDATE booking SET status = 'REJECTED' WHERE id = $1", [bookingId]);
      return { booking: { ...booking, status: "REJECTED" } };
    }

    const signed = await hasConsent(bookingId, "BOOKING", client);
    if (!signed) {
      throw new BookingError("Borrower must sign the booking consent before you can accept");
    }

    const item = (await client.query("SELECT * FROM item WHERE id = $1", [booking.item_id])).rows[0];
    const month = monthKey(booking.start_date);

    // 1. Semester quota (10 total, posts + bookings combined)
    const quota = await assertCanAct(booking.borrower_id, client);

    // 2. Monthly cap: max 4 bookings per student per calendar month
    const monthlyCount = await getMonthlyBookingCount(booking.borrower_id, client);
    if (monthlyCount >= MONTHLY_BOOKING_LIMIT) {
      throw new BookingError(
        `Borrower has reached the limit of ${MONTHLY_BOOKING_LIMIT} bookings this month`
      );
    }

    // 3. High-value item cap: 2 rentals/month, +1 if an approved extension exists
    if (item.tier === "HIGH_VALUE") {
      const { count, extended } = await getItemMonthlyRentals(item.id, month, client);
      const limit = HIGH_VALUE_MONTHLY_LIMIT + (extended ? 1 : 0);
      if (count >= limit) {
        throw new BookingError(
          extended
            ? "This item has reached its extended monthly rental limit"
            : "This item has reached its monthly rental limit (2). The borrower can request an extension from the lender."
        );
      }
    }

    // 4. Hold cash from borrower's wallet (throws if insufficient balance)
    const totalHold = booking.rent_coins + booking.deposit_coins;
    await holdCash(booking.borrower_id, totalHold, bookingId, client);

    // 5. Record quota usage now that the booking is actually confirmed
    await recordUsage(booking.borrower_id, quota.semesterId, "BOOKING", bookingId, client);

    await client.query(
      "UPDATE booking SET status = 'CONFIRMED' WHERE id = $1",
      [bookingId]
    );
    await client.query("UPDATE item SET status = 'BOOKED' WHERE id = $1", [item.id]);

    return { booking: { ...booking, status: "CONFIRMED" } };
  });
}

// Borrower cancels before pickup — restores quota usage and releases held cash
export async function cancelBooking(borrowerId, bookingId) {
  return withTransaction(async (client) => {
    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [bookingId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new BookingError("Booking not found", 404);
    if (booking.borrower_id !== borrowerId) throw new BookingError("Not your booking", 403);
    if (!["REQUESTED", "CONFIRMED"].includes(booking.status)) {
      throw new BookingError(`Cannot cancel a booking that is ${booking.status}`);
    }

    if (booking.status === "CONFIRMED") {
      const totalHeld = booking.rent_coins + booking.deposit_coins;
      await releaseCash(borrowerId, totalHeld, bookingId, client);

      const userResult = await client.query("SELECT semester_id FROM app_user WHERE id = $1", [borrowerId]);
      await restoreUsage(borrowerId, userResult.rows[0].semester_id, "BOOKING", bookingId, client);

      await client.query("UPDATE item SET status = 'LISTED' WHERE id = $1", [booking.item_id]);
    }

    await client.query("UPDATE booking SET status = 'CANCELLED' WHERE id = $1", [bookingId]);
    return { booking: { ...booking, status: "CANCELLED" } };
  });
}

export async function listMyBookings(userId, role) {
  const column = role === "lender" ? "lender_id" : "borrower_id";
  const result = await pool.query(
    `SELECT b.*, i.title AS item_title
     FROM booking b JOIN item i ON i.id = b.item_id
     WHERE b.${column} = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows;
}
