export const PLAN_LIMITS = {
  free: 5,
  pro: 10,
  business: 20,
  enterprise: 1000,
};

export function normalizePlan(plan) {
  const id = String(plan || "free").toLowerCase();
  if (id === "pro" || id === "business" || id === "enterprise") return id;
  return "free";
}

export function planLimit(plan) {
  return PLAN_LIMITS[normalizePlan(plan)] ?? PLAN_LIMITS.free;
}

export function currentPeriodStart(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function usageSnapshot(doc = {}) {
  const plan = normalizePlan(doc.plan);
  const limit = planLimit(plan);
  if (plan === "free") {
    const uses = Number.isFinite(Number(doc.lifetimeUses))
      ? Number(doc.lifetimeUses)
      : Number(doc.uses) || 0;
    return {
      plan,
      uses,
      useLimit: limit,
      usesRemaining: Math.max(0, limit - uses),
      usesPeriodStart: "lifetime",
      usesReset: "lifetime",
    };
  }
  const period = currentPeriodStart();
  const uses = doc.usesPeriodStart === period ? Number(doc.uses) || 0 : 0;
  return {
    plan,
    uses,
    useLimit: limit,
    usesRemaining: Math.max(0, limit - uses),
    usesPeriodStart: period,
    usesReset: "month",
  };
}

export async function ensureUsagePeriod(db, doc) {
  if (!doc?._id) return doc;
  const plan = normalizePlan(doc.plan);
  if (plan === "free") {
    const lifetime = Number(doc.lifetimeUses);
    if (Number.isFinite(lifetime) && doc.usesPeriodStart === "lifetime") return doc;
    const uses = Number.isFinite(lifetime) ? lifetime : Number(doc.uses) || 0;
    await db.collection("users").updateOne(
      { _id: doc._id },
      { $set: { lifetimeUses: uses, uses, usesPeriodStart: "lifetime", updatedAt: new Date() } }
    );
    return { ...doc, lifetimeUses: uses, uses, usesPeriodStart: "lifetime" };
  }
  const period = currentPeriodStart();
  if (doc.usesPeriodStart === period) return doc;
  await db.collection("users").updateOne(
    { _id: doc._id },
    { $set: { uses: 0, usesPeriodStart: period, updatedAt: new Date() } }
  );
  return { ...doc, uses: 0, usesPeriodStart: period };
}
