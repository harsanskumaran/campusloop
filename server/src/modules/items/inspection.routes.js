// src/modules/items/inspection.routes.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { upload } from "../../middleware/upload.js";
import {
  submitInspection, extendRepair, releaseCoolingPeriod, InspectionError,
} from "./inspection.service.js";

const router = Router();

// POST /items/:id/cooling/release — lender ends the cooling period early
router.post("/:id/cooling/release", requireAuth, async (req, res) => {
  try {
    const result = await releaseCoolingPeriod(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    if (err instanceof InspectionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to release the cooling period" });
  }
});

// POST /items/:id/inspection — multipart form, field "photos", plus fields "passed" ("true"/"false") and "notes"
router.post("/:id/inspection", requireAuth, upload.array("photos", 8), async (req, res) => {
  const passed = req.body.passed === "true" || req.body.passed === true;
  const notes = req.body.notes;

  try {
    const result = await submitInspection(req.user.id, req.params.id, passed, notes, req.files);
    res.json(result);
  } catch (err) {
    if (err instanceof InspectionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to submit inspection" });
  }
});

const extendSchema = z.object({ extraDays: z.number().int().min(1).max(2) });

// POST /items/:id/repair/extend
router.post("/:id/repair/extend", requireAuth, async (req, res) => {
  const parsed = extendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await extendRepair(req.user.id, req.params.id, parsed.data.extraDays);
    res.json(result);
  } catch (err) {
    if (err instanceof InspectionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to extend repair" });
  }
});

export default router;
