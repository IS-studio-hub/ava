import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { requireAuth, publicUser } from "./auth.js";
import { currentPeriodStart, ensureUsagePeriod, planLimit, usageSnapshot } from "./plans.js";

const router = Router();
const KINDS = new Set(["letter", "word", "image"]);

router.get("/", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    let doc = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!doc) return res.status(404).json({ error: "User not found" });
    doc = await ensureUsagePeriod(db, doc);
    res.json({ user: publicUser(doc), usage: usageSnapshot(doc) });
  } catch (err) {
    console.error("usage get", err);
    res.status(500).json({ error: "Could not load usage" });
  }
});

router.post("/consume", requireAuth, async (req, res) => {
  try {
    const kind = String(req.body?.kind || "").toLowerCase();
    if (!KINDS.has(kind)) {
      return res.status(400).json({ error: "Use must be letter, word, or image" });
    }

    const db = getDb();
    let doc = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!doc) return res.status(404).json({ error: "User not found" });
    doc = await ensureUsagePeriod(db, doc);

    const period = currentPeriodStart();
    const limit = planLimit(doc.plan);
    const updated = await db.collection("users").findOneAndUpdate(
      {
        _id: doc._id,
        usesPeriodStart: period,
        uses: { $lt: limit },
      },
      {
        $inc: { uses: 1 },
        $set: { lastUseKind: kind, updatedAt: new Date() },
      },
      { returnDocument: "after" }
    );

    const next = updated && updated._id ? updated : updated?.value;
    if (!next) {
      const snap = usageSnapshot(doc);
      return res.status(402).json({
        error: `You've used all ${snap.useLimit} ${snap.plan === "free" ? "Free" : snap.plan} uses this month. Switch plans on your account page.`,
        usage: snap,
        user: publicUser(doc),
      });
    }

    res.json({ user: publicUser(next), usage: usageSnapshot(next) });
  } catch (err) {
    console.error("usage consume", err);
    res.status(500).json({ error: "Could not record use" });
  }
});

export default router;
