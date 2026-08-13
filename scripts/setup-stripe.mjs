/**
 * Create Ava products/prices + webhook in Stripe.
 * Reads STRIPE_SECRET_KEY from env. Prints IDs only.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const stripe = new Stripe(key);
const APP_URL = (process.env.APP_URL || "https://web-production-da2e1.up.railway.app").replace(/\/$/, "");
const WEBHOOK_URL = `${APP_URL}/api/billing/webhook`;

const CATALOG = [
  {
    slug: "free",
    name: "Ava Free",
    description: "Studio access, library saves, embeds, and 720p / web video.",
    amount: 0,
  },
  {
    slug: "pro",
    name: "Ava Pro",
    description: "Everything in Free, plus 4K/1080p export, higher density, and commercial use.",
    amount: 1900,
  },
  {
    slug: "business",
    name: "Ava Business",
    description: "Everything in Pro, plus team library, brand presets, invoicing, and priority support.",
    amount: 4900,
  },
  {
    slug: "enterprise",
    name: "Ava Enterprise",
    description: "Custom: SSO, admin controls, custom domain embeds, SLA, education/nonprofit.",
    amount: null,
  },
];

async function findProduct(name) {
  const list = await stripe.products.list({ limit: 100, active: true });
  return list.data.find((p) => p.name === name) || null;
}

async function ensurePrice(productId, amount) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  const existing = prices.data.find(
    (p) => p.unit_amount === amount && p.currency === "usd" && p.recurring?.interval === "month"
  );
  if (existing) return existing;
  return stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: "month" },
  });
}

async function main() {
  const out = {};

  for (const item of CATALOG) {
    let product = await findProduct(item.name);
    if (!product) {
      product = await stripe.products.create({
        name: item.name,
        description: item.description,
        metadata: { avaPlan: item.slug },
      });
      console.log(`Created product ${item.slug}: ${product.id}`);
    } else {
      await stripe.products.update(product.id, {
        description: item.description,
        metadata: { avaPlan: item.slug },
      });
      console.log(`Using product ${item.slug}: ${product.id}`);
    }
    out[`STRIPE_PRODUCT_${item.slug.toUpperCase()}`] = product.id;

    if (typeof item.amount === "number" && item.amount > 0) {
      const price = await ensurePrice(product.id, item.amount);
      out[`STRIPE_PRICE_${item.slug.toUpperCase()}`] = price.id;
      console.log(`Price ${item.slug}: ${price.id} ($${(item.amount / 100).toFixed(0)}/mo)`);
    }
  }

  try {
    await stripe.billingPortal.configurations.create({
      business_profile: { headline: "Ava billing" },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          proration_behavior: "create_prorations",
          products: [
            ...(out.STRIPE_PRODUCT_PRO && out.STRIPE_PRICE_PRO
              ? [{ product: out.STRIPE_PRODUCT_PRO, prices: [out.STRIPE_PRICE_PRO] }]
              : []),
            ...(out.STRIPE_PRODUCT_BUSINESS && out.STRIPE_PRICE_BUSINESS
              ? [{ product: out.STRIPE_PRODUCT_BUSINESS, prices: [out.STRIPE_PRICE_BUSINESS] }]
              : []),
          ],
        },
      },
    });
    console.log("Billing portal configuration created.");
  } catch (err) {
    console.log(`Billing portal config: ${err.message}`);
  }

  try {
    const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
    let hook = hooks.data.find((h) => h.url === WEBHOOK_URL);
    if (!hook) {
      hook = await stripe.webhookEndpoints.create({
        url: WEBHOOK_URL,
        enabled_events: [
          "checkout.session.completed",
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
          "invoice.payment_failed",
        ],
        metadata: { app: "ava" },
      });
      console.log(`Created webhook: ${hook.id}`);
      if (hook.secret) out.STRIPE_WEBHOOK_SECRET = hook.secret;
    } else {
      console.log(`Using webhook: ${hook.id}`);
    }
  } catch (err) {
    console.log(`Webhook skipped: ${err.message}`);
    console.log(`Add it in Stripe Dashboard → ${WEBHOOK_URL}`);
  }

  console.log("\nENV_IDS");
  for (const [k, v] of Object.entries(out)) {
    console.log(`${k}=${v}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
