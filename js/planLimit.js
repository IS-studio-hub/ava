import { enhanceDialog } from "./a11y.js";

export function showPlanLimitDialog() {
  const dialog = document.getElementById("planLimitDialog");
  if (!dialog?.showModal) {
    window.location.href = "account.html";
    return;
  }
  if (!dialog.open) dialog.showModal();
}

export function bindPlanLimitDialog() {
  const dialog = document.getElementById("planLimitDialog");
  enhanceDialog(dialog);
  document.getElementById("planLimitClose")?.addEventListener("click", () => {
    dialog?.close?.();
  });
}
