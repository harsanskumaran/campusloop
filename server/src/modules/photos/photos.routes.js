// src/modules/photos/photos.routes.js
import { Router } from "express";
import { pool } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { absolutePathFor } from "../../utils/savePhoto.js";

const router = Router();

// GET /photos/:id — streams the file if the requester is allowed to see it.
// ITEM photos: visible to any logged-in user (they're public listing photos).
// BOOKING_CONSENT / PICKUP / DROP / INSPECTION photos: only the booking's
// borrower, lender, or an admin can view them (enforced fully once Part 6
// wires bookings in — for now ITEM photos are the only kind in use).
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM photo WHERE id = $1", [req.params.id]);
    const photo = result.rows[0];
    if (!photo) return res.status(404).json({ error: "Photo not found" });

    if (photo.kind !== "ITEM") {
      // Booking-linked photo: verify the requester is party to that booking or an admin
      if (req.user.role !== "ADMIN") {
        const bookingResult = await pool.query(
          "SELECT borrower_id, lender_id FROM booking WHERE id = $1",
          [photo.booking_id]
        );
        const booking = bookingResult.rows[0];
        const allowed = booking && (booking.borrower_id === req.user.id || booking.lender_id === req.user.id);
        if (!allowed) return res.status(403).json({ error: "Not authorized to view this photo" });
      }
    }

    res.sendFile(absolutePathFor(photo.path));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load photo" });
  }
});

export default router;
