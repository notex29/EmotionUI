import { uid } from "./utils.js";

// SillyTavern PNG character card: JSON stored in tEXt/iTXt chunk keyword "chara".
export function defaultCharacter() {
  return {
    id: "", name: "", shortName: "", description: "", personality: "", scenario: "",
    firstMessage: "", exampleDialog: "", creatorNotes: "", systemPrompt: "", postHistoryInstructions: "",
    speech: "", occupation: "", age: "", residence: "",
    tags: "", altGreetings: [], avatar: "", creator: "", characterVersion: "",
    extensions: {
      chatConfig: {
        aiBg: "transparent", userBg: "transparent", autoText: true, aiText: "", userText: "", chatBgColor: "", chatBgImage: "",
        composerBg: "", composerTxt: "", inputBg: "", inputTxt: "", inputHint: "",
        lineSpacing: 1.5, letterSpacing: 0
      }
    },
    characterBook: null,
    ai: { baseUrl: "", apiKey: "", model: "", temperature: "", top_p: "", presence_penalty: "", frequency_penalty: "", max_tokens: "", extraStop: [] },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function bytesToDataUrl(bytes, mime = "image/png") {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function fileToDataUrl(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return { dataUrl: bytesToDataUrl(bytes, file.type || "image/png"), bytes };
}

// Remote cards arrive as raw bytes rather than a File, so build the same data URL
// and try to shrink it first — full Chub card PNGs run 200KB-1MB and every character
// avatar is persisted into IndexedDB.
export async function bytesToScaledDataUrl(bytes, mime = "image/png", maxSize = 512) {
  const raw = bytesToDataUrl(bytes, mime);
  if (typeof document === "undefined" || !window.createImageBitmap) return raw;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    if (scale >= 1) { bmp.close?.(); return raw; }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const out = canvas.toDataURL(mime === "image/webp" ? "image/webp" : "image/jpeg", 0.88);
    return out.length > 64 ? out : raw;
  } catch (e) {
    return raw;
  }
}

export function extractTavernCard(bytes) {
  try {
    const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== pngSig[i]) return null;
    let pos = 8;
    const dec = new TextDecoder("latin1");
    while (pos < bytes.length) {
      const len = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      const type = dec.decode(bytes.subarray(pos + 4, pos + 8));
      const data = bytes.subarray(pos + 8, pos + 8 + len);
      if (type === "tEXt" || type === "iTXt") {
        const zero = data.indexOf(0);
        const keyword = dec.decode(data.subarray(0, zero));
        if (keyword === "chara") {
          let payload;
          if (type === "tEXt") payload = dec.decode(data.subarray(zero + 1));
          else {
            // iTXt: keyword\0 compFlag compMethod lang\0 translated\0 text
            let p = zero + 1 + 2;
            while (p < data.length && data[p] !== 0) p++;
            p++;
            while (p < data.length && data[p] !== 0) p++;
            p++;
            payload = new TextDecoder("utf-8").decode(data.subarray(p));
          }
          const binStr = atob(payload);
          const u8 = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) u8[i] = binStr.charCodeAt(i);
          const jsonStr = new TextDecoder("utf-8").decode(u8);
          const json = JSON.parse(jsonStr);
          return tavernToCharacter(json);
        }
      }
      if (type === "IEND") break;
      pos += 12 + len;
    }
  } catch (e) { console.warn("card parse failed", e); }
  return null;
}

export function tavernToCharacter(t) {
  const c = defaultCharacter();
  c.id = uid("char");
  c.name = t?.name || t?.data?.name || "";
  const d = t?.data || t || {};
  c.description = d.description || "";
  const nameMatch = c.description.match(/^(?:Name|Character):\s*([^\n]+)/im);
  c.shortName = nameMatch ? nameMatch[1].trim() : c.name.split(" ")[0];
  c.personality = d.personality || "";
  c.scenario = d.scenario || "";
  c.firstMessage = d.first_mes || "";
  c.exampleDialog = d.mes_example || "";
  c.creatorNotes = d.creator_notes || "";
  c.systemPrompt = d.system_prompt || "";
  c.postHistoryInstructions = d.post_history_instructions || "";
  c.speech = d.speech || "";
  c.tags = Array.isArray(d.tags) ? d.tags.join(", ") : (d.tags || "");
  c.altGreetings = Array.isArray(d.alternate_greetings) ? d.alternate_greetings.filter(Boolean) : [];
  c.creator = d.creator || "";
  c.characterVersion = d.character_version || "";
  c.characterBook = d.character_book || null;
  c.extensions = typeof d.extensions === "object" ? d.extensions : {};
  return c;
}

export function parseCardJsonFile(text) {
  const j = JSON.parse(text);
  if (j?.spec === "chara_card_v2" || j?.data || j?.name) return tavernToCharacter(j);
  if (typeof j?.name === "string") return { ...defaultCharacter(), ...j, id: j.id || uid("char") };
  throw new Error("Unrecognized character JSON.");
}
