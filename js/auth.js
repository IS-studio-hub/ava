/**
 * Client auth helpers — talks to /api/auth (MongoDB `ava.users`).
 */

const TOKEN_KEY = "ava.auth.token";

/** Live API origin when the UI is hosted on GitHub Pages (static). */
const LIVE_API_ORIGIN = "https://web-production-da2e1.up.railway.app";

export function apiBase() {
  if (typeof window !== "undefined" && window.AVA_API_ORIGIN) {
    return String(window.AVA_API_ORIGIN).replace(/\/$/, "");
  }
  if (typeof window === "undefined") return LIVE_API_ORIGIN;
  const host = window.location.hostname || "";
  if (!host || host === "localhost" || host === "127.0.0.1") return "";
  if (host.endsWith(".railway.app")) return "";
  return LIVE_API_ORIGIN;
}

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

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

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    let message = data?.error || `Request failed (${res.status})`;
    if (res.status === 405) {
      message =
        "This page cannot talk to the Ava API. Open https://web-production-da2e1.up.railway.app or http://127.0.0.1:8765";
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function signup({ name, email, password }) {
  const data = await request("/api/auth/signup", {
    method: "POST",
    body: { name, email, password },
  });
  // Account is created only after email verification
  return data;
}

export async function verifyEmail(token) {
  const data = await request("/api/auth/verify", {
    method: "POST",
    body: { token },
  });
  if (data.token) setStoredToken(data.token);
  return data.user;
}

export async function signin({ email, password }) {
  const data = await request("/api/auth/signin", {
    method: "POST",
    body: { email, password },
  });
  if (data.token) setStoredToken(data.token);
  return data.user;
}

export async function signout() {
  try {
    await request("/api/auth/signout", { method: "POST" });
  } finally {
    setStoredToken("");
  }
}

export async function fetchMe() {
  try {
    const data = await request("/api/auth/me");
    return data.user;
  } catch (err) {
    if (err.status === 401) setStoredToken("");
    return null;
  }
}

export async function updateProfile({ name }) {
  const data = await request("/api/auth/me", {
    method: "PATCH",
    body: { name },
  });
  return data.user;
}

export async function updatePassword({ currentPassword, password }) {
  return request("/api/auth/password", {
    method: "POST",
    body: { currentPassword, password },
  });
}
