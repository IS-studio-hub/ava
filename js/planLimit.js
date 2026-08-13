export function showPlanLimitDialog() {
  const dialog = document.getElementById("planLimitDialog");
  if (!dialog?.showModal) {
    window.location.href = "account.html";
    return;
  }
  if (!dialog.open) dialog.showModal();
}

export function bindPlanLimitDialog() {
  document.getElementById("planLimitClose")?.addEventListener("click", () => {
    document.getElementById("planLimitDialog")?.close?.();
  });
}
