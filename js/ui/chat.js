import { store } from "../core/store-idb.js";
import { resolveEndpoint, chatCompletion, streamChatCompletion } from "../core/api_v2.js";
import { buildBody } from "../core/promptBuilder_v2.js";
import { summarizeMemory } from "../core/memory.js";
import { parseMessageMarkdown } from "../core/markdown.js";
import { openPersonasModal, openMemoryModal, openCharSettingsModal, openChatMenu, openChatCustomizerModal } from "./modals.js";
import { toast } from "./toast.js";
import { esc, uid, replaceMacros } from "../core/utils.js";
import { icons } from "./icons.js";

let currentCharId = null;
export const getCurrentCharId = () => currentCharId;

export async function renderChat(main, go, charId) {
  currentCharId = charId;
  const char = store.characters.find((c) => c.id === charId);
  if (!char) { go.home(); return; }
  const chat = await store.getChat(charId);
  const memory = await store.getMemory(charId);
  if (!chat.messages.length && char.firstMessage) {
    const allSwipes = [char.firstMessage, ...(char.altGreetings || [])].filter(x=>x.trim());
    chat.messages.push({ id: uid("m"), role: "assistant", content: allSwipes[0], ts: Date.now(), who: char.name, swipes: allSwipes, activeSwipe: 0 });
    await store.saveChat(chat);
  }
  document.getElementById("topbar-title").textContent = char.name;

  main.innerHTML = `
  <div class="chat-wrap">
    <div class="chat-head">
      ${char.avatar ? `<img src="${char.avatar}" alt="${esc(char.name)} avatar" />` : `<div class="av" style="width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,#5b4bff,#27b3e6);display:flex;align-items:center;justify-content:center;font-weight:800" aria-hidden="true">${esc(char.name.slice(0, 1))}</div>`}
      <div class="sp"><div class="nm">${esc(char.name)}</div><div class="ds">${esc(replaceMacros(char.description || char.personality || "", char.shortName || char.name, store.activePersona()?.name))}</div></div>
      <button id="ch-edit" class="icon-btn" type="button" aria-label="Edit ${esc(char.name)}" title="Edit character">${icons.edit}</button>
    </div>
    <div id="chat-log" aria-live="polite" aria-label="Conversation with ${esc(char.name)}"></div>
  </div>
  <div class="composer"><div class="composer-inner">
    <button id="ch-persona" class="icon-btn" type="button" aria-label="Choose persona" title="${esc(store.activePersona()?.name || "User")}" style="background:transparent;border:0;color:var(--txt-1);margin:0;padding:4px;flex-shrink:0; align-self:flex-end;">${icons.user}</button>
    <textarea id="ch-input" placeholder="Message..."></textarea>
    <button id="ch-send" class="icon-btn" type="button" aria-label="Send message" title="Send (Ctrl+Enter)" style="background:transparent;border:0;color:#fff;margin:0;padding:4px;flex-shrink:0; align-self:flex-end;">${icons.send}</button>
  </div></div>`;

  const log = main.querySelector("#chat-log");
  const input = main.querySelector("#ch-input");
  const sendBtn = main.querySelector("#ch-send");
  draw(log, char);

  main.querySelector("#ch-edit").addEventListener("click", () => go.edit(charId));
  main.querySelector("#ch-persona").addEventListener("click", async () => {
    await openPersonasModal(async () => {
      main.querySelector("#ch-persona").title = store.activePersona()?.name || "User";
      draw(log, char);
    });
  });
  
  const globalMenuBtn = document.getElementById("btn-chat-menu");
  if (globalMenuBtn) {
    globalMenuBtn.hidden = false;
    globalMenuBtn.onclick = (e) => {
      const btn = e.currentTarget;
    btn.setAttribute("aria-expanded", "true");
    openChatMenu(char, {
      onClose: () => btn.setAttribute("aria-expanded", "false"),
      onMemory: () => openMemoryModal(char, () => draw(log, char)),
      onSettings: () => openCharSettingsModal(char),
      onCustomizer: () => openChatCustomizerModal(char),
      onNewChat: async () => { 
        await store.clearChat(charId); 
        if (char.firstMessage) { 
          const allSwipes = [char.firstMessage, ...(char.altGreetings || [])].filter(x=>x.trim()); 
          const c2 = await store.getChat(charId); 
          c2.messages.push({ id: uid("m"), role: "assistant", content: allSwipes[0], ts: Date.now(), who: char.name, swipes: allSwipes, activeSwipe: 0 }); 
          await store.saveChat(c2); 
        } 
        draw(log, (await refresh(charId)).char); 
      },
      onSwitch: () => {
        const list = store.getChatListSync(charId);
        const { root, close } = (window.shell || ((t,h) => {
          const r = document.getElementById("modal-root");
          r.innerHTML = `<div class="modal-back" id="m-back"><div class="modal" role="dialog">
            <div class="modal-head"><h2>${esc(t)}</h2><button id="m-x" class="icon-btn" type="button" aria-label="Close dialog" title="Close">${icons.x}</button></div>
            <div>${h}</div></div></div>`;
          const c = () => { r.innerHTML = ""; };
          r.querySelector("#m-x").addEventListener("click", c);
          r.querySelector("#m-back").addEventListener("click", (e) => { if(e.target.id==="m-back") c(); });
          setTimeout(() => { const fb = r.querySelector("button, input"); if(fb) fb.focus(); }, 10);
          return { root: r, close: c };
        }))("Switch Chats", `<div class="list" id="chats-list"></div>`);
        
        root.querySelector("#chats-list").innerHTML = list.map(c => 
          `<div class="list-item" style="cursor:pointer" data-id="${c.id}">
             <div class="grow"><div class="t">Chat with ${c.messages.length} messages</div><div class="d">Last active: ${new Date(c.updatedAt).toLocaleString()}</div></div>
           </div>`
        ).join("");
        
        root.querySelectorAll(".list-item").forEach(el => el.addEventListener("click", async () => {
          await store.getChat(charId, el.dataset.id);
          draw(log, (await refresh(charId)).char);
          close();
        }));
      },
      onEdit: () => go.edit(charId),
    });
  };
  }

  const send = () => doSend(log, input, sendBtn, char, false);
  sendBtn.addEventListener("click", send);
  
  const resizeInput = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 155) + "px";
  };
  input.addEventListener("input", resizeInput);
  
  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(); resizeInput(); }
  });
  input.focus();
  main.scrollTop = main.scrollHeight;
  
  const reD = (e) => { if (e.detail.charId === charId) draw(log, store.characters.find(c => c.id === charId)); };
  document.addEventListener("eui:chat_custom", reD);
  const obs = new MutationObserver(() => { if (!document.body.contains(main.querySelector("#chat-log"))) { document.removeEventListener("eui:chat_custom", reD); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });
}

async function refresh(charId) {
  return { char: store.characters.find((c) => c.id === charId), chat: await store.getChat(charId) };
}
function personaChipInner() {
  const p = store.activePersona();
  return `${icons.user}<span class="lbl">${esc(p?.name || "User")}</span> <small>· tap to switch</small>`;
}

function applyChatConfig(char) {
  let styleEl = document.getElementById("chat-custom-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "chat-custom-style";
    document.head.appendChild(styleEl);
  }
  const isCustomized = !!char.extensions?.chatConfig;
  const cfg = char.extensions?.chatConfig || {};
  
  const aiBg = isCustomized ? cfg.aiBg : "transparent";
  const userBg = isCustomized ? cfg.userBg : "transparent";
  const chatBgImage = isCustomized ? cfg.chatBgImage : "default-bg.png";
  const chatBgColor = isCustomized ? cfg.chatBgColor : "";
  const autoText = isCustomized ? cfg.autoText : true;
  
  const getLum = (hex) => {
    if (!hex || hex === "transparent") return 0;
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const r = parseInt(hex.substr(0,2), 16), g = parseInt(hex.substr(2,2), 16), b = parseInt(hex.substr(4,2), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 0;
    return (r * 299 + g * 587 + b * 114) / 1000;
  };
  const getTxt = (bgHex, auto, manTxt) => auto ? (bgHex === "transparent" ? "#fff" : (getLum(bgHex) > 128 ? "#000" : "#fff")) : (manTxt || "#fff");
  
  let css = "";
  if (aiBg) {
    css += `.main-col .msg.ai .bubble { background: ${aiBg} !important; border-color: ${aiBg === "transparent" ? "rgba(255,255,255,0.1)" : aiBg} !important; color: ${getTxt(aiBg, autoText, cfg.aiText)} !important; }\n`;
    css += `.main-col .msg.ai .who { color: ${getTxt(aiBg, autoText, cfg.aiText)} !important; opacity: 0.8; }\n`;
  }
  if (userBg) {
    css += `.main-col .msg.user .bubble { background: ${userBg} !important; border-color: ${userBg === "transparent" ? "rgba(255,255,255,0.1)" : userBg} !important; color: ${getTxt(userBg, autoText, cfg.userText)} !important; }\n`;
    css += `.main-col .msg.user .who { color: ${getTxt(userBg, autoText, cfg.userText)} !important; opacity: 0.8; }\n`;
  }
  
  if (chatBgImage) {
    css += `body:has(#chat-main) { background: url(${chatBgImage}) center/cover fixed !important; }\n`;
    css += `.main-col .chat-wrap { background: transparent !important; }\n`;
    css += `.main-col .composer { background: linear-gradient(180deg, transparent, rgba(0,0,0,0.8) 30%) !important; }\n`;
  } else if (chatBgColor) {
    css += `body:has(#chat-main) { background: ${chatBgColor} !important; }\n`;
    css += `.main-col .composer { background: linear-gradient(180deg, transparent, ${chatBgColor} 30%) !important; }\n`;
  }

  const compOp = cfg.composerOp !== undefined ? cfg.composerOp : 0.45;
  const compW = cfg.composerW || 860;
  const compH = cfg.composerH || 155;

  if (cfg.composerBg && cfg.composerBg !== "transparent") {
    css += `.main-col .composer-inner { background: ${cfg.composerBg} !important; }\n`;
  } else {
    css += `.main-col .composer-inner { background: linear-gradient(135deg, rgba(20,24,36,${compOp}) 0%, rgba(35,20,50,${Math.max(0, compOp - 0.03)}) 100%) !important; }\n`;
  }
  
  css += `@media (min-width: 901px) { .main-col .chat-wrap, .main-col .composer-inner { max-width: ${compW}px !important; margin: 0 auto; } }\n`;
  css += `@media (max-width: 900px) { .main-col .chat-wrap, .main-col .composer-inner { max-width: 100% !important; margin: 0 auto; } }\n`;
  css += `.main-col .composer-inner textarea { min-height: ${compH}px !important; max-height: ${compH}px !important; }\n`;
  if (cfg.composerTxt) {
    const compT = getTxt(cfg.composerBg, cfg.autoText, cfg.composerTxt);
    css += `.main-col .composer .tool-btn { color: ${compT} !important; border-color: ${compT} !important; }\n`;
    css += `.main-col .composer .tool-btn svg { fill: ${compT} !important; }\n`;
    css += `.main-col #ch-send { color: ${compT} !important; }\n`;
    css += `.main-col #ch-send svg { fill: ${compT} !important; }\n`;
  }
  
  if (cfg.inputBg) {
    css += `.main-col #ch-input { background: ${cfg.inputBg} !important; }\n`;
  }
  if (cfg.inputTxt) {
    const inT = getTxt(cfg.inputBg, cfg.autoText, cfg.inputTxt);
    css += `.main-col #ch-input { color: ${inT} !important; }\n`;
  }
  if (cfg.inputHint) {
    const hintT = getTxt(cfg.inputBg, cfg.autoText, cfg.inputHint);
    css += `.main-col #ch-input::placeholder { color: ${hintT} !important; opacity: 0.7; }\n`;
  }
  if (cfg.lineSpacing !== undefined || cfg.letterSpacing !== undefined) {
    const ls = cfg.lineSpacing ?? 1.5;
    const letS = cfg.letterSpacing ?? 0;
    css += `.main-col .msg .txt { line-height: ${ls} !important; letter-spacing: ${letS}px !important; word-spacing: ${letS * 2}px !important; word-break: break-word !important; overflow-wrap: break-word !important; }\n`;
  }
  
  styleEl.innerHTML = css;
}

function draw(log, char) {
  applyChatConfig(char);
  const chat = store.getChatSync?.(char.id);
  paint(log, char, chat);
  store.getChat(char.id).then((c) => {
    paint(log, char, c);
    const v = document.getElementById("main-view");
    if (v) v.scrollTop = v.scrollHeight;
  });
}
function paint(log, char, chat) {
  if (!chat) return;
  const persona = store.activePersona();
  const pName = persona?.name || "User";
  const cName = char.shortName || char.name;

  const lastAiMsgId = chat.messages.filter((x) => x.role !== "user").pop()?.id;

  log.innerHTML = chat.messages.map((m) => {
    const isUser = m.role === "user";
    const who = isUser ? esc(pName) : esc(char.name);
    let contentText = m.swipes ? m.swipes[m.activeSwipe || 0] : m.content;
    const content = parseMessageMarkdown(replaceMacros(contentText, cName, pName));
    const avName = isUser ? pName : char.name;
    const av = isUser
      ? `<div class="av" aria-hidden="true">${esc(avName.slice(0, 1).toUpperCase())}</div>`
      : (char.avatar ? `<img class="av" src="${char.avatar}" alt="" />` : `<div class="av" aria-hidden="true">${esc(char.name.slice(0, 1))}</div>`);
      
    let swipeHtml = "";
    if (!isUser && m.id === lastAiMsgId) {
      if (!m.swipes) m.swipes = [m.content || ""];
      const idx = m.activeSwipe || 0;
      const isLastMsg = m.id === chat.messages[chat.messages.length - 1].id;
      const nextDisabled = (idx === m.swipes.length - 1 && !isLastMsg) ? "disabled" : "";
      swipeHtml = `<div class="swipe-nav">
        <button class="swipe-btn" data-swipe="${m.id}" data-dir="-1" ${idx === 0 ? "disabled" : ""} type="button" aria-label="Previous swipe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
        <span>${idx + 1}/${m.swipes.length}</span>
        <button class="swipe-btn" data-swipe="${m.id}" data-dir="1" ${nextDisabled} type="button" aria-label="Next swipe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
      </div>`;
    }

    const optionsHtml = `<button class="icon-btn msg-options-btn" aria-label="Message options" data-opt="${m.id}" type="button" style="width:24px;height:24px;padding:2px;border-radius:50%;opacity:0;transition:opacity .2s;background:transparent;border:0;color:inherit;margin:-4px -4px -4px 8px;">${icons.dots}</button>`;

    return `<div class="msg ${isUser ? "user" : "ai"}" style="position:relative">
      ${av}
      <div class="bubble" data-mid="${m.id}">
        <div class="who" style="display:flex;justify-content:space-between;align-items:center;">
          <span>${who}</span>${optionsHtml}
        </div>
        <div class="txt">${content}</div>
        ${swipeHtml ? `<div class="meta">${swipeHtml}</div>` : ""}
      </div>
    </div>`;
  }).join("") || `<div class="empty">Say hello to ${esc(char.shortName || char.name)}.</div>`;
  
  log.querySelectorAll("[data-opt]").forEach(b => {
    b.addEventListener("click", (e) => {
      const msg = chat.messages.find(x => x.id === b.dataset.opt);
      if (msg) showContextMenu(e, msg);
    });
  });
  log.querySelectorAll("[data-swipe]").forEach((b) => b.addEventListener("click", async () => {
    const msg = chat.messages.find((x) => x.id === b.dataset.swipe);
    if (!msg) return;
    if (!msg.swipes) msg.swipes = [msg.content || ""];
    const dir = parseInt(b.dataset.dir);
    const newIdx = (msg.activeSwipe || 0) + dir;
    if (newIdx >= msg.swipes.length && msg.id === chat.messages[chat.messages.length - 1].id) {
      regenerate(log, document.getElementById("ch-input"), document.getElementById("ch-send"), char);
      return;
    }
    if (newIdx >= 0 && newIdx < msg.swipes.length) {
      msg.activeSwipe = newIdx;
      msg.content = msg.swipes[msg.activeSwipe];
      await store.saveChat(chat);
      paint(log, char, chat);
    }
  }));

  let ctxMenu = null;
  function showContextMenu(e, msg) {
    e.preventDefault();
    if (ctxMenu) ctxMenu.remove();
    
    const scrim = document.createElement("div");
    scrim.id = "ctx-scrim";
    const menu = document.createElement("div");
    menu.id = "ctx-menu";
    
    const isLastMsg = chat.messages[chat.messages.length - 1]?.id === msg.id;
  
    menu.innerHTML = `
      <button class="ctx-btn" data-act="copy">Copy Message</button>
      ${isLastMsg ? `<button class="ctx-btn" data-act="edit">Edit Message</button>` : ""}
      <button class="ctx-btn" data-act="branch">Start new chat from here</button>
      <button class="ctx-btn danger" data-act="rewind">Rewind to this</button>
      <button class="ctx-btn danger" data-act="del">Delete</button>
    `;
  
    const closeMenu = () => { scrim.remove(); menu.remove(); ctxMenu = null; };
    scrim.addEventListener("click", closeMenu);
    scrim.addEventListener("touchstart", (ev) => { if (ev.target === scrim) closeMenu(); }, { passive: true });
    
    document.body.appendChild(scrim);
    document.body.appendChild(menu);
    ctxMenu = menu;
    
    let x = e.clientX || (e.touches && e.touches[0].clientX) || window.innerWidth / 2;
    let y = e.clientY || (e.touches && e.touches[0].clientY) || window.innerHeight / 2;
    
    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 10) x = window.innerWidth - rect.width - 10;
    if (y + rect.height > window.innerHeight - 10) y = window.innerHeight - rect.height - 10;
    
    menu.style.left = x + "px";
    menu.style.top = y + "px";
  
    setTimeout(() => {
      const firstBtn = menu.querySelector(".ctx-btn");
      if (firstBtn) firstBtn.focus();
    }, 10);

    menu.querySelectorAll(".ctx-btn").forEach(b => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      closeMenu();
      
      if (act === "copy") {
        const text = msg.swipes ? msg.swipes[msg.activeSwipe || 0] : msg.content;
        navigator.clipboard?.writeText(text).then(() => toast("Copied.", "ok"));
      } else if (act === "del") {
        chat.messages = chat.messages.filter(x => x.id !== msg.id);
        await store.saveChat(chat);
        paint(log, char, chat);
      } else if (act === "rewind") {
        const idx = chat.messages.findIndex(x => x.id === msg.id);
        if (idx >= 0) {
          chat.messages = chat.messages.slice(0, idx + 1);
          await store.saveChat(chat);
          paint(log, char, chat);
        }
      } else if (act === "branch") {
        const idx = chat.messages.findIndex(x => x.id === msg.id);
        if (idx >= 0) {
          const newChatId = (await import("../core/utils.js")).uid("chat");
          const newChat = { 
            id: newChatId, 
            charId: char.id, 
            messages: JSON.parse(JSON.stringify(chat.messages.slice(0, idx + 1))),
            updatedAt: Date.now()
          };
          await store.saveChat(newChat);
          
          const freshChat = await store.getChat(char.id, newChatId);
          paint(log, char, freshChat);
          toast("Branched to new chat.", "ok");
        }
      } else if (act === "edit") {
         const input = document.getElementById("chat-input");
         if (input) {
           input.value = msg.swipes ? msg.swipes[msg.activeSwipe || 0] : msg.content;
           input.focus();
           chat.messages.pop();
           await store.saveChat(chat);
           paint(log, char, chat);
         }
      }
    }));
  }

  let pressTimer = null;
  const startPress = (e, m) => { pressTimer = setTimeout(() => { showContextMenu(e, m); pressTimer = null; }, 500); };
  const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

  log.querySelectorAll(".msg .bubble").forEach((b) => {
    const msg = chat.messages.find(x => x.id === b.dataset.mid);
    if (!msg) return;
    
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e, msg); });
    
    let startX = 0, startY = 0;
    b.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startPress(e, msg);
    }, { passive: true });
    
    b.addEventListener("touchmove", cancelPress, { passive: true });
    
    b.addEventListener("touchend", async (e) => {
      cancelPress();
      if (!msg.swipes) msg.swipes = [msg.content || ""];
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - startX;
      const dy = endY - startY;
      
      if (Math.abs(dx) > 40 && Math.abs(dy) < 40) {
        let dir = 0;
        if (dx > 40) dir = -1; // swiped right -> previous swipe
        if (dx < -40) dir = 1;  // swiped left -> next swipe
        
        if (dir !== 0) {
          const newIdx = (msg.activeSwipe || 0) + dir;
          if (newIdx >= msg.swipes.length && msg.id === chat.messages[chat.messages.length - 1].id) {
            regenerate(log, document.getElementById("ch-input"), document.getElementById("ch-send"), char);
          } else if (newIdx >= 0 && newIdx < msg.swipes.length) {
            msg.activeSwipe = newIdx;
            msg.content = msg.swipes[msg.activeSwipe];
            await store.saveChat(chat);
            paint(log, char, chat);
          }
        }
      }
    });
  });
}

async function doSend(log, input, sendBtn, char, isRegen = false, priorHistory = null, regenTargetId = null) {
  const text = isRegen ? null : input.value.trim();
  if (!text && !isRegen) return;
  const persona = store.activePersona();
  const chat = await store.getChat(char.id);
  const memory = await store.getMemory(char.id);
  let history = priorHistory || chat.messages.map((m) => ({ role: m.role, content: m.content || (m.swipes ? m.swipes[m.activeSwipe || 0] : "") }));
  if (text) {
    history.push({ role: "user", content: text });
    chat.messages.push({ id: uid("m"), role: "user", content: text, ts: Date.now(), who: persona?.name || "User" });
    await store.saveChat(chat);
    paint(log, char, chat);
    if (!isRegen) {
      input.value = "";
      input.style.height = "auto";
    }
  }
  const endpoint = resolveEndpoint(char.ai, store.global);
  let body;
  try {
    body = buildBody({ char, persona, memory, history: history.slice(0, -1), newUserText: isRegen ? history[history.length - 1]?.content || "" : text, endpoint });
  } catch (e) { toast(e.message, "err"); return; }
  sendBtn.disabled = true;
  
  const msgId = regenTargetId || uid("m");
  let targetMsg = chat.messages.find(x => x.id === msgId);
  if (!targetMsg) {
    targetMsg = { id: msgId, role: "assistant", content: "", ts: Date.now(), who: char.name, swipes: [""], activeSwipe: 0 };
    chat.messages.push(targetMsg);
  } else {
    if (!targetMsg.swipes) targetMsg.swipes = [targetMsg.content];
    targetMsg.swipes.push("");
    targetMsg.activeSwipe = targetMsg.swipes.length - 1;
    targetMsg.content = "";
  }
  
  const t = document.createElement("div");
  t.className = "msg ai typing";
  t.innerHTML = `<div class="av" aria-hidden="true">${esc(char.name.slice(0, 1))}</div><div class="bubble"><div class="who">${esc(char.name)}</div><div class="txt"></div></div>`;
  log.appendChild(t);
  t.scrollIntoView({ block: "end" });
  
  const txtNode = t.querySelector(".txt");
  let streamedText = "";
  
  try {
    for await (const chunk of streamChatCompletion({ baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, body })) {
      streamedText += chunk;
      targetMsg.content = streamedText;
      targetMsg.swipes[targetMsg.activeSwipe] = streamedText;
      txtNode.innerHTML = parseMessageMarkdown(replaceMacros(streamedText, char.shortName || char.name, store.activePersona()?.name));
      const v = document.getElementById("main-view");
      if (v) v.scrollTop = v.scrollHeight;
    }
    t.remove();
    await store.saveChat(chat);
    paint(log, char, chat);
    const v2 = document.getElementById("main-view");
    if (v2) v2.scrollTop = v2.scrollHeight;
  } catch (e) {
    t.remove();
    toast(e.message, "err");
  } finally { sendBtn.disabled = false; input.focus(); }
}

async function regenerate(log, input, sendBtn, char) {
  const chat = await store.getChat(char.id);
  const lastUserIdx = [...chat.messages].map((m) => m.role).lastIndexOf("user");
  if (lastUserIdx < 0 && chat.messages.length === 0) { toast("Nothing to regenerate yet.", "err"); return; }
  
  const targetAiIdx = lastUserIdx < 0 ? 0 : lastUserIdx + 1;
  const targetAiMsg = chat.messages[targetAiIdx];
  if (!targetAiMsg) { toast("No AI message to regenerate.", "err"); return; }

  chat.messages = chat.messages.slice(0, targetAiIdx + 1);
  await store.saveChat(chat);
  paint(log, char, chat);
  
  const history = chat.messages.slice(0, targetAiIdx).map((m) => ({ role: m.role, content: m.content || (m.swipes ? m.swipes[m.activeSwipe || 0] : ""), ts: m.ts }));
  await doSend(log, input, sendBtn, char, true, history, targetAiMsg.id);
}
