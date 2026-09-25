import { keywordsOf, rareKeywordsOf } from "./utils.js";
import { evaluateLorebook } from "./lorebook.js";
import { applyFormattingPreset, FORMATTING_PRESETS } from "./presets.js";

// Builds the exact request shape from the spec:
// system directives + character card + persona + scenario + injected memory,
// then last N user/assistant turns, then author's note, then new user msg.
export function buildMessages({ char, persona, memory, history, newUserText, endpoint }) {
  const personaName = persona?.name || "User";
  const charName = char.shortName || char.name || "Character";
  const systems = [];
  if (char.systemPrompt) systems.push({ role: "system", content: char.systemPrompt });
  systems.push({ role: "system", content: characterCardBlock(char) });
  if (persona) systems.push({ role: "system", content: `### USER PERSONA: ${persona.name}\n${persona.prompt || "Roleplay partner."}` });
  if (char.scenario) systems.push({ role: "system", content: `### SCENARIO & TEMPORAL CONTEXT\n${char.scenario}` });
  // Smart Context TF-IDF Memory
  if (char.extensions?.smartContext !== false) {
    const recall = keywordRecall(history, newUserText);
    const memBlock = [memory?.summary?.trim() ? `[Summary] ${memory.summary.trim()}` : "", recall].filter(Boolean).join("\n");
    if (memBlock) systems.push({ role: "system", content: `### INJECTED MEMORY (OPFS Keyword Recall Engine: Matched [${recallKeys(history, newUserText).join(", ")}])\n${memBlock}` });
  } else if (memory?.summary?.trim()) {
    systems.push({ role: "system", content: `### INJECTED MEMORY\n[Summary] ${memory.summary.trim()}` });
  }
  
  // Lorebook
  if (char.extensions?.lorebookEnabled !== false) {
    const lore = evaluateLorebook(char.characterBook, history, newUserText);
    if (lore) systems.push({ role: "system", content: `### WORLD INFO / LOREBOOK\n${lore}` });
  }

  const histLimit = endpoint?.history_messages ?? 10;
  let convo = [...(history || [])].filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content || (m.swipes ? m.swipes[m.activeSwipe || 0] : "") }));
  if (histLimit > 0) convo = convo.slice(-histLimit);
  
  const msgs = [...systems, ...convo];
  if (char.postHistoryInstructions?.trim()) msgs.push({ role: "system", content: char.postHistoryInstructions.trim() });
  if (newUserText) msgs.push({ role: "user", content: newUserText });
  return msgs;
}

export function buildBody({ char, persona, memory, history, newUserText, endpoint }) {
  const personaName = persona?.name || "User";
  const presetData = endpoint.promptPreset === "custom" ? endpoint.customPreset : FORMATTING_PRESETS[endpoint.promptPreset];
  const autoStops = presetData?.stops || [];
  
  const stop = [...new Set([
    `\n${char.shortName || char.name}:`, `\n${personaName}:`, "\nUser:",
    ...(endpoint.extraStop || []),
    ...autoStops,
    "<|eot_id|>", "<|end_of_text|>",
  ])].slice(0, 4);
  
  const rawMsgs = buildMessages({ char, persona, memory, history, newUserText, endpoint });
  const formatted = applyFormattingPreset(rawMsgs, endpoint.promptPreset, endpoint.customPreset);
  
  const body = {
    model: endpoint.model,
    temperature: Number(endpoint.temperature),
    top_p: Number(endpoint.top_p),
    presence_penalty: Number(endpoint.presence_penalty),
    frequency_penalty: Number(endpoint.frequency_penalty),
    max_tokens: Number(endpoint.max_tokens),
    stream: false,
    stop,
    ...formatted,
  };
  
  if (endpoint.min_p !== "" && endpoint.min_p !== null && endpoint.min_p !== undefined && !isNaN(Number(endpoint.min_p))) {
    body.min_p = Number(endpoint.min_p);
  }
  
  return body;
}

function characterCardBlock(c) {
  return [
    `### CHARACTER CARD: ${c.name}`,
    c.age ? `- Age: ${c.age}` : null,
    c.occupation ? `- Occupation: ${c.occupation}` : null,
    c.residence ? `- Setting / Residence: ${c.residence}` : null,
    c.personality ? `- Personality: ${c.personality}` : null,
    c.description ? `- Description: ${c.description}` : null,
    c.speech ? `- Speech Pattern: ${c.speech}` : null,
    c.exampleDialog ? `- Dialogue Examples:\n<START>\n${c.exampleDialog}\n<END>` : null,
  ].filter(Boolean).join("\n");
}

function recallKeys(history, newText) {
  return rareKeywordsOf(`${newText} ${(history || []).slice(-3).map((m) => m.content).join(" ")}`, history).slice(0, 4).map((k) => `'${k.toUpperCase()}'`);
}
function keywordRecall(history, newText) {
  const keys = rareKeywordsOf(newText, history);
  if (!keys.length || !history?.length) return "";
  const hits = [];
  for (const m of history) {
    const lc = String(m.content || "").toLowerCase();
    if (keys.some((k) => lc.includes(k))) hits.push(`[${m.role} @ ${new Date(m.ts || Date.now()).toLocaleString()}]: ${String(m.content).slice(0, 280)}`);
    if (hits.length >= 3) break;
  }
  return hits.length ? `[Archived Event Reference]\n${hits.join("\n")}` : "";
}
