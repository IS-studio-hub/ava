import { apiBase, getStoredToken, setStoredToken } from "./auth.js";

async function request(path, { method = "GET", body } = {}) {
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
    if (res.status === 401) setStoredToken("");
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function fetchUsage() {
  return request("/api/usage");
}

export async function consumeUsage(kind) {
  return request("/api/usage/consume", {
    method: "POST",
    body: { kind },
  });
}

export function usageLabel(user) {
  if (!user) return "";
  const used = Number(user.uses) || 0;
  const limit = Number(user.useLimit) || 0;
  const plan = user.plan === "pro" ? "Pro" : user.plan === "business" ? "Business" : "Free";
  return `${plan} · ${used} / ${limit} uses this month`;
}
