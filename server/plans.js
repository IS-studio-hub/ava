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
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function usageSnapshot(doc = {}) {
  const plan = normalizePlan(doc.plan);
  const limit = planLimit(plan);
  const period = currentPeriodStart();
  const uses = doc.usesPeriodStart === period ? Number(doc.uses) || 0 : 0;
  return {
    plan,
    uses,
    useLimit: limit,
    usesRemaining: Math.max(0, limit - uses),
    usesPeriodStart: period,
  };
}

export async function ensureUsagePeriod(db, doc) {
  if (!doc?._id) return doc;
  const period = currentPeriodStart();
  if (doc.usesPeriodStart === period) return doc;
  await db.collection("users").updateOne(
    { _id: doc._id },
    { $set: { uses: 0, usesPeriodStart: period, updatedAt: new Date() } }
  );
  return { ...doc, uses: 0, usesPeriodStart: period };
}
