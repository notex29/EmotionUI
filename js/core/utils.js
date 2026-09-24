export const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clampStr = (s, n = 2000) => String(s ?? "").slice(0, n);
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export function normalizeBaseUrl(u) {
  u = String(u || "").trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u.replace(/\/+$/, "");
}
export function keywordsOf(text, min = 5, max = 12) {
  const stop = new Set("about,after,there,their,what,when,where,which,while,with,that,this,from,have,were,your,know,just,like,into,over,more,very,will,would,should,could,been,than,them,then,they,them,such,also,only,even,still,manifest,still".split(","));
  const words = String(text || "").toLowerCase().replace(/[^a-z0-9_\- ]/g, " ").split(/\s+/).filter((w) => w.length >= min && !stop.has(w));
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}
export function rareKeywordsOf(text, history, min = 5, max = 12) {
  const baseKeys = keywordsOf(text, min, max * 2);
  if (!history || history.length < 5) return baseKeys.slice(0, max);
  
  const df = new Map();
  for (const m of history) {
    const wds = new Set(String(m.content || "").toLowerCase().replace(/[^a-z0-9_\- ]/g, " ").split(/\s+/));
    for (const k of baseKeys) {
      if (wds.has(k)) df.set(k, (df.get(k) || 0) + 1);
    }
  }
  
  // Filter out keys that appear in > 10% of messages
  const threshold = Math.max(3, history.length * 0.1);
  return baseKeys.filter(k => (df.get(k) || 0) < threshold).slice(0, max);
}
