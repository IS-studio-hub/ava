import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { requireAuth } from "./auth.js";

const router = Router();

function publicSave(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    letter: doc.letter,
    word: doc.word || "",
    theme: doc.params?.theme || "light",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function fullSave(doc) {
  return {
    ...publicSave(doc),
    params: doc.params || {},
  };
}

function titleFromParams(params = {}, fallback = "") {
  if (fallback) return String(fallback).trim().slice(0, 80);
  if (params.imageSrc) return "Image";
  const word = String(params.word || "").trim();
  const letter = String(params.letter || "G").slice(0, 1).toUpperCase();
  return word || letter || "Untitled";
}

/** Public: only live (non-deleted) saves — used by embeds */
router.get("/public/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Not found", removed: true });
    }
    const db = getDb();
    const doc = await db.collection("saves").findOne({
      _id: new ObjectId(req.params.id),
      deletedAt: { $exists: false },
    });
    if (!doc) {
      return res.status(404).json({ error: "This Ava was removed from the library.", removed: true });
    }
    res.json({
      id: String(doc._id),
      title: doc.title,
      params: doc.params || {},
    });
  } catch (err) {
    console.error("public save", err);
    res.status(500).json({ error: "Could not load save" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const docs = await db
      .collection("saves")
      .find({
        userId: req.user.id,
        deletedAt: { $exists: false },
      })
      .sort({ updatedAt: -1 })
      .limit(200)
      .toArray();
    res.json({ saves: docs.map(fullSave) });
  } catch (err) {
    console.error("list saves", err);
    res.status(500).json({ error: "Could not load library" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Not found" });
    }
    const db = getDb();
    const doc = await db.collection("saves").findOne({
      _id: new ObjectId(req.params.id),
      userId: req.user.id,
      deletedAt: { $exists: false },
    });
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ save: fullSave(doc) });
  } catch (err) {
    console.error("get save", err);
    res.status(500).json({ error: "Could not load save" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const params = req.body?.params;
    if (!params || typeof params !== "object") {
      return res.status(400).json({ error: "params are required" });
    }
    const title = titleFromParams(params, req.body?.title);
    const now = new Date();
    const doc = {
      userId: req.user.id,
      title,
      letter: String(params.letter || "G").slice(0, 1).toUpperCase(),
      word: String(params.word || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 10),
      params,
      createdAt: now,
      updatedAt: now,
    };
    const db = getDb();
    const result = await db.collection("saves").insertOne(doc);
    const save = fullSave({ ...doc, _id: result.insertedId });
    res.status(201).json({ save });
  } catch (err) {
    console.error("create save", err);
    res.status(500).json({ error: "Could not save to library" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Not found" });
    }
    const db = getDb();
    // Soft-delete so public embeds immediately stop working
    const result = await db.collection("saves").updateOne(
      {
        _id: new ObjectId(req.params.id),
        userId: req.user.id,
        deletedAt: { $exists: false },
      },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error("delete save", err);
    res.status(500).json({ error: "Could not delete save" });
  }
});

export default router;
