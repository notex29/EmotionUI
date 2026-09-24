export const FORMATTING_PRESETS = {
  "default": { name: "Default (OpenAI Chat API)" },
  "llama3": {
    name: "Llama 3 / 3.1 / 3.2",
    globalPrefix: "<|begin_of_text|>",
    sysStart: "<|start_header_id|>system<|end_header_id|>\\n\\n",
    sysEnd: "<|eot_id|>\\n",
    userStart: "<|start_header_id|>user<|end_header_id|>\\n\\n",
    userEnd: "<|eot_id|>\\n",
    astStart: "<|start_header_id|>assistant<|end_header_id|>\\n\\n",
    astEnd: "<|eot_id|>\\n",
    stops: ["<|eot_id|>", "<|end_of_text|>", "<|start_header_id|>", "\\nUser:", "\\n{{user}}:"]
  },
  "chatml": {
    name: "ChatML (Qwen/Yi)",
    globalPrefix: "",
    sysStart: "<|im_start|>system\\n",
    sysEnd: "<|im_end|>\\n",
    userStart: "<|im_start|>user\\n",
    userEnd: "<|im_end|>\\n",
    astStart: "<|im_start|>assistant\\n",
    astEnd: "<|im_end|>\\n",
    stops: ["<|im_end|>", "<|im_start|>", "\\nUser:", "\\n{{user}}:"]
  },
  "gemma2": {
    name: "Gemma 2",
    globalPrefix: "<bos>",
    sysStart: "<start_of_turn>user\\n",
    sysEnd: "<end_of_turn>\\n",
    userStart: "<start_of_turn>user\\n",
    userEnd: "<end_of_turn>\\n",
    astStart: "<start_of_turn>model\\n",
    astEnd: "<end_of_turn>\\n",
    stops: ["<end_of_turn>", "<eos>", "<start_of_turn>", "\\nUser:", "\\n{{user}}:"]
  },
  "mistral": {
    name: "Mistral v3 / Nemo",
    globalPrefix: "<s>[INST] ",
    sysStart: "[SYSTEM_PROMPT]",
    sysEnd: "[/SYSTEM_PROMPT] ",
    userStart: "",
    userEnd: "[/INST] ",
    astStart: "",
    astEnd: "</s>[INST] ",
    stops: ["</s>", "[INST]", "[/INST]", "\\nUser:", "\\n{{user}}:"]
  },
  "phi3": {
    name: "Phi-3 / Phi-3.5",
    globalPrefix: "",
    sysStart: "<|system|>\\n",
    sysEnd: "<|end|>\\n",
    userStart: "<|user|>\\n",
    userEnd: "<|end|>\\n",
    astStart: "<|assistant|>\\n",
    astEnd: "<|end|>\\n",
    stops: ["<|end|>", "<|endoftext|>", "<|user|>", "\\nUser:", "\\n{{user}}:"]
  },
  "custom": {
    name: "Custom...",
    globalPrefix: "",
    sysStart: "", sysEnd: "", userStart: "", userEnd: "", astStart: "", astEnd: "", stops: []
  }
};

export function applyFormattingPreset(messages, presetKey, customPreset) {
  if (!presetKey || presetKey === "default") return { messages };
  const preset = presetKey === "custom" ? customPreset : FORMATTING_PRESETS[presetKey];
  if (!preset) return { messages };

  // Parse escaped newlines from the JSON configuration so "\n" renders as actual newline
  const unesc = (s) => (s || "").replace(/\\n/g, "\n");

  let prompt = unesc(preset.globalPrefix);
  for (const m of messages) {
    if (m.role === "system") {
      prompt += unesc(preset.sysStart) + m.content + unesc(preset.sysEnd);
    } else if (m.role === "user") {
      prompt += unesc(preset.userStart) + m.content + unesc(preset.userEnd);
    } else if (m.role === "assistant") {
      prompt += unesc(preset.astStart) + m.content + unesc(preset.astEnd);
    }
  }
  // To prompt the assistant to start typing, append the assistant start header
  prompt += unesc(preset.astStart);
  
  return { prompt };
}
