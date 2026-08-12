import { LetterFieldEngine } from "./engine.js";
import { getPublicSave } from "./saves.js";

async function main() {
  const canvas = document.getElementById("field");
  const removed = document.getElementById("embedRemoved");
  if (!canvas) return;

  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    showRemoved(canvas, removed, "Missing save id.");
    return;
  }

  try {
    const data = await getPublicSave(id);
    const engine = new LetterFieldEngine(canvas, data.params || {});
    const side = Math.min(1080, Math.floor(Math.min(window.devicePixelRatio || 1, 2) * 720));
    canvas.width = side;
    canvas.height = side;
    await engine.ready();
    engine.start();
  } catch (err) {
    showRemoved(canvas, removed, err.message || "This Ava was removed from the library.");
  }
}

function showRemoved(canvas, removed, message) {
  canvas.style.display = "none";
  if (removed) {
    removed.hidden = false;
    const p = removed.querySelector("p");
    if (p && message) p.textContent = message;
  }
}

main();
