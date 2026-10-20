// src/middleware/upload.js
import multer from "multer";

export const upload = multer({
  storage: multer.memoryStorage(), // we compress and write to disk ourselves
  limits: { fileSize: 8 * 1024 * 1024, files: 8 }, // 8MB per file, max 8 files
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG or WebP images are allowed"));
  },
});
