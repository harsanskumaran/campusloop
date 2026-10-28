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

// Same as upload.array(field, max) but upload problems come back as a readable
// 400 message instead of a generic "Something went wrong".
export function photoUpload(field = "photos", max = 8) {
  const handler = upload.array(field, max);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      let message = err.message;
      if (err.code === "LIMIT_FILE_SIZE") message = "Each photo must be smaller than 8 MB";
      else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        message = `You can upload at most ${max} photos`;
      }
      return res.status(400).json({ error: message });
    });
  };
}
