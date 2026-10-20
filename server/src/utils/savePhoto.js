// src/utils/savePhoto.js
import sharp from "sharp";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), "uploads");

// Compresses an in-memory image buffer, writes it to uploads/<relDir>/<uuid>.webp,
// and returns everything needed to insert a `photo` row.
export async function savePhoto(buffer, relDir) {
  const fileName = crypto.randomUUID() + ".webp";
  const dir = path.join(UPLOAD_ROOT, relDir);
  await fs.mkdir(dir, { recursive: true });

  const compressed = await sharp(buffer)
    .rotate() // auto-orient based on EXIF, then strip EXIF
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();

  const fullPath = path.join(dir, fileName);
  await fs.writeFile(fullPath, compressed);

  const sha256 = crypto.createHash("sha256").update(compressed).digest("hex");

  return {
    relativePath: path.join(relDir, fileName).replace(/\\/g, "/"), // store forward slashes
    sha256,
    sizeBytes: compressed.length,
  };
}

export function absolutePathFor(relativePath) {
  return path.join(UPLOAD_ROOT, relativePath);
}
