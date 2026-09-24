export function toast(msg, kind = "") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", "alert");
  el.setAttribute("aria-live", "assertive");
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 3600);
  setTimeout(() => el.remove(), 4100);
}
export function announce(msg) {
  const el = document.getElementById("sr-live");
  if (el) el.textContent = msg;
}
