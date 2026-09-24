import { chatCompletion } from "./api_v2.js";
import { buildMessages } from "./promptBuilder_v2.js";

export async function summarizeMemory({ char, persona, history, endpoint }) {
  const tail = (history || []).filter((m) => m.role !== "system").slice(-20)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  if (!tail.trim()) throw new Error("No chat history to summarize yet.");
  const body = {
    model: endpoint.model,
    temperature: 0.3, top_p: 0.9, max_tokens: 400, stream: false,
    messages: [
      { role: "system", content: "Summarize the roleplay so far into dense factual memory: names, places, open plot threads, agreements, conflicts. Under 250 words. No dialogue, no fluff." },
      { role: "user", content: tail },
    ],
  };
  return chatCompletion({ baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, body });
}

export function buildMessagesPreview(args) { return buildMessages(args); }
