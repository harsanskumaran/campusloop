// src/modules/disputes/dispute.routes.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { listOpenDisputes, resolveDispute, DisputeError } from "./dispute.service.js";
import { WalletError } from "../wallet/wallet.service.js";

const router = Router();

// GET /admin/disputes — all open disputes, admin only
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const disputes = await listOpenDisputes();
    res.json({ disputes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

const resolveSchema = z.object({
  resolution: z.enum(["CUSTOM_SETTLEMENT", "OFFLINE_SETTLED"]),
  lenderAmount: z.number().int().min(0),
  note: z.string({ error: "A resolution comment is required" }).trim().min(1, "A resolution comment is required").max(1000),
});

// POST /admin/disputes/:id/resolve — admin only
router.post("/:id/resolve", requireAuth, requireAdmin, async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
  }

  try {
    const result = await resolveDispute(
      req.user.id,
      req.params.id,
      parsed.data.resolution,
      parsed.data.lenderAmount,
      parsed.data.note
    );
    res.json(result);
  } catch (err) {
    if (err instanceof DisputeError || err instanceof WalletError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to resolve dispute" });
  }
});

export default router;
