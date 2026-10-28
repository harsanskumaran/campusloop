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
            b.deposit_outcome, b.status AS booking_status, i.title AS item_title,
            borrower.name AS borrower_name, borrower.phone AS borrower_phone,
            lender.name AS lender_name, lender.phone AS lender_phone,
            CASE WHEN b.status IN ('ON_HOLD', 'LOST_ESCALATION') THEN b.rent_coins + b.deposit_coins ELSE 0 END AS held_amount
     FROM dispute d
     JOIN booking b ON b.id = d.booking_id
     JOIN item i ON i.id = b.item_id
     JOIN app_user borrower ON borrower.id = b.borrower_id
     JOIN app_user lender ON lender.id = b.lender_id
     WHERE d.status = 'OPEN'
     ORDER BY d.created_at`
  );
  return result.rows;
}

// The custom amount is awarded to the lender; any remaining held amount is returned.
export async function resolveDispute(adminId, disputeId, resolution, lenderAmount, note) {
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

    // ON_HOLD = disputed return / unreviewed return; LOST_ESCALATION = item never came back
    if (!["ON_HOLD", "LOST_ESCALATION"].includes(booking.status) || booking.deposit_outcome !== "ON_HOLD") {
      throw new DisputeError("Booking funds are not on hold");
    }

    const totalHeld = booking.rent_coins + booking.deposit_coins;
    if (resolution === "CUSTOM_SETTLEMENT" && lenderAmount > totalHeld) {
      throw new DisputeError(`Lender amount cannot exceed the ₹${totalHeld} held amount`);
    }

    if (resolution === "OFFLINE_SETTLED") {
      await deductHeldCash(
        booking.borrower_id, booking.rent_coins, booking.id,
        "Offline dispute settlement: rent paid to lender", client, "RENT_PAYMENT"
      );
      await creditCash(
        booking.lender_id, booking.rent_coins, "RENT_PAYMENT", booking.id,
        "Rent released by offline dispute settlement", client
      );
      await releaseCash(booking.borrower_id, booking.deposit_coins, booking.id, client);
    } else {
      const rentAward = Math.min(lenderAmount, booking.rent_coins);
      const depositAward = lenderAmount - rentAward;

      if (rentAward > 0) {
        await deductHeldCash(
          booking.borrower_id, rentAward, booking.id,
          "Dispute settlement: rent awarded to lender", client, "RENT_PAYMENT"
        );
        await creditCash(
          booking.lender_id, rentAward, "RENT_PAYMENT", booking.id,
          "Rent awarded by admin dispute settlement", client
        );
      }
      if (depositAward > 0) {
        await deductHeldCash(
          booking.borrower_id, depositAward, booking.id,
          "Dispute settlement: deposit awarded to lender", client
        );
        await creditCash(
          booking.lender_id, depositAward, "DAMAGE_DEDUCTION", booking.id,
          "Deposit awarded by admin dispute settlement", client
        );
      }

      const borrowerAmount = totalHeld - lenderAmount;
      if (borrowerAmount > 0) {
        await releaseCash(booking.borrower_id, borrowerAmount, booking.id, client);
      }
    }

    const finalDepositOutcome = resolution === "OFFLINE_SETTLED" ? "REFUNDED" : "SETTLED";

    await client.query(
      `UPDATE dispute SET status = 'RESOLVED', resolution = $1, resolved_by = $2,
                           resolved_at = now(), resolution_note = $3
       WHERE id = $4`,
      [resolution, adminId, note, disputeId]
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

    return {
      disputeId,
      resolution,
      lenderAmount: resolution === "OFFLINE_SETTLED" ? booking.rent_coins : lenderAmount,
      borrowerAmount: resolution === "OFFLINE_SETTLED" ? booking.deposit_coins : totalHeld - lenderAmount,
      bookingStatus: "COMPLETED",
      depositOutcome: finalDepositOutcome,
    };
  });
}
