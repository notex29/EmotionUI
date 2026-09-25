const P = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
export const icons = {
  logo: `<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="9" fill="#7c5cff"/><circle cx="12.5" cy="14" r="2.6" fill="white"/><circle cx="21.5" cy="14" r="2.6" fill="white"/><path d="M10 21c2.2 2.8 11.8 2.8 14 0" stroke="white" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`,
  home: P(`<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>`),
  plus: P(`<path d="M12 5v14M5 12h14"/>`),
  user: P(`<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>`),
  gear: P(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.05a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/>`),
  send: `<svg viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M3.4 20.4 21.8 12 3.4 3.6l2.6 7.1 9.2 1.3-9.2 1.3z"/></svg>`,
  menu: P(`<path d="M4 7h16M4 12h16M4 17h16"/>`),
  dots: P(`<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>`),
  x: P(`<path d="M6 6l12 12M18 6 6 18"/>`),
  collapse: P(`<path d="M14 6l-6 6 6 6"/>`),
  edit: P(`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`),
  trash: P(`<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>`),
  refresh: P(`<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>`),
  memory: P(`<path d="M12 3a7 7 0 0 1 7 7c0 2-1 3.5-2 5-.7 1-1 2-1 3H8c0-1-.3-2-1-3-1-1.5-2-3-2-5a7 7 0 0 1 7-7Z"/><path d="M9 21h6"/>`),
  copy: P(`<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>`),
  check: P(`<path d="M4 12.5 9.5 18 20 6.5"/>`),
  download: P(`<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>`),
  link: P(`<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`),
  globe: P(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>`),
  search: P(`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`),
};
export function paintStaticIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const k = el.getAttribute("data-icon");
    if (icons[k]) el.innerHTML = icons[k];
  });
  const bm = document.getElementById("brand-mark");
  if (bm && !bm.innerHTML) bm.innerHTML = icons.logo;
  setBtn("btn-collapse-side", icons.collapse);
  setBtn("btn-open-side", icons.menu);
  setBtn("btn-top-settings", icons.gear);
  setBtn("btn-chat-menu", icons.dots);
}
function setBtn(id, svg) {
  const b = document.getElementById(id);
  if (b && !b.innerHTML) b.innerHTML = svg;
}
