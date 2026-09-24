import { store } from "../core/store-idb.js";
import { fetchIntoSelect, samplingFields, normalizeSampling, readSampling } from "./settingsView.js";
import { resolveEndpoint } from "../core/api_v2.js";
import { summarizeMemory } from "../core/memory.js";
import { buildBody } from "../core/promptBuilder_v2.js";
import { toast } from "./toast.js";
import { esc, uid } from "../core/utils.js";
import { icons } from "./icons.js";

function shell(title, bodyHtml, label) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-back" id="m-back"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label || title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button id="m-x" class="icon-btn" type="button" aria-label="Close dialog" title="Close">${icons.x}</button></div>
    <div>${bodyHtml}</div></div></div>`;
  const close = () => { root.innerHTML = ""; };
  root.querySelector("#m-x").addEventListener("click", close);
  root.querySelector("#m-back").addEventListener("click", (e) => { if (e.target.id === "m-back") close(); });
  document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc1); } });
  setTimeout(() => {
    const focusable = root.querySelector("button, input, select, textarea");
    if (focusable) focusable.focus();
  }, 10);
  return { root, close };
}

export async function openPersonasModal(onChange) {
  const { root, close } = shell("Personas", `
    <p class="hint" style="margin-top:0">The active persona's name appears on your chat bubbles and in the prompt as USER PERSONA.</p>
    <div id="p-body"></div>`, "Personas");
    
  let editing = null;

  const drawList = () => {
    const listHtml = store.personas.map((p) => `
      <div class="list-item" style="flex-wrap:wrap"><div class="grow" style="min-width:140px"><div class="t">${esc(p.name)} ${p.active ? "· active" : ""}</div><div class="d">${esc(p.prompt || "")}</div></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="mini-btn" data-use="${p.id}" type="button" aria-label="Use persona ${esc(p.name)}">Use</button>
        <button class="mini-btn" data-edit="${p.id}" type="button" aria-label="Edit persona ${esc(p.name)}">Edit</button>
        <button class="mini-btn" data-del="${p.id}" type="button" aria-label="Delete persona ${esc(p.name)}">Delete</button>
      </div></div>`).join("");
      
    root.querySelector("#p-body").innerHTML = `
      <div id="p-list" class="list">${listHtml}</div>
      <button id="p-new" class="btn" style="margin-top:16px;width:100%" type="button">Create new persona</button>
    `;
    
    root.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", async () => { await store.setActivePersona(b.dataset.use); drawList(); onChange?.(); toast("Persona switched.", "ok"); }));
    root.querySelectorAll("[data-edit]").forEach((b) => {
      b.addEventListener("click", () => {
        editing = store.personas.find((x) => x.id === b.dataset.edit);
        drawForm();
      });
    });
    root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      try { await store.deletePersona(b.dataset.del); if (editing?.id === b.dataset.del) editing = null; drawList(); onChange?.(); }
      catch (e) { toast(e.message, "err"); }
    }));
    root.querySelector("#p-new").addEventListener("click", () => { editing = null; drawForm(); });
  };

  const drawForm = () => {
    root.querySelector("#p-body").innerHTML = `
      <h3 style="margin:0 0 14px">${editing ? "Edit persona" : "New persona"}</h3>
      <div class="field"><label for="p-name">Name</label><input id="p-name" type="text" placeholder="Zyro" value="${esc(editing?.name || "")}" /></div>
      <div class="field"><label for="p-prompt">Persona prompt</label><textarea id="p-prompt" rows="3" placeholder="Who is speaking as the user…">${esc(editing?.prompt || "")}</textarea></div>
      <div style="display:flex;gap:8px">
        <button id="p-save" class="btn" type="button" aria-label="Save persona">Save</button>
        <button id="p-cancel" class="ghost-btn" style="flex:0" type="button" aria-label="Cancel editing">Cancel</button>
      </div>
    `;
    
    root.querySelector("#p-cancel").addEventListener("click", () => drawList());
    root.querySelector("#p-save").addEventListener("click", async () => {
      const name = root.querySelector("#p-name").value.trim();
      const prompt = root.querySelector("#p-prompt").value.trim();
      if (!name) { toast("Persona needs a name.", "err"); return; }
      const p = await store.savePersona({ ...(editing || { id: uid("persona"), active: false }), name, prompt });
      if (!store.activePersona()) await store.setActivePersona(p.id);
      editing = null;
      drawList(); onChange?.(); toast("Persona saved.", "ok");
    });
  };

  drawList();
}

export async function openMemoryModal(char, onSave) {
  const mem = await store.getMemory(char.id);
  const chat = await store.getChat(char.id);
  const { root, close } = shell(`Memory — ${char.name}`, `
    <p class="hint" style="margin-top:0">Summary is injected as a system message so long chats don't lose context. Keyword recall also pulls matching past lines automatically.</p>
    <div class="field"><label for="mem-text">Chat memory summary</label><textarea id="mem-text" rows="6">${esc(mem.summary || "")}</textarea></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="mem-auto" class="ghost-btn" type="button" aria-label="Auto summarize recent chat with current model">Auto-summarize (${esc(String(chat.messages.length))} msgs)</button>
      <button id="mem-save" class="btn" type="button" aria-label="Save chat memory">Save memory</button>
    </div>
    <p class="hint" id="mem-hint"></p>`, "Chat memory");
  root.querySelector("#mem-save").addEventListener("click", async () => {
    await store.saveMemory(char.id, root.querySelector("#mem-text").value);
    onSave?.(); close(); toast("Memory saved.", "ok");
  });
  root.querySelector("#mem-auto").addEventListener("click", async () => {
    const hint = root.querySelector("#mem-hint");
    try {
      root.querySelector("#mem-auto").disabled = true; hint.textContent = "Summarizing…";
      const endpoint = resolveEndpoint(char.ai, store.global);
      const text = await summarizeMemory({ char, persona: store.activePersona(), history: chat.messages, endpoint });
      root.querySelector("#mem-text").value = text;
      hint.textContent = "Draft ready — review then Save memory.";
    } catch (e) { hint.textContent = e.message; toast(e.message, "err"); }
    finally { root.querySelector("#mem-auto").disabled = false; }
  });
}

export async function openCharSettingsModal(char) {
  const ai = char.ai || {};
  const { root, close } = shell(`Chat settings — ${char.name}`, `
    <p class="hint" style="margin-top:0">Hybrid cascade: empty fields inherit the global endpoint. Set endpoint + key, click Fetch, then pick a model to override per character.</p>
    <div class="field"><label for="cs-base">Base URL override</label><input id="cs-base" type="url" value="${esc(ai.baseUrl || "")}" placeholder="empty = global" autocomplete="off" spellcheck="false" /></div>
    <div class="field"><label for="cs-key">API key override</label><input id="cs-key" type="password" value="${esc(ai.apiKey || "")}" placeholder="empty = global" autocomplete="off" /></div>
    <div class="row2"><div class="field"><label>Models</label><button id="cs-fetch" class="ghost-btn" type="button" aria-label="Fetch models for this character">Fetch</button><span class="hint" id="cs-hint"></span></div>
    <div class="field"><label for="cs-model">Model</label><select id="cs-model"><option value="">— use global —</option>${ai.model ? `<option selected value="${esc(ai.model)}">${esc(ai.model)}</option>` : ""}</select></div></div>
    <div id="cs-samp">${samplingFields("cs", ai)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      <button id="cs-save" class="btn" type="button" aria-label="Save character chat settings">Save</button>
      <button id="cs-prev" class="ghost-btn" type="button" aria-label="Preview the exact request payload">Preview request</button>
    </div>
    <div class="field" style="margin-top:10px"><label for="cs-out">Request preview</label><textarea id="cs-out" rows="8" readonly placeholder="Shows model, stop list and the last messages sent…"></textarea></div>`, "Character chat settings");
  root.querySelector("#cs-fetch").addEventListener("click", async () => {
    try {
      root.querySelector("#cs-fetch").disabled = true;
      const base = root.querySelector("#cs-base").value.trim() || store.global.baseUrl;
      const key = root.querySelector("#cs-key").value !== "" ? root.querySelector("#cs-key").value : store.global.apiKey;
      await fetchIntoSelect(base, key, root.querySelector("#cs-model"), ai.model);
      root.querySelector("#cs-hint").textContent = "Models loaded.";
    } catch (e) { root.querySelector("#cs-hint").textContent = e.message; toast(e.message, "err"); }
    finally { root.querySelector("#cs-fetch").disabled = false; }
  });
  const collect = () => ({
    baseUrl: root.querySelector("#cs-base").value.trim(), apiKey: root.querySelector("#cs-key").value,
    model: root.querySelector("#cs-model").value, ...normalizeSampling(readSampling("cs", root)),
  });
  root.querySelector("#cs-save").addEventListener("click", async () => {
    char.ai = collect();
    await store.saveCharacter(char);
    close(); toast("Character settings saved.", "ok");
  });
  root.querySelector("#cs-prev").addEventListener("click", async () => {
    const draft = { ...char, ai: collect() };
    const endpoint = resolveEndpoint(draft.ai, store.global);
    const chat = await store.getChat(char.id);
    const memory = await store.getMemory(char.id);
    try {
      const body = buildBody({ char: draft, persona: store.activePersona(), memory, history: chat.messages, newUserText: "Hello", endpoint });
      root.querySelector("#cs-out").value = JSON.stringify({ ...body, messages: body.messages.slice(0, 3).concat([`… (${body.messages.length} messages total, last 10 turns + systems)`]) }, null, 2);
    } catch (e) { root.querySelector("#cs-out").value = e.message; }
  });
}

export function openChatMenu(char, acts) {
  document.querySelector(".menu")?.remove();
  const m = document.createElement("div");
  m.className = "menu"; m.setAttribute("role", "menu");
  m.innerHTML = `
    <button role="menuitem" data-a="memory" type="button" aria-label="Open chat memory">${icons.memory} Chat memory</button>
    <button role="menuitem" data-a="settings" type="button" aria-label="Open character chat settings">${icons.gear} Chat settings</button>
    <button role="menuitem" data-a="edit" type="button" aria-label="Edit character card">${icons.edit} Edit character</button>
    <button role="menuitem" data-a="custom" type="button" aria-label="Chat customizer">${icons.user} Chat customizer</button>
    <button role="menuitem" data-a="switch" type="button" aria-label="Switch chats">Switch chats</button>
    <button role="menuitem" data-a="newchat" type="button" aria-label="Start new chat">${icons.plus} Start new chat</button>`;
  document.body.appendChild(m);
  const off = (e) => { if (!m.contains(e.target) && e.target.id !== "btn-chat-menu" && !e.target.closest("#btn-chat-menu")) { m.remove(); acts.onClose?.(); document.removeEventListener("click", off); } };
  setTimeout(() => document.addEventListener("click", off), 0);
  m.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    m.remove(); acts.onClose?.(); document.removeEventListener("click", off);
    ({ memory: acts.onMemory, settings: acts.onSettings, edit: acts.onEdit, custom: acts.onCustomizer, switch: acts.onSwitch, newchat: acts.onNewChat })[b.dataset.a]?.();
  }));
}

export function openChatCustomizerModal(char) {
  const cfg = char.extensions?.chatConfig || { aiBg: "transparent", userBg: "transparent", autoText: true, aiText: "", userText: "", chatBgColor: "", chatBgImage: "", composerBg: "", composerTxt: "", inputBg: "", inputTxt: "", inputHint: "", lineSpacing: 1.5, letterSpacing: 0 };
  
  const body = `
    <div style="display: grid; gap: 12px; margin-bottom: 16px;">
      <div class="field">
        <label>Chat Background Color</label>
        <div style="display:flex;gap:8px">
          <input type="color" id="cc-bg-color" value="${cfg.chatBgColor || "#0e1116"}" />
          <input type="text" id="cc-bg-color-txt" value="${cfg.chatBgColor || ""}" placeholder="#0e1116 or transparent" style="flex:1;min-width:0" />
        </div>
      </div>
      <div class="field">
        <label>Chat Background Image / GIF</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="file" id="cc-bg-img" accept="image/*" style="flex:1;min-width:0" />
          <button type="button" class="ghost-btn" id="cc-bg-clear" style="flex:0 0 auto;padding:10px;">Clear</button>
        </div>
        ${cfg.chatBgImage ? `<img src="${cfg.chatBgImage}" style="max-height:80px;border-radius:8px;margin-top:6px;object-fit:contain;" id="cc-bg-preview" />` : `<img id="cc-bg-preview" style="display:none;max-height:80px;border-radius:8px;margin-top:6px;object-fit:contain;" />`}
      </div>
      
      <hr style="border:0;border-top:1px solid var(--line);margin:4px 0" />
      
      <div class="field">
        <label>AI Bubble Background Color</label>
        <div style="display:flex;gap:8px">
          <input type="color" id="cc-ai-bg" value="${cfg.aiBg || "#1b2334"}" />
          <input type="text" id="cc-ai-bg-txt" value="${cfg.aiBg || ""}" placeholder="#1b2334 or transparent" style="flex:1;min-width:0" />
        </div>
      </div>
      <div class="field">
        <label>User Bubble Background Color</label>
        <div style="display:flex;gap:8px">
          <input type="color" id="cc-user-bg" value="${cfg.userBg || "#6a4dff"}" />
          <input type="text" id="cc-user-bg-txt" value="${cfg.userBg || ""}" placeholder="#6a4dff or transparent" style="flex:1;min-width:0" />
        </div>
      </div>

      <div class="field">
        <label for="cc-auto-txt" style="display:flex;gap:8px;cursor:pointer;align-items:center;font-size:14px">
          <input type="checkbox" id="cc-auto-txt" ${cfg.autoText ? "checked" : ""} />
          <span>Automatically invert text color for contrast</span>
        </label>
      </div>

      <div class="row2">
        <div class="field">
          <label>AI Text Color</label>
          <div style="display:flex;gap:8px">
            <input type="color" id="cc-ai-txt" value="${cfg.aiText || "#ffffff"}" ${cfg.autoText ? "disabled" : ""} />
            <input type="text" id="cc-ai-txt-val" value="${cfg.aiText || ""}" placeholder="#ffffff" style="flex:1;min-width:0" ${cfg.autoText ? "disabled" : ""} />
          </div>
        </div>
        <div class="field">
          <label>User Text Color</label>
          <div style="display:flex;gap:8px">
            <input type="color" id="cc-user-txt" value="${cfg.userText || "#ffffff"}" ${cfg.autoText ? "disabled" : ""} />
            <input type="text" id="cc-user-txt-val" value="${cfg.userText || ""}" placeholder="#ffffff" style="flex:1;min-width:0" ${cfg.autoText ? "disabled" : ""} />
          </div>
        </div>
      </div>

      <hr style="border:0;border-top:1px solid var(--line);margin:4px 0" />

      <h3 style="margin:0;font-size:15px">Bottom Bar Settings</h3>
      <div class="field">
        <label>Container Bar Background</label>
        <div style="display:flex;gap:8px">
          <input type="color" id="cc-comp-bg" value="${cfg.composerBg || "#000000"}" />
          <input type="text" id="cc-comp-bg-txt" value="${cfg.composerBg || ""}" placeholder="#000000 or transparent" style="flex:1;min-width:0" />
        </div>
      </div>
      <div class="field">
        <label>Container Elements Text Color</label>
        <div style="display:flex;gap:8px">
          <input type="color" id="cc-comp-txt" value="${cfg.composerTxt || "#ffffff"}" ${cfg.autoText ? "disabled" : ""} />
          <input type="text" id="cc-comp-txt-val" value="${cfg.composerTxt || ""}" placeholder="#ffffff" style="flex:1;min-width:0" ${cfg.autoText ? "disabled" : ""} />
        </div>
      </div>
      <div class="field">
        <label>Text Box Background</label>
        <div style="display:flex;gap:8px">
          <input type="color" id="cc-in-bg" value="${cfg.inputBg || "#1b2334"}" />
          <input type="text" id="cc-in-bg-txt" value="${cfg.inputBg || ""}" placeholder="#1b2334 or transparent" style="flex:1;min-width:0" />
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label>Text Box Text Color</label>
          <div style="display:flex;gap:8px">
            <input type="color" id="cc-in-txt" value="${cfg.inputTxt || "#ffffff"}" ${cfg.autoText ? "disabled" : ""} />
            <input type="text" id="cc-in-txt-val" value="${cfg.inputTxt || ""}" placeholder="#ffffff" style="flex:1;min-width:0" ${cfg.autoText ? "disabled" : ""} />
          </div>
        </div>
        <div class="field">
          <label>Text Box Hint Color</label>
          <div style="display:flex;gap:8px">
            <input type="color" id="cc-in-hint" value="${cfg.inputHint || "#888888"}" ${cfg.autoText ? "disabled" : ""} />
            <input type="text" id="cc-in-hint-val" value="${cfg.inputHint || ""}" placeholder="#888888" style="flex:1;min-width:0" ${cfg.autoText ? "disabled" : ""} />
          </div>
        </div>
      </div>

      <hr style="border:0;border-top:1px solid var(--line);margin:4px 0" />

      <h3 style="margin:0;font-size:15px">Text Spacing</h3>
      
      <div style="padding:10px;background:#0b0f16;border:1px solid var(--line);border-radius:12px;margin-bottom:12px">
        <div id="cc-preview-text" style="line-height:${cfg.lineSpacing || 1.5};letter-spacing:${cfg.letterSpacing || 0}px;word-spacing:${(cfg.letterSpacing || 0) * 2}px;word-break:break-word;overflow-wrap:break-word;">This is a preview of your custom text spacing! Move the sliders below to see how your messages will look in the chat.</div>
      </div>
      
      <div class="field">
        <label>Line Spacing: <span id="cc-ls-val">${cfg.lineSpacing || 1.5}</span></label>
        <input type="range" id="cc-line-space" min="0.8" max="3" step="0.1" value="${cfg.lineSpacing || 1.5}" style="width:100%" />
      </div>
      <div class="field">
        <label>Letter Spacing: <span id="cc-let-val">${cfg.letterSpacing || 0}px</span></label>
        <input type="range" id="cc-let-space" min="-1" max="5" step="0.1" value="${cfg.letterSpacing || 0}" style="width:100%" />
      </div>

    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" id="cc-save">Save Customizations</button>
    </div>
  `;

  const { root, close } = shell("Chat Customizer", body, "Chat Customizer");
  
  const autoTxt = root.querySelector("#cc-auto-txt");
  const tAiC = root.querySelector("#cc-ai-txt");
  const tAiT = root.querySelector("#cc-ai-txt-val");
  const tUsrC = root.querySelector("#cc-user-txt");
  const tUsrT = root.querySelector("#cc-user-txt-val");
  
  const tCompC = root.querySelector("#cc-comp-txt");
  const tCompT = root.querySelector("#cc-comp-txt-val");
  const tInC = root.querySelector("#cc-in-txt");
  const tInT = root.querySelector("#cc-in-txt-val");
  const tHintC = root.querySelector("#cc-in-hint");
  const tHintT = root.querySelector("#cc-in-hint-val");

  autoTxt.addEventListener("change", () => {
    const dis = autoTxt.checked;
    tAiC.disabled = dis; tAiT.disabled = dis;
    tUsrC.disabled = dis; tUsrT.disabled = dis;
    tCompC.disabled = dis; tCompT.disabled = dis;
    tInC.disabled = dis; tInT.disabled = dis;
    tHintC.disabled = dis; tHintT.disabled = dis;
  });
  
  const sync = (c, t) => { c.addEventListener("input", () => t.value = c.value); t.addEventListener("input", () => { if (t.value.match(/^#[0-9a-f]{3,8}$/i)) c.value = t.value.slice(0,7); }); };
  sync(root.querySelector("#cc-bg-color"), root.querySelector("#cc-bg-color-txt"));
  sync(root.querySelector("#cc-ai-bg"), root.querySelector("#cc-ai-bg-txt"));
  sync(root.querySelector("#cc-user-bg"), root.querySelector("#cc-user-bg-txt"));
  sync(tAiC, tAiT);
  sync(tUsrC, tUsrT);
  sync(root.querySelector("#cc-comp-bg"), root.querySelector("#cc-comp-bg-txt"));
  sync(tCompC, tCompT);
  sync(root.querySelector("#cc-in-bg"), root.querySelector("#cc-in-bg-txt"));
  sync(tInC, tInT);
  sync(tHintC, tHintT);
  
  let currentImg = cfg.chatBgImage || "";
  const fileIn = root.querySelector("#cc-bg-img");
  const preview = root.querySelector("#cc-bg-preview");
  
  fileIn.addEventListener("change", () => {
    const file = fileIn.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      currentImg = e.target.result;
      preview.src = currentImg;
      preview.style.display = "block";
    };
    reader.readAsDataURL(file);
  });
  
  root.querySelector("#cc-bg-clear").addEventListener("click", () => {
    currentImg = "";
    preview.style.display = "none";
    preview.src = "";
    fileIn.value = "";
  });
  
  const lineSp = root.querySelector("#cc-line-space");
  const lineVal = root.querySelector("#cc-ls-val");
  const letSp = root.querySelector("#cc-let-space");
  const letVal = root.querySelector("#cc-let-val");
  const prevTxt = root.querySelector("#cc-preview-text");
  
  lineSp.addEventListener("input", () => {
    lineVal.textContent = lineSp.value;
    prevTxt.style.lineHeight = lineSp.value;
  });
  letSp.addEventListener("input", () => {
    letVal.textContent = letSp.value + "px";
    prevTxt.style.letterSpacing = letSp.value + "px";
    prevTxt.style.wordSpacing = (parseFloat(letSp.value) * 2) + "px";
  });
  
  root.querySelector("#cc-save").addEventListener("click", async () => {
    if (!char.extensions) char.extensions = {};
    char.extensions.chatConfig = {
      chatBgColor: root.querySelector("#cc-bg-color-txt").value.trim(),
      chatBgImage: currentImg,
      aiBg: root.querySelector("#cc-ai-bg-txt").value.trim(),
      userBg: root.querySelector("#cc-user-bg-txt").value.trim(),
      autoText: autoTxt.checked,
      aiText: tAiT.value.trim(),
      userText: tUsrT.value.trim(),
      composerBg: root.querySelector("#cc-comp-bg-txt").value.trim(),
      composerTxt: tCompT.value.trim(),
      inputBg: root.querySelector("#cc-in-bg-txt").value.trim(),
      inputTxt: tInT.value.trim(),
      inputHint: tHintT.value.trim(),
      lineSpacing: parseFloat(lineSp.value) || 1.5,
      letterSpacing: parseFloat(letSp.value) || 0
    };
    await store.saveCharacter(char);
    close();
    toast("Chat customized!", "ok");
    document.dispatchEvent(new CustomEvent("eui:chat_custom", { detail: { charId: char.id } }));
  });
}

export function openPresetCustomizerModal(isGlobal, charId) {
  const g = store.global;
  const c = isGlobal ? null : store.characters.find(x => x.id === charId);
  const target = isGlobal ? g : (c?.ai || {});
  const p = target.customPreset || {};
  
  const val = (s) => (s || "").replace(/\n/g, "\\n");
  const unesc = (s) => (s || "").replace(/\\n/g, "\n");

  const body = `
    <p class="sub">Configure headers for the "Custom" raw completion formatting preset. Use <code>\\n</code> for newlines.</p>
    <div class="field"><label>Global Prefix</label><input type="text" id="cp-glob" value="${esc(val(p.globalPrefix))}" placeholder="&lt;bos&gt;" /></div>
    <div class="row2">
      <div class="field"><label>System Prefix</label><input type="text" id="cp-sys-s" value="${esc(val(p.sysStart))}" /></div>
      <div class="field"><label>System Suffix</label><input type="text" id="cp-sys-e" value="${esc(val(p.sysEnd))}" /></div>
    </div>
    <div class="row2">
      <div class="field"><label>User Prefix</label><input type="text" id="cp-usr-s" value="${esc(val(p.userStart))}" /></div>
      <div class="field"><label>User Suffix</label><input type="text" id="cp-usr-e" value="${esc(val(p.userEnd))}" /></div>
    </div>
    <div class="row2">
      <div class="field"><label>Assistant Prefix</label><input type="text" id="cp-ast-s" value="${esc(val(p.astStart))}" /></div>
      <div class="field"><label>Assistant Suffix</label><input type="text" id="cp-ast-e" value="${esc(val(p.astEnd))}" /></div>
    </div>
    <div class="field"><label>Custom Stop Sequences (one per line)</label><textarea id="cp-stop" rows="3">${esc((p.stops || []).join("\n"))}</textarea></div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn" id="cp-save">Save Custom Preset</button>
    </div>
  `;
  const { root, close } = shell("Customize Preset", body, "Custom Preset");
  
  root.querySelector("#cp-save").addEventListener("click", async () => {
    const q = (id) => root.querySelector("#" + id).value;
    const newP = {
      globalPrefix: unesc(q("cp-glob")),
      sysStart: unesc(q("cp-sys-s")), sysEnd: unesc(q("cp-sys-e")),
      userStart: unesc(q("cp-usr-s")), userEnd: unesc(q("cp-usr-e")),
      astStart: unesc(q("cp-ast-s")), astEnd: unesc(q("cp-ast-e")),
      stops: q("cp-stop").split("\n").map(s => s.trim()).filter(Boolean)
    };
    if (isGlobal) {
      await store.saveGlobal({ customPreset: newP });
    } else {
      if (!c.ai) c.ai = {};
      c.ai.customPreset = newP;
      await store.saveCharacter(c);
    }
    toast("Custom preset saved.", "ok");
    close();
  });
}
