// src/modules/bookings/handover.service.js
import { pool, withTransaction } from "../../config/db.js";
import { hasConsent } from "../consent/consent.service.js";
import { creditCash, deductHeldCash, releaseCash } from "../wallet/wallet.service.js";

export class HandoverError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Borrower confirms the item's condition at pickup with a written comment.
// Requires: booking is CONFIRMED, BOOKING consent already signed, comment present.
export async function submitPickup(borrowerId, bookingId, comment) {
  const text = (comment ?? "").trim();
  if (text.length < 3) throw new HandoverError("Please add a comment about the item's condition at pickup");

  return withTransaction(async (client) => {
    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [bookingId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new HandoverError("Booking not found", 404);
    if (booking.borrower_id !== borrowerId) throw new HandoverError("Not your booking", 403);
    if (booking.status !== "CONFIRMED") {
      throw new HandoverError(`Booking must be CONFIRMED to pick up (currently ${booking.status})`);
    }

    const signedBookingConsent = await hasConsent(bookingId, "BOOKING", client);
    if (!signedBookingConsent) {
      throw new HandoverError("Booking consent must be signed before pickup");
    }

    // The borrower's comment IS the pickup consent
    await client.query(
      `INSERT INTO consent (booking_id, stage, note) VALUES ($1, 'PICKUP', $2)`,
      [bookingId, text]
    );

    await client.query("UPDATE booking SET status = 'PICKED_UP' WHERE id = $1", [bookingId]);
    await client.query("UPDATE item SET status = 'WITH_BORROWER' WHERE id = $1", [booking.item_id]);

    return { bookingId, status: "PICKED_UP" };
  });
}

// Borrower marks the item as returned (optional note, e.g. where it was left).
// Starts the lender's 24-hour review window.
// Requires: booking is PICKED_UP or OVERDUE.
export async function submitDrop(borrowerId, bookingId, note) {
  const text = (note ?? "").trim();

  return withTransaction(async (client) => {
    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [bookingId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new HandoverError("Booking not found", 404);
    if (booking.borrower_id !== borrowerId) throw new HandoverError("Not your booking", 403);
    if (!["PICKED_UP", "OVERDUE"].includes(booking.status)) {
      throw new HandoverError(`Booking must be picked up before it can be dropped off (currently ${booking.status})`);
    }

    await client.query(
      `INSERT INTO consent (booking_id, stage, note) VALUES ($1, 'DROP', $2)`,
      [bookingId, text || "Item returned, awaiting lender review"]
    );

    await client.query(
      "UPDATE booking SET status = 'DROP_SUBMITTED', drop_submitted_at = now() WHERE id = $1",
      [bookingId]
    );

    return { bookingId, status: "DROP_SUBMITTED", reviewDeadlineHours: 24 };
  });
}

// Lender reviews the drop evidence and decides: accept (no defects) or defect.
// This is the ONLY place money settles for a normal (non-disputed) booking.
export async function reviewDrop(lenderId, bookingId, hasDefect, note) {
  const comment = (note ?? "").trim();
  if (comment.length < 3) {
    throw new HandoverError("A comment is required to accept the return or report a defect");
  }

  return withTransaction(async (client) => {
    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [bookingId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new HandoverError("Booking not found", 404);
    if (booking.lender_id !== lenderId) throw new HandoverError("Not your booking", 403);
    if (booking.status !== "DROP_SUBMITTED") {
      throw new HandoverError(`Booking must be DROP_SUBMITTED to review (currently ${booking.status})`);
    }

    const pickupResult = await client.query(
      `SELECT signed_at FROM consent
       WHERE booking_id = $1 AND stage = 'PICKUP'
       ORDER BY signed_at ASC
       LIMIT 1`,
      [bookingId]
    );
    if (!pickupResult.rows[0] || !booking.drop_submitted_at) {
      throw new HandoverError("Pickup or return timestamp is missing; cannot settle this booking");
    }

    const pickupTime = new Date(pickupResult.rows[0].signed_at).getTime();
    const returnedAt = new Date(booking.drop_submitted_at).getTime();
    if (!Number.isFinite(pickupTime) || !Number.isFinite(returnedAt) || returnedAt < pickupTime) {
      throw new HandoverError("Pickup or return timestamp is invalid; cannot settle this booking");
    }

    const itemResult = await client.query(
      "SELECT tier, rent_per_day FROM item WHERE id = $1",
      [booking.item_id]
    );
    const item = itemResult.rows[0];
    if (!item) throw new HandoverError("Item not found", 404);
    if (!Number.isInteger(item.rent_per_day) || item.rent_per_day <= 0) {
      throw new HandoverError("Item rent is invalid; cannot settle this booking");
    }

    const earlyReturn = returnedAt < new Date(booking.end_date).getTime();
    const usedDays = Math.max(1, Math.ceil((returnedAt - pickupTime) / 86400000));
    const rentCharged = earlyReturn
      ? Math.min(booking.rent_coins, item.rent_per_day * usedDays)
      : booking.rent_coins;
    const unusedRent = booking.rent_coins - rentCharged;
    const rentNote = earlyReturn
      ? `Rent paid for ${usedDays} day${usedDays === 1 ? "" : "s"}`
      : "Rent paid for booked rental period";

    // Settle only rent actually used on an early return; otherwise the full
    // agreed rent remains due. Every escrow movement is recorded separately.
    await deductHeldCash(
      booking.borrower_id, rentCharged, bookingId,
      rentNote, client, "RENT_PAYMENT"
    );
    await creditCash(
      lenderId, rentCharged, "RENT_PAYMENT", bookingId,
      "Rent released on drop review", client
    );

    if (unusedRent > 0) {
      await releaseCash(
        booking.borrower_id, unusedRent, bookingId, client,
        "Unused rent returned after early item return"
      );
    }

    let depositOutcome;
    if (hasDefect) {
      // Deposit is forfeited: remove it from the borrower's held_cash and
      // credit it to the lender instead of returning it.
      if (booking.deposit_coins > 0) {
        await deductHeldCash(
          booking.borrower_id, booking.deposit_coins, bookingId,
          `Deposit forfeited: ${comment}`, client
        );
        await creditCash(
          lenderId, booking.deposit_coins, "DAMAGE_DEDUCTION", bookingId,
          "Deposit credited to lender: defect reported", client
        );
      }
      depositOutcome = "FORFEITED";
    } else {
      // No defects: deposit is released back to the borrower's spendable balance.
      if (booking.deposit_coins > 0) {
        await releaseCash(
          booking.borrower_id, booking.deposit_coins, bookingId, client,
          "Booking deposit returned after lender review"
        );
      }
      depositOutcome = "REFUNDED";
    }

    await client.query(
      `UPDATE booking SET status = 'COMPLETED', deposit_outcome = $1,
                          review_note = $3, reviewed_at = now()
       WHERE id = $2`,
      [depositOutcome, bookingId, comment]
    );

    // High-value items go into a mandatory cooling/inspection period instead
    // of relisting immediately. Standard items relist right away.
    if (item.tier === "HIGH_VALUE") {
      const coolingDays = 3;
      await client.query(
        `UPDATE item SET status = 'COOLING', cooling_until = now() + ($1 || ' days')::interval WHERE id = $2`,
        [coolingDays, booking.item_id]
      );
    } else {
      await client.query("UPDATE item SET status = 'LISTED' WHERE id = $1", [booking.item_id]);
    }

    if (hasDefect) {
      await client.query(
        `INSERT INTO inspection (item_id, booking_id, passed, notes) VALUES ($1, $2, FALSE, $3)`,
        [booking.item_id, bookingId, comment]
      );
    }

    return { bookingId, status: "COMPLETED", depositOutcome };
  });
}

// Either party can escalate to admin. Puts the booking ON_HOLD — no money
// moves (rent and deposit stay exactly where they were) until an admin
// resolves the dispute (Part 9).
export async function raiseDispute(userId, bookingId, reason) {
  return withTransaction(async (client) => {
    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [bookingId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new HandoverError("Booking not found", 404);

    const isParty = booking.borrower_id === userId || booking.lender_id === userId;
    if (!isParty) throw new HandoverError("Not a party to this booking", 403);

    if (booking.status !== "DROP_SUBMITTED") {
      throw new HandoverError(`Cannot raise a dispute while booking is ${booking.status}`);
    }

    await client.query(
      "UPDATE booking SET status = 'ON_HOLD', deposit_outcome = 'ON_HOLD' WHERE id = $1",
      [bookingId]
    );
    const disputeResult = await client.query(
      `INSERT INTO dispute (booking_id, raised_by_id, reason) VALUES ($1, $2, $3)
       RETURNING id, status, created_at`,
      [bookingId, userId, reason]
    );

    return { dispute: disputeResult.rows[0], bookingStatus: "ON_HOLD" };
  });
}

export async function getEvidenceForBooking(bookingId, requesterId, requesterRole) {
  const bookingResult = await pool.query("SELECT * FROM booking WHERE id = $1", [bookingId]);
  const booking = bookingResult.rows[0];
  if (!booking) throw new HandoverError("Booking not found", 404);

  const allowed = requesterRole === "ADMIN" ||
    booking.borrower_id === requesterId || booking.lender_id === requesterId;
  if (!allowed) throw new HandoverError("Not authorized to view this evidence", 403);

  const photos = await pool.query(
    "SELECT id, kind, path, created_at FROM photo WHERE booking_id = $1 ORDER BY created_at",
    [bookingId]
  );
  const consents = await pool.query(
    "SELECT stage, signed_at, note FROM consent WHERE booking_id = $1 ORDER BY signed_at",
    [bookingId]
  );

  return { photos: photos.rows, consents: consents.rows };
}
