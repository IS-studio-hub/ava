/**
 * Embed snippet + canvas video export helpers.
 * 4K / 1080p / 720p → MP4 only. Web → WebM (smaller).
 */

/** Square export presets (artboard is 1:1). */
export const VIDEO_PRESETS = {
  "4k": { label: "4K", size: 2160, fps: 30, bits: 28_000_000, format: "mp4" },
  "1080p": { label: "1080p", size: 1080, fps: 30, bits: 12_000_000, format: "mp4" },
  "720p": { label: "720p", size: 720, fps: 30, bits: 6_000_000, format: "mp4" },
  "480p": { label: "480p", size: 480, fps: 30, bits: 2_500_000, format: "mp4" },
  web: { label: "Web", size: 480, fps: 24, bits: 2_000_000, format: "webm" },
};

export const MAX_RECORD_MS = 60_000;

export function resultUrl(paramsQuery, absolute = true) {
  const path = `result.html?${paramsQuery}`;
  if (!absolute || typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

export function embedUrl(saveId, absolute = true) {
  const path = `embed.html?id=${encodeURIComponent(saveId)}`;
  if (!absolute || typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

export function buildEmbedCode(saveId, { width = 720, height = 720 } = {}) {
  const src = embedUrl(saveId, true);
  return `<iframe
  src="${src}"
  width="${width}"
  height="${height}"
  style="border:0;border-radius:0;max-width:100%;aspect-ratio:1/1;background:#000"
  allow="autoplay"
  loading="lazy"
  title="Ava letter field embed"
></iframe>`;
}

function pickMime(prefer = "any") {
  const mp4 = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401F",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=h264",
    "video/mp4",
  ];
  const webm = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const webmFast = [
    "video/webm;codecs=vp8",
    "video/webm",
    "video/webm;codecs=vp9",
  ];
  const list =
    prefer === "mp4" ? mp4 :
    prefer === "webm-vp8" ? webmFast :
    prefer === "webm" ? webm :
    [...mp4, ...webm];

  for (const type of list) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

function extensionForFormat(format) {
  return format === "mp4" ? "mp4" : "webm";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Record canvas to a Blob (no download).
 */
export function captureCanvasVideo(canvas, {
  durationSec = 6,
  fps = 30,
  bitsPerSecond = 8_000_000,
  preferMime = "any",
  onProgress,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.captureStream !== "function") {
      reject(new Error("Canvas capture is not supported in this browser."));
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      reject(new Error("Video recording is not supported in this browser."));
      return;
    }

    let mime = pickMime(preferMime);
    if (!mime && preferMime === "mp4") mime = pickMime("webm");
    if (!mime) {
      reject(new Error("No supported video format found for recording."));
      return;
    }

    const stream = canvas.captureStream(fps);
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: bitsPerSecond,
      });
    } catch (err) {
      reject(err);
      return;
    }

    const started = performance.now();
    let progressTimer = 0;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onerror = (e) => {
      clearInterval(progressTimer);
      reject(e.error || new Error("Recording failed."));
    };

    recorder.onstop = () => {
      clearInterval(progressTimer);
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mime });
      if (onProgress) onProgress(1);
      resolve({ blob, mime });
    };

    recorder.start(200);
    if (onProgress) {
      onProgress(0);
      progressTimer = setInterval(() => {
        const t = (performance.now() - started) / (durationSec * 1000);
        onProgress(Math.min(0.99, t));
      }, 100);
    }

    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, Math.max(1000, durationSec * 1000));
  });
}

/**
 * Live artboard recording until stop() is called.
 */
export function startCanvasRecording(canvas, {
  fps = 30,
  bitsPerSecond = 8_000_000,
  preferMime = "webm",
} = {}) {
  if (!canvas || typeof canvas.captureStream !== "function") {
    throw new Error("Canvas capture is not supported in this browser.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Video recording is not supported in this browser.");
  }

  let mime = pickMime(preferMime);
  if (!mime && preferMime !== "any") mime = pickMime("any");
  if (!mime) throw new Error("No supported video format found for recording.");

  const stream = canvas.captureStream(fps);
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: bitsPerSecond,
    });
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw err;
  }

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const startedAt = performance.now();
  try {
    recorder.start(1000);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw err;
  }

  return {
    mime,
    startedAt,
    stop() {
      return new Promise((resolve, reject) => {
        if (!recorder || recorder.state === "inactive") {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: mime });
          resolve({ blob, mime, durationMs: Math.max(0, performance.now() - startedAt) });
          return;
        }
        recorder.onerror = (e) => {
          stream.getTracks().forEach((t) => t.stop());
          reject(e.error || new Error("Recording failed."));
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: mime });
          resolve({ blob, mime, durationMs: Math.max(0, performance.now() - startedAt) });
        };
        try {
          recorder.requestData();
        } catch {
          /* ignore */
        }
        recorder.stop();
      });
    },
  };
}

let ffmpegInstance = null;
let ffmpegLoading = null;

async function getFFmpeg(onStatus) {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    if (onStatus) onStatus("Loading MP4 converter…");
    const [{ FFmpeg }, { toBlobURL, fetchFile }] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm"),
      import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm"),
    ]);
    const ffmpeg = new FFmpeg();
    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg._fetchFile = fetchFile;
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoading;
  } catch (err) {
    ffmpegLoading = null;
    throw err;
  }
}

async function convertToMp4(blob, onStatus) {
  if (blob.type.includes("mp4")) return blob;

  const ffmpeg = await getFFmpeg(onStatus);
  if (onStatus) onStatus("Converting to MP4…");

  const inputName = blob.type.includes("webm") ? "input.webm" : "input.mkv";
  const data = await ffmpeg._fetchFile(blob);
  await ffmpeg.writeFile(inputName, data);

  // Re-encode to H.264 for broad MP4 playback (QuickTime, Instagram, etc.)
  await ffmpeg.exec([
    "-i", inputName,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "ultrafast",
    "-crf", "20",
    "-an",
    "-movflags", "+faststart",
    "output.mp4",
  ]);

  const out = await ffmpeg.readFile("output.mp4");
  try {
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile("output.mp4");
  } catch {
    /* ignore cleanup errors */
  }

  return new Blob([out.buffer], { type: "video/mp4" });
}

/**
 * Scale a recorded blob to a square MP4 preset and download it.
 */
export async function transcodeAndDownloadRecording(blob, {
  presetKey = "1080p",
  filenameBase = "ava-recording",
  onStatus,
} = {}) {
  if (!blob) throw new Error("No recording to download.");
  const preset = VIDEO_PRESETS[presetKey] || VIDEO_PRESETS["1080p"];
  const size = preset.size;
  const ffmpeg = await getFFmpeg(onStatus);
  if (onStatus) onStatus(`Converting to ${preset.label} MP4…`);

  const inputName = blob.type.includes("mp4") ? "input.mp4" : blob.type.includes("webm") ? "input.webm" : "input.mkv";
  const data = await ffmpeg._fetchFile(blob);
  await ffmpeg.writeFile(inputName, data);

  await ffmpeg.exec([
    "-i", inputName,
    "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "ultrafast",
    "-crf", "20",
    "-an",
    "-movflags", "+faststart",
    "output.mp4",
  ]);

  const out = await ffmpeg.readFile("output.mp4");
  try {
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile("output.mp4");
  } catch {
    /* ignore cleanup errors */
  }

  const outBlob = new Blob([out.buffer], { type: "video/mp4" });
  const filename = `${filenameBase}-${preset.label.toLowerCase()}-${size}.mp4`;
  downloadBlob(outBlob, filename);
  if (onStatus) onStatus(`Downloaded ${filename}`);
  return { filename, mime: outBlob.type, size, preset: presetKey };
}

/**
 * Render + record the engine at a chosen square resolution.
 * 4K / 1080p / 720p always download as .mp4.
 */
export async function recordEngineVideo(engine, {
  presetKey = "1080p",
  durationSec = 6,
  filenameBase = "ava-letter-field",
  onProgress,
  onStatus,
} = {}) {
  const preset = VIDEO_PRESETS[presetKey] || VIDEO_PRESETS["1080p"];
  const size = preset.size;
  const format = preset.format || "webm";

  const viewCanvas = engine.canvas;
  const viewCtx = engine.ctx;
  const viewW = viewCanvas.width;
  const viewH = viewCanvas.height;

  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const offCtx = off.getContext("2d", { alpha: false, desynchronized: true });
  if (!offCtx) throw new Error("Could not create export canvas.");

  engine.canvas = off;
  engine.ctx = offCtx;

  const preview = () => {
    if (engine.canvas !== off) return;
    viewCtx.save();
    viewCtx.fillStyle = engine.params.bgColor || (engine.params.theme === "light" ? "#ffffff" : "#000000");
    viewCtx.fillRect(0, 0, viewW, viewH);
    viewCtx.drawImage(off, 0, 0, viewW, viewH);
    viewCtx.restore();
  };
  const previewTimer = setInterval(preview, 1000 / 20);

  try {
    const preferMime = format === "mp4" ? "mp4" : "webm";
    const { blob: rawBlob, mime } = await captureCanvasVideo(off, {
      durationSec,
      fps: preset.fps,
      bitsPerSecond: preset.bits,
      preferMime,
      onProgress,
    });

    let outBlob = rawBlob;
    let outFormat = mime.includes("mp4") ? "mp4" : "webm";

    if (format === "mp4" && outFormat !== "mp4") {
      try {
        outBlob = await convertToMp4(rawBlob, onStatus);
        outFormat = "mp4";
      } catch (err) {
        console.error(err);
        throw new Error(
          "Could not create an MP4 in this browser. Try Safari, or use Web for a WebM file."
        );
      }
    }

    const ext = extensionForFormat(outFormat);
    const filename = `${filenameBase}-${preset.label.toLowerCase()}-${size}.${ext}`;
    downloadBlob(outBlob, filename);
    if (onStatus) onStatus(`Downloaded ${filename}`);
    return { filename, mime: outBlob.type, size, preset: presetKey };
  } finally {
    clearInterval(previewTimer);
    engine.canvas = viewCanvas;
    engine.ctx = viewCtx;
    try {
      engine.draw();
    } catch {
      /* ignore */
    }
  }
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}
