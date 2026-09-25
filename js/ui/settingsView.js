import { store } from "../core/store-idb.js";
import { fetchModels } from "../core/api_v2.js";
import { testConnection } from "../core/sources/index.js";
import { FORMATTING_PRESETS } from "../core/presets.js";
import { toast } from "./toast.js";
import { esc } from "../core/utils.js";
import { icons } from "./icons.js";

export function renderSettings(main, opts = {}) {
  const g = store.global;
  main.innerHTML = `
  <div style="padding: 24px;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
      <h2 style="margin:0">Global AI settings</h2>
      <button id="s-close" class="icon-btn" aria-label="Close settings">${icons.x}</button>
    </div>
    <p class="sub">OpenAI-compatible API endpoint.</p>
    <div class="field"><label for="s-base">Base URL</label>
      <input id="s-base" type="url" inputmode="url" placeholder="http://localhost:8080/v1" value="${esc(g.baseUrl)}" autocomplete="off" spellcheck="false" />
      <span class="hint">Root of the OpenAI-compatible API, e.g. <code>https://api.openai.com/v1</code> or <code>http://127.0.0.1:8080/v1</code>.</span></div>
    <div class="field"><label for="s-key">API key (optional)</label>
      <input id="s-key" type="password" placeholder="sk-… (leave empty for local engines)" value="${esc(g.apiKey)}" autocomplete="off" spellcheck="false" />
      <span class="hint">Stored securely in your browser. Leave empty for keyless local servers.</span></div>
    <div class="row2">
      <div class="field"><label for="s-fetch">Models</label>
        <div style="display:flex;gap:8px"><button id="s-fetch" class="ghost-btn" type="button" aria-label="Fetch available models from endpoint">Fetch</button></div>
        <span class="hint" id="s-fetch-hint">Fetches <code>GET /models</code>.</span></div>
      <div class="field"><label for="s-model">Selected model</label>
        <select id="s-model" aria-label="Selected global model"><option value="">— pick —</option></select></div>
    </div>
    <div class="row2">
      <div class="field"><label for="s-temp">Temperature</label><input id="s-temp" type="number" step="0.05" min="0" max="2" value="${esc(g.temperature)}" /></div>
      <div class="field"><label for="s-topp">Top P</label><input id="s-topp" type="number" step="0.01" min="0" max="1" value="${esc(g.top_p)}" /></div>
      <div class="field"><label for="s-minp">Min P</label><input id="s-minp" type="number" step="0.01" min="0" max="1" placeholder="empty" value="${g.min_p === "" || g.min_p == null ? "" : esc(g.min_p)}" /></div>
    </div>
    <div class="field"><label for="s-preset">Prompt Formatting Preset</label>
      <div style="display:flex;gap:8px">
        <select id="s-preset" style="flex:1">
          <option value="default">Default Chat/Completion (OpenAI)</option>
          <option value="llama3">Llama 3 / 3.1 / 3.2</option>
          <option value="chatml">ChatML (Qwen/Yi)</option>
          <option value="gemma2">Gemma 2</option>
          <option value="mistral">Mistral v3 / Nemo</option>
          <option value="phi3">Phi-3 / Phi-3.5</option>
          <option value="custom">Custom Format...</option>
        </select>
        <button id="s-preset-edit" class="ghost-btn" style="display:none">Customize</button>
      </div>
    </div>
    <div class="row2">
      <div class="field"><label for="s-maxt">Max tokens</label><input id="s-maxt" type="number" step="1" min="1" max="32000" value="${esc(g.max_tokens)}" /></div>
      <div class="field"><label for="s-hist">History msgs limit (0 = unlimited)</label><input id="s-hist" type="number" step="1" min="0" max="1000" value="${esc(g.history_messages ?? 10)}" /></div>
    </div>
    <div class="row2">
      <div class="field"><label for="s-pres">Presence penalty</label><input id="s-pres" type="number" step="0.05" min="-2" max="2" value="${esc(g.presence_penalty)}" /></div>
      <div class="field"><label for="s-freq">Frequency penalty</label><input id="s-freq" type="number" step="0.05" min="-2" max="2" value="${esc(g.frequency_penalty)}" /></div>
    </div>
    <div class="field"><label for="s-stop">Extra stop sequences (one per line)</label>
      <textarea id="s-stop" rows="3" placeholder="&lt;|im_end|&#10;###">${esc((g.extraStop || []).join("\n"))}</textarea></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <h3 style="margin:0 0 4px;font-size:15px">Online card imports</h3>
    <p class="sub" style="margin:0 0 12px">Browsing chub.ai works directly in the browser. If your network blocks those cross-origin requests, run <code>python serve.py</code> and point this at its built-in relay.</p>
    <div class="field"><label for="s-proxy">Local proxy URL (optional)</label>
      <div style="display:flex;gap:8px">
        <input id="s-proxy" type="url" inputmode="url" placeholder="http://127.0.0.1:8000/api/proxy" value="${esc(g.cardProxy || "")}" autocomplete="off" spellcheck="false" />
        <button id="s-proxy-test" class="ghost-btn" type="button" aria-label="Test the local proxy">Test</button>
      </div>
      <span class="hint" id="s-proxy-hint">Leave empty to talk to card sites directly. The relay only forwards card search and image requests to known card hosts — it never sees your chats, keys or library.</span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="s-save" class="btn" type="button" aria-label="Save global AI settings">Save settings</button>
      <span id="s-saved" class="hint" role="status"></span>
    </div>
  </div>`;

  const $ = (id) => main.querySelector("#" + id);
  $("s-close").addEventListener("click", () => {
    main.classList.remove("is-open");
    const scrim = document.getElementById("right-scrim");
    if (scrim) scrim.hidden = true;
  });
  
  const modelSel = $("s-model");
  const known = [...new Set([g.model, ...(opts.models || [])].filter(Boolean))];
  modelSel.innerHTML = `<option value="">— pick —</option>` + known.map((m) => `<option ${m === g.model ? "selected" : ""} value="${esc(m)}">${esc(m)}</option>`).join("");

  const presetSel = $("s-preset");
  const presetEdit = $("s-preset-edit");
  presetSel.value = g.promptPreset || "default";
  const updateEditBtn = () => { presetEdit.style.display = presetSel.value === "custom" ? "block" : "none"; };
  updateEditBtn();
  presetSel.addEventListener("change", () => {
    updateEditBtn();
    const stops = FORMATTING_PRESETS[presetSel.value]?.stops;
    if (stops && stops.length > 0) {
      $("s-stop").value = stops.join("\n");
    }
  });
  presetEdit.addEventListener("click", () => document.dispatchEvent(new CustomEvent("eui:edit_preset", { detail: { isGlobal: true } })));

  $("s-fetch").addEventListener("click", async () => {
    const hint = $("s-fetch-hint");
    try {
      $("s-fetch").disabled = true; hint.textContent = "Fetching…";
      const models = await fetchModels($("s-base").value.trim(), $("s-key").value);
      if (!models.length) { hint.textContent = "No models returned."; return; }
      modelSel.innerHTML = models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
      if (g.model && models.includes(g.model)) modelSel.value = g.model;
      hint.textContent = `Found ${models.length} model(s).`;
      toast(`Found ${models.length} model(s)`, "ok");
    } catch (e) { hint.textContent = e.message; toast(e.message, "err"); }
    finally { $("s-fetch").disabled = false; }
  });

  $("s-proxy-test").addEventListener("click", async () => {
    const hint = $("s-proxy-hint");
    const value = $("s-proxy").value.trim();
    if (!value) { hint.textContent = "Enter a proxy URL first, e.g. http://127.0.0.1:8000/api/proxy"; return; }
    try {
      $("s-proxy-test").disabled = true;
      hint.textContent = "Testing…";
      const res = await testConnection(value);
      hint.textContent = `Proxy works — ${res.ms}ms, ${(res.bytes / 1024).toFixed(0)} KB. Press Save settings to keep it.`;
      toast("Local proxy reachable.", "ok");
    } catch (e) {
      hint.textContent = `${e.message} — is serve.py running?`;
      toast("Proxy test failed.", "err");
    } finally {
      $("s-proxy-test").disabled = false;
    }
  });

  $("s-save").addEventListener("click", async () => {
    await store.saveGlobal({
      baseUrl: $("s-base").value.trim(), apiKey: $("s-key").value,
      model: modelSel.value, temperature: Number($("s-temp").value),
      top_p: Number($("s-topp").value), min_p: $("s-minp").value === "" ? "" : Number($("s-minp").value),
      max_tokens: Number($("s-maxt").value), history_messages: Number($("s-hist").value), presence_penalty: Number($("s-pres").value),
      frequency_penalty: Number($("s-freq").value),
      promptPreset: presetSel.value,
      extraStop: $("s-stop").value.split("\n").map((s) => s.trim()).filter(Boolean),
      cardProxy: $("s-proxy").value.trim(),
    });
    $("s-saved").textContent = "Settings saved.";
    document.dispatchEvent(new CustomEvent("eui:conn"));
    toast("Global settings saved.", "ok");
  });
}

export async function fetchIntoSelect(baseUrl, apiKey, selectEl, current) {
  const models = await fetchModels(baseUrl, apiKey);
  selectEl.innerHTML = `<option value="">— use global —</option>` + models.map((m) => `<option ${m === current ? "selected" : ""} value="${esc(m)}">${esc(m)}</option>`).join("");
  return models;
}

export function samplingFields(prefix, values, main) {
  const v = (k, d) => (values?.[k] ?? "" ) === "" ? "" : esc(values[k]);
  return `
    <div class="row2">
      <div class="field"><label for="${prefix}-temp">Temp (empty=global)</label><input id="${prefix}-temp" type="number" step="0.05" min="0" max="2" placeholder="global" value="${v("temperature")}" /></div>
      <div class="field"><label for="${prefix}-topp">Top P</label><input id="${prefix}-topp" type="number" step="0.01" min="0" max="1" placeholder="global" value="${v("top_p")}" /></div>
      <div class="field"><label for="${prefix}-minp">Min P</label><input id="${prefix}-minp" type="number" step="0.01" min="0" max="1" placeholder="global" value="${v("min_p")}" /></div>
    </div>
    <div class="field"><label for="${prefix}-preset">Prompt Formatting Preset</label>
      <div style="display:flex;gap:8px">
        <select id="${prefix}-preset" style="flex:1">
          <option value="">— use global —</option>
          <option value="default" ${values?.promptPreset === 'default' ? 'selected' : ''}>Default Chat/Completion (OpenAI)</option>
          <option value="llama3" ${values?.promptPreset === 'llama3' ? 'selected' : ''}>Llama 3 / 3.1 / 3.2</option>
          <option value="chatml" ${values?.promptPreset === 'chatml' ? 'selected' : ''}>ChatML (Qwen/Yi)</option>
          <option value="gemma2" ${values?.promptPreset === 'gemma2' ? 'selected' : ''}>Gemma 2</option>
          <option value="mistral" ${values?.promptPreset === 'mistral' ? 'selected' : ''}>Mistral v3 / Nemo</option>
          <option value="phi3" ${values?.promptPreset === 'phi3' ? 'selected' : ''}>Phi-3 / Phi-3.5</option>
          <option value="custom" ${values?.promptPreset === 'custom' ? 'selected' : ''}>Custom Format...</option>
        </select>
        <button id="${prefix}-preset-edit" class="ghost-btn" style="display:${values?.promptPreset === 'custom' ? 'block' : 'none'}" type="button">Customize</button>
      </div>
    </div>
    <div class="row2">
      <div class="field"><label for="${prefix}-maxt">Max tokens</label><input id="${prefix}-maxt" type="number" min="1" max="32000" placeholder="global" value="${v("max_tokens")}" /></div>
      <div class="field"><label for="${prefix}-hist">History limit (0 = unlim, empty = global)</label><input id="${prefix}-hist" type="number" min="0" max="1000" placeholder="global" value="${v("history_messages")}" /></div>
    </div>
    <div class="row2">
      <div class="field"><label for="${prefix}-pres">Presence penalty</label><input id="${prefix}-pres" type="number" step="0.05" min="-2" max="2" placeholder="global" value="${v("presence_penalty")}" /></div>
      <div class="field"><label for="${prefix}-freq">Frequency penalty</label><input id="${prefix}-freq" type="number" step="0.05" min="-2" max="2" placeholder="global" value="${v("frequency_penalty")}" /></div>
    </div>
    <div class="field"><label for="${prefix}-stop">Extra stop sequences (one per line)</label><textarea id="${prefix}-stop" rows="2">${esc((values?.extraStop || []).join("\n"))}</textarea></div>`;
}

export function readSampling(prefix, main) {
  const val = (id) => { const el = main.querySelector("#" + id); return el && el.value !== "" ? Number(el.value) : ""; };
  const stopEl = main.querySelector(`#${prefix}-stop`);
  return {
    temperature: val(`${prefix}-temp`), top_p: val(`${prefix}-topp`), min_p: val(`${prefix}-minp`),
    max_tokens: val(`${prefix}-maxt`), history_messages: val(`${prefix}-hist`),
    presence_penalty: val(`${prefix}-pres`), frequency_penalty: val(`${prefix}-freq`),
    promptPreset: main.querySelector(`#${prefix}-preset`)?.value || "",
    extraStop: stopEl ? stopEl.value.split("\n").map((s) => s.trim()).filter(Boolean) : [],
  };
}

export function normalizeSampling(raw) {
  return {
    temperature: raw.temperature === "" ? "" : Number(raw.temperature),
    top_p: raw.top_p === "" ? "" : Number(raw.top_p),
    min_p: raw.min_p === "" || raw.min_p == null ? "" : Number(raw.min_p),
    presence_penalty: raw.presence_penalty === "" ? "" : Number(raw.presence_penalty),
    frequency_penalty: raw.frequency_penalty === "" ? "" : Number(raw.frequency_penalty),
    max_tokens: raw.max_tokens === "" ? "" : Number(raw.max_tokens),
    history_messages: raw.history_messages === "" ? "" : Number(raw.history_messages),
    promptPreset: raw.promptPreset || "",
    extraStop: raw.extraStop || [],
  };
}
