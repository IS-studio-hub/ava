import { LetterFieldEngine } from "./engine.js";
import { fetchMe, signin, signout, signup } from "./auth.js";
import { createSave, getSave } from "./saves.js";

const STORAGE_KEY = "ava.letterField.lastParams";
const PRESETS = "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z".split(" ");

function saveParams(params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    /* private mode / quota */
  }
}

function loadStoredParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const merged = { ...LetterFieldEngine.defaults(), ...parsed };
    merged.letter = String(merged.letter || "G").slice(0, 1).toUpperCase();
    merged.word = String(merged.word || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 10);
    if (Number.isFinite(merged.wordMerge) && merged.wordMerge > 0 && merged.wordMerge <= 1) {
      merged.wordMerge = Math.round(merged.wordMerge * 100);
    }
    if (Number.isFinite(merged.wordMerge)) {
      merged.wordMerge = Math.max(-20, Math.min(100, merged.wordMerge));
    }
    if (typeof merged.imageSrc !== "string") merged.imageSrc = "";
    if (!merged.bgColor) merged.bgColor = merged.theme === "dark" ? "#000000" : "#ffffff";
    if (!merged.inkColor) merged.inkColor = merged.theme === "dark" ? "#ffffff" : "#111111";
    return merged;
  } catch {
    return null;
  }
}

function resolveInitialParams() {
  const hasUrl = window.location.search.length > 1;
  if (hasUrl) {
    const fromUrl = LetterFieldEngine.fromQuery(window.location.search);
    saveParams(fromUrl);
    return fromUrl;
  }
  return loadStoredParams() || LetterFieldEngine.defaults();
}

function persistEngine(engine) {
  let timer = 0;
  const original = engine.setParams.bind(engine);
  engine.setParams = (partial) => {
    original(partial);
    clearTimeout(timer);
    timer = setTimeout(() => saveParams(engine.params), 80);
  };
  saveParams(engine.params);
}

const SLIDERS = [
  "fontWeight",
  "glyphSize",
  "stroke",
  "density",
  "spacing",
  "letterScale",
  "wordMerge",
  "shapeAmount",
  "shapeSize",
  "shapeWeight",
  "shapeSoftness",
  "bgDensity",
  "warp",
  "bulge",
  "twist",
  "lightIntensity",
  "ambient",
  "lightX",
  "lightY",
  "rimLight",
  "glow",
  "speed",
  "waveAmount",
  "waveSpeed",
  "waveScale",
  "driftAmount",
  "driftSpeed",
  "shakeAmount",
  "shakeSpeed",
  "pointerSpinAmount",
  "pointerSpinLag",
  "pulseAmount",
  "pulseSpeed",
  "twinkleAmount",
  "twinkleSpeed",
  "rippleAmount",
  "rippleRadius",
  "bubbleAmount",
  "bubbleRadius",
  "bubbleSpeed",
  "bubbleScale",
  "imageThreshold",
];

const CHECKS = [
  "filledGlyphs",
  "autoMorph",
  "followPointer",
  "organic",
  "animWave",
  "animDrift",
  "animShake",
  "animPointerSpin",
  "animPulse",
  "animTwinkle",
  "animRipple",
  "animBubble",
  "imageInvert",
];
const SELECTS = ["fontFamily", "layout", "theme"];
const COLORS = ["bgColor", "inkColor"];

const THEME_PRESETS = {
  light: { bgColor: "#ffffff", inkColor: "#111111" },
  dark: { bgColor: "#000000", inkColor: "#ffffff" },
};

function $(sel) {
  return document.querySelector(sel);
}

function isResultMode() {
  return document.body.classList.contains("result-body") ||
    $("#app")?.dataset.mode === "result";
}

function formatValue(id, value) {
  const out = document.querySelector(`.value[data-for="${id}"]`);
  if (!out) return;
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-6) {
    out.textContent = String(Math.round(value));
  } else {
    out.textContent = value.toFixed(2);
  }
}

async function compressImageFile(file) {
  const bmp = await createImageBitmap(file);
  const maxSide = 512;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  try {
    bmp.close();
  } catch {
    /* ignore */
  }
  return canvas.toDataURL("image/jpeg", 0.74);
}

function bindStudio(engine) {
  const defaults = LetterFieldEngine.defaults();
  const letterInput = $("#letterInput");
  const wordInput = $("#wordInput");
  const presets = $("#letterPresets");
  const imageInput = $("#imageInput");
  const imagePreview = $("#imagePreview");
  const btnPickImage = $("#btnPickImage");
  const btnClearImage = $("#btnClearImage");

  PRESETS.forEach((ch) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = ch;
    btn.addEventListener("click", () => {
      letterInput.value = ch;
      wordInput.value = "";
      syncLetter();
      syncWord();
    });
    presets.appendChild(btn);
  });

  function markPreset() {
    const current = (letterInput.value || "G").toUpperCase();
    const usingWord = Boolean((wordInput.value || "").replace(/[^A-Za-z]/g, ""));
    const usingImage = Boolean(engine.params.imageSrc);
    presets.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("is-active", !usingWord && !usingImage && b.textContent === current);
    });
  }

  function syncImagePreview(src) {
    if (imagePreview) {
      if (src) {
        imagePreview.src = src;
        imagePreview.hidden = false;
      } else {
        imagePreview.removeAttribute("src");
        imagePreview.hidden = true;
      }
    }
    if (btnClearImage) btnClearImage.hidden = !src;
  }

  function syncLetter() {
    const letter = (letterInput.value || "G").slice(0, 1).toUpperCase();
    letterInput.value = letter;
    engine.setParams({ letter });
    markPreset();
  }

  function syncWord() {
    const raw = (wordInput.value || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
    wordInput.value = raw;
    engine.setParams({ word: raw });
    markPreset();
    const label = $("#resultLetter");
    if (label) label.textContent = raw || engine.params.letter;
  }

  letterInput.addEventListener("input", syncLetter);
  letterInput.addEventListener("focus", () => letterInput.select());
  wordInput.addEventListener("input", syncWord);
  wordInput.addEventListener("focus", () => wordInput.select());

  btnPickImage?.addEventListener("click", () => imageInput?.click());
  imageInput?.addEventListener("change", async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    try {
      const src = await compressImageFile(file);
      engine.setParams({ imageSrc: src });
      syncImagePreview(src);
      markPreset();
    } catch (err) {
      console.error(err);
      const status = $("#saveStatus");
      if (status) status.textContent = "Could not read that image.";
    } finally {
      imageInput.value = "";
    }
  });
  btnClearImage?.addEventListener("click", () => {
    engine.setParams({ imageSrc: "" });
    syncImagePreview("");
    markPreset();
  });

  // Hydrate from engine/URL first
  letterInput.value = engine.params.letter;
  wordInput.value = engine.params.word || "";
  syncImagePreview(engine.params.imageSrc || "");

  SLIDERS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = engine.params[id];
    formatValue(id, engine.params[id]);
  });
  CHECKS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = Boolean(engine.params[id]);
  });
  SELECTS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = engine.params[id];
  });
  COLORS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = engine.params[id] || (id === "bgColor" ? "#ffffff" : "#111111");
  });
  markPreset();

  SLIDERS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const value = parseFloat(el.value);
      formatValue(id, value);
      engine.setParams({ [id]: value });
    });
  });

  CHECKS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      engine.setParams({ [id]: el.checked });
    });
  });

  SELECTS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      if (id === "theme" && THEME_PRESETS[el.value]) {
        const preset = THEME_PRESETS[el.value];
        engine.setParams({ theme: el.value, ...preset });
        COLORS.forEach((colorId) => {
          const colorEl = document.getElementById(colorId);
          if (colorEl) colorEl.value = preset[colorId];
        });
        return;
      }
      engine.setParams({ [id]: el.value });
    });
  });

  COLORS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const themeEl = $("#theme");
      if (themeEl) themeEl.value = "custom";
      engine.setParams({ [id]: el.value, theme: "custom" });
    });
  });

  $("#btnReset").addEventListener("click", () => {
    Object.entries(defaults).forEach(([key, value]) => {
      if (key === "particle") return;
      const el = document.getElementById(
        key === "letter" ? "letterInput" : key === "word" ? "wordInput" : key
      );
      if (!el) return;
      if (el.type === "checkbox") {
        el.checked = Boolean(value);
        el.dispatchEvent(new Event("change"));
      } else {
        el.value = value;
        el.dispatchEvent(new Event("input"));
        el.dispatchEvent(new Event("change"));
      }
    });
    letterInput.value = defaults.letter;
    wordInput.value = defaults.word;
    engine.setParams({ imageSrc: "" });
    syncImagePreview("");
    syncLetter();
    syncWord();
  });

  $("#btnPause").addEventListener("click", () => {
    const paused = engine.togglePause();
    $("#btnPause").textContent = paused ? "Play" : "Pause";
  });

  $("#btnSave")?.addEventListener("click", async () => {
    const status = $("#saveStatus");
    const btn = $("#btnSave");
    saveParams(engine.params);

    const user = await fetchMe();
    if (!user) {
      if (status) status.textContent = "Sign in to save to your library.";
      $("#authDialog")?.showModal?.();
      return;
    }

    if (btn) btn.disabled = true;
    if (status) status.textContent = "Saving…";
    try {
      const save = await createSave(engine.params);
      if (status) status.textContent = `Saved “${save.title}”.`;
      const help = $("#saveDialogHelp");
      if (help) {
        help.textContent = `“${save.title}” is in your library. Use Embed and Video download there. Deleting it will disable its embeds.`;
      }
      $("#embedDialog")?.showModal?.();
    } catch (err) {
      if (status) status.textContent = err.message || "Could not save.";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#btnTogglePanel")?.addEventListener("click", () => {
    document.body.classList.toggle("panel-open");
  });

  bindPointer(engine);
  loadSaveFromQuery(engine);
}

async function loadSaveFromQuery(engine) {
  const id = new URLSearchParams(window.location.search).get("load");
  if (!id) return;
  try {
    const save = await getSave(id);
    if (!save?.params) return;
    engine.setParams(save.params);
    // Re-hydrate studio controls
    const letterInput = $("#letterInput");
    const wordInput = $("#wordInput");
    if (letterInput) letterInput.value = engine.params.letter;
    if (wordInput) wordInput.value = engine.params.word || "";
    const preview = $("#imagePreview");
    const clearBtn = $("#btnClearImage");
    if (preview) {
      if (engine.params.imageSrc) {
        preview.src = engine.params.imageSrc;
        preview.hidden = false;
      } else {
        preview.removeAttribute("src");
        preview.hidden = true;
      }
    }
    if (clearBtn) clearBtn.hidden = !engine.params.imageSrc;
    SLIDERS.forEach((key) => {
      const el = document.getElementById(key);
      if (!el || engine.params[key] === undefined) return;
      el.value = engine.params[key];
      formatValue(key, engine.params[key]);
    });
    CHECKS.forEach((key) => {
      const el = document.getElementById(key);
      if (!el || engine.params[key] === undefined) return;
      el.checked = Boolean(engine.params[key]);
    });
    SELECTS.forEach((key) => {
      const el = document.getElementById(key);
      if (!el || engine.params[key] === undefined) return;
      el.value = engine.params[key];
    });
    COLORS.forEach((key) => {
      const el = document.getElementById(key);
      if (!el || engine.params[key] === undefined) return;
      el.value = engine.params[key];
    });
    await engine.ready();
    const status = $("#saveStatus");
    if (status) status.textContent = `Loaded “${save.title}” from library.`;
  } catch (err) {
    const status = $("#saveStatus");
    if (status) status.textContent = err.message || "Could not load save.";
  }
}

function bindPointer(engine) {
  const canvas = $("#field");
  if (!canvas) return;

  const toNorm = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width - 0.5,
      y: (e.clientY - rect.top) / rect.height - 0.5,
    };
  };

  // Always track pointer over the canvas (needed for pointer spin / ripple)
  canvas.addEventListener("pointermove", (e) => {
    const { x, y } = toNorm(e);
    engine.setPointer(x, y, true);
  });
  canvas.addEventListener("pointerenter", (e) => {
    const { x, y } = toNorm(e);
    engine.setPointer(x, y, true);
  });
  canvas.addEventListener("pointerleave", () => {
    engine.setPointer(engine.pointer.x, engine.pointer.y, false);
  });
  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = toNorm(e);
    engine.setPointer(x, y, true);
    if (!engine.params.followPointer) {
      engine.setParams({ followPointer: true });
      engine._tempFollow = true;
      const el = $("#followPointer");
      if (el) el.checked = true;
    }
  });
  window.addEventListener("pointerup", () => {
    if (engine._tempFollow) {
      engine.setParams({ followPointer: false });
      engine._tempFollow = false;
      const el = $("#followPointer");
      if (el) el.checked = false;
    }
  });
}

async function main() {
  const canvas = $("#field");
  if (!canvas) return;

  const initial = resolveInitialParams();
  const engine = new LetterFieldEngine(canvas, initial);
  persistEngine(engine);
  await engine.ready();

  if (isResultMode()) {
    const label = $("#resultLetter");
    if (label) label.textContent = engine.params.word || engine.params.letter;
    const side = Math.min(1080, Math.floor(Math.min(window.devicePixelRatio || 1, 2) * 720));
    canvas.width = side;
    canvas.height = side;
    // Keep the result URL in sync so a refresh restores the same look
    if (!window.location.search || window.location.search.length <= 1) {
      history.replaceState(null, "", `result.html?${engine.toQuery()}`);
    }
    bindPointer(engine);
  } else {
    bindStudio(engine);
    bindAuth();
  }

  engine.start();
}

function bindAuth() {
  const dialog = $("#authDialog");
  const form = $("#authForm");
  const bar = $("#authBar");
  const nameField = $("#authNameField");
  const nameInput = $("#authName");
  const emailInput = $("#authEmail");
  const passwordInput = $("#authPassword");
  const errorEl = $("#authError");
  const titleEl = $("#authTitle");
  const helpEl = $("#authHelp");
  const submitBtn = $("#authSubmit");
  let mode = "signin";
  let currentUser = null;

  function setMode(next) {
    mode = next;
    const signup = mode === "signup";
    $("#tabSignin")?.classList.toggle("is-active", !signup);
    $("#tabSignup")?.classList.toggle("is-active", signup);
    if (nameField) nameField.hidden = !signup;
    if (titleEl) titleEl.textContent = signup ? "Create account" : "Sign in";
    if (helpEl) {
      helpEl.textContent = signup
        ? "We’ll email you a verification link. Your account is created only after you click it."
        : "Sign in to your Ava account.";
    }
    if (submitBtn) submitBtn.textContent = signup ? "Sign up" : "Sign in";
    if (passwordInput) {
      passwordInput.autocomplete = signup ? "new-password" : "current-password";
    }
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      errorEl.style.color = "";
    }
  }

  function renderBar() {
    if (!bar) return;
    if (currentUser) {
      bar.innerHTML = `
        <a class="btn btn--ghost btn--small" href="index.html">Home</a>
        <a class="btn btn--ghost btn--small" href="library.html">Library</a>
        <span class="stage__auth-user" title="${currentUser.email}">${currentUser.name || currentUser.email}</span>
        <button type="button" class="btn btn--ghost btn--small" id="btnSignOut">Sign out</button>
      `;
      $("#btnSignOut")?.addEventListener("click", async () => {
        await signout();
        currentUser = null;
        renderBar();
      });
    } else {
      bar.innerHTML = `
        <a class="btn btn--ghost btn--small" href="index.html">Home</a>
        <a class="btn btn--ghost btn--small" href="library.html">Library</a>
        <button type="button" class="btn btn--ghost btn--small" id="btnOpenAuth">Sign in</button>
      `;
      $("#btnOpenAuth")?.addEventListener("click", () => {
        setMode("signin");
        dialog?.showModal?.();
      });
    }
  }

  $("#tabSignin")?.addEventListener("click", () => setMode("signin"));
  $("#tabSignup")?.addEventListener("click", () => setMode("signup"));
  $("#authCancel")?.addEventListener("click", () => dialog?.close?.());

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
    if (submitBtn) submitBtn.disabled = true;
    try {
      const payload = {
        name: nameInput?.value || "",
        email: emailInput?.value || "",
        password: passwordInput?.value || "",
      };
      if (mode === "signup") {
        const result = await signup(payload);
        form.reset();
        setMode("signin");
        if (errorEl) {
          errorEl.style.color = "#b7d7b0";
          errorEl.textContent =
            result.message ||
            "Check your email and click the verification button to create your account.";
          errorEl.hidden = false;
        }
      } else {
        currentUser = await signin(payload);
        dialog?.close?.();
        form.reset();
        renderBar();
      }
    } catch (err) {
      if (errorEl) {
        errorEl.style.color = "";
        errorEl.textContent = err.message || "Something went wrong";
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  setMode("signin");
  renderBar();
  fetchMe().then((user) => {
    currentUser = user;
    renderBar();
  });
}

main();
