import { apiBase, getStoredToken } from "./auth.js";

async function billingRequest(path, { method = "POST", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function returnTo() {
  try {
    const u = new URL(window.location.href);
    u.search = "";
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return window.location.origin;
  }
}

export async function createCheckout(plan) {
  return billingRequest("/api/billing/checkout", {
    body: { plan, returnTo: returnTo() },
  });
}

export async function createPortal() {
  return billingRequest("/api/billing/portal", {
    body: { returnTo: returnTo() },
  });
}

export async function confirmCheckout(sessionId) {
  return billingRequest("/api/billing/confirm", {
    body: { sessionId },
  });
}
