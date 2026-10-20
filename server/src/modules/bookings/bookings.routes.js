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
  requestExtension, respondToExtension, listExtensionsForLender, ExtensionError,
} from "./extensions.service.js";

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

// ===== Extension requests =====

const extRequestSchema = z.object({ itemId: z.number().int(), note: z.string().optional() });

// POST /bookings/extensions — borrower requests an extra monthly slot
router.post("/extensions", requireAuth, async (req, res) => {
  const parsed = extRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await requestExtension(req.user.id, parsed.data.itemId, parsed.data.note);
    res.status(201).json({ extension: result });
  } catch (err) {
    if (err instanceof ExtensionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to request extension" });
  }
});

// GET /bookings/extensions/mine — lender views requests on their items
router.get("/extensions/mine", requireAuth, async (req, res) => {
  try {
    const extensions = await listExtensionsForLender(req.user.id);
    res.json({ extensions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch extensions" });
  }
});

// POST /bookings/extensions/:id/approve
router.post("/extensions/:id/approve", requireAuth, async (req, res) => {
  try {
    const result = await respondToExtension(req.user.id, req.params.id, true);
    res.json({ extension: result });
  } catch (err) {
    if (err instanceof ExtensionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to reject extension" });
  }
});

// POST /bookings/extensions/:id/reject
router.post("/extensions/:id/reject", requireAuth, async (req, res) => {
  try {
    const result = await respondToExtension(req.user.id, req.params.id, false);
    res.json({ extension: result });
  } catch (err) {
    if (err instanceof ExtensionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to reject extension" });
  }
});

export default router;
