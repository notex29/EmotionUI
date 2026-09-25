import { store } from "../store-idb.js";

const DEFAULT_TIMEOUT = 20000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class SourceError extends Error {
  constructor(kind, message, { remedy = "", status = 0 } = {}) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
    this.remedy = remedy;
    this.status = status;
  }
}

export function isAbort(e) {
  return e?.name === "SourceError" && e.kind === "abort";
}

export function isRetryableStatus(status) {
  return RETRYABLE.has(status);
}

export function proxyBase() {
  return String(store.global?.cardProxy || "").trim();
}

// When a local proxy is configured every card request is rewritten to
// <proxy>?url=<encoded>. Same-origin, so the browser's CORS rules don't apply.
export function proxied(url, proxyOverride) {
  const base = proxyOverride === undefined ? proxyBase() : String(proxyOverride || "").trim();
  if (!base) return url;
  const sep = base.includes("?") ? "&" : "?";
  return base + sep + "url=" + encodeURIComponent(url);
}

function remedyForBlocked(status, body) {
  if (/not available in your country/i.test(body) || /restricted in your country/i.test(body)) {
    return "chub.ai is geo-blocked on this network. Search cannot be proxied around this — use “Open on chub.ai”, then paste the card link into the Paste a link tab.";
  }
  if (status === 403) {
    return "chub.ai refused the request (rate limit or bot check). Wait a moment, or set the local proxy in Settings to route requests through serve.py.";
  }
  return "Set a local proxy in Settings (serve.py → /api/proxy) if your browser blocks cross-origin requests.";
}

async function once(url, { signal, timeoutMs, accept, proxy }) {
  const target = proxied(url, proxy);
  const ctrl = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) throw new SourceError("abort", "Cancelled.");
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);

  const headers = { Accept: accept };
  try {
    const res = await fetch(target, { method: "GET", headers, signal: ctrl.signal, credentials: "omit", redirect: "follow" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const kind = isRetryableStatus(res.status) ? "rate" : "http";
      const geo = res.status === 403;
      throw new SourceError(
        geo ? "geo" : kind,
        geo ? "chub.ai blocked this request (403)." : `Request failed (${res.status} ${res.statusText || ""}).`.trim(),
        { status: res.status, remedy: geo ? remedyForBlocked(403, body) : (kind === "rate" ? "Rate limited by chub.ai. Wait a few seconds and try again." : "") }
      );
    }
    return res;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    if (timedOut) throw new SourceError("timeout", `Timed out after ${Math.round(timeoutMs / 1000)}s.`, { remedy: "The source was slow or unreachable. Retry, or use the local proxy in Settings." });
    if (signal?.aborted) throw new SourceError("abort", "Cancelled.");
    throw new SourceError("net", e?.message === "Failed to fetch" ? "Network or CORS block." : String(e?.message || e), {
      remedy: "Network or CORS block. If you are offline or the site blocks cross-origin requests, set the local proxy in Settings (serve.py).",
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

export async function request(url, opts = {}) {
  const { signal, timeoutMs = DEFAULT_TIMEOUT, accept = "*/*", proxy } = opts;
  const attempts = signal ? 1 : 2;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await once(url, { signal, timeoutMs, accept, proxy });
    } catch (e) {
      last = e;
      if (e.kind !== "rate" || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { accept: "application/json", ...opts });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new SourceError("parse", "The source returned a non-JSON response.", { remedy: "The endpoint may be down or returning an error page." }); }
}

export async function getText(url, opts = {}) {
  const res = await request(url, { accept: "text/plain,application/json,*/*", ...opts });
  return res.text();
}

export async function getBytes(url, opts = {}) {
  const res = await request(url, { accept: "image/*,application/json,*/*", ...opts });
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), mime: res.headers.get("content-type") || "" };
}

const DEFAULT_IMAGE_HOSTS = ["avatars.charhub.io", "chub.ai", "chub-ai.net", "characterhub.org", "www.characterhub.org", "i.imgur.com", "cdn.discordapp.com"];

// Anything that reaches innerHTML/src must be an https URL on a host we know is
// a card CDN — remote card text is untrusted input.
export function safeRemoteUrl(raw, hosts = DEFAULT_IMAGE_HOSTS) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return ""; }
  if (u.protocol !== "https:") return "";
  if (!hosts.includes(u.hostname)) return "";
  return u.href;
}

export { DEFAULT_IMAGE_HOSTS };
