// OPFS-backed storage. No localStorage is used for secrets, chats or cards.
// Layout inside OPFS root/emotionui/:
//   settings/global.json
//   characters/<id>.json
//   personas/<id>.json
//   chats/<charId>.json
//   memories/<charId>.json
import { uid } from "./utils.js";

const ROOT = "emotionui";
let dirHandle = null;
let memCache = { global: null, characters: null, personas: null, chats: {}, memories: {} };
let persistGranted = false;

async function root() {
  if (dirHandle) return dirHandle;
  if (!navigator.storage || !navigator.storage.getDirectory) throw new Error("OPFS API missing");
  const opfs = await navigator.storage.getDirectory();
  dirHandle = await opfs.getDirectoryHandle(ROOT, { create: true });
  for (const sub of ["settings", "characters", "personas", "chats", "memories", "avatars"]) {
    await dirHandle.getDirectoryHandle(sub, { create: true });
  }
  return dirHandle;
}
async function sub(name) { const r = await root(); return r.getDirectoryHandle(name, { create: true }); }
async function readJson(subDir, file) {
  try {
    const d = await sub(subDir);
    const h = await d.getFileHandle(file, { create: false });
    const f = await h.getFile();
    const t = await f.text();
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}
async function writeJson(subDir, file, value) {
  const d = await sub(subDir);
  const h = await d.getFileHandle(file, { create: true });
  const w = await h.createWritable();
  await w.write(JSON.stringify(value));
  await w.close();
}
async function removeFile(subDir, file) {
  try { const d = await sub(subDir); await d.removeEntry(file); } catch { /* noop */ }
}
async function listJson(subDir) {
  const d = await sub(subDir);
  const out = [];
  for await (const [name, h] of d.entries()) {
    if (h.kind === "file" && name.endsWith(".json")) {
      const v = await readJson(subDir, name);
      if (v) out.push(v);
    }
  }
  return out;
}

export async function initStorage(onStatus) {
  try { persistGranted = await navigator.storage.persist(); } catch { persistGranted = false; }
  if (navigator.storage?.persisted) { try { persistGranted = await navigator.storage.persisted(); } catch { /* noop */ } }
  
  try {
    await root();
    memCache.global = (await readJson("settings", "global.json")) || defaultGlobal();
    memCache.characters = await listJson("characters");
    memCache.personas = await listJson("personas");
  } catch (err) {
    console.warn("OPFS unavailable (likely insecure context). Falling back to in-memory.", err);
    memCache.global = defaultGlobal();
    memCache.characters = [];
    memCache.personas = [];
  }
  
  if (!memCache.personas.length) {
    const p = { id: uid("persona"), name: "Default User", prompt: "A grounded, curious roleplay partner.", active: true, updatedAt: Date.now() };
    try { await writeJson("personas", `${p.id}.json`, p); } catch {}
    memCache.personas = [p];
  }
  onStatus?.({ persisted: persistGranted });
  return memCache;
}

export function defaultGlobal() {
  return {
    baseUrl: "", apiKey: "", model: "",
    temperature: 0.75, top_p: 0.9,
    presence_penalty: 0.2, frequency_penalty: 0.3,
    max_tokens: 800, extraStop: [], updatedAt: Date.now(),
  };
}
export const store = {
  get persisted() { return persistGranted; },
  get global() { return memCache.global; },
  get characters() { return memCache.characters || []; },
  get personas() { return memCache.personas || []; },
  activePersona() { return memCache.personas.find((p) => p.active) || memCache.personas[0]; },
  async saveGlobal(patch) {
    memCache.global = { ...memCache.global, ...patch, updatedAt: Date.now() };
    try { await writeJson("settings", "global.json", memCache.global); } catch {}
    return memCache.global;
  },
  async saveCharacter(c) {
    c.updatedAt = Date.now();
    if (!c.id) c.id = uid("char");
    try { await writeJson("characters", `${c.id}.json`, c); } catch {}
    const i = memCache.characters.findIndex((x) => x.id === c.id);
    if (i >= 0) memCache.characters[i] = c; else memCache.characters.unshift(c);
    return c;
  },
  async deleteCharacter(id) {
    try {
      await removeFile("characters", `${id}.json`);
      await removeFile("chats", `${id}.json`);
      await removeFile("memories", `${id}.json`);
    } catch {}
    memCache.characters = memCache.characters.filter((c) => c.id !== id);
    delete memCache.chats[id]; delete memCache.memories[id];
  },
  async savePersona(p) {
    p.updatedAt = Date.now();
    if (!p.id) p.id = uid("persona");
    try { await writeJson("personas", `${p.id}.json`, p); } catch {}
    const i = memCache.personas.findIndex((x) => x.id === p.id);
    if (i >= 0) memCache.personas[i] = p; else memCache.personas.push(p);
    return p;
  },
  async setActivePersona(id) {
    for (const p of memCache.personas) {
      const next = p.id === id;
      if (p.active !== next) { 
        p.active = next; 
        try { await writeJson("personas", `${p.id}.json`, p); } catch {}
      }
    }
  },
  async deletePersona(id) {
    if (memCache.personas.length <= 1) throw new Error("Keep at least one persona.");
    try { await removeFile("personas", `${id}.json`); } catch {}
    memCache.personas = memCache.personas.filter((p) => p.id !== id);
    if (!memCache.personas.some((p) => p.active)) { 
      memCache.personas[0].active = true; 
      try { await writeJson("personas", `${memCache.personas[0].id}.json`, memCache.personas[0]); } catch {}
    }
  },
  getChatSync(charId) { 
    const container = memCache.chats[charId];
    if (!container) return null;
    return container.chats ? container.chats[container.activeChatId] : container;
  },
  async getChat(charId, specificChatId = null) {
    let container = memCache.chats[charId];
    if (!container) {
      container = (await readJson("chats", `${charId}.json`));
      if (!container) {
        const def = uid("chat");
        container = { charId, activeChatId: def, chats: { [def]: { id: def, charId, messages: [], updatedAt: Date.now() } } };
      } else if (Array.isArray(container.messages)) {
        // Migrate legacy single-chat format
        const def = uid("chat");
        container = { charId, activeChatId: def, chats: { [def]: { id: def, charId, messages: container.messages, updatedAt: container.updatedAt } } };
      }
      memCache.chats[charId] = container;
    }
    
    if (specificChatId && container.chats[specificChatId]) {
      container.activeChatId = specificChatId;
      await writeJson("chats", `${charId}.json`, container);
    }
    
    let active = container.chats[container.activeChatId];
    if (!active) {
      const def = uid("chat");
      active = { id: def, charId, messages: [], updatedAt: Date.now() };
      container.activeChatId = def;
      container.chats[def] = active;
      await writeJson("chats", `${charId}.json`, container);
    }
    return active;
  },
  async saveChat(chat) {
    chat.updatedAt = Date.now();
    let container = memCache.chats[chat.charId];
    if (!container || !container.chats) container = { charId: chat.charId, activeChatId: chat.id, chats: {} };
    container.chats[chat.id] = chat;
    container.activeChatId = chat.id;
    memCache.chats[chat.charId] = container;
    await writeJson("chats", `${chat.charId}.json`, container);
  },
  async clearChat(charId) {
    // Creating a new chat instead of wiping the active one
    const newChatId = uid("chat");
    const newChat = { id: newChatId, charId, messages: [], updatedAt: Date.now() };
    const container = memCache.chats[charId];
    if (container && container.chats) {
      container.chats[newChatId] = newChat;
      container.activeChatId = newChatId;
      await writeJson("chats", `${charId}.json`, container);
    }
    return newChat;
  },
  getChatListSync(charId) {
    const container = memCache.chats[charId];
    return container && container.chats ? Object.values(container.chats).sort((a,b) => b.updatedAt - a.updatedAt) : [];
  },
  async getMemory(charId) {
    if (memCache.memories[charId]) return memCache.memories[charId];
    const m = (await readJson("memories", `${charId}.json`)) || { charId, summary: "", updatedAt: Date.now() };
    memCache.memories[charId] = m;
    return m;
  },
  async saveMemory(charId, summary) {
    const m = { charId, summary: String(summary || ""), updatedAt: Date.now() };
    memCache.memories[charId] = m;
    await writeJson("memories", `${charId}.json`, m);
    return m;
  },
  async exportAll() {
    const chats = {}, memories = {};
    for (const c of memCache.characters) {
      chats[c.id] = await this.getChat(c.id);
      memories[c.id] = await this.getMemory(c.id);
    }
    return { app: "emotionui", v: 1, exportedAt: new Date().toISOString(), global: { ...memCache.global, apiKey: "" }, characters: memCache.characters, personas: memCache.personas, chats, memories };
  },
  async importAll(data) {
    if (!data || !Array.isArray(data.characters)) throw new Error("Invalid backup file.");
    for (const c of data.characters) await this.saveCharacter({ ...c, id: c.id || uid("char") });
    if (Array.isArray(data.personas) && data.personas.length) {
      for (const p of data.personas) await this.savePersona({ ...p, id: p.id || uid("persona"), active: false });
    }
    if (data.chats) for (const [k, v] of Object.entries(data.chats)) await this.saveChat({ charId: k, messages: v.messages || [], updatedAt: Date.now() });
    if (data.memories) for (const [k, v] of Object.entries(data.memories)) await this.saveMemory(k, v.summary || "");
  },
};
