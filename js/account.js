import {
  fetchMe,
  signin,
  signout,
  signup,
  updatePassword,
  updateProfile,
} from "./auth.js";
import { confirmCheckout, createCheckout, createPortal } from "./billing.js";

const $ = (sel) => document.querySelector(sel);

let currentUser = null;
let authMode = "signin";

function planLabel(plan) {
  if (plan === "pro") return "Pro";
  if (plan === "business") return "Business";
  if (plan === "enterprise") return "Enterprise";
  return "Free";
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function setStatus(text, ok = false) {
  const el = $("#accountStatus");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "#b7d7b0" : "";
}

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

function renderUser() {
  const gate = $("#accountGate");
  const grid = $("#accountGrid");
  const btn = $("#btnAccountSignIn");
  const lead = $("#accountLead");

  if (!currentUser) {
    if (gate) gate.hidden = false;
    if (grid) grid.hidden = true;
    if (lead) lead.textContent = "Sign in to manage your profile, plan, and password.";
    if (btn) {
      btn.hidden = false;
      btn.textContent = "Sign in";
      btn.onclick = () => openAuth("signin");
    }
    return;
  }

  if (gate) gate.hidden = true;
  if (grid) grid.hidden = false;
  if (lead) lead.textContent = "Your profile, plan, and password.";
  if (btn) {
    btn.hidden = false;
    btn.textContent = "Sign out";
    btn.onclick = async () => {
      await signout();
      currentUser = null;
      renderUser();
      setStatus("Signed out.");
    };
  }

  if ($("#accountName")) $("#accountName").value = currentUser.name || "";
  if ($("#accountEmail")) $("#accountEmail").value = currentUser.email || "";
  if ($("#accountSince")) {
    $("#accountSince").textContent = currentUser.createdAt
      ? `Member since ${formatDate(currentUser.createdAt)}`
      : "";
  }

  const plan = currentUser.plan || "free";
  const status = currentUser.planStatus || "active";
  if ($("#accountPlan")) $("#accountPlan").textContent = planLabel(plan);
  if ($("#accountPlanHelp")) {
    $("#accountPlanHelp").textContent =
      plan === "free"
        ? "You're on Free. Upgrade anytime for 4K export and commercial use."
        : `Status: ${status}. Manage billing to change or cancel your plan.`;
  }
  const upgrade = $("#btnUpgradePro");
  const billing = $("#btnManageBilling");
  if (upgrade) upgrade.hidden = plan === "pro" || plan === "business" || plan === "enterprise";
  if (billing) billing.hidden = plan === "free";
}

async function startCheckout(plan) {
  setStatus("Opening Stripe checkout…");
  try {
    const data = await createCheckout(plan);
    if (data?.url) window.location.href = data.url;
  } catch (err) {
    setStatus(err.message || "Could not start checkout.");
  }
}

async function startPortal() {
  setStatus("Opening billing portal…");
  try {
    const data = await createPortal();
    if (data?.url) window.location.href = data.url;
  } catch (err) {
    setStatus(err.message || "Could not open billing portal.");
  }
}

function bindForms() {
  $("#profileForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#btnSaveProfile");
    if (btn) btn.disabled = true;
    try {
      currentUser = await updateProfile({ name: $("#accountName")?.value || "" });
      renderUser();
      setStatus("Name saved.", true);
    } catch (err) {
      setStatus(err.message || "Could not save name.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#passwordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#btnSavePassword");
    if (btn) btn.disabled = true;
    try {
      await updatePassword({
        currentPassword: $("#currentPassword")?.value || "",
        password: $("#newPassword")?.value || "",
      });
      $("#passwordForm")?.reset();
      setStatus("Password updated.", true);
    } catch (err) {
      setStatus(err.message || "Could not update password.");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#btnUpgradePro")?.addEventListener("click", () => startCheckout("pro"));
  $("#btnManageBilling")?.addEventListener("click", () => startPortal());
  $("#btnAccountSignOut")?.addEventListener("click", async () => {
    await signout();
    currentUser = null;
    renderUser();
    setStatus("Signed out.");
  });
}

function bindAuth() {
  $("#tabSignin")?.addEventListener("click", () => setAuthMode("signin"));
  $("#tabSignup")?.addEventListener("click", () => setAuthMode("signup"));
  $("#authCancel")?.addEventListener("click", () => $("#authDialog")?.close?.());

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
        renderUser();
        setStatus(`Signed in as ${currentUser.email}.`, true);
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

async function main() {
  bindAuth();
  bindForms();
  currentUser = await fetchMe();

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
    setStatus(
      currentUser?.plan && currentUser.plan !== "free"
        ? `You're on ${planLabel(currentUser.plan)}.`
        : "Payment received. Refresh if your plan still says Free.",
      true
    );
    history.replaceState(null, "", window.location.pathname);
  }

  renderUser();
  if (!currentUser) openAuth("signin");
}

main();
