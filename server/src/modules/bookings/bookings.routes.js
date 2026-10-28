// src/modules/bookings/bookings.routes.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import {
  requestBooking, respondToRequest, cancelBooking, listMyBookings, BookingError,
} from "./bookings.service.js";
import { WalletError } from "../wallet/wallet.service.js";
import { QuotaError } from "../quota/quota.service.js";
import { ConsentError } from "../consent/consent.service.js";
import { ItemError } from "../items/items.service.js";
import {
  requestBookingExtension, respondToBookingExtension, BookingExtensionError,
} from "./bookingExtensions.service.js";

const router = Router();

// Errors that carry a user-readable message + HTTP status. Anything else is a
// real bug, so it is logged and the client gets a generic message.
const KNOWN_ERRORS = [BookingError, WalletError, QuotaError, ConsentError, ItemError];
function sendError(res, err, fallbackMessage) {
  if (KNOWN_ERRORS.some((E) => err instanceof E)) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: fallbackMessage });
}

const requestSchema = z.object({
  itemId: z.number().int(),
  startDate: z.string(), // ISO date string
  endDate: z.string(),
  consent: z.boolean().optional(), // true = borrower signed the consent on the listing page
});

// POST /bookings — borrower requests a booking AND signs the booking consent
// in one step (consent: true is required).
router.post("/", requireAuth, async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await requestBooking(
      req.user.id, parsed.data.itemId, parsed.data.startDate, parsed.data.endDate,
      parsed.data.consent === true
    );
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, "Failed to request booking");
  }
});

// POST /bookings/:id/accept — lender accepts
router.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const result = await respondToRequest(req.user.id, req.params.id, true);
    res.json(result);
  } catch (err) {
    sendError(res, err, "Failed to accept booking");
  }
});

// POST /bookings/:id/reject — lender rejects
router.post("/:id/reject", requireAuth, async (req, res) => {
  try {
    const result = await respondToRequest(req.user.id, req.params.id, false);
    res.json(result);
  } catch (err) {
    sendError(res, err, "Failed to reject booking");
  }
});

// POST /bookings/:id/cancel — borrower cancels before pickup
router.post("/:id/cancel", requireAuth, async (req, res) => {
  try {
    const result = await cancelBooking(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    sendError(res, err, "Failed to cancel booking");
  }
});

// GET /bookings/mine?as=borrower|lender
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const role = req.query.as === "lender" ? "lender" : "borrower";
    const bookings = await listMyBookings(req.user.id, role);
    res.json({ bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// POST /bookings/:id/booking-extension — borrower requests a later return date
const bookingExtensionSchema = z.object({
  requestedEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
router.post("/:id/booking-extension", requireAuth, async (req, res) => {
  const parsed = bookingExtensionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const extension = await requestBookingExtension(
      req.user.id,
      req.params.id,
      parsed.data.requestedEndDate
    );
    res.status(201).json({ extension });
  } catch (err) {
    if (err instanceof BookingExtensionError || err instanceof WalletError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to request booking extension" });
  }
});

// Lender approves/rejects additional time on an existing booking
router.post("/booking-extensions/:id/:decision", requireAuth, async (req, res) => {
  if (!["approve", "reject"].includes(req.params.decision)) {
    return res.status(400).json({ error: "Decision must be approve or reject" });
  }

  try {
    const extension = await respondToBookingExtension(
      req.user.id,
      req.params.id,
      req.params.decision === "approve"
    );
    res.json({ extension });
  } catch (err) {
    if (err instanceof BookingExtensionError || err instanceof WalletError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to respond to booking extension" });
  }
});

export default router;
