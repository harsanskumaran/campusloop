// src/modules/consent/consent.service.js
import { pool } from "../../config/db.js";

export class ConsentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const MIN_EVIDENCE_PHOTOS = {
  PICKUP: 4,
  DROP: 4,
};

// Sign a consent stage (BOOKING, PICKUP, or DROP) for a booking.
// Only the borrower signs consent in this flow.
export async function signConsent(bookingId, userId, stage, note) {
  const bookingResult = await pool.query("SELECT * FROM booking WHERE id = $1", [bookingId]);
  const booking = bookingResult.rows[0];
  if (!booking) throw new ConsentError("Booking not found", 404);
  if (booking.borrower_id !== userId) throw new ConsentError("Only the borrower signs consent", 403);

  const existing = await pool.query(
    "SELECT id FROM consent WHERE booking_id = $1 AND stage = $2",
    [bookingId, stage]
  );
  if (existing.rows.length > 0) {
    throw new ConsentError(`${stage} consent was already signed for this booking`);
  }

  const result = await pool.query(
    `INSERT INTO consent (booking_id, stage, note) VALUES ($1, $2, $3)
     RETURNING id, stage, signed_at`,
    [bookingId, stage, note ?? null]
  );
  return result.rows[0];
}

export async function hasConsent(bookingId, stage, client = pool) {
  const result = await client.query(
    "SELECT id FROM consent WHERE booking_id = $1 AND stage = $2",
    [bookingId, stage]
  );
  return result.rows.length > 0;
}

export async function countPhotos(bookingId, kind, client = pool) {
  const result = await client.query(
    "SELECT COUNT(*)::int AS count FROM photo WHERE booking_id = $1 AND kind = $2",
    [bookingId, kind]
  );
  return result.rows[0].count;
}

export function minPhotosRequired(stage) {
  return MIN_EVIDENCE_PHOTOS[stage] ?? 0;
}

export async function listConsentsForBooking(bookingId) {
  const result = await pool.query(
    "SELECT stage, signed_at, note FROM consent WHERE booking_id = $1 ORDER BY signed_at",
    [bookingId]
  );
  return result.rows;
}
