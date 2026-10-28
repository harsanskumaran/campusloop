// src/middleware/auth.js
import { verifyToken } from "../utils/auth.js";
import { pool } from "../config/db.js";

// Attaches req.user if a valid token is present. Rejects if missing/invalid.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization; // expects "Bearer <token>"
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice(7);
  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const result = await pool.query(
      "SELECT role, status FROM app_user WHERE id = $1",
      [payload.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "User account no longer exists" });
    if (user.status === "SUSPENDED") {
      return res.status(403).json({ error: "Your account is blocked. Contact an administrator." });
    }

    req.user = { ...payload, role: user.role, status: user.status };
    return next();
  } catch (err) {
    console.error("Authentication status check failed:", err);
    return res.status(500).json({ error: "Could not verify account status" });
  }
}

// Use after requireAuth. Blocks non-admins.
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
