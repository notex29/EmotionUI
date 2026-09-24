import { store } from "../core/store-idb.js";
import { defaultCharacter, fileToDataUrl, extractTavernCard, parseCardJsonFile } from "../core/tavernCard.js";
import { fetchIntoSelect, samplingFields, normalizeSampling, readSampling } from "./settingsView.js";
import { fetchModels } from "../core/api_v2.js";
import { FORMATTING_PRESETS } from "../core/presets.js";
import { toast, announce } from "./toast.js";
import { esc } from "../core/utils.js";
import { icons } from "./icons.js";

const TABS = [
  ["definition", "Character Definition"],
  ["advanced", "Advanced Formatting"],
  ["lorebook", "Lorebook Editor"],
  ["model", "Model configuration"],
  ["dumps", "Chat Dumps"]
];

export function renderCharacterForm(main, go, existingId = null) {
  let c = existingId ? { ...store.characters.find((x) => x.id === existingId) } : defaultCharacter();
  if (!c.ai) c.ai = defaultCharacter().ai;
  c._pendingDumps = c._pendingDumps || [];
  let tab = "definition";

  function shell() {
    main.innerHTML = `
    <div class="view-narrow"><div class="panel">
      <h2>${existingId ? "Edit character" : "Create character"}</h2>
      <p class="sub">Drop a SillyTavern PNG card (or JSON) on the avatar field — name, description, scenario, example dialogue and more prefill instantly.</p>
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;margin-bottom:24px;">
        ${c.avatar ? `<img class="avatar-prev" src="${c.avatar}" alt="Character avatar preview" style="width:120px;height:120px;border-radius:32px;object-fit:cover;border:2px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,0.2)" />` : `<div class="avatar-prev" aria-hidden="true" style="width:120px;height:120px;border-radius:32px;border:2px dashed var(--line);display:flex;align-items:center;justify-content:center;background:var(--bg-2);font-size:13px;color:var(--txt-2);text-align:center;line-height:1.4">Drop<br>Avatar</div>`}
        <div style="display:flex;gap:12px;align-items:center">
          <label class="tool-btn" for="cf-file" aria-label="Upload photo or character card" title="Upload photo or card" style="background:var(--bg-3);color:#fff;cursor:pointer"><span aria-hidden="true">${icons.download}</span><span class="lbl">Upload Image</span></label>
          <input id="cf-file" type="file" accept="image/png,image/jpeg,image/webp,.json" hidden />
          <button id="cf-clear-av" class="tool-btn" type="button" aria-label="Remove character photo" title="Remove character photo" style="color:var(--txt-1)"><span aria-hidden="true">${icons.trash}</span><span class="lbl">Remove</span></button>
        </div>
      </div>
      <div class="tabs" role="tablist" aria-label="Character creation sections">
        ${TABS.map(([k, l]) => `<button class="tab-btn" role="tab" data-tab="${k}" aria-selected="${k === tab}" type="button" aria-label="${l} tab">${l}</button>`).join("")}
      </div>
      <div id="cf-body"></div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button id="cf-save" class="btn" type="button" aria-label="Save character">Save character</button>
        ${existingId ? `<button id="cf-del" class="danger-btn" type="button" aria-label="Delete this character">Delete</button>` : ""}
      </div>
    </div></div>`;
    main.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => {
      try { collect(); } catch (e) { console.error("collect error", e); }
      tab = b.dataset.tab;
      shell();
    }));
    drawBody();
    main.querySelector("#cf-file").addEventListener("change", onFile);
    main.querySelector("#cf-clear-av").addEventListener("click", () => { c.avatar = ""; shell(); });
    main.querySelector("#cf-save").addEventListener("click", onSave);
    main.querySelector("#cf-del")?.addEventListener("click", async () => {
      if (!confirm(`Delete ${c.name || "character"} and its chat?`)) return;
      await store.deleteCharacter(c.id);
      toast("Character deleted.", "ok"); go.home();
    });
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      if (f.name.endsWith(".json") || f.type === "application/json") {
        const pre = parseCardJsonFile(await f.text());
        const av = c.avatar; c = { ...c, ...pre, id: c.id || pre.id, avatar: av };
        toast("Character JSON imported — fields prefilled.", "ok");
      } else {
        const { dataUrl, bytes } = await fileToDataUrl(f);
        c.avatar = dataUrl;
        const pre = extractTavernCard(bytes);
        if (pre) {
          const av = dataUrl; c = { ...c, ...pre, id: c.id || pre.id, avatar: av };
          toast("SillyTavern card detected — all fields prefilled.", "ok");
          announce("Character card imported. Fields prefilled.");
        } else toast("Photo set. (No embedded card found.)", "ok");
      }
      shell();
    } catch (err) { toast(err.message, "err"); }
  }

  function drawBody() {
    const b = main.querySelector("#cf-body");
    if (tab === "definition") {
      b.innerHTML = `
      <div class="row2">
        <div class="field"><label for="cf-name">Character name (User-facing)</label><input id="cf-name" type="text" value="${esc(c.name)}" placeholder="Linnea Dahl" /></div>
        <div class="field"><label for="cf-shortname">Backend Name (Sent to AI)</label><input id="cf-shortname" type="text" value="${esc(c.shortName || "")}" placeholder="Linnea" /><span class="hint">Replaces {{char}}. Short names work best.</span></div>
      </div>
      <div class="field"><label for="cf-creator">Creator (Author)</label><input id="cf-creator" type="text" value="${esc(c.creator)}" placeholder="Your username" /></div>
      <div class="field"><label for="cf-notes">Creator's Notes (User-Facing Bio)</label><textarea id="cf-notes" rows="2">${esc(c.creatorNotes)}</textarea>
        <span class="hint">Not sent to the AI. This is a public bio or note for users.</span></div>
      <div class="field"><label for="cf-desc">Description (Character Definition)</label><textarea id="cf-desc" rows="12">${esc(c.description)}</textarea>
        <span class="hint">The main behavioral and physical profile of the character. This is typically the largest field.</span></div>
      <div class="field"><label for="cf-pers">Personality summary</label><textarea id="cf-pers" rows="3">${esc(c.personality)}</textarea></div>
      <div class="field"><label for="cf-scen">Scenario</label><textarea id="cf-scen" rows="3">${esc(c.scenario)}</textarea></div>
      <div class="field"><label for="cf-first">First message (greeting)</label><textarea id="cf-first" rows="4">${esc(c.firstMessage)}</textarea></div>
      <div class="field"><label for="cf-alt">Alternate greetings (one per blank-line-separated block)</label><textarea id="cf-alt" rows="3">${esc((c.altGreetings || []).join("\n\n"))}</textarea></div>
      <div class="field"><label for="cf-ex">Example dialogue</label><textarea id="cf-ex" rows="6" placeholder="{{user}}: Hello!&#10;{{char}}: Hi there!">${esc(c.exampleDialog)}</textarea>
        <span class="hint">Use <code>{{user}}:</code> and <code>{{char}}:</code> formatting for example dialogue.</span></div>
      <div class="field"><label for="cf-tags">Tags (comma separated)</label><input id="cf-tags" type="text" value="${esc(c.tags)}" placeholder="noir, stoic, slow-burn" /></div>`;
    }
    if (tab === "advanced") {
      b.innerHTML = `
      <div class="field"><label for="cf-sys">System Prompt</label><textarea id="cf-sys" rows="4">${esc(c.systemPrompt)}</textarea>
        <span class="hint">Becomes the first system message on every request. Overrides the default system prompt.</span></div>
      <div class="field"><label for="cf-post">Post-History Instructions (Author's Note/Jailbreak)</label><textarea id="cf-post" rows="2">${esc(c.postHistoryInstructions)}</textarea>
        <span class="hint">Appended at the end of the chat history, right before the newest user message.</span></div>
      <div class="row2">
        <div class="field"><label for="cf-ver">Character version</label><input id="cf-ver" type="text" value="${esc(c.characterVersion)}" placeholder="1.0" /></div>
        <div class="field"><label for="cf-speech">Speech pattern (Legacy)</label><input id="cf-speech" type="text" value="${esc(c.speech)}" /></div>
      </div>
      <div class="row2" style="margin-bottom:12px">
        <label for="cf-lorebook-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:var(--txt-1)">
          <input type="checkbox" id="cf-lorebook-toggle" aria-label="Enable V2 Lorebook" ${c.extensions.lorebookEnabled !== false ? "checked" : ""} />
          <span aria-hidden="true">Enable V2 Lorebook (if attached)</span>
        </label>
      </div>`;
    }
    if (tab === "lorebook") {
      const entries = (c.characterBook && c.characterBook.entries) || [];
      b.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <p class="sub" style="margin:0">V2 Lorebook entries. Keywords trigger injection.</p>
        <div style="display:flex;gap:8px">
          <label class="ghost-btn" for="cf-lb-import" style="padding:6px 10px;font-size:13px;cursor:pointer;white-space:nowrap">Import JSON</label>
          <input id="cf-lb-import" type="file" accept=".json" hidden />
          <button id="cf-lb-add" class="btn" style="padding:6px 10px;font-size:13px;white-space:nowrap" type="button">Add Entry</button>
        </div>
      </div>
      <div id="lb-list" style="display:grid;gap:12px">
        ${entries.map((e, i) => `
          <div class="list-item" style="display:grid;gap:8px;align-items:start;flex-direction:column">
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
              <span style="font-weight:700;font-size:13px">Entry #${i+1}</span>
              <button class="icon-btn lb-del" data-idx="${i}" type="button" aria-label="Delete entry" title="Delete entry" style="width:28px;height:28px;flex:0 0 28px">${icons.trash}</button>
            </div>
            <input type="text" class="lb-keys" data-idx="${i}" placeholder="Keywords (comma separated)" value="${esc((e.keys||[]).join(", "))}" style="background:#0f141d;border:1px solid var(--line);border-radius:8px;padding:6px;width:100%;color:#fff" />
            <textarea class="lb-content" data-idx="${i}" placeholder="Lorebook content..." rows="3" style="background:#0f141d;border:1px solid var(--line);border-radius:8px;padding:6px;width:100%;resize:vertical;color:#fff">${esc(e.content)}</textarea>
            <div style="display:flex;gap:12px;font-size:12px">
              <label for="lb-en-${i}" style="display:flex;gap:4px;cursor:pointer"><input type="checkbox" id="lb-en-${i}" class="lb-en" aria-label="Enabled" data-idx="${i}" ${e.enabled !== false ? "checked" : ""} /> <span aria-hidden="true">Enabled</span></label>
              <label for="lb-cs-${i}" style="display:flex;gap:4px;cursor:pointer"><input type="checkbox" id="lb-cs-${i}" class="lb-cs" aria-label="Case sensitive" data-idx="${i}" ${e.case_sensitive ? "checked" : ""} /> <span aria-hidden="true">Case sensitive</span></label>
              <label style="display:flex;gap:4px;align-items:center">Order: <input type="number" class="lb-order" data-idx="${i}" value="${e.insertion_order || 0}" style="width:50px;background:#0f141d;border:1px solid var(--line);border-radius:4px;color:#fff;padding:2px" /></label>
            </div>
          </div>
        `).join("")}
        ${entries.length === 0 ? `<div class="empty">No entries found.</div>` : ""}
      </div>
      `;
      
      b.querySelector("#cf-lb-add").addEventListener("click", () => {
        if (!c.characterBook) c.characterBook = { entries: [] };
        if (!c.characterBook.entries) c.characterBook.entries = [];
        c.characterBook.entries.push({ keys: [], content: "", insertion_order: 0, case_sensitive: false, enabled: true });
        collect(); shell();
      });
      b.querySelector("#cf-lb-import").addEventListener("change", async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try {
          const lb = JSON.parse(await f.text());
          const newEntries = Array.isArray(lb.entries) ? lb.entries : [];
          if (!newEntries.length) throw new Error("No entries found in JSON.");
          if (!c.characterBook) c.characterBook = { entries: [] };
          if (!c.characterBook.entries) c.characterBook.entries = [];
          c.characterBook.entries.push(...newEntries);
          collect(); shell();
          toast(`Imported ${newEntries.length} lorebook entries.`, "ok");
        } catch(err) { toast("Invalid lorebook file.", "err"); }
      });
      b.querySelectorAll(".lb-del").forEach((btn) => btn.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        c.characterBook.entries.splice(idx, 1);
        collect(); shell();
      }));
    }
    if (tab === "model") {
      b.innerHTML = `
      <div class="row2" style="margin-bottom:12px">
        <label for="cf-smart" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:var(--txt-1)">
          <input type="checkbox" id="cf-smart" aria-label="Enable TF-IDF Smart Context Retrieval" ${c.extensions.smartContext !== false ? "checked" : ""} />
          <span aria-hidden="true">Enable TF-IDF Smart Context Retrieval</span>
        </label>
      </div>
      <p class="hint" style="margin-top:0">Hybrid cascade: leave endpoint/key empty to inherit the global endpoint. Or set a per-character endpoint + key, click Fetch, then pick a model. Sampling blanks also inherit global.</p>
      <div class="field"><label for="cf-base">Per-character base URL (optional)</label><input id="cf-base" type="url" value="${esc(c.ai.baseUrl || "")}" placeholder="leave empty = use global" autocomplete="off" spellcheck="false" /></div>
      <div class="field"><label for="cf-key">Per-character API key (optional)</label><input id="cf-key" type="password" value="${esc(c.ai.apiKey || "")}" placeholder="leave empty = use global" autocomplete="off" /></div>
      <div class="row2">
        <div class="field"><label>Models</label><button id="cf-fetch" class="ghost-btn" type="button" aria-label="Fetch models for per-character endpoint">Fetch</button><span class="hint" id="cf-hint"></span></div>
        <div class="field"><label for="cf-model">Model override</label><select id="cf-model"><option value="">— use global —</option>${c.ai.model ? `<option selected value="${esc(c.ai.model)}">${esc(c.ai.model)}</option>` : ""}</select></div>
      </div>
      ${samplingFields("cf", c.ai, main)}`;
      
      b.querySelector("#cf-fetch").addEventListener("click", async () => {
        const base = b.querySelector("#cf-base").value.trim() || store.global.baseUrl;
        const key = b.querySelector("#cf-key").value !== "" ? b.querySelector("#cf-key").value : store.global.apiKey;
        try {
          b.querySelector("#cf-fetch").disabled = true;
          await fetchIntoSelect(base, key, b.querySelector("#cf-model"), c.ai.model);
          b.querySelector("#cf-hint").textContent = "Models loaded.";
          toast("Models loaded.", "ok");
        } catch (e) { b.querySelector("#cf-hint").textContent = e.message; toast(e.message, "err"); }
        finally { b.querySelector("#cf-fetch").disabled = false; }
      });
      
      const cfPreset = b.querySelector("#cf-preset");
      const cfPresetEdit = b.querySelector("#cf-preset-edit");
      if (cfPreset) {
        cfPreset.addEventListener("change", () => {
          cfPresetEdit.style.display = cfPreset.value === "custom" ? "block" : "none";
          const stops = FORMATTING_PRESETS[cfPreset.value]?.stops;
          if (stops && stops.length > 0) {
            b.querySelector("#cf-stop").value = stops.join("\n");
          }
        });
        cfPresetEdit.addEventListener("click", () => document.dispatchEvent(new CustomEvent("eui:edit_preset", { detail: { isGlobal: false, charId: c.id } })));
      }
    }
    if (tab === "dumps") {
      b.innerHTML = `
      <div style="margin-bottom:12px;">
        <p class="sub" style="margin:0 0 16px 0">Import chat dumps (Currently supports Character.AI CAI Tools HTML exports). The imported chats will be added when you save the character.</p>
        <div style="display:flex;gap:12px;align-items:center;">
          <label class="btn" for="cf-dump-import" style="cursor:pointer">Import CAI HTML Dump</label>
          <input id="cf-dump-import" type="file" accept=".html" hidden />
        </div>
      </div>
      <div id="dump-list" style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
        ${c._pendingDumps.length === 0 ? '<p class="sub" style="margin:0">No pending imports.</p>' : ''}
        ${c._pendingDumps.map((d, i) => `
          <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#0f141d;border:1px solid var(--line);border-radius:8px;">
            <div>
              <div style="font-weight:bold;color:#fff">${esc(d.title)}</div>
              <div style="font-size:12px;color:var(--txt-2)">${d.chats.length} chat(s), ${d.chats.reduce((acc, chat) => acc + chat.messages.length, 0)} total messages</div>
            </div>
            <button class="icon-btn dump-del" data-idx="${i}" type="button" aria-label="Delete alt greeting" title="Delete greeting" style="color:#e20909">${icons.trash}</button>
          </div>
        `).join("")}
      </div>`;
      
      b.querySelector("#cf-dump-import").addEventListener("change", async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try {
          const txt = await f.text();
          const m = txt.match(/let historyData\s*=\s*`([^`]+)`/i) || txt.match(/let historyData\s*=\s*"([^"]+)"/i) || txt.match(/let historyData\s*=\s*'([^']+)'/i);
          if (!m) throw new Error("Could not find CAI Tools historyData in the HTML file.");
          
          const data = JSON.parse(decodeURIComponent(m[1]));
          const title = data.title || f.name.replace(".html", "");
          
          const chats = (data.history || []).map(h => {
            const humanIds = new Set((h.participants || []).filter(p => p.is_human).map(p => p.id));
            const messages = (h.content || []).map(msg => ({
              id: Date.now() + "_" + Math.random().toString(36).slice(2),
              role: humanIds.has(msg.author) ? "user" : "char",
              content: msg.message || ""
            }));
            return { messages };
          });
          
          if (chats.length === 0) throw new Error("No messages found in the dump.");
          
          c._pendingDumps.push({ title, chats });
          toast("Chat dump parsed and queued for import.", "ok");
          shell();
        } catch (err) {
          toast(err.message, "err");
        }
        e.target.value = "";
      });
      
      b.querySelectorAll(".dump-del").forEach(btn => {
        btn.addEventListener("click", (e) => {
          c._pendingDumps.splice(Number(e.currentTarget.dataset.idx), 1);
          shell();
        });
      });
    }
  }

  function collect() {
    const q = (id) => main.querySelector("#" + id)?.value ?? (c[({ "cf-name": "name", "cf-shortname": "shortName", "cf-creator": "creator", "cf-notes": "creatorNotes", "cf-desc": "description", "cf-pers": "personality", "cf-scen": "scenario", "cf-first": "firstMessage", "cf-ex": "exampleDialog", "cf-tags": "tags", "cf-sys": "systemPrompt", "cf-post": "postHistoryInstructions", "cf-ver": "characterVersion", "cf-speech": "speech" })[id]] || "");
    if (main.querySelector("#cf-name")) c.name = q("cf-name").trim();
    if (main.querySelector("#cf-shortname")) c.shortName = q("cf-shortname").trim();
    if (main.querySelector("#cf-creator")) c.creator = q("cf-creator");
    if (main.querySelector("#cf-notes")) c.creatorNotes = q("cf-notes");
    if (main.querySelector("#cf-desc")) c.description = q("cf-desc");
    if (main.querySelector("#cf-pers")) c.personality = q("cf-pers");
    if (main.querySelector("#cf-scen")) c.scenario = q("cf-scen");
    if (main.querySelector("#cf-first")) c.firstMessage = q("cf-first");
    if (main.querySelector("#cf-alt")) c.altGreetings = main.querySelector("#cf-alt").value.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (main.querySelector("#cf-ex")) c.exampleDialog = q("cf-ex");
    if (main.querySelector("#cf-tags")) c.tags = q("cf-tags");
    if (main.querySelector("#cf-sys")) c.systemPrompt = q("cf-sys");
    if (main.querySelector("#cf-post")) c.postHistoryInstructions = q("cf-post");
    if (main.querySelector("#cf-ver")) c.characterVersion = q("cf-ver");
    if (main.querySelector("#cf-speech")) c.speech = q("cf-speech");
    if (main.querySelector("#cf-smart")) {
      if (!c.extensions) c.extensions = {};
      c.extensions.smartContext = main.querySelector("#cf-smart").checked;
    }
    if (main.querySelector("#cf-lorebook-toggle")) {
      if (!c.extensions) c.extensions = {};
      c.extensions.lorebookEnabled = main.querySelector("#cf-lorebook-toggle").checked;
    }
    if (main.querySelector("#cf-base")) {
      c.ai = {
        baseUrl: main.querySelector("#cf-base").value.trim(),
        apiKey: main.querySelector("#cf-key").value,
        model: main.querySelector("#cf-model").value,
        ...normalizeSampling(readSampling("cf", main)),
      };
    }
    if (tab === "lorebook") {
      if (c.characterBook && c.characterBook.entries) {
        c.characterBook.entries.forEach((e, i) => {
          const keyInput = main.querySelector(`.lb-keys[data-idx="${i}"]`);
          if (keyInput) {
            e.keys = keyInput.value.split(",").map(s => s.trim()).filter(Boolean);
            e.content = main.querySelector(`.lb-content[data-idx="${i}"]`).value;
            e.enabled = main.querySelector(`.lb-en[data-idx="${i}"]`).checked;
            e.case_sensitive = main.querySelector(`.lb-cs[data-idx="${i}"]`).checked;
            e.insertion_order = Number(main.querySelector(`.lb-order[data-idx="${i}"]`).value) || 0;
          }
        });
      }
    }
  }

  async function onSave() {
    collect();
    if (!c.name.trim()) { toast("Give the character a name.", "err"); tab = "definition"; shell(); return; }
    
    const pending = c._pendingDumps || [];
    delete c._pendingDumps;
    
    await store.saveCharacter(c);
    
    for (const d of pending) {
      for (let i = 0; i < d.chats.length; i++) {
        const chatData = d.chats[i];
        const chatName = d.chats.length > 1 ? `${d.title} (Part ${i + 1})` : d.title;
        const newChat = {
          id: Date.now() + "_" + Math.random().toString(36).slice(2),
          charId: c.id,
          name: chatName,
          messages: chatData.messages,
        };
        await store.saveChat(newChat);
      }
    }
    if (pending.length > 0) {
      toast(`“${c.name}” saved and ${pending.reduce((acc, d) => acc + d.chats.length, 0)} chat(s) imported.`, "ok");
    } else {
      toast(`“${c.name}” saved.`, "ok");
    }
    
    go.chat(c.id || store.characters.find((x) => x.name === c.name)?.id);
  }

  shell();
}
