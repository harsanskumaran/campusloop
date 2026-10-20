// src/modules/blocklist/blocklist.routes.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import {
  blockBorrower, releaseBorrower, listMyBlocked, listAllBlocked, BlockListError,
} from "./blocklist.service.js";

const router = Router();

const borrowerSchema = z.object({ borrowerId: z.number().int() });

// POST /blocklist — lender blocks a borrower
router.post("/", requireAuth, async (req, res) => {
  const parsed = borrowerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await blockBorrower(req.user.id, parsed.data.borrowerId);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof BlockListError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to block borrower" });
  }
});

// DELETE /blocklist — lender releases a borrower
router.delete("/", requireAuth, async (req, res) => {
  const parsed = borrowerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await releaseBorrower(req.user.id, parsed.data.borrowerId);
    res.json(result);
  } catch (err) {
    if (err instanceof BlockListError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to release borrower" });
  }
});

// GET /blocklist/mine — lender views their own blocked list
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const blocked = await listMyBlocked(req.user.id);
    res.json({ blocked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch blocked list" });
  }
});

// GET /blocklist/all — admin: every blocked pairing platform-wide
router.get("/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const blocked = await listAllBlocked();
    res.json({ blocked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch blocked list" });
  }
});

export default router;
