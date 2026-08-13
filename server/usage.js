import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { requireAuth, publicUser } from "./auth.js";
import { ensureUsagePeriod, usageSnapshot } from "./plans.js";

const router = Router();
const KINDS = new Set(["save"]);

export async function consumeUserUse(userId, kind = "save") {
  const db = getDb();
  let doc = await db.collection("users").findOne({ _id: new ObjectId(userId) });
  if (!doc) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  doc = await ensureUsagePeriod(db, doc);
  const snap = usageSnapshot(doc);
  if (snap.usesRemaining <= 0) {
    const label = snap.plan === "pro" ? "Pro" : snap.plan === "business" ? "Business" : "Free";
    const windowText = snap.usesReset === "lifetime" ? "" : " this month";
    const err = new Error(`Please increase your plan. You've used all ${snap.useLimit} ${label} saves${windowText}.`);
    err.status = 402;
    err.usage = snap;
    err.user = publicUser(doc);
    throw err;
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
  return { user: publicUser(next), usage: usageSnapshot(next) };
}

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
    const kind = String(req.body?.kind || "save").toLowerCase();
    if (!KINDS.has(kind)) {
      return res.status(400).json({ error: "Use must be a save" });
    }
    const result = await consumeUserUse(req.user.id, kind);
    res.json(result);
  } catch (err) {
    if (err.status === 402 || err.status === 404) {
      return res.status(err.status).json({
        error: err.message,
        usage: err.usage,
        user: err.user,
      });
    }
    console.error("usage consume", err);
    res.status(500).json({ error: "Could not record use" });
  }
});

export default router;
