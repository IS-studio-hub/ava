import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { requireAuth, publicUser } from "./auth.js";
import { ensureUsagePeriod, usageSnapshot } from "./plans.js";

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
    const snap = usageSnapshot(doc);
    if (snap.usesRemaining <= 0) {
      const label = snap.plan === "pro" ? "Pro" : snap.plan === "business" ? "Business" : "Free";
      const windowText = snap.usesReset === "lifetime" ? "" : " this month";
      return res.status(402).json({
        error: `Please increase your plan. You've used all ${snap.useLimit} ${label} uses${windowText}.`,
        usage: snap,
        user: publicUser(doc),
      });
    }

    const nextUses = snap.uses + 1;
    const $set = {
      lastUseKind: kind,
      usesPeriodStart: snap.usesPeriodStart,
      uses: nextUses,
      updatedAt: new Date(),
    };
    if (snap.plan === "free") $set.lifetimeUses = nextUses;
    await db.collection("users").updateOne({ _id: doc._id }, { $set });
    const next = {
      ...doc,
      uses: nextUses,
      lifetimeUses: snap.plan === "free" ? nextUses : doc.lifetimeUses,
      usesPeriodStart: snap.usesPeriodStart,
    };
    res.json({ user: publicUser(next), usage: usageSnapshot(next) });
  } catch (err) {
    console.error("usage consume", err);
    res.status(500).json({ error: "Could not record use" });
  }
});

export default router;
