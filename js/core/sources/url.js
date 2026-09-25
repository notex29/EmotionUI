import { getBytes, getText, SourceError, safeRemoteUrl } from "./http.js";
import { extractTavernCard, parseCardJsonFile } from "../tavernCard.js";
import { cardPngUrl, thumbUrl, pageUrl, characterFromCard as chubCharacterFromCard } from "./chub.js";

const CHUB_PAGE = /^(?:www\.)?(?:chub\.ai|chub-ai\.net|characterhub\.org|www\.characterhub\.org)\/characters\/([^/?#]+\/[^/?#]+)/i;
const CHUB_CDN = /avatars\.charhub\.io\/avatars\/([^/?#]+\/[^/?#]+)/i;

const IMAGE_HOSTS = [
  "avatars.charhub.io", "chub.ai", "chub-ai.net", "characterhub.org", "www.characterhub.org",
  "i.imgur.com", "imgur.com", "cdn.discordapp.com", "media.discordapp.net", "raw.githubusercontent.com",
];

function parse(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new SourceError("parse", "Paste a card link first.");
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new SourceError("parse", "That doesn't look like a URL.");
  }
  if (u.protocol !== "https:") {
    throw new SourceError("parse", "Only https:// links are supported.", { remedy: "Local file paths still work with the Upload button on the character form." });
  }
  return u;
}

export function resolveUrl(input) {
  const u = parse(input);
  const href = u.href;
  // Match against host+path so the ^ anchors stay meaningful and a lookalike
  // host such as "chub.ai.evil.com" can't slip through.
  const sitePath = u.hostname.toLowerCase() + u.pathname;

  const chub = sitePath.match(CHUB_PAGE);
  if (chub) {
    const fullPath = chub[1].replace(/\/+$/, "");
    return {
      source: "url",
      id: `chub:${fullPath}`,
      platform: "chub",
      kind: "chub",
      fullPath,
      name: (fullPath.split("/")[1] || fullPath).replace(/-/g, " "),
      creator: fullPath.split("/")[0],
      tags: [],
      thumb: thumbUrl(fullPath),
      pageUrl: pageUrl(fullPath),
      description: "",
      sourceUrl: href,
    };
  }

  const cdn = sitePath.match(CHUB_CDN);
  if (cdn) {
    const fullPath = cdn[1].replace(/\/+$/, "");
    return {
      source: "url", id: `chub:${fullPath}`, platform: "chub", kind: "chub", fullPath,
      name: (fullPath.split("/")[1] || fullPath).replace(/-/g, " "), creator: fullPath.split("/")[0],
      tags: [], thumb: thumbUrl(fullPath), pageUrl: pageUrl(fullPath), description: "", sourceUrl: href,
    };
  }

  const isPng = /\.(png|webp|jpe?g)(\?|#|$)/i.test(u.pathname) || u.pathname.toLowerCase().endsWith(".png");
  if (isPng) {
    if (!safeRemoteUrl(href, IMAGE_HOSTS)) {
      throw new SourceError("parse", "Images are only fetched from known card hosts.", { remedy: `Allowed: ${IMAGE_HOSTS.slice(0, 4).join(", ")}…` });
    }
    return { source: "url", id: `png:${href}`, platform: "image", kind: "png", name: u.pathname.split("/").pop() || "Image", creator: u.hostname, tags: [], thumb: safeRemoteUrl(href, IMAGE_HOSTS), pageUrl: href, description: "", sourceUrl: href };
  }

  if (/\.json(\?|#|$)/i.test(u.pathname) || /\.json$/i.test(u.pathname)) {
    return { source: "url", id: `json:${href}`, platform: "json", kind: "json", name: u.pathname.split("/").pop() || "card.json", creator: u.hostname, tags: [], thumb: "", pageUrl: href, description: "", sourceUrl: href };
  }

  throw new SourceError("parse", "Unsupported link.", {
    remedy: "Use a chub.ai/characterhub card page, a direct .png character card, or a direct .json card link.",
  });
}

export async function fetchCard(item, opts = {}) {
  if (item.kind === "chub") {
    const { bytes, mime } = await getBytes(cardPngUrl(item.fullPath), { accept: "image/png", timeoutMs: 30000, ...opts });
    return { bytes, mime: mime || "image/png", kind: "png", sourceUrl: item.sourceUrl, platform: "chub" };
  }
  if (item.kind === "png") {
    const { bytes, mime } = await getBytes(item.sourceUrl, { accept: "image/*", timeoutMs: 30000, ...opts });
    return { bytes, mime: mime || "image/png", kind: "png", sourceUrl: item.sourceUrl, platform: "image" };
  }
  const text = await getText(item.sourceUrl, { accept: "application/json,text/plain,*/*", ...opts });
  return { text, kind: "json", sourceUrl: item.sourceUrl, platform: "json" };
}

export function characterFromCard(card) {
  if (card.kind === "json") return parseCardJsonFile(card.text);
  return extractTavernCard(card.bytes);
}

export const urlSource = {
  id: "url",
  label: "Paste a link",
  home: "",
  needsQuery: false,
  resolve: resolveUrl,
  search: null,
  thumb: (item) => item.thumb,
  pageUrl: (item) => item.pageUrl,
  fetchCard,
  characterFromCard,
  characterFromChubCard: chubCharacterFromCard,
};
