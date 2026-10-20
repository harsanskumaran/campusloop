// src/middleware/quotaGuard.js
import { assertCanAct, QuotaError } from "../modules/quota/quota.service.js";

export async function quotaGuard(req, res, next) {
  try {
    const quota = await assertCanAct(req.user.id);
    req.quota = quota;
    next();
  } catch (err) {
    if (err instanceof QuotaError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Quota check failed" });
  }
}