// src/modules/quota/quota.routes.js
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { getUsage, adminLift, QuotaError } from "./quota.service.js";

const router = Router();

// GET /quota — current user's usage this semester
router.get("/", requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      "SELECT status, semester_id FROM app_user WHERE id = $1",
      [req.user.id]
    );
    const user = userResult.rows[0];
    if (!user.semester_id) return res.json({ used: 0, limit: 10, status: user.status, note: "No active semester" });

    const used = await getUsage(req.user.id, user.semester_id);
    res.json({ used, limit: 10, status: user.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch quota" });
  }
});

const liftSchema = z.object({ userId: z.number().int(), reason: z.string().min(3) });

// POST /quota/admin/lift  { "userId": 5, "reason": "Appeal approved" }  — admin only
router.post("/admin/lift", requireAuth, requireAdmin, async (req, res) => {
  const parsed = liftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await adminLift(parsed.data.userId, parsed.data.reason);
    res.json({ message: "User lifted from EXCEEDED", ...result });
  } catch (err) {
    if (err instanceof QuotaError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Lift failed" });
  }
});

export default router;
