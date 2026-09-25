import { shell } from "./modals.js";
import { toast, announce } from "./toast.js";
import { esc, debounce } from "../core/utils.js";
import { icons } from "./icons.js";
import { SORTS, searchPageUrl, search as chubSearch } from "../core/sources/chub.js";
import { importItem, isAbort, proxyBase } from "../core/sources/index.js";
import { urlSource } from "../core/sources/url.js";
import { safeRemoteUrl } from "../core/sources/http.js";

const PAGE_SIZES = [20, 30, 50];
const RATINGS = [["", "Any rating"], ["3", "3+"], ["3.5", "3.5+"], ["4", "4+"], ["4.5", "4.5+"]];

const statLine = (i) => {
  const bits = [];
  if (i.rating) bits.push(`★ ${i.rating.toFixed(1)}${i.ratings ? ` (${i.ratings.toLocaleString()})` : ""}`);
  if (i.messages) bits.push(`${i.messages.toLocaleString()} msgs`);
  if (i.chats) bits.push(`${i.chats.toLocaleString()} users`);
  if (i.tokens) bits.push(`${i.tokens.toLocaleString()} tokens`);
  return bits.join(" · ");
};

const SEARCH_DEFAULTS = {
  q: "", topics: "", sort: "default", nsfw: false, minAiRating: "",
  requireImages: false, requireExampleDialogues: false, first: 30, page: 1,
};

export function openDiscoverModal({ onImported, persist = true } = {}) {
  const state = {
    tab: "chub",
    ...SEARCH_DEFAULTS,
    items: [], hasMore: false, loading: false, error: null,
    selected: new Set(), detailIdx: null,
    urlInput: "", urlItem: null, urlError: null,
    importing: false,
  };

  let controller = null;
  let closed = false;
  let dupResolve = null;

  // Teardown must run for every close path (X, backdrop, Escape), so it is
  // registered with the shell rather than wrapping close().
  const teardown = () => {
    if (closed) return;
    closed = true;
    controller?.abort();
    controller = null;
    if (dupResolve) { const r = dupResolve; dupResolve = null; r("skip"); }
  };

  const { root, close } = shell("Browse online cards", `<div id="dc-body"></div>`, "Browse online character cards", {
    wide: true,
    focus: "#dc-q",
    onClose: teardown,
  });

  const body = root.querySelector("#dc-body");
  body.innerHTML = `
    <div class="src-tabs" role="tablist" aria-label="Card source">
      <button class="src-tab" role="tab" data-tab="chub" type="button" aria-selected="true">Chub.ai</button>
      <button class="src-tab" role="tab" data-tab="url" type="button" aria-selected="false">Paste a link</button>
    </div>
    <p class="hint" style="margin-top:0">Search and download are public — no account, no login. Only the text you type is sent; nothing from your library ever leaves this device.</p>
    <div id="dc-panel"></div>
    <div id="dc-dup" hidden></div>`;

  const panel = body.querySelector("#dc-panel");
  const dupHost = body.querySelector("#dc-dup");

  body.querySelectorAll(".src-tab").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    body.querySelectorAll(".src-tab").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    drawPanel();
  }));

  const $ = (id) => panel.querySelector("#" + id);

  function setStatus(text, kind = "") {
    const el = $("dc-status");
    if (el) { el.className = `dc-status ${kind}`.trim(); el.textContent = text; }
    if (text) announce(text);
  }

  function errorBox(e) {
    const msg = e?.message || String(e);
    const kind = e?.kind || "";
    const label = kind === "geo" ? "chub.ai is not reachable from this network"
      : kind === "rate" ? "chub.ai is rate limiting you"
      : kind === "net" ? "Network or CORS block"
      : kind === "timeout" ? "Timed out"
      : kind === "parse" ? "Unreadable card"
      : "Something went wrong";
    return `<div class="dc-err" role="alert">
      <strong>${esc(label)}</strong>
      <div>${esc(msg)}</div>
      ${e?.remedy ? `<div class="hint">${esc(e.remedy)}</div>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${kind === "geo" ? `<button class="ghost-btn" data-fix="web" type="button">Open this search on chub.ai</button>` : ""}
        ${kind === "net" ? `<button class="ghost-btn" data-fix="proxy" type="button">Use the local proxy</button>` : ""}
      </div>
    </div>`;
  }

  function wireErrorBox(scope) {
    scope.querySelector('[data-fix="web"]')?.addEventListener("click", () => window.open(searchPageUrl(state), "_blank", "noopener"));
    scope.querySelector('[data-fix="proxy"]')?.addEventListener("click", () => {
      close();
      document.querySelector('.nav-item[data-view="settings"]')?.click();
      toast("Start serve.py, then set the proxy URL to http://127.0.0.1:8000/api/proxy in Settings.", "ok");
    });
  }

  // ---------------------------------------------------------------- chub tab

  function drawChub() {
    const proxy = proxyBase();
    panel.innerHTML = `
      <div class="filter-row">
        <div class="search-row" style="margin:0;flex:1 1 250px">
          <input id="dc-q" type="search" placeholder="Search chub.ai — name, trope, creator…" aria-label="Search online cards" value="${esc(state.q)}" autocomplete="off" spellcheck="false" />
        </div>
        <button id="dc-go" class="btn" type="button" aria-label="Run search">Search</button>
        <button id="dc-web" class="ghost-btn" style="flex:0 0 auto" type="button" aria-label="Open this search on chub.ai in a new tab" title="Open on chub.ai">${icons.link}</button>
      </div>

      <div class="filter-row">
        <div class="field" style="margin:0;flex:0 1 190px">
          <label for="dc-sort">Sort</label>
          <select id="dc-sort">${SORTS.map(([v, l]) => `<option value="${esc(v)}" ${state.sort === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        </div>
        <div class="field" style="margin:0;flex:1 1 190px">
          <label for="dc-topics">Tags (comma separated)</label>
          <input id="dc-topics" type="text" placeholder="fantasy, slow-burn" value="${esc(state.topics)}" autocomplete="off" />
        </div>
        <div class="field" style="margin:0;flex:0 1 140px">
          <label for="dc-rating">Min AI rating</label>
          <select id="dc-rating">${RATINGS.map(([v, l]) => `<option value="${esc(v)}" ${state.minAiRating === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        </div>
        <div class="field" style="margin:0;flex:0 1 110px">
          <label for="dc-size">Per page</label>
          <select id="dc-size">${PAGE_SIZES.map((n) => `<option value="${n}" ${state.first === n ? "selected" : ""}>${n}</option>`).join("")}</select>
        </div>
      </div>

      <div class="filter-row" style="align-items:center">
        <label class="chk"><input type="checkbox" id="dc-nsfw" ${state.nsfw ? "checked" : ""} /> <span>Include adult (NSFW)</span></label>
        <label class="chk"><input type="checkbox" id="dc-img" ${state.requireImages ? "checked" : ""} /> <span>Has image</span></label>
        <label class="chk"><input type="checkbox" id="dc-ex" ${state.requireExampleDialogues ? "checked" : ""} /> <span>Has example dialogue</span></label>
        ${proxy ? `<span class="pill" title="${esc(proxy)}">via local proxy</span>` : ""}
      </div>

      <div id="dc-detail"></div>
      <p id="dc-status" class="dc-status" role="status" aria-live="polite"></p>
      <div id="dc-grid" class="res-grid" role="list" aria-busy="false"></div>
      <div class="pager">
        <button id="dc-prev" class="ghost-btn" type="button">Previous</button>
        <span id="dc-pageno" class="hint">Page ${state.page}</span>
        <button id="dc-next" class="ghost-btn" type="button">Next</button>
        <button id="dc-pick-all" class="ghost-btn" type="button">Select all</button>
        <button id="dc-import-sel" class="btn" type="button" disabled>Import selected (0)</button>
      </div>`;

    const q = $("dc-q");
    const topics = $("dc-topics");
    const search = () => { state.q = q.value; state.topics = topics.value; state.page = 1; state.detailIdx = null; runSearch({ reset: true }); };
    const searchDebounced = debounce(search, 450);

    q.addEventListener("input", searchDebounced);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
    topics.addEventListener("input", debounce(() => { state.topics = topics.value; state.page = 1; runSearch({ reset: true }); }, 600));
    topics.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
    $("dc-go").addEventListener("click", search);
    $("dc-web").addEventListener("click", () => window.open(searchPageUrl(state), "_blank", "noopener"));
    $("dc-sort").addEventListener("change", (e) => { state.sort = e.target.value; state.page = 1; runSearch({ reset: true }); });
    $("dc-rating").addEventListener("change", (e) => { state.minAiRating = e.target.value; state.page = 1; runSearch({ reset: true }); });
    $("dc-size").addEventListener("change", (e) => { state.first = Number(e.target.value); state.page = 1; runSearch({ reset: true }); });
    $("dc-nsfw").addEventListener("change", (e) => { state.nsfw = e.target.checked; state.page = 1; runSearch({ reset: true }); });
    $("dc-img").addEventListener("change", (e) => { state.requireImages = e.target.checked; runSearch({ reset: true }); });
    $("dc-ex").addEventListener("change", (e) => { state.requireExampleDialogues = e.target.checked; runSearch({ reset: true }); });
    $("dc-prev").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; state.detailIdx = null; runSearch({}); } });
    $("dc-next").addEventListener("click", () => { state.page += 1; state.detailIdx = null; runSearch({ append: true }); });
    $("dc-pick-all").addEventListener("click", () => {
      const allSelected = state.items.length > 0 && state.items.every((i) => state.selected.has(i.id));
      state.items.forEach((i) => (allSelected ? state.selected.delete(i.id) : state.selected.add(i.id)));
      drawGrid();
    });
    $("dc-import-sel").addEventListener("click", () => importMany(state.items.filter((i) => state.selected.has(i.id))));

    drawGrid();
  }

  function drawGrid() {
    const grid = $("dc-grid");
    if (!grid) return;
    grid.setAttribute("aria-busy", String(state.loading));

    if (state.loading && !state.items.length) {
      grid.innerHTML = Array.from({ length: 6 }, () => `<div class="res-card skel" aria-hidden="true"></div>`).join("");
      return;
    }
    if (state.error && !state.items.length) {
      grid.innerHTML = errorBox(state.error);
      wireErrorBox(grid);
      return;
    }
    if (!state.items.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No cards matched. Try fewer tags, a broader search, or set Sort to “Trending”.</div>`;
      return;
    }

    grid.innerHTML = state.items.map((i, idx) => {
      const thumb = safeRemoteUrl(i.thumb || "");
      const picked = state.selected.has(i.id);
      const imported = !!i._imported;
      return `<article class="res-card" role="listitem" data-idx="${idx}">
        <button class="res-open" type="button" data-act="open" aria-label="Preview ${esc(i.name)}">
          ${thumb ? `<img class="res-thumb" src="${esc(thumb)}" alt="" loading="lazy" decoding="async" />` : `<span class="res-thumb res-thumb-fallback" aria-hidden="true">${esc((i.name || "?").slice(0, 1).toUpperCase())}</span>`}
          <span class="res-meta">
            <span class="res-name">${esc(i.name || "Unnamed")}</span>
            <span class="res-creator">${i.creator ? `by @${esc(i.creator)}` : ""}${i.nsfw ? " · NSFW" : ""}</span>
            ${i.description ? `<span class="res-desc">${esc(i.description.slice(0, 200))}</span>` : ""}
            ${i.tags.length ? `<span class="chip-row">${i.tags.slice(0, 5).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>` : ""}
            ${statLine(i) ? `<span class="res-stats">${esc(statLine(i))}</span>` : ""}
          </span>
        </button>
        <div class="res-actions">
          <label class="res-pick"><input type="checkbox" data-act="pick" ${picked ? "checked" : ""} aria-label="Select ${esc(i.name)}" /></label>
          <button class="mini-btn" data-act="import" type="button" ${imported || state.importing ? "disabled" : ""} aria-label="Import ${esc(i.name)}">${imported ? "Imported" : "Import"}</button>
        </div>
      </article>`;
    }).join("");

    grid.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => { img.style.visibility = "hidden"; }));
    grid.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", (e) => {
      const idx = Number(el.closest(".res-card").dataset.idx);
      const item = state.items[idx];
      if (!item) return;
      const act = el.dataset.act;
      if (act === "open") { state.detailIdx = state.detailIdx === idx ? null : idx; drawDetail(); }
      else if (act === "import") { state.selected.delete(item.id); importMany([item]); }
      else if (act === "pick") { if (el.checked) state.selected.add(item.id); else state.selected.delete(item.id); updateSelBar(); }
    }));
    updateSelBar();
  }

  function updateSelBar() {
    const btn = $("dc-import-sel");
    if (!btn) return;
    const n = state.selected.size;
    btn.textContent = `Import selected (${n})`;
    btn.disabled = n === 0 || state.importing;
    const all = $("dc-pick-all");
    if (all) all.textContent = state.items.length && state.items.every((i) => state.selected.has(i.id)) ? "Clear selection" : "Select all";
  }

  function drawDetail() {
    const host = $("dc-detail");
    if (!host) return;
    const item = state.detailIdx != null ? state.items[state.detailIdx] : null;
    if (!item) { host.innerHTML = ""; return; }
    host.innerHTML = `<div class="res-detail">
      <div class="res-detail-head">
        <strong>${esc(item.name || "Unnamed")}</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-d="import" type="button">Import this card</button>
          <a class="ghost-btn" style="flex:0 0 auto;display:inline-flex;align-items:center;text-decoration:none" href="${esc(item.pageUrl)}" target="_blank" rel="noopener noreferrer">Open page</a>
          <button class="ghost-btn" style="flex:0 0 auto" data-d="close" type="button">Close</button>
        </div>
      </div>
      <div class="hint">${esc(item.creator ? `by @${item.creator}` : "")}${statLine(item) ? ` · ${esc(statLine(item))}` : ""}</div>
      ${item.description ? `<p class="res-detail-desc">${esc(item.description)}</p>` : `<p class="hint" style="margin:6px 0 0">Full description and first message load with the card on import.</p>`}
      ${item.tags.length ? `<div class="chip-row" style="margin-top:8px">${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>`;
    host.querySelector('[data-d="close"]').addEventListener("click", () => { state.detailIdx = null; drawDetail(); });
    host.querySelector('[data-d="import"]').addEventListener("click", () => importMany([item]));
  }

  async function runSearch({ reset = false, append = false } = {}) {
    if (reset) { state.page = 1; state.selected.clear(); }
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    state.loading = true;
    state.error = null;
    if (!append) state.items = [];
    setStatus("Searching chub.ai…");
    const pg = $("dc-pageno");
    if (pg) pg.textContent = `Page ${state.page}`;
    drawGrid();

    try {
      const res = await chubSearch({
        q: state.q,
        topics: state.topics,
        sort: state.sort,
        nsfw: state.nsfw,
        minAiRating: state.minAiRating,
        requireImages: state.requireImages,
        requireExampleDialogues: state.requireExampleDialogues,
        first: state.first,
        page: state.page,
      }, { signal });
      if (closed) return;
      state.hasMore = res.hasMore;
      state.items = append ? state.items.concat(res.items) : res.items;
      state.loading = false;
      setStatus(res.items.length
        ? `${res.items.length} card${res.items.length === 1 ? "" : "s"} found${res.total > res.items.length ? ` (of about ${res.total.toLocaleString()})` : ""}.`
        : "No cards matched.", res.items.length ? "" : "err");
    } catch (e) {
      if (isAbort(e) || closed) return;
      state.loading = false;
      state.error = e;
      setStatus(e?.message || "Search failed.", "err");
    }
    drawGrid();
    drawDetail();
  }

  // ----------------------------------------------------------------- url tab

  function drawUrl() {
    panel.innerHTML = `
      <p class="hint" style="margin-top:0">Works with any public card link — a chub.ai / characterhub card page, a direct <code>.png</code> SillyTavern card, or a <code>.json</code> card file.</p>
      <div class="filter-row">
        <div class="search-row" style="margin:0;flex:1 1 250px">
          <input id="dc-url" type="url" inputmode="url" placeholder="https://chub.ai/characters/creator/card-name" aria-label="Character card link" value="${esc(state.urlInput)}" autocomplete="off" spellcheck="false" />
        </div>
        <button id="dc-lookup" class="btn" type="button" aria-label="Look up this link">Look up</button>
      </div>
      <div id="dc-url-out"></div>`;

    const inp = $("dc-url");
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lookupUrl(); } });
    $("dc-lookup").addEventListener("click", lookupUrl);
    renderUrlOut();
  }

  function renderUrlOut() {
    const out = $("dc-url-out");
    if (!out) return;
    if (state.urlError) { out.innerHTML = errorBox(state.urlError); wireErrorBox(out); return; }
    const item = state.urlItem;
    if (!item) { out.innerHTML = ""; return; }
    const thumb = safeRemoteUrl(item.thumb || "");
    out.innerHTML = `<div class="res-detail">
      <div class="res-detail-head">
        <strong>${esc(item.name || "Card")}</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-u="import" type="button">Import this card</button>
          <a class="ghost-btn" style="flex:0 0 auto;display:inline-flex;align-items:center;text-decoration:none" href="${esc(item.pageUrl)}" target="_blank" rel="noopener noreferrer">Open page</a>
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:10px">
        ${thumb ? `<img src="${esc(thumb)}" alt="" style="width:56px;height:56px;border-radius:12px;object-fit:cover;flex:0 0 56px" />` : ""}
        <div class="hint" style="min-width:0;overflow-wrap:anywhere">${esc(item.creator ? `by @${item.creator}` : "")}<br>${esc(item.sourceUrl || "")}</div>
      </div>
    </div>`;
    out.querySelector('[data-u="import"]').addEventListener("click", () => importMany([item]));
    out.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => { img.style.visibility = "hidden"; }));
  }

  function lookupUrl() {
    const input = $("dc-url");
    state.urlInput = input ? input.value : "";
    state.urlItem = null;
    state.urlError = null;
    try {
      state.urlItem = urlSource.resolve(state.urlInput);
    } catch (e) {
      state.urlError = e;
    }
    renderUrlOut();
  }

  // ------------------------------------------------------------------ import

  function askDuplicate(existing, fresh) {
    return new Promise((resolve) => {
      dupResolve = (v) => { dupResolve = null; dupHost.hidden = true; dupHost.innerHTML = ""; resolve(v); };
      dupHost.innerHTML = `<div class="dup-ask" role="alertdialog" aria-label="Duplicate character">
        <div><strong>${esc(fresh.name || "This card")}</strong> is already in your library${existing?.updatedAt ? ` <span class="hint">(updated ${esc(new Date(existing.updatedAt).toLocaleDateString())})</span>` : ""}.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn" data-a="update" type="button">Update existing</button>
          <button class="ghost-btn" style="flex:0 0 auto" data-a="new" type="button">Import as new</button>
          <button class="ghost-btn" style="flex:0 0 auto" data-a="skip" type="button">Skip</button>
        </div>
      </div>`;
      dupHost.hidden = false;
      dupHost.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => dupResolve?.(b.dataset.a), { once: true }));
    });
  }

  async function importMany(items) {
    if (!items.length || state.importing || closed) return;
    state.importing = true;
    controller?.abort();
    let done = 0, skipped = 0;
    const failed = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setStatus(`Importing ${i + 1} of ${items.length} — ${item.name || "card"}…`);
      try {
        const res = await importItem(item, {
          persist,
          onStage: (s) => setStatus(`${s} (${i + 1}/${items.length})`),
          resolveDuplicate: persist ? askDuplicate : undefined,
        });
        if (res.skipped) { skipped += 1; continue; }
        item._imported = true;
        done += 1;
        onImported?.(persist ? res.saved : res.character, res.updated);
      } catch (e) {
        if (closed) break;
        failed.push(`${item.name || "card"}: ${e?.message || e}`);
      }
    }

    state.importing = false;
    const parts = [];
    if (done) parts.push(`${done} card${done === 1 ? "" : "s"} imported`);
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed.length) parts.push(`${failed.length} failed`);
    if (parts.length) {
      setStatus(parts.join(" · "), failed.length ? "err" : "");
      toast(parts.join(" · ") + (failed.length ? ` — ${failed[0]}` : ""), failed.length ? "err" : "ok");
    } else {
      setStatus("");
    }
    if (!closed) { drawGrid(); drawDetail(); }
  }

  // ------------------------------------------------------------------- mount

  function drawPanel() {
    if (state.tab === "chub") {
      drawChub();
      runSearch({ reset: true });
    } else {
      drawUrl();
    }
    // drawChub()/drawUrl() rebuild innerHTML, so move focus to the new input.
    $(state.tab === "chub" ? "dc-q" : "dc-url")?.focus();
  }

  drawPanel();
}
