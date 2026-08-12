/**
 * Client auth helpers — talks to /api/auth (MongoDB `ava.users`).
 */

const TOKEN_KEY = "ava.auth.token";

function apiBase() {
  return "";
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
    const err = new Error(data?.error || `Request failed (${res.status})`);
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
