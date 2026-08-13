import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { sendVerificationEmail } from "./mail.js";
import { currentPeriodStart, ensureUsagePeriod, usageSnapshot } from "./plans.js";

const router = Router();
const COOKIE = "ava_token";
const TOKEN_DAYS = 14;
const VERIFY_HOURS = 24;

function jwtSecret() {
  return process.env.JWT_SECRET || "dev-only-secret";
}

export function publicUser(doc) {
  const usage = usageSnapshot(doc || {});
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    plan: usage.plan,
    planStatus: doc.planStatus || "active",
    uses: usage.uses,
    useLimit: usage.useLimit,
    usesRemaining: usage.usesRemaining,
    createdAt: doc.createdAt,
  };
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: `${TOKEN_DAYS}d` });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function readToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.[COOKIE] || null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: "Not signed in" });
    const payload = jwt.verify(token, jwtSecret());
    const db = getDb();
    const user = await db.collection("users").findOne({ _id: new ObjectId(payload.sub) });
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = publicUser(user);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

router.post("/signup", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const db = getDb();
    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VERIFY_HOURS * 60 * 60 * 1000);

    // Replace any previous pending signup for this email
    await db.collection("pending_users").deleteMany({ email });
    await db.collection("pending_users").insertOne({
      name,
      email,
      passwordHash,
      token,
      createdAt: now,
      expiresAt,
    });

    const mail = await sendVerificationEmail({ to: email, name, token });

    if (!mail.sent) {
      await db.collection("pending_users").deleteOne({ token });
      return res.status(503).json({
        error: mail.reason
          ? `Could not send verification email: ${mail.reason}`
          : "Could not send verification email. Check email provider settings in .env.",
      });
    }

    res.status(201).json({
      pending: true,
      message: `Check ${email} — click the verification button to create your account.`,
    });
  } catch (err) {
    console.error("signup", err);
    res.status(500).json({ error: "Could not start signup" });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const token = String(req.body?.token || req.query?.token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing verification token" });

    const db = getDb();
    const pending = await db.collection("pending_users").findOne({ token });
    if (!pending) {
      return res.status(400).json({ error: "Invalid or already used verification link" });
    }
    if (pending.expiresAt && new Date(pending.expiresAt) < new Date()) {
      await db.collection("pending_users").deleteOne({ _id: pending._id });
      return res.status(400).json({ error: "Verification link expired. Please sign up again." });
    }

    const existing = await db.collection("users").findOne({ email: pending.email });
    if (existing) {
      await db.collection("pending_users").deleteOne({ _id: pending._id });
      return res.status(409).json({ error: "Email already registered. Please sign in." });
    }

    const now = new Date();
    const doc = {
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
      plan: "free",
      planStatus: "active",
      uses: 0,
      usesPeriodStart: currentPeriodStart(now),
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection("users").insertOne(doc);
    await db.collection("pending_users").deleteOne({ _id: pending._id });

    const user = publicUser({ ...doc, _id: result.insertedId });
    const session = signToken(user.id);
    setAuthCookie(res, session);
    res.status(201).json({ user, token: session, verified: true });
  } catch (err) {
    console.error("verify", err);
    res.status(500).json({ error: "Could not verify account" });
  }
});

router.post("/signin", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const db = getDb();
    const doc = await db.collection("users").findOne({ email });
    if (!doc) {
      const pending = await db.collection("pending_users").findOne({ email });
      if (pending) {
        return res.status(403).json({
          error: "Please verify your email first. Check your inbox for the Ava verification link.",
          pending: true,
        });
      }
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, doc.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const user = publicUser(doc);
    const token = signToken(user.id);
    setAuthCookie(res, token);
    res.json({ user, token });
  } catch (err) {
    console.error("signin", err);
    res.status(500).json({ error: "Could not sign in" });
  }
});

router.post("/signout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    let doc = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!doc) return res.status(401).json({ error: "User not found" });
    doc = await ensureUsagePeriod(db, doc);
    res.json({ user: publicUser(doc) });
  } catch (err) {
    console.error("me", err);
    res.status(500).json({ error: "Could not load account" });
  }
});

router.patch("/me", requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "Name is required" });

    const db = getDb();
    await db.collection("users").updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { name, updatedAt: new Date() } }
    );
    const doc = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    res.json({ user: publicUser(doc) });
  } catch (err) {
    console.error("update profile", err);
    res.status(500).json({ error: "Could not update profile" });
  }
});

router.post("/password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const nextPassword = String(req.body?.password || "");
    if (!currentPassword) return res.status(400).json({ error: "Current password is required" });
    if (nextPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const db = getDb();
    const doc = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!doc) return res.status(404).json({ error: "User not found" });

    const ok = await bcrypt.compare(currentPassword, doc.passwordHash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const passwordHash = await bcrypt.hash(nextPassword, 10);
    await db.collection("users").updateOne(
      { _id: doc._id },
      { $set: { passwordHash, updatedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("update password", err);
    res.status(500).json({ error: "Could not update password" });
  }
});

export default router;
