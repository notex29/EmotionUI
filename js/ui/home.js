import { store } from "../core/store-idb.js";
import { esc } from "../core/utils.js";

export function renderHome(main, go) {
  const chars = store.characters;
  main.innerHTML = `
  <div class="view-narrow">
    <div class="home-head">
      <div><h1>Characters</h1><p>${chars.length} saved</p></div>
      <button id="h-new" class="btn" type="button" aria-label="Create a new character">New character</button>
    </div>
    <div class="search-row">
      <input id="h-q" type="text" placeholder="Search characters…" aria-label="Search characters" />
    </div>
    <div id="h-grid" class="card-grid" role="list"></div>
  </div>`;
  const grid = main.querySelector("#h-grid");
  const draw = (q = "") => {
    const f = chars.filter((c) => (c.name + " " + c.description + " " + (c.tags || "")).toLowerCase().includes(q.toLowerCase()));
    if (!f.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No characters yet. Create one — or import a SillyTavern PNG card and every field prefills automatically.</div>`;
      return;
    }
    grid.innerHTML = f.map((c) => `
      <button class="char-card" role="listitem" data-id="${esc(c.id)}" aria-label="Chat with ${esc(c.name)}">
        ${c.avatar ? `<img class="char-img" src="${c.avatar}" alt="" loading="lazy" />` : `<div class="char-img-fallback" aria-hidden="true">${esc((c.name || "?").slice(0, 1).toUpperCase())}</div>`}
        <span class="char-body">
          <span class="char-name">${esc(c.name || "Unnamed")}</span>
          <span class="char-desc">${esc((c.creatorNotes || c.description || "No description.").slice(0, 180))}</span>
          <span class="char-tags">${String(c.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
        </span>
      </button>`).join("");
    grid.querySelectorAll(".char-card").forEach((b) => {
      b.addEventListener("click", () => go.chat(b.dataset.id));
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openCharMenu(chars.find(c => c.id === b.dataset.id), e.clientX, e.clientY, go);
      });
      let pressTimer;
      b.addEventListener("touchstart", (e) => {
        pressTimer = setTimeout(() => {
          e.preventDefault();
          const touch = e.touches[0];
          openCharMenu(chars.find(c => c.id === b.dataset.id), touch.clientX, touch.clientY, go);
        }, 600);
      }, { passive: true });
      b.addEventListener("touchend", () => clearTimeout(pressTimer));
      b.addEventListener("touchmove", () => clearTimeout(pressTimer));
    });
  };
  draw();
  main.querySelector("#h-q").addEventListener("input", (e) => draw(e.target.value));
  main.querySelector("#h-new").addEventListener("click", () => go.create());
}

function openCharMenu(char, x, y, go) {
  if (document.querySelector(".ctx-menu")) document.querySelector(".ctx-menu").remove();
  const m = document.createElement("div");
  m.className = "ctx-menu";
  m.style.position = "fixed";
  m.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
  m.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
  m.style.background = "var(--bg-1)";
  m.style.border = "1px solid var(--line)";
  m.style.borderRadius = "12px";
  m.style.padding = "8px";
  m.style.zIndex = "100";
  m.style.boxShadow = "0 8px 32px rgba(0,0,0,0.5)";
  m.style.display = "flex";
  m.style.flexDirection = "column";
  m.style.gap = "4px";

  const btn = (lbl, fn) => {
    const b = document.createElement("button");
    b.textContent = lbl;
    b.className = "tool-btn";
    b.style.textAlign = "left";
    b.style.padding = "10px 14px";
    b.style.background = "transparent";
    b.style.border = "none";
    b.addEventListener("click", (e) => { e.stopPropagation(); m.remove(); fn(); });
    return b;
  };

  m.appendChild(btn("Chat", () => go.chat(char.id)));
  m.appendChild(btn("Edit Character", () => go.edit(char.id)));
  m.appendChild(btn("Delete Character", async () => {
    if (confirm(`Delete ${char.name}?`)) {
      await import("../core/store-opfs.js").then(m => m.store.deleteCharacter(char.id));
      go.home();
    }
  }));

  document.body.appendChild(m);
  const close = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", close); } };
  setTimeout(() => document.addEventListener("click", close), 10);
}
