// src/modules/admin/admin.routes.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import {
  getReports, listExceededUsers, listSuspendedUsers, listAllDisputes,
  suspendUser, unsuspendUser,
} from "./admin.service.js";

const router = Router();

router.use(requireAuth, requireAdmin); // every route below is admin-only

// GET /admin/reports — basic reporting dashboard
router.get("/reports", async (req, res) => {
  try {
    const reports = await getReports();
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// GET /admin/users/exceeded
router.get("/users/exceeded", async (req, res) => {
  try {
    const users = await listExceededUsers();
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch exceeded users" });
  }
});

// GET /admin/users/suspended
router.get("/users/suspended", async (req, res) => {
  try {
    const users = await listSuspendedUsers();
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch suspended users" });
  }
});

// GET /admin/concerns — all disputes/flagged concerns (open and resolved)
router.get("/concerns", async (req, res) => {
  try {
    const disputes = await listAllDisputes();
    res.json({ disputes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch concerns" });
  }
});

const suspendSchema = z.object({ userId: z.number().int(), reason: z.string().min(3) });

// POST /admin/users/suspend
router.post("/users/suspend", async (req, res) => {
  const parsed = suspendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await suspendUser(parsed.data.userId, parsed.data.reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const userIdSchema = z.object({ userId: z.number().int() });

// POST /admin/users/unsuspend
router.post("/users/unsuspend", async (req, res) => {
  const parsed = userIdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await unsuspendUser(parsed.data.userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
