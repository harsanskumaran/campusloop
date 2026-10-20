// src/middleware/auth.js
import { verifyToken } from "../utils/auth.js";

// Attaches req.user if a valid token is present. Rejects if missing/invalid.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization; // expects "Bearer <token>"
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = payload; // { id, role, status }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Use after requireAuth. Blocks non-admins.
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
