import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDb } from "./db.js";
import authRouter from "./auth.js";
import savesRouter from "./saves.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT) || 8765;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ava", db: "ava" });
});

app.use("/api/auth", authRouter);
app.use("/api/saves", savesRouter);

app.use(express.static(root));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  // Prefer exact static files; fallback to studio
  res.sendFile(path.join(root, "index.html"));
});

async function main() {
  const db = await connectDb();
  await db.collection("saves").createIndex({ userId: 1, updatedAt: -1 });
  await db.collection("pending_users").createIndex({ email: 1 });
  await db.collection("pending_users").createIndex({ token: 1 }, { unique: true });
  await db.collection("pending_users").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  app.listen(port, () => {
    console.log(`Ava running at http://127.0.0.1:${port}`);
    console.log(`MongoDB database: ava (users, saves, pending_users)`);
  });
}

main().catch((err) => {
  console.error("Failed to start Ava server:", err);
  process.exit(1);
});
