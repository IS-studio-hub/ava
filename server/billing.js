import Stripe from "stripe";
import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { publicUser, requireAuth } from "./auth.js";
import { PLAN_LIMITS } from "./plans.js";

const router = Router();

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

function appUrl() {
  return (process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 8765}`).replace(/\/$/, "");
}

function priceIdFor(plan) {
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO || "";
  if (plan === "business") return process.env.STRIPE_PRICE_BUSINESS || "";
  return "";
}

function planFromPriceId(priceId) {
  if (priceId && priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId && priceId === process.env.STRIPE_PRICE_BUSINESS) return "business";
  return "free";
}

function safeReturnTo(value) {
  const fallback = appUrl();
  try {
    const u = new URL(String(value || fallback));
    const host = u.hostname || "";
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".railway.app") ||
      host.endsWith("github.io")
    ) {
      return `${u.origin}${u.pathname}`.replace(/\/$/, "") || u.origin;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

async function loadUserDoc(userId) {
  const db = getDb();
  return db.collection("users").findOne({ _id: new ObjectId(userId) });
}

async function syncSubscription(userId, subscription, extra = {}) {
  if (!userId || !ObjectId.isValid(String(userId))) return;
  const status = subscription?.status || extra.planStatus || "canceled";
  const active = status === "active" || status === "trialing";
  const priceId = subscription?.items?.data?.[0]?.price?.id || extra.stripePriceId || "";
  const customerId =
    extra.stripeCustomerId ||
    (typeof subscription?.customer === "string"
      ? subscription.customer
      : subscription?.customer?.id) ||
    "";
  const plan = extra.plan || (active ? planFromPriceId(priceId) : "free");
  const db = getDb();
  const $set = {
    plan: active ? plan : "free",
    planStatus: active ? status : plan === "free" ? "active" : status,
    updatedAt: new Date(),
  };
  if (subscription?.id) $set.stripeSubscriptionId = subscription.id;
  if (priceId) $set.stripePriceId = priceId;
  if (customerId) $set.stripeCustomerId = customerId;
  await db.collection("users").updateOne({ _id: new ObjectId(userId) }, { $set });
}

router.get("/plans", (_req, res) => {
  res.json({
    plans: [
      { id: "free", name: "Free", amount: 0, interval: null, uses: PLAN_LIMITS.free },
      { id: "pro", name: "Pro", amount: 1900, interval: "month", uses: PLAN_LIMITS.pro, configured: Boolean(priceIdFor("pro")) },
      { id: "business", name: "Business", amount: 4900, interval: "month", uses: PLAN_LIMITS.business, configured: Boolean(priceIdFor("business")) },
      { id: "enterprise", name: "Enterprise", amount: null, interval: null, uses: PLAN_LIMITS.enterprise },
    ],
  });
});

router.post("/checkout", requireAuth, async (req, res) => {
  try {
    const plan = String(req.body?.plan || "").toLowerCase();
    if (plan === "free") {
      return res.json({ url: `${safeReturnTo(req.body?.returnTo)}/studio.html` });
    }
    if (plan !== "pro" && plan !== "business") {
      return res.status(400).json({ error: "Unknown plan" });
    }
    const priceId = priceIdFor(plan);
    if (!priceId) {
      return res.status(503).json({ error: "This plan is not configured in Stripe yet." });
    }

    const doc = await loadUserDoc(req.user.id);
    if (!doc) return res.status(401).json({ error: "User not found" });

    const stripe = stripeClient();
    let customerId = doc.stripeCustomerId || "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: doc.email,
        name: doc.name,
        metadata: { avaUserId: req.user.id },
      });
      customerId = customer.id;
      const db = getDb();
      await db.collection("users").updateOne(
        { _id: doc._id },
        { $set: { stripeCustomerId: customerId, updatedAt: new Date() } }
      );
    }

    const returnTo = safeReturnTo(req.body?.returnTo);
    const pageReturn = returnTo.endsWith(".html");
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: req.user.id,
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: pageReturn
        ? `${returnTo}?billing=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`
        : `${returnTo}/?billing=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: pageReturn ? `${returnTo}` : `${returnTo}/#plans`,
      metadata: { avaUserId: req.user.id, plan },
      subscription_data: {
        metadata: { avaUserId: req.user.id, plan },
      },
    });

    res.json({ url: session.url, id: session.id });
  } catch (err) {
    console.error("billing checkout", err);
    res.status(500).json({ error: err.message || "Could not start checkout" });
  }
});

router.post("/confirm", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ error: "Missing checkout session" });
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    const userId = session.metadata?.avaUserId || session.client_reference_id;
    if (userId !== req.user.id) {
      return res.status(403).json({ error: "This checkout does not belong to your account." });
    }
    const customerId = typeof session.customer === "string" ? session.customer : "";
    let subscription = session.subscription;
    if (typeof subscription === "string") {
      subscription = await stripe.subscriptions.retrieve(subscription);
    }
    if (subscription) {
      await syncSubscription(userId, subscription, {
        plan: session.metadata?.plan,
        stripeCustomerId: customerId,
      });
    }
    const doc = await loadUserDoc(req.user.id);
    res.json({
      ok: true,
      user: publicUser(doc),
    });
  } catch (err) {
    console.error("billing confirm", err);
    res.status(500).json({ error: err.message || "Could not confirm payment" });
  }
});

router.post("/switch", requireAuth, async (req, res) => {
  try {
    const plan = String(req.body?.plan || "").toLowerCase();
    if (!["free", "pro", "business"].includes(plan)) {
      return res.status(400).json({ error: "Choose Free, Pro, or Business" });
    }

    const doc = await loadUserDoc(req.user.id);
    if (!doc) return res.status(401).json({ error: "User not found" });
    const current = doc.plan || "free";
    if (current === plan && (plan === "free" || doc.planStatus === "active" || doc.planStatus === "trialing")) {
      return res.json({ user: publicUser(doc), switched: true });
    }

    const db = getDb();

    if (plan === "free") {
      if (doc.stripeSubscriptionId) {
        try {
          await stripeClient().subscriptions.cancel(doc.stripeSubscriptionId);
        } catch (err) {
          if (err?.code !== "resource_missing") throw err;
        }
      }
      await db.collection("users").updateOne(
        { _id: doc._id },
        {
          $set: {
            plan: "free",
            planStatus: "active",
            stripeSubscriptionId: "",
            stripePriceId: "",
            updatedAt: new Date(),
          },
        }
      );
      const updated = await loadUserDoc(req.user.id);
      return res.json({ user: publicUser(updated), switched: true });
    }

    const priceId = priceIdFor(plan);
    if (!priceId) {
      return res.status(503).json({ error: "This plan is not configured in Stripe yet." });
    }

    if (doc.stripeSubscriptionId && doc.stripeCustomerId) {
      try {
        const stripe = stripeClient();
        const sub = await stripe.subscriptions.retrieve(doc.stripeSubscriptionId);
        const itemId = sub.items?.data?.[0]?.id;
        if (itemId && ["active", "trialing", "past_due"].includes(sub.status)) {
          const updatedSub = await stripe.subscriptions.update(doc.stripeSubscriptionId, {
            items: [{ id: itemId, price: priceId }],
            proration_behavior: "create_prorations",
            metadata: { avaUserId: req.user.id, plan },
          });
          await syncSubscription(req.user.id, updatedSub, {
            plan,
            stripeCustomerId: doc.stripeCustomerId,
          });
          const updated = await loadUserDoc(req.user.id);
          return res.json({ user: publicUser(updated), switched: true });
        }
      } catch (err) {
        console.warn("plan switch update failed, using checkout", err.message);
      }
    }

    const stripe = stripeClient();
    let customerId = doc.stripeCustomerId || "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: doc.email,
        name: doc.name,
        metadata: { avaUserId: req.user.id },
      });
      customerId = customer.id;
      await db.collection("users").updateOne(
        { _id: doc._id },
        { $set: { stripeCustomerId: customerId, updatedAt: new Date() } }
      );
    }

    const returnTo = safeReturnTo(req.body?.returnTo);
    const pageReturn = returnTo.endsWith(".html");
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: req.user.id,
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: pageReturn
        ? `${returnTo}?billing=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`
        : `${returnTo}/?billing=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: pageReturn ? `${returnTo}` : `${returnTo}/#plans`,
      metadata: { avaUserId: req.user.id, plan },
      subscription_data: {
        metadata: { avaUserId: req.user.id, plan },
      },
    });
    res.json({ url: session.url, id: session.id });
  } catch (err) {
    console.error("billing switch", err);
    res.status(500).json({ error: err.message || "Could not switch plan" });
  }
});

router.post("/portal", requireAuth, async (req, res) => {
  try {
    const doc = await loadUserDoc(req.user.id);
    if (!doc?.stripeCustomerId) {
      return res.status(400).json({ error: "No billing account yet. Choose a paid plan first." });
    }
    const stripe = stripeClient();
    const returnTo = safeReturnTo(req.body?.returnTo);
    const portal = await stripe.billingPortal.sessions.create({
      customer: doc.stripeCustomerId,
      return_url: returnTo.endsWith(".html") ? returnTo : `${returnTo}/#plans`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error("billing portal", err);
    res.status(500).json({ error: err.message || "Could not open billing portal" });
  }
});

export async function billingWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return res.status(500).json({ error: "Webhook is not configured" });
  }
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      secret
    );
  } catch (err) {
    console.error("billing webhook signature", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    const stripe = stripeClient();
    const db = getDb();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.avaUserId || session.client_reference_id;
      const customerId = typeof session.customer === "string" ? session.customer : "";
      if (userId && ObjectId.isValid(userId) && customerId) {
        await db.collection("users").updateOne(
          { _id: new ObjectId(userId) },
          { $set: { stripeCustomerId: customerId, updatedAt: new Date() } }
        );
      }
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
        await syncSubscription(userId || subscription.metadata?.avaUserId, subscription, {
          plan: session.metadata?.plan,
          stripeCustomerId: customerId,
        });
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      let userId = subscription.metadata?.avaUserId;
      if (!userId) {
        const customerId = typeof subscription.customer === "string" ? subscription.customer : "";
        if (customerId) {
          const user = await db.collection("users").findOne({ stripeCustomerId: customerId });
          if (user) userId = String(user._id);
        }
      }
      await syncSubscription(userId, subscription);
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : "";
      if (customerId) {
        await db.collection("users").updateOne(
          { stripeCustomerId: customerId },
          { $set: { planStatus: "past_due", updatedAt: new Date() } }
        );
      }
    }
  } catch (err) {
    console.error("billing webhook handler", err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }

  res.json({ received: true });
}

export default router;
