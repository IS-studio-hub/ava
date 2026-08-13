import { Router } from "express";
import { GridFSBucket, ObjectId } from "mongodb";
import multer from "multer";
import { getDb } from "./db.js";
import { requireAuth, publicUser } from "./auth.js";
import { consumeUserUse } from "./usage.js";
import { ensureUsagePeriod, usageSnapshot } from "./plans.js";

const router = Router();
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

function gridFsVideoStorage() {
  return {
    _handleFile(req, file, cb) {
      const bucket = recordingsBucket();
      const mime = String(file.mimetype || "video/webm");
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      const upload = bucket.openUploadStream(`ava-recording.${ext}`, {
        contentType: mime,
        metadata: { userId: req.user?.id || "" },
      });
      let settled = false;
      const done = (err, info) => {
        if (settled) return;
        settled = true;
        cb(err || null, info);
      };
      file.stream.on("error", (err) => {
        try { upload.destroy(err); } catch { /* ignore */ }
        done(err);
      });
      file.stream.pipe(upload);
      upload.on("error", (err) => done(err));
      upload.on("finish", () => done(null, { videoId: upload.id, filename: upload.filename, size: upload.length }));
      upload.on("close", () => {
        if (!settled) done(null, { videoId: upload.id, filename: upload.filename, size: upload.length });
      });
    },
    _removeFile(req, file, cb) {
      if (!file.videoId) return cb(null);
      recordingsBucket()
        .delete(file.videoId)
        .then(() => cb(null))
        .catch(() => cb(null));
    },
  };
}

const uploadVideo = multer({
  storage: gridFsVideoStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, fieldSize: 12 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const type = String(file.mimetype || "").toLowerCase();
    const ok =
      type.startsWith("video/") ||
      type === "application/octet-stream" ||
      type === "application/mp4";
    cb(ok ? null : new Error("A video file is required"), ok);
  },
});

function recordingsBucket() {
  return new GridFSBucket(getDb(), { bucketName: "recordings" });
}

async function deleteRecordingFile(videoId) {
  if (!videoId) return;
  try {
    await recordingsBucket().delete(videoId instanceof ObjectId ? videoId : new ObjectId(videoId));
  } catch {
    /* already gone */
  }
}

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
    kind: doc.kind || "save",
    hasVideo: Boolean(doc.videoId),
    durationMs: Number(doc.durationMs) || 0,
    videoMime: doc.videoMime || "",
  };
}

function titleFromParams(params = {}, fallback = "", kind = "") {
  if (fallback) return String(fallback).trim().slice(0, 80);
  const word = String(params.word || "").trim();
  const letter = String(params.letter || "").slice(0, 1);
  const base = word || letter || (params.imageSrc ? "Image" : "Untitled");
  if (kind === "recording") return `Recording · ${base}`.slice(0, 80);
  return base;
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
    let usageResult;
    try {
      usageResult = await consumeUserUse(req.user.id, "save");
    } catch (err) {
      if (err.status === 402 || err.status === 404) {
        return res.status(err.status).json({
          error: err.message,
          usage: err.usage,
          user: err.user,
        });
      }
      throw err;
    }
    const title = titleFromParams(params, req.body?.title);
    const now = new Date();
    const doc = {
      userId: req.user.id,
      kind: "save",
      title,
      letter: String(params.letter || "").slice(0, 1),
      word: String(params.word || "").slice(0, 10),
      params,
      createdAt: now,
      updatedAt: now,
    };
    const db = getDb();
    const result = await db.collection("saves").insertOne(doc);
    const save = fullSave({ ...doc, _id: result.insertedId });
    res.status(201).json({ save, user: usageResult.user, usage: usageResult.usage });
  } catch (err) {
    console.error("create save", err);
    res.status(500).json({ error: "Could not save to library" });
  }
});

async function assertRecordingUsesLeft(req, res, next) {
  try {
    const db = getDb();
    let doc = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!doc) return res.status(404).json({ error: "User not found" });
    doc = await ensureUsagePeriod(db, doc);
    const snap = usageSnapshot(doc);
    if (snap.usesRemaining <= 0) {
      const label = snap.plan === "pro" ? "Pro" : snap.plan === "business" ? "Business" : "Free";
      const windowText = snap.usesReset === "lifetime" ? "" : " this month";
      return res.status(402).json({
        error: `Please increase your plan. You've used all ${snap.useLimit} ${label} saves${windowText}.`,
        usage: snap,
        user: publicUser(doc),
      });
    }
    next();
  } catch (err) {
    console.error("recording usage check", err);
    res.status(500).json({ error: "Could not check plan uses" });
  }
}

router.post("/recording", requireAuth, assertRecordingUsesLeft, (req, res, next) => {
  uploadVideo.single("video")(req, res, (err) => {
    if (err) {
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        error: tooBig ? "Recording is too large. Keep it under 60 seconds." : err.message || "Could not upload recording",
      });
    }
    next();
  });
}, async (req, res) => {
  let videoId = req.file?.videoId || null;
  try {
    if (!videoId) {
      return res.status(400).json({ error: "Recording video is required" });
    }
    let params = req.body?.params;
    if (typeof params === "string") {
      try {
        params = JSON.parse(params);
      } catch {
        params = null;
      }
    }
    if (!params || typeof params !== "object") {
      await deleteRecordingFile(videoId);
      videoId = null;
      return res.status(400).json({ error: "params are required" });
    }

    const mime = String(req.body?.mime || req.file.mimetype || "video/webm").slice(0, 80);
    const durationMs = Math.max(0, Math.min(120_000, Number(req.body?.durationMs) || 0));

    let usageResult;
    try {
      usageResult = await consumeUserUse(req.user.id, "save");
    } catch (err) {
      await deleteRecordingFile(videoId);
      videoId = null;
      if (err.status === 402 || err.status === 404) {
        return res.status(err.status).json({
          error: err.message,
          usage: err.usage,
          user: err.user,
        });
      }
      throw err;
    }

    const title = titleFromParams(params, req.body?.title, "recording");
    const now = new Date();
    const doc = {
      userId: req.user.id,
      kind: "recording",
      title,
      letter: String(params.letter || "").slice(0, 1),
      word: String(params.word || "").slice(0, 10),
      params,
      videoId,
      videoMime: mime,
      durationMs,
      createdAt: now,
      updatedAt: now,
    };
    const db = getDb();
    const result = await db.collection("saves").insertOne(doc);
    const save = fullSave({ ...doc, _id: result.insertedId });
    res.status(201).json({ save, user: usageResult.user, usage: usageResult.usage });
  } catch (err) {
    if (videoId) await deleteRecordingFile(videoId);
    console.error("create recording", err);
    res.status(500).json({ error: "Could not save recording to library" });
  }
});

router.get("/:id/video", requireAuth, async (req, res) => {
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
    if (!doc?.videoId) return res.status(404).json({ error: "No recording on this save" });

    const bucket = recordingsBucket();
    const files = await bucket.find({ _id: new ObjectId(String(doc.videoId)) }).toArray();
    if (!files.length) return res.status(404).json({ error: "Recording file missing" });
    const file = files[0];
    res.setHeader("Content-Type", file.contentType || doc.videoMime || "video/webm");
    res.setHeader("Content-Length", String(file.length));
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${file.filename || "ava-recording.webm"}"`
    );
    bucket.openDownloadStream(file._id).on("error", (err) => {
      console.error("stream recording", err);
      if (!res.headersSent) res.status(500).json({ error: "Could not stream recording" });
      else res.end();
    }).pipe(res);
  } catch (err) {
    console.error("get recording", err);
    res.status(500).json({ error: "Could not load recording" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
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
    // Soft-delete so public embeds immediately stop working
    await db.collection("saves").updateOne(
      { _id: doc._id },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } }
    );
    if (doc.videoId) await deleteRecordingFile(doc.videoId);
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error("delete save", err);
    res.status(500).json({ error: "Could not delete save" });
  }
});

export default router;
