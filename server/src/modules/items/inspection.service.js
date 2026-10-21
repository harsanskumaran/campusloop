// src/modules/items/inspection.service.js
import { withTransaction } from "../../config/db.js";
import { savePhoto } from "../../utils/savePhoto.js";

export class InspectionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const MAX_REPAIR_EXTENSION_DAYS = 2;

export async function releaseCoolingPeriod(lenderId, itemId) {
  return withTransaction(async (client) => {
    const itemResult = await client.query("SELECT * FROM item WHERE id = $1 FOR UPDATE", [itemId]);
    const item = itemResult.rows[0];
    if (!item) throw new InspectionError("Item not found", 404);
    if (item.owner_id !== lenderId) throw new InspectionError("Only the owner can release the cooling period", 403);
    if (item.status !== "COOLING") {
      throw new InspectionError(`Item is not in its cooling period (currently ${item.status})`);
    }

    await client.query(
      `INSERT INTO inspection (item_id, passed, notes)
       VALUES ($1, TRUE, 'Cooling period released early by lender')`,
      [itemId]
    );
    await client.query(
      "UPDATE item SET status = 'LISTED', cooling_until = NULL WHERE id = $1",
      [itemId]
    );

    return { itemId: item.id, status: "LISTED" };
  });
}

// Lender submits an inspection during COOLING (or while UNDER_REPAIR, to
// confirm a fix). Passing relists the item immediately; failing sends it to
// UNDER_REPAIR.
export async function submitInspection(lenderId, itemId, passed, notes, files) {
  return withTransaction(async (client) => {
    const itemResult = await client.query("SELECT * FROM item WHERE id = $1 FOR UPDATE", [itemId]);
    const item = itemResult.rows[0];
    if (!item) throw new InspectionError("Item not found", 404);
    if (item.owner_id !== lenderId) throw new InspectionError("Only the owner can inspect this item", 403);
    if (!["COOLING", "UNDER_REPAIR"].includes(item.status)) {
      throw new InspectionError(`Item is not awaiting inspection (currently ${item.status})`);
    }

    const inspectionResult = await client.query(
      `INSERT INTO inspection (item_id, passed, notes) VALUES ($1, $2, $3)
       RETURNING id, passed, created_at`,
      [itemId, passed, notes ?? null]
    );
    const inspection = inspectionResult.rows[0];

    if (files && files.length > 0) {
      for (const file of files) {
        const { relativePath, sha256, sizeBytes } = await savePhoto(
          file.buffer, `inspections/${itemId}/${inspection.id}`
        );
        await client.query(
          `INSERT INTO photo (kind, path, sha256, size_bytes, uploaded_by, item_id, inspection_id)
           VALUES ('INSPECTION', $1, $2, $3, $4, $5, $6)`,
          [relativePath, sha256, sizeBytes, lenderId, itemId, inspection.id]
        );
      }
    }

    if (passed) {
      await client.query(
        "UPDATE item SET status = 'LISTED', cooling_until = NULL WHERE id = $1",
        [itemId]
      );
    } else {
      await client.query(
        "UPDATE item SET status = 'UNDER_REPAIR' WHERE id = $1",
        [itemId]
      );
    }

    return { itemId, inspectionId: inspection.id, passed, newStatus: passed ? "LISTED" : "UNDER_REPAIR" };
  });
}

// Lender requests one extension while repairing (max +2 days), logged as a note.
export async function extendRepair(lenderId, itemId, extraDays) {
  if (extraDays > MAX_REPAIR_EXTENSION_DAYS) {
    throw new InspectionError(`Cannot extend by more than ${MAX_REPAIR_EXTENSION_DAYS} days`);
  }
  return withTransaction(async (client) => {
    const itemResult = await client.query("SELECT * FROM item WHERE id = $1 FOR UPDATE", [itemId]);
    const item = itemResult.rows[0];
    if (!item) throw new InspectionError("Item not found", 404);
    if (item.owner_id !== lenderId) throw new InspectionError("Only the owner can extend repair", 403);
    if (item.status !== "UNDER_REPAIR") {
      throw new InspectionError("Item is not currently under repair");
    }

    await client.query(
      `UPDATE item SET cooling_until = now() + ($1 || ' days')::interval WHERE id = $2`,
      [extraDays, itemId]
    );

    return { itemId, extendedByDays: extraDays };
  });
}
