import { store } from "../store-idb.js";
import { defaultCharacter, bytesToScaledDataUrl, bytesToDataUrl } from "../tavernCard.js";
import { getBytes, request, SourceError } from "./http.js";
import { chubSource, thumbUrl } from "./chub.js";
import { urlSource } from "./url.js";

export { SourceError, isAbort } from "./http.js";

export const SOURCES = [chubSource, urlSource];
export function getSource(id) {
  return SOURCES.find((s) => s.id === id) || SOURCES[0];
}

// Public, geo-neutral, CORS-open URL used only to check that the local proxy is
// actually reachable and relaying.
export const PROBE_URL = "https://avatars.charhub.io/avatars/slaykyh/character-card-builder-8927c8a0/avatar.webp";

export async function testConnection(proxy) {
  const started = performance.now();
  const res = await request(PROBE_URL, { accept: "image/*", timeoutMs: 12000, proxy });
  const bytes = Number(res.headers.get("content-length") || 0);
  await res.arrayBuffer().catch(() => null);
  return { ok: true, ms: Math.round(performance.now() - started), bytes };
}

function sourceIdOf(item) {
  if (!item) return "";
  if (item.id) return String(item.id);
  if (item.fullPath) return `chub:${item.fullPath}`;
  return "";
}

export function findExisting(item, character) {
  const sid = sourceIdOf(item);
  const bySource = sid ? store.characters.find((c) => c.extensions?.source?.id === sid) : null;
  if (bySource) return bySource;
  const name = (character?.name || item?.name || "").trim().toLowerCase();
  if (!name) return null;
  return store.characters.find((c) => (c.name || "").trim().toLowerCase() === name && (c.creator || "") === (item?.creator || "")) || null;
}

function stampSource(character, item, sourceUrl) {
  if (!character.extensions || typeof character.extensions !== "object") character.extensions = {};
  if (!character.extensions.chatConfig) character.extensions.chatConfig = defaultCharacter().extensions.chatConfig;
  character.extensions.source = {
    platform: item.platform || item.source || "web",
    id: sourceIdOf(item) || sourceUrl || "",
    url: item.pageUrl || sourceUrl || "",
    importedAt: Date.now(),
  };
  return character;
}

async function avatarFromCard(card, item) {
  if (card.bytes) {
    const mime = (card.mime || "image/png").split(";")[0].trim();
    if (!mime.startsWith("image/")) return "";
    return bytesToScaledDataUrl(card.bytes, mime);
  }
  if (card.thumb || item?.thumb) {
    try {
      const { bytes, mime } = await getBytes(card.thumb || item.thumb, { accept: "image/*", timeoutMs: 15000 });
      return bytesToScaledDataUrl(bytes, (mime || "image/webp").split(";")[0].trim());
    } catch { return ""; }
  }
  return "";
}

/**
 * Fetch, parse and persist one remote card.
 * persist: false returns the parsed character without touching storage (used by
 * the character form, so a cancelled edit never leaves a stray record behind).
 * resolveDuplicate(existing, fresh) -> "update" | "new" | "skip"
 */
export async function importItem(item, { signal, onStage, resolveDuplicate, persist = true } = {}) {
  const source = getSource(item.source);
  onStage?.("Downloading card…");
  const card = await source.fetchCard(item, { signal });

  onStage?.("Reading card…");
  let character = null;
  try {
    character = source.characterFromCard(card);
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError("parse", "That file is not a readable character card.");
  }

  if (!character) {
    // A plain image with no embedded tEXt card — keep it as a photo-only character.
    if (!card.bytes) throw new SourceError("parse", "No character data found at that link.");
    character = defaultCharacter();
    character.name = (item?.name || "Imported character").replace(/\.(png|webp|jpe?g)$/i, "").replace(/[-_]+/g, " ").trim() || "Imported character";
    character.creator = item?.creator || "";
    character.tags = "imported";
  }
  if (!character.ai || typeof character.ai !== "object") character.ai = defaultCharacter().ai;
  if (!Array.isArray(character.altGreetings)) character.altGreetings = [];

  onStage?.("Preparing image…");
  const avatar = await avatarFromCard(card, item);
  if (avatar) character.avatar = avatar;
  stampSource(character, item, card.sourceUrl);

  if (!persist) return { character, persisted: false };

  const existing = findExisting(item, character);
  let updated = false;
  if (existing) {
    const decision = resolveDuplicate ? await resolveDuplicate(existing, character) : "new";
    if (decision === "skip") return { skipped: true, existing };
    if (decision === "update") {
      updated = true;
      const merged = {
        ...existing,
        ...character,
        id: existing.id,
        createdAt: existing.createdAt || Date.now(),
        ai: hasAi(existing.ai) ? existing.ai : character.ai,
        extensions: {
          ...character.extensions,
          chatConfig: existing.extensions?.chatConfig || character.extensions?.chatConfig,
        },
      };
      if (!character.avatar) merged.avatar = existing.avatar || "";
      character = merged;
    }
  }

  onStage?.("Saving…");
  const saved = await store.saveCharacter(character);
  return { saved, existing: updated ? existing : null, updated };
}

function hasAi(ai) {
  return !!ai && Object.values(ai).some((v) => v !== "" && v != null);
}

// Re-exported so UI modules have a single import surface for card sources.
export { thumbUrl, bytesToDataUrl };
export { proxyBase, safeRemoteUrl, getBytes, getJson } from "./http.js";
