import { fetchMe, signin, signout, signup } from "./auth.js";
import { LetterFieldEngine } from "./engine.js";

const $ = (sel) => document.querySelector(sel);

let currentUser = null;
let authMode = "signin";

function setAuthMode(next) {
  authMode = next;
  const signupMode = authMode === "signup";
  $("#tabSignin")?.classList.toggle("is-active", !signupMode);
  $("#tabSignup")?.classList.toggle("is-active", signupMode);
  const nameField = $("#authNameField");
  if (nameField) nameField.hidden = !signupMode;
  if ($("#authTitle")) $("#authTitle").textContent = signupMode ? "Create account" : "Sign in";
  if ($("#authHelp")) {
    $("#authHelp").textContent = signupMode
      ? "We’ll email you a verification link. Your account is created only after you click it."
      : "Sign in to your Ava account.";
  }
  if ($("#authSubmit")) $("#authSubmit").textContent = signupMode ? "Sign up" : "Sign in";
  const password = $("#authPassword");
  if (password) password.autocomplete = signupMode ? "new-password" : "current-password";
  const errorEl = $("#authError");
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    errorEl.style.color = "";
  }
}

function openAuth(mode = "signin") {
  setAuthMode(mode);
  $("#authDialog")?.showModal?.();
}

function renderAuthBar() {
  const bar = $("#homeAuthBar");
  if (!bar) return;
  if (currentUser) {
    bar.innerHTML = `
      <a class="btn btn--ghost btn--small" href="studio.html">Studio</a>
      <a class="btn btn--ghost btn--small" href="library.html">Library</a>
      <span class="stage__auth-user" title="${currentUser.email}">${currentUser.name || currentUser.email}</span>
      <button type="button" class="btn btn--ghost btn--small" id="btnHomeSignOut">Sign out</button>
    `;
    $("#btnHomeSignOut")?.addEventListener("click", async () => {
      await signout();
      currentUser = null;
      renderAuthBar();
    });
    return;
  }
  bar.innerHTML = `
    <button type="button" class="btn btn--ghost btn--small" id="btnHomeSignIn">Sign in</button>
    <button type="button" class="btn btn--primary btn--small" id="btnHomeSignUp">Get started</button>
  `;
  $("#btnHomeSignIn")?.addEventListener("click", () => openAuth("signin"));
  $("#btnHomeSignUp")?.addEventListener("click", () => openAuth("signup"));
}

function bindAuth() {
  $("#tabSignin")?.addEventListener("click", () => setAuthMode("signin"));
  $("#tabSignup")?.addEventListener("click", () => setAuthMode("signup"));
  $("#authCancel")?.addEventListener("click", () => $("#authDialog")?.close?.());
  $("#btnHeroStart")?.addEventListener("click", () => openAuth("signup"));
  document.querySelectorAll("[data-auth]").forEach((btn) => {
    btn.addEventListener("click", () => openAuth(btn.getAttribute("data-auth") || "signup"));
  });

  $("#authForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#authError");
    const submit = $("#authSubmit");
    const form = $("#authForm");
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
    if (submit) submit.disabled = true;
    try {
      const payload = {
        name: $("#authName")?.value || "",
        email: $("#authEmail")?.value || "",
        password: $("#authPassword")?.value || "",
      };
      if (authMode === "signup") {
        const result = await signup(payload);
        form?.reset();
        setAuthMode("signin");
        if (errorEl) {
          errorEl.style.color = "#b7d7b0";
          errorEl.textContent =
            result.message ||
            "Check your email and click the verification button to create your account.";
          errorEl.hidden = false;
        }
      } else {
        currentUser = await signin(payload);
        $("#authDialog")?.close?.();
        form?.reset();
        renderAuthBar();
      }
    } catch (err) {
      if (errorEl) {
        errorEl.style.color = "";
        errorEl.textContent = err.message || "Something went wrong";
        errorEl.hidden = false;
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function startPreview() {
  const canvas = $("#homeField");
  if (!canvas) return;
  const engine = new LetterFieldEngine(canvas, {
    letter: "A",
    word: "",
    theme: "dark",
    bgColor: "#000000",
    inkColor: "#ffffff",
    density: 36,
    glyphSize: 0.52,
    shapeAmount: 1,
    shapeSize: 2.05,
    shapeWeight: 700,
    shapeSoftness: 0.32,
    animBubble: true,
    bubbleAmount: 0.95,
    bubbleRadius: 0.34,
    bubbleSpeed: 0.45,
    bubbleScale: 1.05,
    animWave: true,
    waveAmount: 0.22,
    waveSpeed: 0.7,
    waveScale: 2.1,
    speed: 0.55,
  });
  engine.start();

  const frame = canvas.parentElement;
  const toNorm = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width - 0.5);
    const y = ((clientY - r.top) / r.height - 0.5);
    return { x, y };
  };
  frame?.addEventListener("pointermove", (e) => {
    const { x, y } = toNorm(e.clientX, e.clientY);
    engine.setPointer(x, y, true);
  });
  frame?.addEventListener("pointerleave", () => {
    engine.setPointer(0, 0, false);
  });
}

async function main() {
  const year = $("#homeYear");
  if (year) year.textContent = String(new Date().getFullYear());
  bindAuth();
  currentUser = await fetchMe();
  renderAuthBar();
  startPreview();
}

main();
