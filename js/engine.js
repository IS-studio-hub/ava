import { fbm } from "./noise.js";
import { createLetterField, createWordField, createImageField, normalizeWord } from "./sdf.js";

/**
 * Reference-matched kinetic type field.
 * Big letter emerges from a DENSE field of small letters via size + brightness
 * (like honigwespe), with smooth continuous spin / wave — not sparse culling.
 */

const DEFAULTS = {
  letter: "G",
  word: "",
  wordMerge: 45,
  imageSrc: "",
  imageInvert: false,
  imageThreshold: 0.48,
  particle: "g",
  fontFamily: "Inter",
  fontWeight: 400,
  glyphSize: 0.55,
  stroke: 0,
  filledGlyphs: true,
  layout: "grid",
  density: 28,
  spacing: 1,
  letterScale: 0.82,
  // How strongly the uppercase letter appears on the grid (0 = flat field)
  shapeAmount: 1,
  // Controls for ONLY the glyphs that form the uppercase letter
  shapeSize: 2.15,
  shapeWeight: 800,
  shapeSoftness: 0.35,
  bgDensity: 1,
  warp: 0,
  bulge: 0,
  twist: 0,
  lightIntensity: 0.4,
  ambient: 1,
  lightX: -0.4,
  lightY: -0.55,
  rimLight: 0,
  glow: 0,
  speed: 0.5,
  // Animation modes (each has dedicated controls; always affect all glyphs)
  animWave: false,
  waveAmount: 0.35,
  waveSpeed: 1,
  waveScale: 2.4,
  animDrift: false,
  driftAmount: 0.1,
  driftSpeed: 0.7,
  animShake: false,
  shakeAmount: 0.12,
  shakeSpeed: 2.4,
  animPointerSpin: false,
  pointerSpinAmount: 1,
  pointerSpinLag: 0.18,
  animPulse: false,
  pulseAmount: 0.18,
  pulseSpeed: 1.2,
  animTwinkle: false,
  twinkleAmount: 0.22,
  twinkleSpeed: 1.5,
  animRipple: false,
  rippleAmount: 0.25,
  rippleRadius: 0.28,
  animBubble: false,
  bubbleAmount: 0.9,
  bubbleRadius: 0.36,
  bubbleSpeed: 0.55,
  bubbleScale: 1,
  autoMorph: false,
  followPointer: false,
  organic: false,
  theme: "light",
  bgColor: "#ffffff",
  inkColor: "#111111",
};

function normalizeHex(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function themeColors(theme) {
  if (theme === "dark") return { bgColor: "#000000", inkColor: "#ffffff" };
  return { bgColor: "#ffffff", inkColor: "#111111" };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function particleChar(letter) {
  const ch = String(letter || "G").slice(0, 1);
  if (/^[A-Za-z]$/.test(ch)) return ch.toLowerCase();
  return ch;
}

function hash01(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class LetterFieldEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.params = { ...DEFAULTS, ...options };
    this.params.bgColor = normalizeHex(this.params.bgColor, DEFAULTS.bgColor);
    this.params.inkColor = normalizeHex(this.params.inkColor, DEFAULTS.inkColor);
    this.params.word = normalizeWord(this.params.word);
    if (Number.isFinite(this.params.wordMerge)) {
      if (this.params.wordMerge > 0 && this.params.wordMerge <= 1) {
        this.params.wordMerge = Math.round(this.params.wordMerge * 100);
      }
      this.params.wordMerge = Math.max(-20, Math.min(100, this.params.wordMerge));
    }
    const sourceLetter = this.params.word
      ? this.params.word.slice(0, 1)
      : this.params.letter;
    this.params.particle = particleChar(sourceLetter);
    this.letterField = null;
    this.time = 0;
    this.paused = false;
    this.pointer = { x: 0, y: 0, active: false, px: 0, py: 0, angle: 0 };
    this.morph = 1;
    this._morphDir = 1;
    this._raf = 0;
    this._last = 0;
    this._tempFollow = false;
    this._glyphSprite = null;
    this._shapeSprite = null;
    this._glyphSprites = new Map();
    this._glyphKey = "";
    this._samples = [];
    this._sampleKey = "";
    this._imageEl = null;
    this.rebuildLetter();
    this.rebuildGlyphSprite();
    this.rebuildSamples();
    this._ready = this.params.imageSrc
      ? this.loadImageSrc(this.params.imageSrc).catch((err) => {
          console.warn("Could not restore image field:", err);
        })
      : Promise.resolve();
  }

  ready() {
    return this._ready || Promise.resolve();
  }

  static defaults() {
    return { ...DEFAULTS };
  }

  setParams(partial) {
    const prev = { ...this.params };
    Object.assign(this.params, partial);
    if (partial.theme && !partial.bgColor && !partial.inkColor) {
      Object.assign(this.params, themeColors(this.params.theme));
    }
    this.params.bgColor = normalizeHex(this.params.bgColor, DEFAULTS.bgColor);
    this.params.inkColor = normalizeHex(this.params.inkColor, DEFAULTS.inkColor);
    this.params.word = normalizeWord(this.params.word);
    if (Number.isFinite(this.params.wordMerge)) {
      if (this.params.wordMerge > 0 && this.params.wordMerge <= 1) {
        this.params.wordMerge = Math.round(this.params.wordMerge * 100);
      }
      this.params.wordMerge = Math.max(-20, Math.min(100, this.params.wordMerge));
    }
    // Particle follows active shape source (word first letter, else main letter)
    const sourceLetter = this.params.word
      ? this.params.word.slice(0, 1)
      : this.params.letter;
    this.params.particle = particleChar(sourceLetter);

    if (this.params.imageSrc !== prev.imageSrc) {
      this._ready = this.loadImageSrc(this.params.imageSrc).catch((err) => {
        console.warn("Could not load image field:", err);
      });
    } else if (
      this.params.letter !== prev.letter ||
      this.params.word !== prev.word ||
      this.params.wordMerge !== prev.wordMerge ||
      this.params.letterScale !== prev.letterScale ||
      this.params.fontFamily !== prev.fontFamily ||
      this.params.imageInvert !== prev.imageInvert ||
      this.params.imageThreshold !== prev.imageThreshold
    ) {
      this.rebuildLetter();
    }

    if (
      this.params.letter !== prev.letter ||
      this.params.word !== prev.word ||
      this.params.imageSrc !== prev.imageSrc ||
      this.params.particle !== prev.particle ||
      this.params.fontFamily !== prev.fontFamily ||
      this.params.fontWeight !== prev.fontWeight ||
      this.params.shapeWeight !== prev.shapeWeight ||
      this.params.stroke !== prev.stroke ||
      this.params.filledGlyphs !== prev.filledGlyphs ||
      this.params.theme !== prev.theme ||
      this.params.inkColor !== prev.inkColor
    ) {
      this.rebuildGlyphSprite();
    }

    if (
      this.params.layout !== prev.layout ||
      this.params.density !== prev.density ||
      this.params.spacing !== prev.spacing ||
      this.params.organic !== prev.organic ||
      this.params.jitter !== prev.jitter
    ) {
      this.rebuildSamples();
    }
  }

  async loadImageSrc(src) {
    if (!src) {
      this._imageEl = null;
      this.rebuildLetter();
      this.rebuildGlyphSprite();
      return;
    }
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not read image"));
      img.src = src;
    });
    this._imageEl = img;
    this.rebuildLetter();
    this.rebuildGlyphSprite();
  }

  rebuildLetter() {
    const p = this.params;
    if (p.imageSrc && this._imageEl) {
      this.letterField = createImageField(this._imageEl, {
        scale: p.letterScale,
        invert: Boolean(p.imageInvert),
        threshold: p.imageThreshold ?? 0.48,
      });
      return;
    }
    if (p.word && p.word.length > 1) {
      this.letterField = createWordField(
        p.word,
        p.letterScale,
        p.fontFamily,
        p.wordMerge
      );
    } else if (p.word && p.word.length === 1) {
      this.letterField = createLetterField(p.word, p.letterScale, p.fontFamily);
    } else {
      this.letterField = createLetterField(
        p.letter,
        p.letterScale,
        p.fontFamily
      );
    }
  }

  activeChars() {
    if (this.letterField?.mode === "image") {
      return this.letterField.chars || "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    }
    if (this.letterField?.chars?.length) return this.letterField.chars;
    if (this.params.word) return normalizeWord(this.params.word).split("");
    return [String(this.params.letter || "G").slice(0, 1).toUpperCase()];
  }

  rebuildGlyphSprite() {
    const p = this.params;
    const chars = this.activeChars();
    const lowers = [...new Set(chars.map((ch) => particleChar(ch)))];
    const bgWeight = Math.round(p.fontWeight / 100) * 100;
    const shapeWeight = Math.round(p.shapeWeight / 100) * 100;
    const ink = p.inkColor || (p.theme === "light" ? "#111111" : "#ffffff");
    const key = `${lowers.join("")}|${p.fontFamily}|${bgWeight}|${shapeWeight}|${p.stroke}|${p.filledGlyphs}|${ink}`;
    if (key === this._glyphKey && this._glyphSprites.size) {
      this._glyphSprite = this._glyphSprites.get(lowers[0])?.bg || null;
      this._shapeSprite = this._glyphSprites.get(lowers[0])?.shape || null;
      return;
    }
    this._glyphKey = key;
    this._glyphSprites = new Map();

    const bake = (glyph, weight) => {
      const size = 72;
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const g = c.getContext("2d");
      g.clearRect(0, 0, size, size);
      g.fillStyle = ink;
      g.strokeStyle = ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `${weight} 48px "${p.fontFamily}", "Helvetica Neue", Arial, sans-serif`;
      if (p.filledGlyphs) g.fillText(glyph, size / 2, size / 2 + 1);
      if (p.stroke > 0.05) {
        g.lineWidth = Math.max(0.9, p.stroke * 1.8);
        g.lineJoin = "round";
        g.strokeText(glyph, size / 2, size / 2 + 1);
      }
      return c;
    };

    for (const glyph of lowers) {
      this._glyphSprites.set(glyph, {
        bg: bake(glyph, bgWeight),
        shape: bake(glyph, shapeWeight),
      });
    }
    this._glyphSprite = this._glyphSprites.get(lowers[0])?.bg || null;
    this._shapeSprite = this._glyphSprites.get(lowers[0])?.shape || null;
  }

  spriteFor(nx, ny, shapeMix) {
    const owner =
      this.letterField?.letterAt?.(nx, ny) ||
      this.activeChars()[0] ||
      this.params.letter;
    const key = particleChar(owner);
    const pair = this._glyphSprites.get(key);
    if (!pair) {
      return shapeMix > 0.45 ? this._shapeSprite : this._glyphSprite;
    }
    return shapeMix > 0.45 ? pair.shape : pair.bg;
  }

  /**
   * Precompute static sample positions once — animate by rotating / waving them.
   * Dense field like the references (almost no gaps).
   */
  rebuildSamples() {
    const p = this.params;
    const density = Math.min(72, Math.round(p.density));
    const spacing = p.spacing;
    const samples = [];
    const key = `${p.layout}|${density}|${spacing}|${p.organic}|${p.jitter}`;
    if (key === this._sampleKey && this._samples.length) return;
    this._sampleKey = key;

    if (p.layout === "radial") {
      // Concentric rings — matches spiral G references
      const rings = Math.max(14, Math.round(density * 0.55));
      for (let r = 1; r <= rings; r++) {
        const radius = (r / rings) * 0.495 * spacing;
        // denser angular packing like the refs
        const count = Math.max(8, Math.round(r * 5.8 * (1.05 / Math.max(0.7, spacing))));
        for (let i = 0; i < count; i++) {
          const a0 = (i / count) * Math.PI * 2 + r * 0.045;
          let jr = 0;
          let ja = 0;
          if (p.organic) {
            jr = (hash01(i, r) - 0.5) * 0.006 * p.jitter;
            ja = (hash01(i + 3, r + 5) - 0.5) * 0.04 * p.jitter;
          }
          samples.push({
            radius: radius + jr,
            a0: a0 + ja,
            ringT: r / rings,
            i,
            j: r,
          });
        }
      }
    } else if (p.layout === "flow") {
      const cols = Math.round(density * 0.85);
      const rows = Math.round(density * 0.85);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          let nx = ((i + 0.5) / cols - 0.5) * spacing;
          let ny = ((j + 0.5) / rows - 0.5) * spacing;
          if (p.organic) {
            nx += (hash01(i, j) - 0.5) * 0.01 * p.jitter;
            ny += (hash01(i + 9, j + 2) - 0.5) * 0.01 * p.jitter;
          }
          samples.push({ nx, ny, i, j, ringT: 0.5 });
        }
      }
    } else {
      // Full artboard grid — equal cell spacing, edge to edge (start state)
      const cols = Math.max(2, density);
      const rows = Math.max(2, density);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          // Cell centers across the full square [-0.5, 0.5]
          let nx = ((i + 0.5) / cols - 0.5) * spacing;
          let ny = ((j + 0.5) / rows - 0.5) * spacing;
          if (p.organic && p.jitter > 0) {
            nx += (hash01(i, j) - 0.5) * 0.008 * p.jitter;
            ny += (hash01(i + 4, j + 7) - 0.5) * 0.008 * p.jitter;
          }
          samples.push({ nx, ny, i, j, ringT: 0.5 });
        }
      }
    }

    this._samples = samples;
  }

  setPointer(nx, ny, active) {
    const prevX = this.pointer.x;
    const prevY = this.pointer.y;
    this.pointer.px = prevX;
    this.pointer.py = prevY;
    this.pointer.x = nx;
    this.pointer.y = ny;
    this.pointer.active = active;
    const dx = nx - prevX;
    const dy = ny - prevY;
    if (dx * dx + dy * dy > 1e-8) {
      const target = Math.atan2(dy, dx);
      const lag = this.params.pointerSpinLag || 0.18;
      let cur = this.pointer.angle;
      let diff = target - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.pointer.angle = cur + diff * clamp(lag * 3, 0.05, 1);
    }
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.033, (now - this._last) / 1000);
      this._last = now;
      if (!this.paused) {
        // Smooth constant-time integration
        this.time += dt * this.params.speed;
        if (this.params.autoMorph) {
          this.morph += dt * 0.12 * this._morphDir * Math.max(0.15, this.params.speed);
          if (this.morph >= 1) {
            this.morph = 1;
            this._morphDir = -1;
          } else if (this.morph <= 0.55) {
            this.morph = 0.55;
            this._morphDir = 1;
          }
        } else {
          this.morph = 1;
        }
      }
      this.draw();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /**
   * Soft membership in the uppercase letter shape (0 outside → 1 inside).
   */
  influence(nx, ny) {
    const d = this.letterField.sample(nx, ny);
    const soft = Math.max(2, this.params.shapeSoftness * 28);
    const sdfOn = 1 - smoothstep(-soft * 0.35, soft, d);
    let on = sdfOn;
    if (typeof this.letterField.sampleLuma === "function") {
      const luma = this.letterField.sampleLuma(nx, ny);
      const t = this.params.imageThreshold ?? 0.48;
      const band = Math.max(0.04, this.params.shapeSoftness * 0.55);
      const photo = smoothstep(t - band, t + band * 0.35, luma);
      on = clamp(photo * 0.82 + sdfOn * 0.18, 0, 1);
    }
    const fill = d < 0 ? 1 : 0;
    const edge = Math.exp(-(d * d) / (soft * soft));
    return { d, fill, edge, on: clamp(on, 0, 1) };
  }

  anyAnimOn() {
    const p = this.params;
    return !!(
      p.animWave ||
      p.animDrift ||
      p.animShake ||
      p.animPointerSpin ||
      p.animPulse ||
      p.animTwinkle ||
      p.animRipple ||
      p.animBubble
    );
  }

  draw() {
    const { canvas, ctx, params } = this;
    const bgSprite = this._glyphSprite;
    const shapeSprite = this._shapeSprite || bgSprite;
    if (!bgSprite || !this._samples.length) return;

    const W = canvas.width;
    const H = canvas.height;
    const size = W < H ? W : H;
    const cx = W * 0.5;
    const cy = H * 0.5;
    ctx.fillStyle = params.bgColor || (params.theme === "light" ? "#ffffff" : "#000000");
    ctx.fillRect(0, 0, W, H);

    const t = this.time;
    const morph = this.morph;
    const shapeAmt = (params.shapeAmount ?? 1) * morph;
    const bulge = params.bulge * morph;
    const warp = params.warp * morph;
    const layout = params.layout;
    const density = Math.min(72, Math.round(params.density));
    const cell = size / Math.max(2, density);
    const bgGlyph = cell * params.glyphSize;
    const shapeGlyph = cell * params.glyphSize * (params.shapeSize ?? 2);
    const animOn = this.anyAnimOn();

    const flat =
      layout === "grid" &&
      shapeAmt < 0.02 &&
      warp < 0.02 &&
      bulge < 0.02 &&
      !animOn;

    let lightX = params.lightX;
    let lightY = params.lightY;
    if (params.followPointer && this.pointer.active) {
      lightX = this.pointer.x * 2;
      lightY = this.pointer.y * 2;
    }
    const lLen = Math.hypot(lightX, lightY, 0.7) || 1;
    const lx = lightX / lLen;
    const ly = lightY / lLen;
    const lz = 0.7 / lLen;

    const ptrX = this.pointer.x;
    const ptrY = this.pointer.y;
    const ptrAngle = this.pointer.angle;

    let bubbleX = 0;
    let bubbleY = 0;
    if (params.animBubble) {
      const bt = t * (params.bubbleSpeed || 0.55);
      bubbleX = Math.sin(bt * 0.62) * 0.18 + Math.sin(bt * 0.27 + 1.4) * 0.14;
      bubbleY = Math.cos(bt * 0.51) * 0.16 + Math.sin(bt * 0.33 + 0.6) * 0.12;
      if (this.pointer.active) {
        bubbleX += (ptrX - bubbleX) * 0.72;
        bubbleY += (ptrY - bubbleY) * 0.72;
      }
    }

    ctx.imageSmoothingEnabled = true;
    const samples = this._samples;

    if (flat) {
      const dw = (72 * Math.max(3.2, bgGlyph)) / 48;
      ctx.globalAlpha = 1;
      for (let s = 0; s < samples.length; s++) {
        const sm = samples[s];
        const x = cx + sm.nx * size;
        const y = cy + sm.ny * size;
        const sprite = this.spriteFor(sm.nx, sm.ny, 0) || bgSprite;
        ctx.drawImage(sprite, x - dw / 2, y - dw / 2, dw, dw);
      }
      return;
    }

    for (let s = 0; s < samples.length; s++) {
      const sm = samples[s];
      let nx = layout === "radial" ? 0 : sm.nx;
      let ny = layout === "radial" ? 0 : sm.ny;
      let angle = 0;
      let homeX;
      let homeY;

      if (layout === "radial") {
        const a = sm.a0;
        homeX = Math.cos(a) * sm.radius;
        homeY = Math.sin(a) * sm.radius;
        nx = homeX;
        ny = homeY;
        angle = a + Math.PI / 2;
      } else {
        homeX = sm.nx;
        homeY = sm.ny;
      }

      // Influence at home position so shape stays readable while animating
      const { d, fill, edge, on } = this.influence(homeX, homeY);
      const shapeMix = on * shapeAmt;

      if (params.animWave) {
        const ws = params.waveScale || 2.4;
        const wt = t * (params.waveSpeed || 1);
        const n1 = fbm(homeX * ws + wt * 0.35, homeY * ws - wt * 0.28, 1);
        const n2 = fbm(homeX * ws * 0.8 - wt * 0.22, homeY * ws * 0.8 + 4, 1);
        const amt = (params.waveAmount || 0) * 0.045;
        nx += (n1 - 0.5) * amt;
        ny += (n2 - 0.5) * amt;
      }

      if (params.animDrift) {
        const dt = t * (params.driftSpeed || 0.7);
        const seed = sm.i * 0.17 + sm.j * 0.31;
        const amt = (params.driftAmount || 0) * 0.05;
        nx += (fbm(seed + dt * 0.2, sm.j * 0.11, 1) - 0.5) * amt;
        ny += (fbm(seed + 9 + dt * 0.18, sm.i * 0.13, 1) - 0.5) * amt;
      }

      if (params.animShake) {
        const st = t * (params.shakeSpeed || 2.4);
        const amt = (params.shakeAmount || 0) * 0.018;
        nx += Math.sin(st * 17.1 + sm.i * 2.3 + sm.j) * amt;
        ny += Math.cos(st * 19.7 + sm.j * 2.1 + sm.i) * amt;
        angle += Math.sin(st * 13.3 + sm.i) * amt * 8;
      }

      if (params.animRipple) {
        const dx = homeX - ptrX;
        const dy = homeY - ptrY;
        const dist = Math.hypot(dx, dy) + 1e-4;
        const rad = params.rippleRadius || 0.28;
        const fall = Math.exp(-(dist * dist) / (rad * rad));
        const push = fall * (params.rippleAmount || 0) * 0.12;
        nx += (dx / dist) * push;
        ny += (dy / dist) * push;
      }

      let bubblePersp = 1;
      if (params.animBubble) {
        const dx = homeX - bubbleX;
        const dy = homeY - bubbleY;
        const dist = Math.hypot(dx, dy) + 1e-5;
        const R = Math.max(0.06, params.bubbleRadius || 0.36);
        const u = dist / R;
        if (u < 1.45) {
          const sphere = u < 1 ? Math.sqrt(Math.max(0, 1 - u * u)) : 0;
          const rim = u < 1 ? 1 : Math.exp(-((u - 1) * 3.2) ** 2);
          const z = sphere * rim;
          const amt = params.bubbleAmount || 0;
          const cam = 1.2;
          bubblePersp = cam / Math.max(0.22, cam - z * amt);
          const ox = nx - homeX;
          const oy = ny - homeY;
          nx = bubbleX + dx * bubblePersp + ox;
          ny = bubbleY + dy * bubblePersp + oy;
          angle += (Math.atan2(dy, dx) + Math.PI / 2) * z * amt * 0.9;
        }
      }

      if (params.animPointerSpin) {
        const toPtr = Math.atan2(ptrY - homeY, ptrX - homeX);
        angle += toPtr * (params.pointerSpinAmount || 1) * 0.35;
        angle += ptrAngle * (params.pointerSpinAmount || 1) * 0.65;
      }

      if (layout === "radial" && nx * nx + ny * ny > 0.3) continue;

      const g = this.letterField.gradient(homeX, homeY);
      const gLen = Math.hypot(g.x, g.y) + 1e-4;
      const gx = g.x / gLen;
      const gy = g.y / gLen;

      if (warp > 0.05 && shapeMix > 0.05) {
        if (d > 0) {
          const pull = edge * warp * 0.035 * shapeMix;
          nx -= gx * pull;
          ny -= gy * pull;
        } else {
          nx += gx * fill * warp * 0.02 * shapeMix;
          ny += gy * fill * warp * 0.02 * shapeMix;
        }
      }

      if (bulge > 0.01 && shapeMix > 0.05) {
        const radial = on * bulge * 0.06 * shapeMix;
        nx *= 1 + radial;
        ny *= 1 + radial;
      }

      const x = cx + nx * size;
      const y = cy + ny * size;

      let glyphPx = lerp(bgGlyph, shapeGlyph, shapeMix);
      if (layout === "radial") glyphPx *= 0.9 + sm.ringT * 0.18;

      if (params.animPulse) {
        const pt = t * (params.pulseSpeed || 1.2);
        const breathe = Math.sin(pt + sm.i * 0.2 + sm.j * 0.15);
        glyphPx *= 1 + breathe * (params.pulseAmount || 0) * 0.35;
      }

      if (bubblePersp !== 1) {
        glyphPx *= 1 + (bubblePersp - 1) * (params.bubbleScale ?? 1);
      }

      const nz = 0.7 + shapeMix * 0.35;
      const nLen = Math.hypot(gx * 0.5, gy * 0.5, nz) || 1;
      const ndot =
        (-gx * 0.5 * lx) / nLen +
        (-gy * 0.5 * ly) / nLen +
        (nz * lz) / nLen;
      const diffuse = ndot > 0 ? ndot : 0;
      const rim = (1 - diffuse) * (1 - diffuse) * edge * params.rimLight * shapeMix;
      let lit = clamp(
        params.ambient * 0.85 +
          (0.55 + diffuse * params.lightIntensity) * lerp(0.75, 1.1, shapeMix) +
          rim,
        0.2,
        1.4
      );

      if (params.animTwinkle) {
        const tt = t * (params.twinkleSpeed || 1.5);
        const flicker = 0.5 + 0.5 * Math.sin(tt * 3.1 + sm.i * 1.7 + sm.j * 2.3);
        lit *= 1 - (params.twinkleAmount || 0) * (1 - flicker);
      }

      const alpha = clamp(lit * params.bgDensity, 0.12, 1);
      const stretch = 1 + shapeMix * bulge * 0.18;
      const drawScale = Math.max(3.2, glyphPx) / 48;
      const dw = 72 * drawScale;
      const dh = 72 * drawScale;
      const sprite = this.spriteFor(homeX, homeY, shapeMix) || (shapeMix > 0.45 ? shapeSprite : bgSprite);

      ctx.save();
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      if (stretch !== 1) ctx.scale(stretch, 1 / Math.sqrt(stretch));
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  toQuery() {
    const p = this.params;
    const q = new URLSearchParams();
    Object.entries(p).forEach(([key, value]) => {
      if (key === "imageSrc") return; // too large for a URL
      if (typeof value === "boolean") q.set(key, value ? "1" : "0");
      else q.set(key, String(value));
    });
    return q.toString();
  }

  static fromQuery(search) {
    const q = new URLSearchParams(search);
    const out = { ...DEFAULTS };
    const numKeys = new Set([
      "fontWeight", "glyphSize", "stroke", "density", "spacing", "letterScale",
      "shapeAmount", "shapeSize", "shapeWeight", "shapeSoftness",
      "bgDensity", "warp", "bulge", "twist", "lightIntensity",
      "ambient", "lightX", "lightY", "rimLight", "glow", "speed",
      "waveAmount", "waveSpeed", "waveScale", "driftAmount", "driftSpeed",
      "shakeAmount", "shakeSpeed", "pointerSpinAmount", "pointerSpinLag",
      "pulseAmount", "pulseSpeed", "twinkleAmount", "twinkleSpeed",
      "rippleAmount", "rippleRadius", "bubbleAmount", "bubbleRadius",
      "bubbleSpeed", "bubbleScale", "wordMerge", "imageThreshold",
    ]);
    const boolKeys = new Set([
      "filledGlyphs", "autoMorph", "followPointer", "organic",
      "animWave", "animDrift", "animShake", "animPointerSpin",
      "animPulse", "animTwinkle", "animRipple", "animBubble", "imageInvert",
    ]);

    if (q.has("letter")) out.letter = q.get("letter").slice(0, 1).toUpperCase() || "G";
    if (q.has("word")) out.word = normalizeWord(q.get("word"));
    out.particle = particleChar(out.word ? out.word.slice(0, 1) : out.letter);
    if (q.has("fontFamily")) out.fontFamily = q.get("fontFamily");
    if (q.has("layout")) out.layout = q.get("layout");
    if (q.has("theme")) out.theme = q.get("theme") === "dark" ? "dark" : q.get("theme") === "custom" ? "custom" : "light";
    if (q.has("bgColor")) out.bgColor = normalizeHex(q.get("bgColor"), out.bgColor);
    if (q.has("inkColor")) out.inkColor = normalizeHex(q.get("inkColor"), out.inkColor);
    if (!q.has("bgColor") && !q.has("inkColor")) {
      Object.assign(out, themeColors(out.theme));
    }

    numKeys.forEach((key) => {
      if (!q.has(key)) return;
      const v = parseFloat(q.get(key));
      if (Number.isFinite(v)) out[key] = v;
    });
    boolKeys.forEach((key) => {
      if (!q.has(key)) return;
      out[key] = q.get(key) === "1" || q.get(key) === "true";
    });

    if (q.has("ringSize") && !q.has("glyphSize")) {
      const v = parseFloat(q.get("ringSize"));
      if (Number.isFinite(v)) out.glyphSize = v;
    }
    if (q.has("letterContrast") && !q.has("shapeAmount")) {
      const v = parseFloat(q.get("letterContrast"));
      if (Number.isFinite(v)) out.shapeAmount = Math.max(0, Math.min(1, v / 2.5));
    }
    if (out.density > 72) out.density = 72;
    // Migrate old 0–1 merge scale → −20…100
    if (Number.isFinite(out.wordMerge) && out.wordMerge > 0 && out.wordMerge <= 1) {
      out.wordMerge = Math.round(out.wordMerge * 100);
    }
    out.wordMerge = Math.max(-20, Math.min(100, out.wordMerge ?? 45));
    return out;
  }
}
