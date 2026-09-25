import { getJson, getBytes, SourceError, safeRemoteUrl } from "./http.js";
import { extractTavernCard, tavernToCharacter } from "../tavernCard.js";

const SEARCH_HOST = "https://gateway.chub.ai/search";
const DETAIL_HOST = "https://gateway.chub.ai/api/characters";
const CDN = "https://avatars.charhub.io/avatars";

export const SORTS = [
  ["default", "Default"],
  ["trending", "Trending"],
  ["latest", "Recently updated"],
  ["created_at", "Newest"],
  ["rating", "Rating"],
  ["popularity", "Popularity"],
  ["random", "Random"],
];

const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

// Chub's search payload nests field values in a few different shapes depending on
// the card's age; unwrap {content} wrappers and camelCase keys before handing the
// object to the existing SillyTavern mapper.
function unwrap(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && typeof v.content === "string") return v.content;
  return v;
}

export function fullPathOf(node) {
  return String(node?.fullPath || node?.full_path || node?.full_path_slug || "").replace(/^\/+|\/+$/g, "");
}

function idOf(node, fullPath) {
  return String(
    node?.nodeId || node?.node_id || node?.id ||
    node?.data?.extensions?.chub?.id || node?.extensions?.chub?.id || fullPath
  );
}

function tagsOf(node) {
  const t = node?.topics || node?.tags || node?.node?.topics || [];
  return arr(t).map((x) => (typeof x === "string" ? x : x?.name || x?.tag || "")).filter(Boolean).slice(0, 12);
}

function nameOf(node, fullPath) {
  const n = node?.name || node?.tag || node?.title || node?.node?.name;
  if (n) return String(n);
  const parts = fullPath.split("/");
  return (parts[1] || parts[0] || "Unnamed").replace(/-/g, " ");
}

function creatorOf(node, fullPath) {
  const c = node?.creator || node?.userName || node?.user_name || node?.author || node?.node?.creator;
  if (c) return typeof c === "string" ? c : (c?.username || c?.name || "");
  return fullPath.includes("/") ? fullPath.split("/")[0] : "";
}

export function thumbUrl(fullPath) {
  return fullPath ? `${CDN}/${fullPath}/avatar.webp` : "";
}

export function cardPngUrl(fullPath) {
  return fullPath ? `${CDN}/${fullPath}/chara_card_v2.png` : "";
}

export function pageUrl(fullPath) {
  return fullPath ? `https://chub.ai/characters/${fullPath}` : "https://chub.ai/characters";
}

export function searchPageUrl(p = {}) {
  const u = new URL("https://chub.ai/characters");
  u.searchParams.set("namespace", "characters");
  u.searchParams.set("first", String(p.first || 30));
  u.searchParams.set("page", String(p.page || 1));
  if (p.q) u.searchParams.set("search", p.q);
  if (p.sort && p.sort !== "default") u.searchParams.set("sort", p.sort);
  if (p.asc) u.searchParams.set("asc", "true");
  if (p.topics) u.searchParams.set("topics", p.topics);
  return u.href;
}

export function buildSearchUrl(p = {}) {
  const params = {
    namespace: "characters",
    count: "false",
    first: String(p.first || 30),
    page: String(p.page || 1),
    search: p.q || "",
    topics: p.topics || "",
    excludetopics: "",
    sort: p.sort || "default",
    asc: p.asc ? "true" : "false",
    nsfw: p.nsfw ? "true" : "false",
    nsfw_only: "false",
    nsfl: p.nsfw ? "true" : "false",
    include_forks: p.includeForks === false ? "false" : "true",
    exclude_mine: "false",
    only_mine: "",
    require_images: p.requireImages ? "true" : "false",
    require_example_dialogues: p.requireExampleDialogues ? "true" : "false",
    require_custom_prompt: "false",
    require_expressions: "false",
    require_alternate_greetings: "false",
    require_lore: "false",
    require_lore_embedded: "false",
    require_lore_linked: "false",
    recommended_verified: "false",
    inclusive_or: "false",
    min_ai_rating: p.minAiRating ? String(p.minAiRating) : "0",
    min_tokens: p.minTokens ? String(p.minTokens) : "50",
    max_tokens: p.maxTokens ? String(p.maxTokens) : "100000",
    min_tags: p.minTags ? String(p.minTags) : "0",
    max_days_ago: "",
    min_users_chatted: "",
    language: "",
    name_like: "",
    special_mode: "",
    chub: "true",
  };
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== "" && v !== null && v !== undefined) usp.append(k, String(v));
  }
  return `${SEARCH_HOST}?${usp.toString()}`;
}

function normalizeNode(node) {
  const fullPath = fullPathOf(node);
  const stats = node?.stats || node?.node?.stats || {};
  const thumb = thumbUrl(fullPath) || safeRemoteUrl(node?.imageUrl || node?.thumbnailUrl || node?.image_url || "", ["avatars.charhub.io", "chub.ai", "chub-ai.net"]);
  return {
    source: "chub",
    id: idOf(node, fullPath),
    fullPath,
    name: nameOf(node, fullPath),
    creator: creatorOf(node, fullPath),
    tags: tagsOf(node),
    thumb,
    pageUrl: pageUrl(fullPath),
    description: String(unwrap(node?.description || node?.tagline || node?.subtext || "") || ""),
    tokens: Number(node?.stats?.total_tokens || node?.total_tokens || 0) || 0,
    rating: Number(stats?.rating_avg ?? node?.rating ?? 0) || 0,
    ratings: Number(stats?.rating_count ?? node?.rating_count ?? 0) || 0,
    messages: Number(stats?.message_count ?? node?.message_count ?? 0) || 0,
    chats: Number(stats?.user_count ?? 0) || 0,
    updatedAt: Number(node?.updatedAt || node?.updated_at || 0) || 0,
    nsfw: node?.nsfw === true || arr(node?.topics).includes("NSFW"),
    raw: node,
  };
}

export async function search(params, opts = {}) {
  const json = await getJson(buildSearchUrl(params), { accept: "application/json", ...opts });
  const nodes = json?.data?.nodes || json?.data?.items || json?.nodes || [];
  const items = (Array.isArray(nodes) ? nodes : []).map(normalizeNode).filter((c) => c.fullPath);
  const first = Number(params.first || 30);
  return { items, hasMore: items.length >= first, total: Number(json?.data?.total || json?.total || 0) || items.length };
}

function definitionToStCard(def) {
  const d = def || {};
  const s = (k) => {
    const v = unwrap(d[k]);
    return typeof v === "string" ? v : "";
  };
  const card = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: s("name") || s("tag"),
      description: s("description") || s("charDescription") || s("personality_summary"),
      personality: s("personality") || s("personality_summary"),
      scenario: s("scenario"),
      first_mes: s("firstMes") || s("first_mes") || s("greeting"),
      mes_example: s("mesExample") || s("mes_example") || s("exampleDialog"),
      creator_notes: s("creatorNotes") || s("creator_notes"),
      system_prompt: s("systemPrompt") || s("system_prompt"),
      post_history_instructions: s("postHistoryInstructions") || s("post_history_instructions"),
      alternate_greetings: arr(d.alternateGreetings || d.alternate_greetings).map((x) => String(unwrap(x) || "")).filter(Boolean),
      tags: arr(d.tags || d.topics).map((t) => String(typeof t === "string" ? t : t?.name || "")).filter(Boolean),
      creator: typeof d.creator === "string" ? d.creator : (d.creator?.username || ""),
      character_version: s("characterVersion") || s("character_version"),
      character_book: d.characterBook || d.character_book || null,
      extensions: (d.extensions && typeof d.extensions === "object") ? d.extensions : {},
      speech: s("speech"),
      age: s("age"),
      occupation: s("occupation"),
      residence: s("residence"),
    },
  };
  if (!card.data.name && !card.data.description) throw new SourceError("parse", "chub.ai returned no card content for this character.");
  return card;
}

export async function fetchCard(item, opts = {}) {
  const fullPath = item?.fullPath || item?.full_path || "";
  if (!fullPath) throw new SourceError("parse", "This search result has no chub.ai path, so it cannot be downloaded.");
  const pngUrl = cardPngUrl(fullPath);
  try {
    const { bytes, mime } = await getBytes(pngUrl, { accept: "image/png", timeoutMs: 30000, ...opts });
    return { bytes, mime: mime || "image/png", kind: "png", sourceUrl: pngUrl };
  } catch (e) {
    if (e?.kind === "abort") throw e;
    if (e?.status !== 404) throw e;
  }
  // Older cards have no V2 PNG on the CDN; fall back to the gateway definition.
  const json = await getJson(`${DETAIL_HOST}/${fullPath}?full=true`, { accept: "application/json", ...opts });
  const node = json?.node || json?.data?.node || json?.data || null;
  const def = node?.definition || node?.node?.definition || node?.definition_json;
  const card = definitionToStCard(typeof def === "string" ? JSON.parse(def) : def);
  return { json: card, kind: "definition", sourceUrl: pageUrl(fullPath), thumb: thumbUrl(fullPath) };
}

export function characterFromCard(card) {
  if (card.bytes) return extractTavernCard(card.bytes);
  return tavernToCharacter(card.json);
}

export const chubSource = {
  id: "chub",
  label: "Chub.ai",
  home: "https://chub.ai",
  needsQuery: false,
  search,
  thumb: (item) => item.thumb,
  pageUrl: (item) => item.pageUrl,
  externalSearchUrl: (params) => searchPageUrl(params),
  fetchCard,
  characterFromCard,
};
