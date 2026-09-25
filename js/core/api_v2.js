import { normalizeBaseUrl } from "./utils.js";

export function resolveEndpoint(charCfg, globalCfg) {
  const baseUrl = normalizeBaseUrl(charCfg?.baseUrl || globalCfg.baseUrl);
  const apiKey = (charCfg?.apiKey ?? "") !== "" ? charCfg.apiKey : globalCfg.apiKey;
  const model = charCfg?.model || globalCfg.model;
  const merged = {
    temperature: pick(charCfg?.temperature, globalCfg.temperature, 0.75),
    top_p: pick(charCfg?.top_p, globalCfg.top_p, 0.9),
    min_p: pick(charCfg?.min_p, globalCfg.min_p, ""),
    presence_penalty: pick(charCfg?.presence_penalty, globalCfg.presence_penalty, 0.2),
    frequency_penalty: pick(charCfg?.frequency_penalty, globalCfg.frequency_penalty, 0.3),
    max_tokens: pick(charCfg?.max_tokens, globalCfg.max_tokens, 800),
    history_messages: pick(charCfg?.history_messages, globalCfg.history_messages, 10),
    promptPreset: charCfg?.promptPreset || globalCfg.promptPreset || "default",
    customPreset: charCfg?.customPreset || globalCfg.customPreset || {},
    extraStop: [...(globalCfg.extraStop || []), ...(charCfg?.extraStop || [])],
  };
  return { baseUrl, apiKey: apiKey || "", model: model || "", ...merged };
}
function pick(a, b, d) {
  if (a === "" || a === null || a === undefined) {
    if (b === "" || b === null || b === undefined) return d;
    return Number(b);
  }
  return Number(a);
}

export async function fetchModels(baseUrl, apiKey) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("Set a base URL first (e.g. http://localhost:8080/v1).");
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) throw new Error(`Models request failed (${res.status}). Check base URL / key.`);
  const data = await res.json();
  const list = Array.isArray(data?.data) ? data.data.map((m) => m.id).filter(Boolean)
    : Array.isArray(data?.models) ? data.models.map((m) => m.name || m.id).filter(Boolean)
    : [];
  return [...new Set(list)].sort();
}

export async function chatCompletion({ baseUrl, apiKey, body }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("No AI endpoint configured. Open Settings and set a base URL.");
  if (!body.model) throw new Error("No model selected. Open Settings and fetch + pick a model.");
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  
  const isRaw = body.prompt !== undefined;
  const endpoint = isRaw ? `${base}/completions` : `${base}/chat/completions`;
  
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ stream: false, ...body }) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 300) || res.statusText}`);
  }
  const data = await res.json();
  const text = isRaw ? data?.choices?.[0]?.text?.trim() : data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty reply from model.");
  return text;
}

export async function* streamChatCompletion({ baseUrl, apiKey, body }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("No AI endpoint configured. Open Settings and set a base URL.");
  if (!body.model) throw new Error("No model selected. Open Settings and fetch + pick a model.");
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  
  const isRaw = body.prompt !== undefined;
  const endpoint = isRaw ? `${base}/completions` : `${base}/chat/completions`;
  
  const res = await fetch(endpoint, { 
    method: "POST", 
    headers, 
    body: JSON.stringify({ ...body, stream: true }) 
  });
  
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 300) || res.statusText}`);
  }
  
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete chunk
    
    for (let line of lines) {
      line = line.trim();
      if (!line.startsWith("data:")) continue;
      
      const dataStr = line.slice(5).trim();
      if (dataStr === "[DONE]") return;
      
      try {
        const data = JSON.parse(dataStr);
        const chunk = isRaw ? data?.choices?.[0]?.text : data?.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch (e) {
        // Ignore incomplete JSON fragment parsing errors if they somehow occur
      }
    }
  }
}
