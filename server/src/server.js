// src/server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { pool } from "./config/db.js";
import authRoutes from "./modules/auth/auth.routes.js";
import walletRoutes from "./modules/wallet/wallet.routes.js";
import itemRoutes from "./modules/items/items.routes.js";
import photoRoutes from "./modules/photos/photos.routes.js";
import quotaRoutes from "./modules/quota/quota.routes.js";
import bookingRoutes from "./modules/bookings/bookings.routes.js";
import handoverRoutes from "./modules/consent/handover.routes.js";
import inspectionRoutes from "./modules/items/inspection.routes.js";
import blocklistRoutes from "./modules/blocklist/blocklist.routes.js";
import disputeRoutes from "./modules/disputes/dispute.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import { startJobs } from "./jobs/index.js";

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// Health check — confirms the server AND the DB connection both work
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", db: "not connected", message: err.message });
  }
});

// ===== Route modules =====
app.use("/auth", authRoutes);
app.use("/wallet", walletRoutes);
app.use("/items", itemRoutes);
app.use("/items", inspectionRoutes);      // POST /items/:id/inspection, /items/:id/repair/extend
app.use("/photos", photoRoutes);
app.use("/quota", quotaRoutes);
app.use("/bookings", bookingRoutes);      // request, accept, reject, cancel, mine, extensions
app.use("/bookings", handoverRoutes);     // pickup, drop, evidence, review, dispute
app.use("/blocklist", blocklistRoutes);
app.use("/admin/disputes", disputeRoutes); // must come before /admin
app.use("/admin", adminRoutes);

// Unknown route -> clear JSON 404 (easier to debug than Express's HTML page)
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Basic error handler (last middleware)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CampusLoop server running on http://localhost:${PORT}`);
  startJobs(); // background jobs: expire requests, mark overdue, escalate lost items, end semester
});
