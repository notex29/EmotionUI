import { initStorage, store } from "./core/store-idb.js";
import { paintStaticIcons, icons } from "./ui/icons.js";
import { renderHome } from "./ui/home.js";
import { renderDiscover } from "./ui/discover.js";
import { renderSettings } from "./ui/settingsView.js";
import { renderCharacterForm } from "./ui/characterForm.js";
import { renderChat } from "./ui/chat.js";
import { openPersonasModal, openPresetCustomizerModal } from "./ui/modals.js";
import { toast } from "./ui/toast.js";
import { esc } from "./core/utils.js";

const main = document.getElementById("main-view");
const sidebar = document.getElementById("sidebar");
const title = document.getElementById("topbar-title");
let view = "home";
let currentHash = location.hash;

function routeState(newHash) {
  if (currentHash === newHash) return;
  if (!currentHash && newHash) history.pushState(null, "", newHash || location.pathname);
  else history.replaceState(null, "", newHash || location.pathname);
  currentHash = newHash;
}

window.addEventListener("popstate", () => {
  currentHash = location.hash;
  if (currentHash.startsWith("#chat-")) go.chat(currentHash.split("-")[1], true);
  else if (currentHash.startsWith("#edit-")) go.edit(currentHash.split("-")[1], true);
  else if (currentHash === "#create") go.create(true);
  else if (currentHash === "#discover") go.discover(true);
  else go.home(true);
});

export function renderSidebarChars() {
  const container = document.getElementById("sidebar-chars");
  if (!container) return;
  container.innerHTML = `<div style="margin: 16px 8px 8px; font-size: 11px; text-transform: uppercase; color: var(--txt-2); font-weight: 700; letter-spacing: 0.5px;">Chats</div>` + 
  store.characters.map(c => `
    <button class="nav-item sidebar-char-btn" data-id="${c.id}" style="padding: 8px 12px; gap: 10px;" aria-label="Chat with ${esc(c.name)}">
      ${c.avatar ? `<img src="${c.avatar}" style="width:24px;height:24px;border-radius:6px;object-fit:cover;flex:0 0 24px;">` : `<div style="width:24px;height:24px;border-radius:6px;background:var(--bg-3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;flex:0 0 24px;">${esc(c.name[0])}</div>`}
      <span class="nav-txt" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px">${esc(c.name)}</span>
    </button>
  `).join("");
  container.querySelectorAll(".sidebar-char-btn").forEach(b => {
    b.addEventListener("click", () => go.chat(b.dataset.id));
  });
}

export const go = {
  home(fromPop = false) { 
    if (!fromPop) routeState("");
    setView("home"); store.saveGlobal({ activeView: "home", activeCharId: null }); renderHome(main, go); title.textContent = "Characters"; hideChatTools(); 
    setSidebar(false);
    renderSidebarChars();
  },
  create(fromPop = false) { 
    if (!fromPop) routeState("#create");
    setView("create"); store.saveGlobal({ activeView: "create", activeCharId: null }); renderCharacterForm(main, go, null); title.textContent = "Create character"; hideChatTools(); 
    setSidebar(false);
  },
  discover(fromPop = false) {
    if (!fromPop) routeState("#discover");
    setView("discover"); store.saveGlobal({ activeView: "discover", activeCharId: null }); renderDiscover(main, go); title.textContent = "Discover"; hideChatTools();
    setSidebar(false);
  },
  edit(id, fromPop = false) { 
    if (!fromPop) routeState("#edit-" + id);
    setView("create"); store.saveGlobal({ activeView: "edit", activeCharId: id }); renderCharacterForm(main, go, id); title.textContent = "Edit character"; hideChatTools(); 
    setSidebar(false);
  },
  personas() { setView("personas"); openPersonasModal(); },
  settings() { 
    const r = document.getElementById("right-sidebar");
    const scrim = document.getElementById("right-scrim");
    const m = document.querySelector(".main-col");
    const side = document.getElementById("sidebar");
    r.hidden = false;
    if (r.classList.contains("is-open")) {
      r.classList.remove("is-open");
      if (scrim) scrim.hidden = true;
      r.inert = true;
      m.inert = false;
      if (window.innerWidth > 900) side.inert = false;
    } else {
      r.classList.add("is-open");
      if (scrim) scrim.hidden = false;
      r.inert = false;
      m.inert = true;
      side.inert = true;
      renderSettings(r);
    }
  },
  chat(id, fromPop = false) { 
    if (!fromPop) routeState("#chat-" + id);
    setView("home"); store.saveGlobal({ activeView: "chat", activeCharId: id }); renderChat(main, go, id);
    setSidebar(true); 
    renderSidebarChars();
  },
};

function hideChatTools() { 
  const btn = document.getElementById("btn-chat-menu");
  if (btn) btn.hidden = true; 
  document.querySelector(".menu")?.remove(); 
}

function setView(v) {
  view = v;
  main.scrollTop = 0;
  document.querySelectorAll(".nav-item").forEach((b) => {
    const on = b.dataset.view === v || (v === "create" && b.dataset.view === "create");
    b.classList.toggle("is-active", b.dataset.view === v);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}

function setSidebar(hidden) {
  const m = document.querySelector(".main-col");
  if (window.innerWidth <= 900) {
    sidebar.classList.toggle("is-hidden", hidden);
    sidebar.classList.remove("is-collapsed");
    document.body.classList.toggle("side-hidden", hidden);
    const scrim = document.getElementById("sidebar-scrim");
    if (scrim) scrim.hidden = hidden;
    sidebar.inert = hidden;
    m.inert = !hidden;
  } else {
    sidebar.classList.toggle("is-collapsed", hidden);
    sidebar.classList.remove("is-hidden");
    document.body.classList.remove("side-hidden");
    const scrim = document.getElementById("sidebar-scrim");
    if (scrim) scrim.hidden = true;
    sidebar.inert = false;
    m.inert = false;
  }
}
function refreshPersonaChip() {
  document.dispatchEvent(new CustomEvent("eui:conn"));
}
function refreshConn() {
  const g = store.global;
  // Labels removed from UI, but keep event for other components if needed
}

async function boot() {
  paintStaticIcons();
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      for (const reg of regs) reg.unregister();
    });
  }

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btn-install-app');
    if (installBtn) {
      installBtn.style.display = 'flex';
      installBtn.addEventListener('click', async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.style.display = 'none';
      });
    }
  });

  try {
    await initStorage(() => {});
  } catch (e) {
    toast("OPFS unavailable — use a secure context (localhost/https).", "err");
  }
  refreshPersonaChip(); refreshConn();
  renderSidebarChars();

  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => {
    ({ home: go.home, discover: go.discover, create: go.create, personas: go.personas, settings: go.settings })[b.dataset.view]();
    if (window.innerWidth <= 900) setSidebar(true);
  }));
  document.getElementById("btn-collapse-side").addEventListener("click", () => setSidebar(true));
  document.getElementById("btn-open-side").addEventListener("click", () => setSidebar(false));
  document.getElementById("sidebar-scrim").addEventListener("click", () => setSidebar(true));
  document.getElementById("right-scrim").addEventListener("click", () => go.settings());
  document.addEventListener("eui:conn", refreshConn);
  document.addEventListener("eui:edit_preset", (e) => {
    openPresetCustomizerModal(e.detail.isGlobal, e.detail.charId);
  });

  document.getElementById("btn-export").addEventListener("click", async () => {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "emotionui-backup.json"; a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { await store.importAll(JSON.parse(await f.text())); refreshPersonaChip(); go.home(); toast("Backup imported.", "ok"); }
    catch (err) { toast("Import failed: " + err.message, "err"); }
    e.target.value = "";
  });

  if (window.innerWidth <= 900) setSidebar(true);
  
  const v = store.global.activeView;
  const id = store.global.activeCharId;
  if (location.hash.startsWith("#chat-")) go.chat(location.hash.split("-")[1], true);
  else if (location.hash.startsWith("#edit-")) go.edit(location.hash.split("-")[1], true);
  else if (location.hash === "#create") go.create(true);
  else if (location.hash === "#discover") go.discover(true);
  else if (v === "chat" && id) go.chat(id);
  else if (v === "edit" && id) go.edit(id);
  else if (v === "create") go.create();
  else if (v === "discover") go.discover();
  else go.home();
}
boot();
