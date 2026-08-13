import { fetchMe, signin, signout, signup } from "./auth.js";
import { confirmCheckout, createCheckout, createPortal } from "./billing.js";
import { LetterFieldEngine } from "./engine.js";
import {
  bindCanvasKeyboard,
  bindMobileNav,
  bindTabs,
  enhanceDialog,
  showFieldError,
} from "./a11y.js";

const PENDING_PLAN_KEY = "ava.pendingPlan";

const $ = (sel) => document.querySelector(sel);

let currentUser = null;
let authMode = "signin";

function setAuthMode(next) {
  authMode = next;
  const signupMode = authMode === "signup";
  $("#tabSignin")?.classList.toggle("is-active", !signupMode);
  $("#tabSignup")?.classList.toggle("is-active", signupMode);
  $("#tabSignin")?.setAttribute("aria-selected", signupMode ? "false" : "true");
  $("#tabSignup")?.setAttribute("aria-selected", signupMode ? "true" : "false");
  if ($("#tabSignin")) $("#tabSignin").tabIndex = signupMode ? -1 : 0;
  if ($("#tabSignup")) $("#tabSignup").tabIndex = signupMode ? 0 : -1;
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

function setBillingStatus(text) {
  const el = $("#billingStatus");
  if (el) el.textContent = text || "";
}

function planLabel(plan) {
  if (plan === "pro") return "Pro";
  if (plan === "business") return "Business";
  if (plan === "enterprise") return "Enterprise";
  return "Free";
}

function renderPlanButtons() {
  const plan = currentUser?.plan || "free";
  document.querySelectorAll("[data-plan-card]").forEach((card) => {
    const id = card.getAttribute("data-plan-card");
    const btn = card.querySelector("[data-plan]");
    if (!btn) return;
    if (id === plan) {
      btn.textContent = "Current plan";
      btn.disabled = true;
    } else if (id === "free") {
      btn.textContent = currentUser ? "Open studio" : "Get started";
      btn.disabled = false;
    } else if (id === "pro") {
      btn.textContent = plan === "business" ? "Switch to Pro" : "Start Pro";
      btn.disabled = false;
    } else if (id === "business") {
      btn.textContent = plan === "pro" ? "Upgrade to Business" : "Start Business";
      btn.disabled = false;
    }
  });
}

async function startCheckout(plan) {
  setBillingStatus("");
  if (plan === "enterprise") return;
  if (plan === "free") {
    if (!currentUser) {
      openAuth("signup");
      return;
    }
    window.location.href = "studio.html";
    return;
  }
  if (!currentUser) {
    try {
      sessionStorage.setItem(PENDING_PLAN_KEY, plan);
    } catch {
      /* ignore */
    }
    openAuth("signin");
    setBillingStatus("Sign in (or create an account) to subscribe.");
    return;
  }
  try {
    setBillingStatus("Opening Stripe checkout…");
    const data = await createCheckout(plan);
    if (data?.url) window.location.href = data.url;
  } catch (err) {
    setBillingStatus(err.message || "Could not start checkout.");
  }
}

async function startPortal() {
  if (!currentUser) {
    openAuth("signin");
    return;
  }
  try {
    setBillingStatus("Opening billing portal…");
    const data = await createPortal();
    if (data?.url) window.location.href = data.url;
  } catch (err) {
    setBillingStatus(err.message || "Could not open billing portal.");
  }
}

function renderAuthBar() {
  const bar = $("#homeAuthBar");
  if (!bar) return;
  if (currentUser) {
    const plan = planLabel(currentUser.plan);
    bar.innerHTML = `
      <a class="btn btn--ghost btn--small" href="studio.html">Studio</a>
      <a class="btn btn--ghost btn--small" href="library.html">Library</a>
      <a class="btn btn--ghost btn--small" href="account.html" title="${currentUser.email}">${currentUser.name || currentUser.email} · ${plan}</a>
      <button type="button" class="btn btn--ghost btn--small" id="btnHomeSignOut">Sign out</button>
    `;
    $("#btnHomeSignOut")?.addEventListener("click", async () => {
      await signout();
      currentUser = null;
      renderAuthBar();
      renderPlanButtons();
    });
    renderPlanButtons();
    return;
  }
  bar.innerHTML = `
    <button type="button" class="btn btn--ghost btn--small" id="btnHomeSignIn">Sign in</button>
    <button type="button" class="btn btn--primary btn--small" id="btnHomeSignUp">Get started</button>
  `;
  $("#btnHomeSignIn")?.addEventListener("click", () => openAuth("signin"));
  $("#btnHomeSignUp")?.addEventListener("click", () => openAuth("signup"));
  renderPlanButtons();
}

function bindAuth() {
  bindTabs($(".auth-tabs"), {
    onChange(tab) {
      setAuthMode(tab.getAttribute("data-mode") || "signin");
    },
  });
  enhanceDialog($("#authDialog"));
  $("#authCancel")?.addEventListener("click", () => $("#authDialog")?.close?.());
  $("#btnHeroStart")?.addEventListener("click", () => openAuth("signup"));
  document.querySelectorAll("[data-auth]").forEach((btn) => {
    btn.addEventListener("click", () => openAuth(btn.getAttribute("data-auth") || "signup"));
  });
  document.querySelectorAll("[data-plan]").forEach((btn) => {
    btn.addEventListener("click", () => startCheckout(btn.getAttribute("data-plan") || "free"));
  });

  $("#authForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#authError");
    const submit = $("#authSubmit");
    const form = $("#authForm");
    showFieldError(errorEl, [$("#authEmail"), $("#authPassword")], "");
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
        showFieldError(
          errorEl,
          [$("#authEmail"), $("#authPassword")],
          result.message ||
            "Check your email and click the verification button to create your account.",
          { ok: true }
        );
      } else {
        currentUser = await signin(payload);
        $("#authDialog")?.close?.();
        form?.reset();
        renderAuthBar();
        let pending = "";
        try {
          pending = sessionStorage.getItem(PENDING_PLAN_KEY) || "";
          sessionStorage.removeItem(PENDING_PLAN_KEY);
        } catch {
          pending = "";
        }
        if (pending === "pro" || pending === "business") {
          await startCheckout(pending);
        }
      }
    } catch (err) {
      showFieldError(errorEl, [$("#authEmail"), $("#authPassword")], err.message || "Something went wrong");
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
  bindCanvasKeyboard(canvas, engine);
}

async function main() {
  const year = $("#homeYear");
  if (year) year.textContent = String(new Date().getFullYear());
  bindAuth();
  bindMobileNav({
    toggle: $("#btnHomeMenu"),
    nav: $("#homeNavLinks"),
    wrap: $("#homeNav"),
  });
  currentUser = await fetchMe();
  renderAuthBar();
  startPreview();
  const params = new URLSearchParams(window.location.search);
  if (params.get("billing") === "success") {
    const sessionId = params.get("session_id") || "";
    if (sessionId && currentUser) {
      try {
        const confirmed = await confirmCheckout(sessionId);
        if (confirmed?.user) currentUser = { ...currentUser, ...confirmed.user };
      } catch (err) {
        console.warn("billing confirm", err);
      }
    }
    currentUser = (await fetchMe()) || currentUser;
    renderAuthBar();
    setBillingStatus(
      currentUser?.plan && currentUser.plan !== "free"
        ? `You're on ${planLabel(currentUser.plan)}. Welcome back.`
        : "Payment received. Your plan will update in a few seconds — refresh if it still says Free."
    );
    history.replaceState(null, "", window.location.pathname + window.location.hash);
  }
}

main();
