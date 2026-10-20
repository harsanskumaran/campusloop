// src/modules/wallet/wallet.routes.js
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { topUp, getWallet, withdraw, WalletError } from "./wallet.service.js";

const router = Router();

// GET /wallet — current balance
router.get("/", requireAuth, async (req, res) => {
  try {
    const wallet = await getWallet(req.user.id);
    res.json({ wallet });
  } catch (err) {
    if (err instanceof WalletError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to fetch wallet" });
  }
});

const amountSchema = z.object({ amount: z.number().int().positive() });

// POST /wallet/topup  { "amount": 2000 }
router.post("/topup", requireAuth, async (req, res) => {
  const parsed = amountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await topUp(req.user.id, parsed.data.amount);
    res.json({ message: "Top-up successful (mock payment)", ...result });
  } catch (err) {
    if (err instanceof WalletError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Top-up failed" });
  }
});

// POST /wallet/withdraw — only allowed once the user's semester has ended
router.post("/withdraw", requireAuth, async (req, res) => {
  try {
    const result = await withdraw(req.user.id);
    res.json({ message: "Withdrawal successful", ...result });
  } catch (err) {
    if (err instanceof WalletError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Withdraw failed" });
  }
});

// GET /wallet/ledger — full transaction history for this user
router.get("/ledger", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cl.id, cl.type, cl.amount, cl.booking_id, cl.note, cl.created_at
       FROM cash_ledger cl
       JOIN wallet w ON w.id = cl.wallet_id
       WHERE w.user_id = $1
       ORDER BY cl.created_at DESC`,
      [req.user.id]
    );
    res.json({ ledger: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch ledger" });
  }
});

export default router;
