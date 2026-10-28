import { pool, withTransaction } from "../../config/db.js";
import { holdCash, WalletError } from "../wallet/wallet.service.js";

const EXTENDABLE_STATUSES = ["CONFIRMED", "PICKED_UP", "OVERDUE"];
const MAX_BOOKING_AMOUNT = 10000;
const BLOCKING_BOOKING_STATUSES = [
  "CONSENT_PENDING", "CONFIRMED", "PICKUP_READY", "PICKED_UP", "OVERDUE",
  "DROP_SUBMITTED", "VERIFIED", "COOLING", "UNDER_REPAIR", "ON_HOLD",
  "DISPUTED", "LOST_ESCALATION",
];

export class BookingExtensionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseDateOnly(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BookingExtensionError("Enter a valid new return date");
  }
  return date;
}

function daysBetweenDateOnly(start, end) {
  const startDate = new Date(`${new Date(start).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const endDate = parseDateOnly(end);
  return Math.ceil((endDate - startDate) / 86400000);
}

export async function requestBookingExtension(borrowerId, bookingId, requestedEndDate) {
  const requestedDate = parseDateOnly(requestedEndDate);

  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT b.*, i.rent_per_day
       FROM booking b
       JOIN item i ON i.id = b.item_id
       WHERE b.id = $1
       FOR UPDATE OF b`,
      [bookingId]
    );
    const booking = result.rows[0];
    if (!booking) throw new BookingExtensionError("Booking not found", 404);
    if (booking.borrower_id !== borrowerId) {
      throw new BookingExtensionError("Only the borrower can request an extension", 403);
    }
    if (!EXTENDABLE_STATUSES.includes(booking.status)) {
      throw new BookingExtensionError(
        `This booking cannot be extended while it is ${booking.status}`
      );
    }
    if (requestedDate <= new Date(booking.end_date)) {
      throw new BookingExtensionError("The new return date must be after the current return date");
    }
    if (requestedDate <= new Date()) {
      throw new BookingExtensionError("The new return date must be in the future");
    }

    const pending = await client.query(
      "SELECT id FROM booking_extension WHERE booking_id = $1 AND status = 'PENDING'",
      [bookingId]
    );
    if (pending.rows.length > 0) {
      throw new BookingExtensionError("An extension request is already waiting for the lender");
    }

    const extraDays = daysBetweenDateOnly(booking.end_date, requestedEndDate);
    const additionalRent = booking.rent_per_day * extraDays;
    if (!Number.isInteger(additionalRent) || additionalRent <= 0) {
      throw new BookingExtensionError("Could not calculate the additional rent");
    }
    if (booking.rent_coins + booking.deposit_coins + additionalRent > MAX_BOOKING_AMOUNT) {
      throw new BookingExtensionError(
        `The extended booking would exceed the ₹${MAX_BOOKING_AMOUNT} booking limit`
      );
    }

    const walletResult = await client.query(
      "SELECT cash_balance FROM wallet WHERE user_id = $1 FOR UPDATE",
      [borrowerId]
    );
    const wallet = walletResult.rows[0];
    if (!wallet) throw new WalletError("Wallet not found", 404);
    if (wallet.cash_balance < additionalRent) {
      throw new WalletError(
        `Not enough wallet balance for this extension. Available: ₹${wallet.cash_balance}, required: ₹${additionalRent}`
      );
    }

    const extension = await client.query(
      `INSERT INTO booking_extension
         (booking_id, borrower_id, lender_id, requested_end_date, additional_rent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, booking_id, requested_end_date, additional_rent, status, created_at`,
      [bookingId, borrowerId, booking.lender_id, requestedDate, additionalRent]
    );
    return extension.rows[0];
  });
}

export async function respondToBookingExtension(lenderId, extensionId, approve) {
  return withTransaction(async (client) => {
    const lookup = await client.query(
      `SELECT be.booking_id, b.item_id
       FROM booking_extension be
       JOIN booking b ON b.id = be.booking_id
       WHERE be.id = $1`,
      [extensionId]
    );
    if (!lookup.rows[0]) throw new BookingExtensionError("Extension request not found", 404);

    const itemResult = await client.query(
      "SELECT id FROM item WHERE id = $1 FOR UPDATE",
      [lookup.rows[0].item_id]
    );
    if (!itemResult.rows[0]) throw new BookingExtensionError("Item not found", 404);

    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [lookup.rows[0].booking_id]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new BookingExtensionError("Booking not found", 404);

    const extensionResult = await client.query(
      "SELECT * FROM booking_extension WHERE id = $1 FOR UPDATE",
      [extensionId]
    );
    const extension = extensionResult.rows[0];
    if (extension.lender_id !== lenderId) {
      throw new BookingExtensionError("This extension request is not yours", 403);
    }
    if (extension.status !== "PENDING") {
      throw new BookingExtensionError("This extension request has already been decided");
    }
    if (!EXTENDABLE_STATUSES.includes(booking.status)) {
      throw new BookingExtensionError(`This booking cannot be extended while it is ${booking.status}`);
    }

    if (!approve) {
      const rejected = await client.query(
        `UPDATE booking_extension SET status = 'REJECTED', decided_at = now()
         WHERE id = $1
         RETURNING id, booking_id, requested_end_date, additional_rent, status`,
        [extensionId]
      );
      return rejected.rows[0];
    }

    if (new Date(extension.requested_end_date) <= new Date(booking.end_date)) {
      throw new BookingExtensionError("The current return date has changed; request a new extension date");
    }

    const conflict = await client.query(
      `SELECT id FROM booking
       WHERE item_id = $1
         AND id <> $2
         AND status = ANY($3::booking_status[])
         AND start_date < $5
         AND end_date > $4
       LIMIT 1`,
      [
        booking.item_id,
        booking.id,
        BLOCKING_BOOKING_STATUSES,
        booking.end_date,
        extension.requested_end_date,
      ]
    );
    if (conflict.rows.length > 0) {
      throw new BookingExtensionError(
        "Cannot approve this extension because another active booking overlaps the extended dates"
      );
    }

    await holdCash(
      booking.borrower_id,
      extension.additional_rent,
      booking.id,
      client
    );

    const updatedBooking = await client.query(
      `UPDATE booking
       SET end_date = $1,
           rent_coins = rent_coins + $2,
           status = CASE WHEN status = 'OVERDUE' THEN 'PICKED_UP'::booking_status ELSE status END
       WHERE id = $3
       RETURNING end_date, rent_coins, status`,
      [extension.requested_end_date, extension.additional_rent, booking.id]
    );
    const approved = await client.query(
      `UPDATE booking_extension SET status = 'APPROVED', decided_at = now()
       WHERE id = $1
       RETURNING id, booking_id, requested_end_date, additional_rent, status`,
      [extensionId]
    );

    return { ...approved.rows[0], booking: updatedBooking.rows[0] };
  });
}
