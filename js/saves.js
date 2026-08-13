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
    if (res.status === 401) setStoredToken("");
    throw err;
  }
  return data;
}

export async function listSaves() {
  const data = await request("/api/saves");
  return data.saves || [];
}

export async function createSave(params, title) {
  const data = await request("/api/saves", {
    method: "POST",
    body: { params, title },
  });
  return data;
}

export async function createRecordingSave(params, blob, {
  title,
  durationMs,
  mime,
} = {}) {
  const form = new FormData();
  const ext = String(mime || blob.type || "").includes("mp4") ? "mp4" : "webm";
  form.append("video", blob, `recording.${ext}`);
  form.append("params", JSON.stringify(params || {}));
  if (title) form.append("title", title);
  form.append("durationMs", String(durationMs || 0));
  form.append("mime", mime || blob.type || "video/webm");

  const headers = { Accept: "application/json" };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase()}/api/saves/recording`, {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
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
    if (res.status === 401) setStoredToken("");
    throw err;
  }
  return data;
}

export async function fetchRecordingBlob(id) {
  const headers = { Accept: "*/*" };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}/api/saves/${encodeURIComponent(id)}/video`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 401) setStoredToken("");
    const err = new Error(data?.error || `Could not load recording (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res.blob();
}

export async function deleteSave(id) {
  return request(`/api/saves/${id}`, { method: "DELETE" });
}

export async function getSave(id) {
  const data = await request(`/api/saves/${id}`);
  return data.save;
}

/** Public — fails when deleted / missing */
export async function getPublicSave(id) {
  const res = await fetch(`${apiBase()}/api/saves/public/${id}`, {
    headers: { Accept: "application/json" },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || "Not found");
    err.status = res.status;
    err.removed = Boolean(data?.removed);
    throw err;
  }
  return data;
}
