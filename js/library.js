import { fetchMe, signin, signout, signup } from "./auth.js";
import { deleteSave, fetchRecordingBlob, listSaves } from "./saves.js";
import { LetterFieldEngine } from "./engine.js";
import {
  buildEmbedCode,
  copyText,
  recordEngineVideo,
  transcodeAndDownloadRecording,
  VIDEO_PRESETS,
} from "./export.js";

const $ = (sel) => document.querySelector(sel);

let currentUser = null;
let saves = [];
let videoSave = null;
let recording = false;

function setStatus(text) {
  const el = $("#libraryStatus");
  if (el) el.textContent = text || "";
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function renderUser() {
  const label = $("#libraryUser");
  const btn = $("#btnLibrarySignIn");
  if (currentUser) {
    if (label) {
      label.hidden = false;
      label.textContent = currentUser.name || currentUser.email;
    }
    if (btn) {
      btn.textContent = "Sign out";
      btn.onclick = async () => {
        await signout();
        currentUser = null;
        saves = [];
        renderUser();
        renderGrid();
        setStatus("Signed out.");
      };
    }
  } else {
    if (label) label.hidden = true;
    if (btn) {
      btn.textContent = "Sign in";
      btn.onclick = () => $("#authDialog")?.showModal?.();
    }
  }
}

function renderGrid() {
  const grid = $("#libraryGrid");
  const empty = $("#libraryEmpty");
  if (!grid) return;
  grid.innerHTML = "";

  if (!currentUser) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Sign in to see your saved pieces.";
    }
    return;
  }

  if (!saves.length) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "No saves yet. Open Studio and press Save or Record.";
    }
    return;
  }

  if (empty) empty.hidden = true;

  for (const save of saves) {
    const card = document.createElement("article");
    card.className = "library-card";
    const label = save.word || save.letter || save.title;
    const bg = save.params?.bgColor || (save.theme === "dark" ? "#000000" : "#ffffff");
    const ink = save.params?.inkColor || (save.theme === "dark" ? "#ffffff" : "#111111");
    card.innerHTML = `
      <div class="library-card__preview" style="background:${bg};color:${ink}">
        <span class="library-card__glyph">${label}</span>
      </div>
      <div class="library-card__body">
        <h2 class="library-card__title">${save.title}${save.kind === "recording" || save.hasVideo ? '<span class="library-card__badge">Recording</span>' : ""}</h2>
        <p class="help">${formatDate(save.updatedAt || save.createdAt)}</p>
        <div class="library-card__actions">
          <a class="btn btn--ghost btn--small" href="studio.html?load=${encodeURIComponent(save.id)}">Open</a>
          <button type="button" class="btn btn--ghost btn--small" data-act="embed" data-id="${save.id}">Embed</button>
          <button type="button" class="btn btn--primary btn--small" data-act="video" data-id="${save.id}">Video</button>
          <button type="button" class="btn btn--ghost btn--small" data-act="delete" data-id="${save.id}">Delete</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }
}

async function refresh() {
  if (!currentUser) {
    saves = [];
    renderGrid();
    return;
  }
  setStatus("Loading library…");
  try {
    saves = await listSaves();
    setStatus(saves.length ? `${saves.length} saved` : "");
    renderGrid();
  } catch (err) {
    setStatus(err.message || "Could not load library");
    renderGrid();
  }
}

function bindAuthDialog() {
  const dialog = $("#authDialog");
  const form = $("#authForm");
  const nameField = $("#authNameField");
  const errorEl = $("#authError");
  let mode = "signin";

  function setMode(next) {
    mode = next;
    const signupMode = mode === "signup";
    $("#tabSignin")?.classList.toggle("is-active", !signupMode);
    $("#tabSignup")?.classList.toggle("is-active", signupMode);
    if (nameField) nameField.hidden = !signupMode;
    if ($("#authTitle")) $("#authTitle").textContent = signupMode ? "Create account" : "Sign in";
    if ($("#authSubmit")) $("#authSubmit").textContent = signupMode ? "Sign up" : "Sign in";
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      errorEl.style.color = "";
    }
  }

  $("#tabSignin")?.addEventListener("click", () => setMode("signin"));
  $("#tabSignup")?.addEventListener("click", () => setMode("signup"));
  $("#authCancel")?.addEventListener("click", () => dialog?.close?.());

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = $("#authSubmit");
    if (submit) submit.disabled = true;
    try {
      const payload = {
        name: $("#authName")?.value || "",
        email: $("#authEmail")?.value || "",
        password: $("#authPassword")?.value || "",
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
        renderUser();
        await refresh();
      }
    } catch (err) {
      if (errorEl) {
        errorEl.style.color = "";
        errorEl.textContent = err.message || "Failed";
        errorEl.hidden = false;
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  setMode("signin");
}

function bindGridActions() {
  $("#libraryGrid")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");
    const save = saves.find((s) => s.id === id);
    if (!save) return;

    if (act === "embed") {
      const code = buildEmbedCode(save.id);
      const area = $("#embedCode");
      if (area) area.value = code;
      $("#embedDialog")?.showModal?.();
      return;
    }

    if (act === "video") {
      videoSave = save;
      $("#exportStatus").textContent = "";
      const recorded = save.kind === "recording" || save.hasVideo;
      const durationFields = $("#exportDurationFields");
      if (durationFields) durationFields.hidden = recorded;
      const webOpt = $("#exportResolution")?.querySelector('option[value="web"]');
      if (webOpt) webOpt.hidden = recorded;
      if (recorded && $("#exportResolution")?.value === "web") {
        $("#exportResolution").value = "1080p";
      }
      $("#videoDialog")?.showModal?.();
      return;
    }

    if (act === "delete") {
      const ok = window.confirm(
        `Delete “${save.title}”? Embeds of this piece will stop working everywhere.`
      );
      if (!ok) return;
      try {
        await deleteSave(save.id);
        setStatus(`Deleted “${save.title}”. Embeds for it are now offline.`);
        await refresh();
      } catch (err) {
        setStatus(err.message || "Delete failed");
      }
    }
  });
}

function bindEmbedCopy() {
  $("#btnCopyEmbed")?.addEventListener("click", async () => {
    const code = $("#embedCode")?.value || "";
    try {
      await copyText(code);
      const btn = $("#btnCopyEmbed");
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      }
    } catch {
      setStatus("Could not copy embed code.");
    }
  });
}

function bindVideoDialog() {
  const durationEl = $("#exportDuration");
  const valueEl = document.querySelector('.value[data-for="exportDuration"]');
  durationEl?.addEventListener("input", () => {
    if (valueEl && !valueEl.querySelector("input")) {
      valueEl.textContent = String(Math.round(durationEl.value));
    }
  });

  if (valueEl && durationEl) {
    valueEl.tabIndex = 0;
    valueEl.setAttribute("role", "button");
    valueEl.setAttribute("title", "Click to type a value");
    const startEdit = () => {
      if (valueEl.querySelector("input")) return;
      const input = document.createElement("input");
      input.className = "value-input";
      input.type = "number";
      input.step = durationEl.step || "1";
      input.min = durationEl.min;
      input.max = durationEl.max;
      input.value = durationEl.value;
      valueEl.textContent = "";
      valueEl.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const raw = parseFloat(input.value);
        input.remove();
        if (ok && Number.isFinite(raw)) {
          const min = parseFloat(durationEl.min);
          const max = parseFloat(durationEl.max);
          const next = Math.max(min, Math.min(max, Math.round(raw)));
          durationEl.value = String(next);
        }
        valueEl.textContent = String(Math.round(durationEl.value));
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
    };
    valueEl.addEventListener("click", startEdit);
    valueEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        startEdit();
      }
    });
  }

  $("#btnCloseVideo")?.addEventListener("click", () => $("#videoDialog")?.close?.());

  $("#btnStartVideo")?.addEventListener("click", async () => {
    if (recording || !videoSave) return;
    const presetKey = $("#exportResolution")?.value || "1080p";
    const preset = VIDEO_PRESETS[presetKey] || VIDEO_PRESETS["1080p"];
    const durationSec = Math.max(3, Math.min(15, parseFloat(durationEl?.value || "6") || 6));
    const canvas = $("#exportCanvas");
    const btn = $("#btnStartVideo");
    const recorded = videoSave.kind === "recording" || videoSave.hasVideo;
    const label = String(videoSave.word || videoSave.letter || videoSave.title || "field")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "") || "field";

    recording = true;
    if (btn) btn.disabled = true;

    try {
      if (recorded) {
        $("#exportStatus").textContent = "Loading recording…";
        const blob = await fetchRecordingBlob(videoSave.id);
        const { filename } = await transcodeAndDownloadRecording(blob, {
          presetKey: presetKey === "web" ? "480p" : presetKey,
          filenameBase: `ava-${label}`,
          onStatus: (msg) => {
            $("#exportStatus").textContent = msg;
          },
        });
        $("#exportStatus").textContent = `Downloaded ${filename}`;
        return;
      }

      if (!videoSave.params) return;
      $("#exportStatus").textContent = `Recording ${preset.label}…`;
      const engine = new LetterFieldEngine(canvas, videoSave.params);
      await engine.ready();
      engine.start();
      try {
        const { filename } = await recordEngineVideo(engine, {
          presetKey,
          durationSec,
          filenameBase: `ava-${label}`,
          onProgress: (t) => {
            $("#exportStatus").textContent =
              t >= 1 ? "Finishing…" : `Recording ${preset.label}… ${Math.round(t * 100)}%`;
          },
          onStatus: (msg) => {
            $("#exportStatus").textContent = msg;
          },
        });
        $("#exportStatus").textContent = `Downloaded ${filename}`;
      } finally {
        engine.stop();
      }
    } catch (err) {
      console.error(err);
      $("#exportStatus").textContent = err?.message || "Video export failed.";
    } finally {
      recording = false;
      if (btn) btn.disabled = false;
    }
  });
}

async function main() {
  bindAuthDialog();
  bindGridActions();
  bindEmbedCopy();
  bindVideoDialog();

  currentUser = await fetchMe();
  renderUser();
  await refresh();
}

main();
