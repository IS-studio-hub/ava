import { LetterFieldEngine } from "./engine.js";
import { fetchMe, signin, signout, signup } from "./auth.js";
import { createSave, createRecordingSave, getSave } from "./saves.js";
import { usageLabel } from "./usage.js";
import { bindPlanLimitDialog, showPlanLimitDialog } from "./planLimit.js";
import { MAX_RECORD_MS, startCanvasRecording } from "./export.js";
import {
  alphabetFor,
  detectScript,
  normalizeLetter,
  normalizeScript,
  normalizeWord,
  defaultLetter,
} from "./sdf.js";

const STORAGE_KEY = "ava.letterField.lastParams";
const LATIN_ONLY_FONTS = new Set([
  "Playfair Display",
  "Cormorant Garamond",
  "Bodoni Moda",
  "Instrument Serif",
  "Georgia",
  "Times New Roman",
  "Arial Black",
  "Space Grotesk",
]);

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
    merged.script = detectScript(
      `${merged.letter || ""}${merged.word || ""}`,
      merged.script
    );
    merged.letter = normalizeLetter(merged.letter, merged.script);
    merged.word = normalizeWord(merged.word, merged.script);
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
  if (!out || out.querySelector("input")) return;
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-6) {
    out.textContent = String(Math.round(value));
  } else {
    out.textContent = value.toFixed(2);
  }
}

function snapToStep(value, min, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  const base = Number.isFinite(min) ? min : 0;
  const snapped = base + Math.round((value - base) / step) * step;
  const decimals = String(step).includes(".") ? (String(step).split(".")[1] || "").length : 0;
  return Number(snapped.toFixed(Math.min(6, decimals)));
}

function commitSliderValue(id, raw, engine) {
  const slider = document.getElementById(id);
  if (!slider) return;
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const step = parseFloat(slider.step);
  let value = parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(value)) {
    formatValue(id, parseFloat(slider.value));
    return;
  }
  if (Number.isFinite(min)) value = Math.max(min, value);
  if (Number.isFinite(max)) value = Math.min(max, value);
  if (Number.isFinite(step) && step > 0) value = snapToStep(value, min, step);
  slider.value = String(value);
  const applied = parseFloat(slider.value);
  formatValue(id, applied);
  engine.setParams({ [id]: applied });
}

function beginEditValue(span, engine) {
  const id = span.getAttribute("data-for");
  if (!id || span.querySelector("input")) return;
  const slider = document.getElementById(id);
  if (!slider) return;

  const input = document.createElement("input");
  input.className = "value-input";
  input.type = "number";
  input.inputMode = "decimal";
  if (slider.step) input.step = slider.step;
  if (slider.min !== "") input.min = slider.min;
  if (slider.max !== "") input.max = slider.max;
  input.value = slider.value;
  input.setAttribute("aria-label", `Value for ${id}`);
  span.textContent = "";
  span.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const raw = input.value;
    input.remove();
    if (ok) commitSliderValue(id, raw, engine);
    else formatValue(id, parseFloat(slider.value));
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function bindEditableValues(engine) {
  document.querySelectorAll(".value[data-for]").forEach((span) => {
    span.tabIndex = 0;
    span.setAttribute("role", "button");
    span.setAttribute("title", "Click to type a value");
    span.addEventListener("click", () => beginEditValue(span, engine));
    span.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        beginEditValue(span, engine);
      }
    });
  });
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
  const wordHelp = $("#wordHelp");
  const presets = $("#letterPresets");
  const imageInput = $("#imageInput");
  const imagePreview = $("#imagePreview");
  const btnPickImage = $("#btnPickImage");
  const btnClearImage = $("#btnClearImage");
  let usageUser = null;
  let recording = false;
  let recorderHandle = null;
  let recordTimer = 0;
  let stoppingRecord = false;

  function planExhausted() {
    return Boolean(usageUser && Number(usageUser.usesRemaining) === 0);
  }

  function lockSaveButton() {
    const locked = planExhausted();
    const saveBtn = $("#btnSave");
    if (saveBtn) {
      const block = locked || recording;
      saveBtn.classList.toggle("is-locked", block);
      saveBtn.setAttribute("aria-disabled", block ? "true" : "false");
    }
    const recBtn = $("#btnRecord");
    if (recBtn && !recording) {
      recBtn.classList.toggle("is-locked", locked);
      recBtn.setAttribute("aria-disabled", locked ? "true" : "false");
    }
  }

  function formatRecordClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function lockShapeSource(locked) {
    document.body.classList.toggle("is-recording-art", locked);
    if (letterInput) {
      letterInput.readOnly = locked;
      letterInput.classList.toggle("is-locked", locked);
      letterInput.setAttribute("aria-disabled", locked ? "true" : "false");
    }
    if (wordInput) {
      wordInput.readOnly = locked;
      wordInput.classList.toggle("is-locked", locked);
      wordInput.setAttribute("aria-disabled", locked ? "true" : "false");
    }
    if (btnPickImage) {
      btnPickImage.disabled = locked;
      btnPickImage.classList.toggle("is-locked", locked);
    }
    if (btnClearImage) {
      btnClearImage.disabled = locked;
      btnClearImage.classList.toggle("is-locked", locked);
    }
    if (imageInput) imageInput.disabled = locked;
    $("#scriptToggle")?.classList.toggle("is-locked", locked);
    if ($("#scriptLatin")) $("#scriptLatin").disabled = locked;
    if ($("#scriptHebrew")) $("#scriptHebrew").disabled = locked;
    presets?.classList.toggle("is-locked", locked);
    presets?.querySelectorAll("button").forEach((b) => {
      b.disabled = locked;
    });
    const reset = $("#btnReset");
    if (reset) {
      reset.disabled = locked;
      reset.classList.toggle("is-locked", locked);
    }
    lockSaveButton();
  }

  function updateRecordUi(ms = 0) {
    const btn = $("#btnRecord");
    const rec = $("#recIndicator");
    if (btn) {
      btn.textContent = recording ? `Stop · ${formatRecordClock(ms)}` : "Record";
      btn.classList.toggle("is-recording", recording);
    }
    if (rec) {
      rec.hidden = !recording;
      rec.textContent = recording ? `REC ${formatRecordClock(ms)}` : "REC";
    }
  }

  function renderUsage(user, { prompt = false } = {}) {
    usageUser = user || usageUser;
    const el = $("#usageStatus");
    if (el) {
      el.textContent = usageUser
        ? `${usageLabel(usageUser)}${usageUser.usesRemaining === 0 ? " · please increase your plan" : ""}`
        : "";
    }
    lockSaveButton();
    if (prompt && planExhausted()) showPlanLimitDialog();
  }

  function currentScript() {
    return normalizeScript(engine.params.script);
  }

  function applyScriptUI(script) {
    const hebrew = script === "hebrew";
    $("#scriptLatin")?.classList.toggle("is-active", !hebrew);
    $("#scriptHebrew")?.classList.toggle("is-active", hebrew);
    if (presets) presets.dataset.script = script;
    if (letterInput) {
      letterInput.dir = hebrew ? "rtl" : "ltr";
      letterInput.classList.toggle("text-input--hebrew", hebrew);
    }
    if (wordInput) {
      wordInput.dir = hebrew ? "rtl" : "ltr";
      wordInput.placeholder = hebrew ? "למשל שלום" : "e.g. AVA";
    }
    if (wordHelp) {
      wordHelp.textContent = hebrew
        ? "Type a Hebrew word. Each big letter is built from that same letter. Leave empty for a single letter."
        : "Type a word to form it from small letters (each big letter uses its own lowercase). Leave empty for a single letter.";
    }
  }

  function renderPresets() {
    if (!presets) return;
    presets.innerHTML = "";
    alphabetFor(currentScript()).forEach((ch) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = ch;
      btn.addEventListener("click", () => {
        if (ch === letterInput.value && !wordInput.value && !engine.params.imageSrc) return;
        letterInput.value = ch;
        wordInput.value = "";
        syncLetter();
        syncWord();
      });
      presets.appendChild(btn);
    });
    markPreset();
  }

  function setScript(next) {
    if (recording) return;
    const script = normalizeScript(next);
    const patch = { script };
    if (script === "hebrew" && LATIN_ONLY_FONTS.has(engine.params.fontFamily)) {
      patch.fontFamily = "Heebo";
      const fontEl = $("#fontFamily");
      if (fontEl) fontEl.value = "Heebo";
    }
    engine.setParams(patch);
    letterInput.value = engine.params.letter;
    wordInput.value = engine.params.word || "";
    applyScriptUI(script);
    renderPresets();
    syncLetter();
    syncWord();
  }

  function markPreset() {
    const script = currentScript();
    const current = normalizeLetter(letterInput.value || defaultLetter(script), script);
    const usingWord = Boolean(normalizeWord(wordInput.value || "", script));
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
    const script = currentScript();
    const letter = normalizeLetter(letterInput.value || defaultLetter(script), script);
    letterInput.value = letter;
    engine.setParams({ letter, script });
    markPreset();
  }

  function syncWord() {
    const script = currentScript();
    const raw = normalizeWord(wordInput.value || "", script);
    wordInput.value = raw;
    engine.setParams({ word: raw, script });
    markPreset();
    const label = $("#resultLetter");
    if (label) label.textContent = raw || engine.params.letter;
  }

  $("#scriptLatin")?.addEventListener("click", () => setScript("latin"));
  $("#scriptHebrew")?.addEventListener("click", () => setScript("hebrew"));

  letterInput.addEventListener("input", () => {
    if (recording) {
      letterInput.value = engine.params.letter;
      return;
    }
    syncLetter();
  });
  letterInput.addEventListener("focus", () => {
    if (recording) {
      letterInput.blur();
      return;
    }
    letterInput.select();
  });

  wordInput.addEventListener("input", () => {
    if (recording) {
      wordInput.value = engine.params.word || "";
      return;
    }
    syncWord();
  });
  wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      wordInput.blur();
    }
  });
  wordInput.addEventListener("focus", () => {
    if (recording) {
      wordInput.blur();
      return;
    }
    wordInput.select();
  });

  btnPickImage?.addEventListener("click", (e) => {
    if (recording) {
      e.preventDefault();
      return;
    }
    imageInput?.click();
  });
  imageInput?.addEventListener("change", async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    if (recording) {
      imageInput.value = "";
      return;
    }
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
    if (recording) return;
    engine.setParams({ imageSrc: "" });
    syncImagePreview("");
    markPreset();
  });

  // Hydrate from engine/URL first
  letterInput.value = engine.params.letter;
  wordInput.value = engine.params.word || "";
  applyScriptUI(currentScript());
  renderPresets();
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
  bindEditableValues(engine);

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
    if (recording) return;
    setScript(defaults.script || "latin");
    Object.entries(defaults).forEach(([key, value]) => {
      if (key === "particle" || key === "script") return;
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

  async function stopRecordingAndSave() {
    if (!recorderHandle || stoppingRecord) return;
    stoppingRecord = true;
    clearInterval(recordTimer);
    recordTimer = 0;
    const status = $("#saveStatus");
    const btn = $("#btnRecord");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Saving recording…";
    try {
      const { blob, mime, durationMs } = await recorderHandle.stop();
      recorderHandle = null;
      recording = false;
      lockShapeSource(false);
      updateRecordUi(0);

      if (!blob || blob.size < 800 || durationMs < 800) {
        if (status) status.textContent = "Recording was too short. Try again.";
        return;
      }

      const user = await fetchMe();
      if (!user) {
        $("#authDialog")?.showModal?.();
        if (status) status.textContent = "Sign in to save the recording.";
        return;
      }
      if (planExhausted()) {
        showPlanLimitDialog();
        if (status) status.textContent = "Please increase your plan to save.";
        return;
      }

      saveParams(engine.params);
      const data = await createRecordingSave(engine.params, blob, { durationMs, mime });
      const save = data.save || data;
      if (data.user) renderUsage(data.user);
      if (status) status.textContent = `Saved “${save.title}”.`;
      const help = $("#saveDialogHelp");
      if (help) {
        help.textContent = `“${save.title}” is in your library. Download it as 480p, 720p, 1080p, or 4K MP4 from Video.`;
      }
      $("#embedDialog")?.showModal?.();
    } catch (err) {
      recorderHandle = null;
      recording = false;
      lockShapeSource(false);
      updateRecordUi(0);
      if (err.data?.user) renderUsage(err.data.user, { prompt: err.status === 402 });
      else if (err.status === 402) showPlanLimitDialog();
      if (status) status.textContent = err.message || "Could not save recording.";
    } finally {
      stoppingRecord = false;
      if (btn) btn.disabled = false;
      lockSaveButton();
    }
  }

  $("#btnRecord")?.addEventListener("click", async () => {
    const status = $("#saveStatus");
    if (recording) {
      await stopRecordingAndSave();
      return;
    }

    const user = await fetchMe();
    if (!user) {
      if (status) status.textContent = "Sign in to record to your library.";
      $("#authDialog")?.showModal?.();
      return;
    }
    if (planExhausted()) {
      showPlanLimitDialog();
      if (status) status.textContent = "Please increase your plan to record.";
      return;
    }

    try {
      recorderHandle = startCanvasRecording(engine.canvas, {
        fps: 30,
        bitsPerSecond: 8_000_000,
        preferMime: "webm",
      });
    } catch (err) {
      if (status) status.textContent = err.message || "Could not start recording.";
      return;
    }

    recording = true;
    lockShapeSource(true);
    updateRecordUi(0);
    if (status) {
      status.textContent =
        "Recording the artboard. Controllers stay live; letter, word, and image are locked.";
    }
    recordTimer = setInterval(() => {
      if (!recorderHandle) return;
      const elapsed = performance.now() - recorderHandle.startedAt;
      updateRecordUi(elapsed);
      if (elapsed >= MAX_RECORD_MS) stopRecordingAndSave();
    }, 200);
  });

  $("#btnSave")?.addEventListener("click", async () => {
    const status = $("#saveStatus");
    const btn = $("#btnSave");
    if (recording) return;
    saveParams(engine.params);

    const user = await fetchMe();
    if (!user) {
      if (status) status.textContent = "Sign in to save to your library.";
      $("#authDialog")?.showModal?.();
      return;
    }

    if (planExhausted()) {
      showPlanLimitDialog();
      if (status) status.textContent = "Please increase your plan to save.";
      return;
    }

    if (btn) btn.disabled = true;
    if (status) status.textContent = "Saving…";
    try {
      const data = await createSave(engine.params);
      const save = data.save || data;
      if (data.user) renderUsage(data.user);
      if (status) status.textContent = `Saved “${save.title}”.`;
      const help = $("#saveDialogHelp");
      if (help) {
        help.textContent = `“${save.title}” is in your library. Use Embed and Video download there. Deleting it will disable its embeds.`;
      }
      $("#embedDialog")?.showModal?.();
    } catch (err) {
      if (err.data?.user) renderUsage(err.data.user, { prompt: err.status === 402 });
      else if (err.status === 402) showPlanLimitDialog();
      if (status) status.textContent = err.message || "Could not save.";
    } finally {
      if (btn) btn.disabled = false;
      lockSaveButton();
    }
  });

  $("#btnTogglePanel")?.addEventListener("click", () => {
    document.body.classList.toggle("panel-open");
  });

  bindPlanLimitDialog();
  bindPointer(engine);
  Promise.resolve(loadSaveFromQuery(engine)).finally(() => {
    fetchMe().then((user) => {
      if (user) renderUsage(user, { prompt: Number(user.usesRemaining) === 0 });
    });
  });
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
    const scriptBtn = engine.params.script === "hebrew" ? $("#scriptHebrew") : $("#scriptLatin");
    scriptBtn?.click();
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
        <a class="btn btn--ghost btn--small" href="account.html" title="${currentUser.email}">Account</a>
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
        <a class="btn btn--ghost btn--small" href="account.html">Account</a>
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
