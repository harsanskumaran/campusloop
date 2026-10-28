// src/modules/items/items.routes.js
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { quotaGuard } from "../../middleware/quotaGuard.js";
import { photoUpload } from "../../middleware/upload.js";
import { savePhoto } from "../../utils/savePhoto.js";
import {
  createItem, getItem, listItems, getAvailability, listMyItems, ItemError,
} from "./items.service.js";
import { ITEM_CATEGORIES } from "./categories.js";

const router = Router();

// The create form is multipart (text fields + 4-8 photos), so numbers arrive as strings.
const createItemSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters"),
  description: z.string().trim().min(5, "Description must be at least 5 characters"),
  category: z.enum(ITEM_CATEGORIES, { error: `Choose a category: ${ITEM_CATEGORIES.join(", ")}` }),
  declaredValue: z.coerce.number({ error: "Choose an item value range" }).int().positive("Choose an item value range"),
  rentPerDay: z.coerce.number({ error: "Enter the rent per day" }).int().positive("Rent per day must be at least ₹1"),
  deposit: z.coerce.number({ error: "Enter the deposit" }).int().min(0, "Deposit cannot be negative"),
  knownDefects: z.string().trim().optional().transform((v) => v || undefined),
});

// POST /items — create a listing with 4-8 photos (counts toward the semester quota).
// multipart/form-data: title, description, category, declaredValue, rentPerDay,
// deposit, knownDefects?, photos (min 4)
router.post("/", requireAuth, quotaGuard, photoUpload("photos", 8), async (req, res) => {
  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
  }

  try {
    const result = await createItem(req.user.id, parsed.data, req.files ?? []);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ItemError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to create item" });
  }
});

// GET /items?category=&search=  — browse listings
router.get("/", requireAuth, async (req, res) => {
  try {
    const items = await listItems({
      category: req.query.category,
      search: req.query.search,
    });
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list items" });
  }
});

// GET /items/mine — items owned by the current lender
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const items = await listMyItems(req.user.id);
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch your items" });
  }
});

// GET /items/:id — single item with photos
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const item = await getItem(req.params.id, req.user);
    res.json({ item });
  } catch (err) {
    if (err instanceof ItemError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to fetch item" });
  }
});

// GET /items/:id/availability — booked date ranges
router.get("/:id/availability", requireAuth, async (req, res) => {
  try {
    const availability = await getAvailability(req.params.id);
    res.json(availability);
  } catch (err) {
    if (err instanceof ItemError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

// POST /items/:id/photos — owner only, up to 8 images
router.post("/:id/photos", requireAuth, photoUpload("photos", 8), async (req, res) => {
  const itemId = req.params.id;
  try {
    const ownerCheck = await pool.query("SELECT owner_id FROM item WHERE id = $1", [itemId]);
    if (ownerCheck.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    if (ownerCheck.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: "Only the item's owner can add photos" });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No photos uploaded" });
    }

    const saved = [];
    for (const file of req.files) {
      const { relativePath, sha256, sizeBytes } = await savePhoto(file.buffer, `items/${itemId}`);
      const result = await pool.query(
        `INSERT INTO photo (kind, path, sha256, size_bytes, uploaded_by, item_id)
         VALUES ('ITEM', $1, $2, $3, $4, $5)
         RETURNING id, path, created_at`,
        [relativePath, sha256, sizeBytes, req.user.id, itemId]
      );
      saved.push(result.rows[0]);
    }

    res.status(201).json({ photos: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Photo upload failed" });
  }
});

export default router;
