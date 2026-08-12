import { setStoredToken } from "./auth.js";

async function main() {
  const title = document.getElementById("verifyTitle");
  const message = document.getElementById("verifyMessage");
  const actions = document.getElementById("verifyActions");
  const token = new URLSearchParams(window.location.search).get("token");

  if (!token) {
    if (title) title.textContent = "Invalid link";
    if (message) message.textContent = "This verification link is missing a token. Please sign up again.";
    return;
  }

  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Verification failed");

    if (data.token) setStoredToken(data.token);
    if (title) title.textContent = "Email verified";
    if (message) {
      message.textContent = data.user?.name
        ? `Welcome, ${data.user.name}. Your Ava account is ready.`
        : "Your Ava account is ready.";
    }
    if (actions) actions.hidden = false;
  } catch (err) {
    if (title) title.textContent = "Could not verify";
    if (message) message.textContent = err.message || "Please sign up again.";
    if (actions) {
      actions.hidden = false;
      actions.innerHTML = `<a class="btn btn--primary" href="index.html">Back to studio</a>`;
    }
  }
}

main();
