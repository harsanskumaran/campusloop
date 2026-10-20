// src/modules/disputes/dispute.service.js
import { pool, withTransaction } from "../../config/db.js";
import { creditCash, deductHeldCash, releaseCash } from "../wallet/wallet.service.js";

export class DisputeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function listOpenDisputes() {
  const result = await pool.query(
    `SELECT d.*, b.item_id, b.borrower_id, b.lender_id, b.rent_coins, b.deposit_coins,
            b.deposit_outcome, i.title AS item_title
     FROM dispute d
     JOIN booking b ON b.id = d.booking_id
     JOIN item i ON i.id = b.item_id
     WHERE d.status = 'OPEN'
     ORDER BY d.created_at`
  );
  return result.rows;
}

// Admin resolves a dispute. resolution is 'NO_REFUND' or 'OFFLINE_SETTLED'.
export async function resolveDispute(adminId, disputeId, resolution, note) {
  return withTransaction(async (client) => {
    const disputeResult = await client.query(
      "SELECT * FROM dispute WHERE id = $1 FOR UPDATE",
      [disputeId]
    );
    const dispute = disputeResult.rows[0];
    if (!dispute) throw new DisputeError("Dispute not found", 404);
    if (dispute.status !== "OPEN") throw new DisputeError("Dispute already resolved");

    const bookingResult = await client.query(
      "SELECT * FROM booking WHERE id = $1 FOR UPDATE",
      [dispute.booking_id]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new DisputeError("Booking not found", 404);

    const alreadySettled = booking.deposit_outcome === "REFUNDED" || booking.deposit_outcome === "FORFEITED";

    if (!alreadySettled) {
      // Nothing moved yet (dispute raised before lender review). Settle now.
      await creditCash(
        booking.lender_id, booking.rent_coins, "RENT_PAYMENT", booking.id,
        "Rent released on dispute resolution", client
      );

      if (resolution === "NO_REFUND") {
        await deductHeldCash(
          booking.borrower_id, booking.deposit_coins, booking.id,
          note ?? "Deposit forfeited: admin ruling", client
        );
        await creditCash(
          booking.lender_id, booking.deposit_coins, "DAMAGE_DEDUCTION", booking.id,
          "Deposit credited to lender: admin ruling", client
        );
      } else {
        await releaseCash(booking.borrower_id, booking.deposit_coins, booking.id, client);
      }
    } else {
      // Already settled before the dispute — reverse only if the admin's
      // decision contradicts what already happened.
      const wasForfeited = booking.deposit_outcome === "FORFEITED";
      const shouldBeForfeited = resolution === "NO_REFUND";

      if (wasForfeited && !shouldBeForfeited) {
        // Reverse: move the deposit back from lender to borrower
        await creditCash(
          booking.borrower_id, booking.deposit_coins, "ADJUSTMENT", booking.id,
          note ?? "Deposit returned to borrower: admin overturned prior forfeiture", client
        );
      } else if (!wasForfeited && shouldBeForfeited) {
        // Reverse: claw back the deposit from borrower, give to lender
        await creditCash(
          booking.lender_id, booking.deposit_coins, "ADJUSTMENT", booking.id,
          note ?? "Deposit reassigned to lender: admin ruling", client
        );
      }
      // If the resolution matches what already happened, no money moves —
      // admin is just confirming and releasing the hold.
    }

    const finalDepositOutcome = resolution === "NO_REFUND" ? "FORFEITED" : "REFUNDED";

    await client.query(
      `UPDATE dispute SET status = 'RESOLVED', resolution = $1, resolved_by = $2,
                           resolved_at = now(), resolution_note = $3
       WHERE id = $4`,
      [resolution, adminId, note ?? null, disputeId]
    );
    await client.query(
      "UPDATE booking SET status = 'COMPLETED', deposit_outcome = $1 WHERE id = $2",
      [finalDepositOutcome, booking.id]
    );

    const itemResult = await client.query("SELECT tier FROM item WHERE id = $1", [booking.item_id]);
    if (itemResult.rows[0].tier === "HIGH_VALUE") {
      await client.query(
        `UPDATE item SET status = 'COOLING', cooling_until = now() + interval '3 days' WHERE id = $1`,
        [booking.item_id]
      );
    } else {
      await client.query("UPDATE item SET status = 'LISTED' WHERE id = $1", [booking.item_id]);
    }

    return { disputeId, resolution, bookingStatus: "COMPLETED", depositOutcome: finalDepositOutcome };
  });
}
