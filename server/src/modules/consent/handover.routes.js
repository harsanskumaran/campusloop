// src/modules/bookings/handover.routes.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
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

const textOf = (error) => error.issues.map((i) => i.message).join(". ");

const pickupSchema = z.object({
  comment: z.string({ error: "Please add a comment about the item's condition at pickup" })
    .trim().min(3, "Please add a comment about the item's condition at pickup").max(1000),
});

// POST /bookings/:id/pickup — borrower confirms the item's condition with a written comment (required)
router.post("/:id/pickup", requireAuth, async (req, res) => {
  const parsed = pickupSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: textOf(parsed.error) });

  try {
    const result = await submitPickup(req.user.id, req.params.id, parsed.data.comment);
    res.json(result);
  } catch (err) {
    sendError(res, err, "Failed to submit pickup");
  }
});

const dropSchema = z.object({ note: z.string().trim().max(1000).optional() });

// POST /bookings/:id/drop — borrower marks the item as returned (optional note)
router.post("/:id/drop", requireAuth, async (req, res) => {
  const parsed = dropSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: textOf(parsed.error) });

  try {
    const result = await submitDrop(req.user.id, req.params.id, parsed.data.note);
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
  note: z.string({ error: "A comment is required to accept the return or report a defect" })
    .trim().min(3, "A comment is required to accept the return or report a defect").max(1000),
});

// POST /bookings/:id/review — lender accepts (no defect) or flags a defect; a comment is required either way
router.post("/:id/review", requireAuth, async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: textOf(parsed.error) });

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
