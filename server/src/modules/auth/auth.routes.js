// src/modules/auth/auth.routes.js
import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../../config/db.js";
import { hashPassword, comparePassword, signToken } from "../../utils/auth.js";
import { requireAuth } from "../../middleware/auth.js";

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).regex(/^[\p{L} ]+$/u, "Name can only contain letters"),
  email: z.string().trim().email().refine(
    (email) => email.toLowerCase().endsWith("@srm.edu.in"),
    "Email must use the @srm.edu.in domain"
  ).transform((email) => email.toLowerCase()),
  password: z.string().min(6),
  campusId: z.string().optional(),
  phone: z.string().regex(/^\d{10}$/, "Contact number must be exactly 10 digits"),
  roomNo: z.string().trim().min(1, "Room number is required").max(40),
});

// POST /auth/register
router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, email, password, campusId, phone, roomNo } = parsed.data;

  try {
    const existing = await pool.query("SELECT id FROM app_user WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);

    // Find the currently active semester (may be null if none set yet)
    const semResult = await pool.query("SELECT id FROM semester WHERE is_active = TRUE LIMIT 1");
    const semesterId = semResult.rows[0]?.id ?? null;

    const user = await withTransaction(async (client) => {
      const userResult = await client.query(
        `INSERT INTO app_user (name, email, phone, room_no, password_hash, campus_id, semester_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, phone, room_no, role, status`,
        [name, email, phone, roomNo, passwordHash, campusId ?? null, semesterId]
      );
      const newUser = userResult.rows[0];

      // Every user gets a wallet on registration
      await client.query("INSERT INTO wallet (user_id) VALUES ($1)", [newUser.id]);

      return newUser;
    });

    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  try {
    const result = await pool.query(
      "SELECT id, name, email, phone, room_no, password_hash, role, status FROM app_user WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (user.status === "SUSPENDED") {
      return res.status(403).json({ error: "Your account is blocked. Contact an administrator." });
    }

    const token = signToken(user);
    delete user.password_hash;
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /auth/me  — confirms the token works and returns current user
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, phone, room_no, role, status, campus_id, semester_id, created_at FROM app_user WHERE id = $1",
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
