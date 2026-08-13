/** Shared WCAG AA helpers: tabs, dialogs, errors, announcements. */

export function bindTabs(tablist, { onChange } = {}) {
  if (!tablist) return;
  const tabs = () => [...tablist.querySelectorAll('[role="tab"]')];

  function select(tab, focus = false) {
    tabs().forEach((t) => {
      const on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    if (focus) tab.focus();
    onChange?.(tab);
  }

  tabs().forEach((tab) => {
    const selected = tab.classList.contains("is-active") || tab.getAttribute("aria-selected") === "true";
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.tabIndex = selected ? 0 : -1;
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const list = tabs();
      const i = list.indexOf(tab);
      if (i < 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        select(list[(i + 1) % list.length], true);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        select(list[(i - 1 + list.length) % list.length], true);
      } else if (e.key === "Home") {
        e.preventDefault();
        select(list[0], true);
      } else if (e.key === "End") {
        e.preventDefault();
        select(list[list.length - 1], true);
      }
    });
  });

  return { select };
}

export function enhanceDialog(dialog) {
  if (!dialog) return;
  dialog.setAttribute("aria-modal", "true");
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close?.();
  });
}

export function showFieldError(errorEl, inputs = [], message = "", { ok = false } = {}) {
  if (errorEl) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
    errorEl.style.color = ok ? "#b8e0b0" : "";
    if (!errorEl.getAttribute("role")) errorEl.setAttribute("role", "alert");
  }
  inputs.filter(Boolean).forEach((el) => {
    el.setAttribute("aria-invalid", message && !ok ? "true" : "false");
  });
}

export function bindMobileNav({ toggle, nav, wrap } = {}) {
  if (!toggle || !nav) return;
  const root = wrap || toggle.closest("header") || document.body;

  function setOpen(open) {
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (open) {
      nav.querySelector("a, button")?.focus();
    }
  }

  toggle.addEventListener("click", () => {
    setOpen(!root.classList.contains("is-open"));
  });
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });
}

export function bindCanvasKeyboard(canvas, engine) {
  if (!canvas || !engine) return;
  canvas.tabIndex = 0;
  let kx = 0;
  let ky = 0;

  canvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.12 : 0.06;
    let moved = false;
    if (e.key === "ArrowLeft") {
      kx = Math.max(-0.5, kx - step);
      moved = true;
    } else if (e.key === "ArrowRight") {
      kx = Math.min(0.5, kx + step);
      moved = true;
    } else if (e.key === "ArrowUp") {
      ky = Math.max(-0.5, ky - step);
      moved = true;
    } else if (e.key === "ArrowDown") {
      ky = Math.min(0.5, ky + step);
      moved = true;
    } else if (e.key === "Home") {
      kx = 0;
      ky = 0;
      moved = true;
    }
    if (moved) {
      e.preventDefault();
      engine.setPointer(kx, ky, true);
    }
  });

  canvas.addEventListener("blur", () => {
    engine.setPointer(kx, ky, false);
  });
}

export function describeArtboard(params = {}) {
  if (params.imageSrc) return "Image field artboard";
  const word = String(params.word || "").trim();
  if (word) return `Word field artboard showing “${word}”`;
  const letter = String(params.letter || "letter").slice(0, 1);
  return `Letter field artboard showing “${letter}”`;
}
