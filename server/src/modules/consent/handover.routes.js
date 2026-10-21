// src/modules/bookings/handover.routes.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { upload } from "../../middleware/upload.js";
import { signConsent, ConsentError } from "../consent/consent.service.js";
import { WalletError } from "../wallet/wallet.service.js";
import {
  submitPickup, submitDrop, getEvidenceForBooking, reviewDrop, raiseDispute, HandoverError,
} from "./handover.service.js";

const router = Router();

// Errors with a readable message + status; anything else is a real bug (logged, generic reply).
function sendError(res, err, fallbackMessage) {
  if (err instanceof HandoverError || err instanceof WalletError || err instanceof ConsentError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: fallbackMessage });
}

const consentSchema = z.object({ note: z.string().optional() });

// POST /bookings/:id/consent/booking — borrower signs the booking-stage consent
router.post("/:id/consent/booking", requireAuth, async (req, res) => {
  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await signConsent(req.params.id, req.user.id, "BOOKING", parsed.data.note);
    res.status(201).json({ consent: result });
  } catch (err) {
    if (err instanceof ConsentError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to sign consent" });
  }
});

// POST /bookings/:id/pickup — borrower accepts condition + uploads photos (multipart, field "photos")
router.post("/:id/pickup", requireAuth, upload.array("photos", 8), async (req, res) => {
  try {
    const result = await submitPickup(req.user.id, req.params.id, req.files);
    res.json(result);
  } catch (err) {
    sendError(res, err, "Failed to submit pickup");
  }
});

// POST /bookings/:id/drop — borrower uploads drop-point photos (multipart, field "photos")
router.post("/:id/drop", requireAuth, upload.array("photos", 8), async (req, res) => {
  try {
    const result = await submitDrop(req.user.id, req.params.id, req.files);
    res.json(result);
  } catch (err) {
    sendError(res, err, "Failed to submit drop");
  }
});

// GET /bookings/:id/evidence — borrower, lender, or admin can view all photos + consents
router.get("/:id/evidence", requireAuth, async (req, res) => {
  try {
    const result = await getEvidenceForBooking(req.params.id, req.user.id, req.user.role);
    res.json(result);
  } catch (err) {
    if (err instanceof HandoverError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to fetch evidence" });
  }
});

const reviewSchema = z.object({
  hasDefect: z.boolean(),
  note: z.string().optional(),
});

// POST /bookings/:id/review — lender accepts (no defect) or flags a defect
router.post("/:id/review", requireAuth, async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await reviewDrop(req.user.id, req.params.id, parsed.data.hasDefect, parsed.data.note);
    res.json(result);
  } catch (err) {
    sendError(res, err, "Failed to review drop");
  }
});

const disputeSchema = z.object({ reason: z.string().trim().min(5) });

// POST /bookings/:id/dispute — either party escalates to admin
router.post("/:id/dispute", requireAuth, async (req, res) => {
  const parsed = disputeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await raiseDispute(req.user.id, req.params.id, parsed.data.reason);
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, "Failed to raise dispute");
  }
});

export default router;
