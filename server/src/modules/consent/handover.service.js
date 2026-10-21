// src/modules/bookings/handover.service.js
import { pool, withTransaction } from "../../config/db.js";
import { savePhoto } from "../../utils/savePhoto.js";
import { hasConsent, minPhotosRequired } from "../consent/consent.service.js";
import { creditCash, deductHeldCash, releaseCash } from "../wallet/wallet.service.js";

export class HandoverError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Borrower accepts current condition at pickup, uploads photos.
// Requires: booking is CONFIRMED, BOOKING consent already signed, at least
// the minimum number of photos attached.
export async function submitPickup(borrowerId, bookingId, files) {
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

    const minPhotos = minPhotosRequired("PICKUP");
    if (!files || files.length < minPhotos) {
      throw new HandoverError(`At least ${minPhotos} pickup photos are required`);
    }

    // Save photos
    for (const file of files) {
      const { relativePath, sha256, sizeBytes } = await savePhoto(file.buffer, `evidence/${bookingId}/pickup`);
      await client.query(
        `INSERT INTO photo (kind, path, sha256, size_bytes, uploaded_by, booking_id)
         VALUES ('PICKUP', $1, $2, $3, $4, $5)`,
        [relativePath, sha256, sizeBytes, borrowerId, bookingId]
      );
    }

    // Record the pickup consent (condition accepted)
    await client.query(
      `INSERT INTO consent (booking_id, stage, note) VALUES ($1, 'PICKUP', 'Condition accepted at pickup')`,
      [bookingId]
    );

    await client.query("UPDATE booking SET status = 'PICKED_UP' WHERE id = $1", [bookingId]);
    await client.query("UPDATE item SET status = 'WITH_BORROWER' WHERE id = $1", [booking.item_id]);

    return { bookingId, status: "PICKED_UP" };
  });
}

// Borrower uploads drop photos at the drop point.
// Requires: booking is PICKED_UP or OVERDUE, at least the minimum photos.
export async function submitDrop(borrowerId, bookingId, files) {
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

    const minPhotos = minPhotosRequired("DROP");
    if (!files || files.length < minPhotos) {
      throw new HandoverError(`At least ${minPhotos} drop photos are required`);
    }

    for (const file of files) {
      const { relativePath, sha256, sizeBytes } = await savePhoto(file.buffer, `evidence/${bookingId}/drop`);
      await client.query(
        `INSERT INTO photo (kind, path, sha256, size_bytes, uploaded_by, booking_id)
         VALUES ('DROP', $1, $2, $3, $4, $5)`,
        [relativePath, sha256, sizeBytes, borrowerId, bookingId]
      );
    }

    await client.query(
      `INSERT INTO consent (booking_id, stage, note) VALUES ($1, 'DROP', 'Item dropped off, awaiting lender review')`,
      [bookingId]
    );

    await client.query("UPDATE booking SET status = 'DROP_SUBMITTED' WHERE id = $1", [bookingId]);

    return { bookingId, status: "DROP_SUBMITTED" };
  });
}

// Lender reviews the drop evidence and decides: accept (no defects) or defect.
// This is the ONLY place money settles for a normal (non-disputed) booking.
export async function reviewDrop(lenderId, bookingId, hasDefect, note) {
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

    // Rent always goes to the lender, defect or not. It must LEAVE the borrower's
    // escrow at the same moment, otherwise the money is counted twice.
    await deductHeldCash(
      booking.borrower_id, booking.rent_coins, bookingId,
      "Rent paid to lender", client, "RENT_PAYMENT"
    );
    await creditCash(
      lenderId, booking.rent_coins, "RENT_PAYMENT", bookingId,
      "Rent released on drop review", client
    );

    let depositOutcome;
    if (hasDefect) {
      // Deposit is forfeited: remove it from the borrower's held_cash and
      // credit it to the lender instead of returning it.
      await deductHeldCash(
        booking.borrower_id, booking.deposit_coins, bookingId,
        note ?? "Deposit forfeited: defect reported", client
      );
      await creditCash(
        lenderId, booking.deposit_coins, "DAMAGE_DEDUCTION", bookingId,
        "Deposit credited to lender: defect reported", client
      );
      depositOutcome = "FORFEITED";
    } else {
      // No defects: deposit is released back to the borrower's spendable balance.
      await releaseCash(booking.borrower_id, booking.deposit_coins, bookingId, client);
      depositOutcome = "REFUNDED";
    }

    await client.query(
      "UPDATE booking SET status = 'COMPLETED', deposit_outcome = $1 WHERE id = $2",
      [depositOutcome, bookingId]
    );

    // High-value items go into a mandatory cooling/inspection period instead
    // of relisting immediately. Standard items relist right away.
    const itemResult = await client.query("SELECT tier FROM item WHERE id = $1", [booking.item_id]);
    const tier = itemResult.rows[0].tier;

    if (tier === "HIGH_VALUE") {
      const coolingDays = 3;
      await client.query(
        `UPDATE item SET status = 'COOLING', cooling_until = now() + ($1 || ' days')::interval WHERE id = $2`,
        [coolingDays, booking.item_id]
      );
    } else {
      await client.query("UPDATE item SET status = 'LISTED' WHERE id = $1", [booking.item_id]);
    }

    if (hasDefect && note) {
      await client.query(
        `INSERT INTO inspection (item_id, booking_id, passed, notes) VALUES ($1, $2, FALSE, $3)`,
        [booking.item_id, bookingId, note]
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
