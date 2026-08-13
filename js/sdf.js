/**
 * Build a signed distance field from a letter or word drawn on an offscreen canvas.
 * Positive = outside glyph, negative = inside glyph fill.
 */

const SDF_SIZE = 320;

export const LATIN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const HEBREW_LETTERS = "אבגדהוזחטיכלמנסעפצקרשת".split("");

const HEBREW_RE = /[\u0590-\u05FF]/;
const FONT_FALLBACK = `"Noto Sans Hebrew", "Heebo", "Arial Hebrew", "Helvetica Neue", Arial, sans-serif`;

export function isHebrewChar(ch) {
  return HEBREW_RE.test(String(ch || ""));
}

export function normalizeScript(script) {
  return script === "hebrew" ? "hebrew" : "latin";
}

export function detectScript(text, fallback = "latin") {
  if (HEBREW_RE.test(String(text || ""))) return "hebrew";
  if (/[A-Za-z]/.test(String(text || ""))) return "latin";
  return normalizeScript(fallback);
}

export function alphabetFor(script) {
  return normalizeScript(script) === "hebrew" ? HEBREW_LETTERS.slice() : LATIN_LETTERS.slice();
}

export function defaultLetter(script) {
  return normalizeScript(script) === "hebrew" ? "א" : "G";
}

export function normalizeLetter(letter, script = "latin") {
  const ch = String(letter || "").slice(0, 1);
  if (normalizeScript(script) === "hebrew" || isHebrewChar(ch)) {
    return isHebrewChar(ch) ? ch : defaultLetter("hebrew");
  }
  const up = ch.toUpperCase();
  return /^[A-Z]$/.test(up) ? up : defaultLetter("latin");
}

function normalizeWord(text, script = "latin") {
  const raw = String(text || "");
  if (normalizeScript(script) === "hebrew" || HEBREW_RE.test(raw)) {
    return raw.replace(/[^\u0590-\u05FF]/g, "").slice(0, 10);
  }
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
}

function fontFace(weight, px, fontFamily) {
  return `${weight} ${px}px "${fontFamily}", ${FONT_FALLBACK}`;
}

function paintLetter(ctx, letter, size, scale, fontFamily = "Arial Black") {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = size * scale;
  ctx.font = fontFace(900, fontSize, fontFamily);
  ctx.save();
  ctx.translate(size / 2, size / 2 + fontSize * 0.03);
  ctx.scale(1.04, 1);
  ctx.fillText(letter, 0, 0);
  ctx.restore();
}

/**
 * Paint a word with slight letter overlap (merge) and an ownership id buffer.
 * idBuf stores 1-based letter index per pixel (0 = empty).
 */
function paintWord(ctx, idCtx, chars, size, scale, fontFamily, merge) {
  ctx.clearRect(0, 0, size, size);
  idCtx.clearRect(0, 0, size, size);

  const n = chars.length;
  const fit = Math.min(1, 2.15 / (n + 0.65));
  const fontSize = size * scale * fit;
  const font = fontFace(900, fontSize, fontFamily);
  ctx.font = font;
  idCtx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  idCtx.textAlign = "center";
  idCtx.textBaseline = "middle";
  ctx.fillStyle = "#fff";

  const gap =
    merge >= 0
      ? -fontSize * (0.06 + (merge / 100) * 0.28)
      : fontSize * ((-merge) / 100) * 0.9;
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += widths[i];
    if (i < n - 1) total += gap;
  }

  const y = size / 2 + fontSize * 0.03;
  const rtl = chars.some((ch) => HEBREW_RE.test(ch));
  let x = rtl ? size / 2 + total / 2 : size / 2 - total / 2;

  for (let i = 0; i < n; i++) {
    const w = widths[i];
    const cx = rtl ? x - w / 2 : x + w / 2;
    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(1.02, 1);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();

    // Ownership: paint each letter into its own R-channel id
    idCtx.fillStyle = `rgb(${i + 1},0,0)`;
    idCtx.save();
    idCtx.translate(cx, y);
    idCtx.scale(1.02, 1);
    idCtx.fillText(chars[i], 0, 0);
    idCtx.restore();

    if (rtl) x -= w + gap;
    else x += w + gap;
  }
}

function maskFromAlpha(ctx, size) {
  const { data } = ctx.getImageData(0, 0, size, size);
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;
  }
  return mask;
}

function idBufferFromCanvas(ctx, size) {
  const { data } = ctx.getImageData(0, 0, size, size);
  const ids = new Uint8Array(size * size);
  for (let i = 0; i < ids.length; i++) {
    const a = data[i * 4 + 3];
    ids[i] = a > 128 ? data[i * 4] : 0;
  }
  return ids;
}

function distanceTransform(mask) {
  const w = SDF_SIZE;
  const h = SDF_SIZE;
  const INF = 1e6;
  const dist = new Float32Array(w * h);

  for (let i = 0; i < dist.length; i++) {
    dist[i] = mask[i] ? 0 : INF;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
      if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - w - 1] + 1.41421356);
      if (x < w - 1 && y > 0) dist[i] = Math.min(dist[i], dist[i - w + 1] + 1.41421356);
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
      if (x < w - 1 && y < h - 1) dist[i] = Math.min(dist[i], dist[i + w + 1] + 1.41421356);
      if (x > 0 && y < h - 1) dist[i] = Math.min(dist[i], dist[i + w - 1] + 1.41421356);
    }
  }

  return dist;
}

function buildFieldFromMask(mask, letterLabel, chars, ids) {
  const outside = distanceTransform(mask);
  const inverted = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inverted[i] = mask[i] ? 0 : 1;
  const inside = distanceTransform(inverted);

  const sdf = new Float32Array(mask.length);
  for (let i = 0; i < sdf.length; i++) {
    sdf[i] = mask[i] ? -inside[i] : outside[i];
  }

  const size = SDF_SIZE;
  const list = chars && chars.length ? chars : [letterLabel];

  function sample(nx, ny) {
    const u = (nx + 0.5) * (size - 1);
    const v = (ny + 0.5) * (size - 1);
    const x = Math.max(0, Math.min(size - 1.001, u));
    const y = Math.max(0, Math.min(size - 1.001, v));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(size - 1, x0 + 1);
    const y1 = Math.min(size - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const a = sdf[y0 * size + x0];
    const b = sdf[y0 * size + x1];
    const c = sdf[y1 * size + x0];
    const d = sdf[y1 * size + x1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }

  function gradient(nx, ny, eps = 0.0035) {
    const dx = sample(nx + eps, ny) - sample(nx - eps, ny);
    const dy = sample(nx, ny + eps) - sample(nx, ny - eps);
    return { x: dx / (2 * eps), y: dy / (2 * eps) };
  }

  function letterAt(nx, ny) {
    if (!ids || list.length <= 1) return list[0];
    const u = Math.round((nx + 0.5) * (size - 1));
    const v = Math.round((ny + 0.5) * (size - 1));
    const x = Math.max(0, Math.min(size - 1, u));
    const y = Math.max(0, Math.min(size - 1, v));
    let id = ids[y * size + x];
    if (id > 0 && id <= list.length) return list[id - 1];

    // Outside ink: pick nearest letter by scanning a small neighborhood, else by x-slot
    let found = 0;
    for (let r = 1; r <= 12 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const vId = ids[yy * size + xx];
          if (vId > 0 && vId <= list.length) found = vId;
        }
      }
    }
    if (found) return list[found - 1];

    const t = clamp01(nx + 0.5);
    const idx = Math.min(list.length - 1, Math.max(0, Math.floor(t * list.length)));
    return list[idx];
  }

  return {
    letter: letterLabel,
    word: list.join(""),
    chars: list,
    sample,
    gradient,
    letterAt,
    size,
  };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function createLetterField(letter, scale = 0.72, fontFamily = "Arial Black", script = "latin") {
  const glyph = normalizeLetter(letter, script);
  const canvas = document.createElement("canvas");
  canvas.width = SDF_SIZE;
  canvas.height = SDF_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  paintLetter(ctx, glyph, SDF_SIZE, scale, fontFamily);
  const mask = maskFromAlpha(ctx, SDF_SIZE);
  return buildFieldFromMask(mask, glyph, [glyph], null);
}

const ALPHA = LATIN_LETTERS;

function hash01(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function sampleScalar(buf, nx, ny, size) {
  const u = (nx + 0.5) * (size - 1);
  const v = (ny + 0.5) * (size - 1);
  const x = Math.max(0, Math.min(size - 1.001, u));
  const y = Math.max(0, Math.min(size - 1.001, v));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = buf[y0 * size + x0];
  const b = buf[y0 * size + x1];
  const c = buf[y1 * size + x0];
  const d = buf[y1 * size + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/**
 * Image field: photo becomes a letter mosaic (random a–z).
 * Dark areas (or light if invert) read as the “shape”, same as a big letter.
 */
export function createImageField(image, {
  scale = 0.82,
  invert = false,
  threshold = 0.5,
  chars = LATIN_LETTERS,
} = {}) {
  const size = SDF_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);

  const iw = image.naturalWidth || image.width || 1;
  const ih = image.naturalHeight || image.height || 1;
  const box = size * clamp01(scale);
  const r = Math.min(box / iw, box / ih);
  const dw = Math.max(1, iw * r);
  const dh = Math.max(1, ih * r);
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  ctx.drawImage(image, dx, dy, dw, dh);

  const { data } = ctx.getImageData(0, 0, size, size);
  const ink = new Float32Array(size * size);
  const mask = new Uint8Array(size * size);
  const cut = Math.max(0.02, Math.min(0.98, threshold));

  for (let i = 0; i < ink.length; i++) {
    const o = i * 4;
    const a = data[o + 3] / 255;
    if (a < 0.08) {
      ink[i] = 0;
      mask[i] = 0;
      continue;
    }
    const luma = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
    const v = (invert ? luma : 1 - luma) * a;
    ink[i] = v;
    mask[i] = v >= cut ? 1 : 0;
  }

  const pool = Array.isArray(chars) && chars.length ? chars.slice() : LATIN_LETTERS.slice();
  const field = buildFieldFromMask(mask, pool[0], pool, null);
  field.mode = "image";
  field.chars = pool;
  field.sampleLuma = (nx, ny) => sampleScalar(ink, nx, ny, size);
  field.letterAt = (nx, ny) => {
    const h = hash01(Math.floor((nx + 2) * 131.7), Math.floor((ny + 2) * 197.3));
    return pool[Math.floor(h * pool.length)];
  };
  return field;
}

/**
 * Word field: each letter forms one shape; merge pulls letters together so
 * small glyphs blend where letters meet.
 */
export function createWordField(word, scale = 0.72, fontFamily = "Arial Black", merge = 45, script = "latin") {
  const chars = normalizeWord(word, script).split("");
  if (chars.length <= 1) {
    return createLetterField(chars[0] || defaultLetter(script), scale, fontFamily, script);
  }

  const canvas = document.createElement("canvas");
  canvas.width = SDF_SIZE;
  canvas.height = SDF_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const idCanvas = document.createElement("canvas");
  idCanvas.width = SDF_SIZE;
  idCanvas.height = SDF_SIZE;
  const idCtx = idCanvas.getContext("2d", { willReadFrequently: true });

  paintWord(ctx, idCtx, chars, SDF_SIZE, scale, fontFamily, merge);
  const mask = maskFromAlpha(ctx, SDF_SIZE);
  const ids = idBufferFromCanvas(idCtx, SDF_SIZE);
  return buildFieldFromMask(mask, chars[0], chars, ids);
}

export { normalizeWord, fontFace };
