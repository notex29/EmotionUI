# EmotionUI

A humble bridge between complicated and simple. Inspired by Character.ai, but explicitly designed not to copy it blindly. EmotionUI provides an incredibly fast, highly customizable, and locally-first chat interface for your AI personas.

## Features

- **Local First & Privacy Respecting**: All chat history, character data, and preferences are stored locally in your browser using IndexedDB. No centralized server snooping.
- **Tavern PNG Card Support**: Import and manage your favorite characters effortlessly using the standard Tavern PNG card format.
- **Hybrid Cascade Endpoints**: Set a global API endpoint, or override it on a per-character basis for ultimate flexibility.
- **Deeply Customizable**: Fine-tune the UI to your liking. Change chat backgrounds, bubble colors, text spacing, and contrast settings instantly via the Chat Customizer.
- **Smart Context Memory**: Long chats won't lose the plot. Built-in auto-summarization acts as a rolling context to keep characters in character without eating up token limits.
- **Fluid & Accessible**: Fully responsive, mobile-first design with a commitment to accessibility. Modals trap focus, hidden elements are properly removed from the accessibility tree, and screen readers are fully supported.
- **Multi-Swipe Options**: Swipe through generated messages or instantly generate new ones with a sleek, non-intrusive UI.

## Technical Details (For Developers & Power Users)

EmotionUI connects directly to your backend LLM runners from the browser. It is fully transparent about how it handles prompts and generation limits.

- **API Compatibility**: It natively consumes any **OpenAI-compatible API endpoint** (`/v1/chat/completions`). This means it works perfectly out-of-the-box with popular local runners like [LM Studio](https://lmstudio.ai/), [Text Generation WebUI (Oobabooga)](https://github.com/oobabooga/text-generation-webui), [vLLM](https://github.com/vllm-project/vllm), [Ollama](https://ollama.com/), as well as cloud providers like OpenRouter and Groq. See [`js/core/api_v2.js`](./js/core/api_v2.js) for the network implementation.
- **Prompt Formatting**: EmotionUI supports dynamic template mapping to format raw conversation into exact text arrays for your models. Natively supported formats include **ChatML**, **Llama 3**, and **Custom** (which allows injecting your own JSON template directly into the character's settings). See how the prompt is structured in [`js/core/promptBuilder_v2.js`](./js/core/promptBuilder_v2.js).
- **Anti-Impersonation (Stop Sequences)**: The engine proactively blocks the LLM from speaking on your behalf. By default, it dynamically builds stop sequences based on your active persona name and the character's name (e.g., `\nUser:`, `\n[PersonaName]:`, `<|eot_id|>`, `<|end_of_text|>`). You can easily define extra custom stop sequences within the settings UI to strict-lock models. 
- **Lorebooks & Memory**: EmotionUI dynamically injects relevant snippets via a TF-IDF keyword recall engine to retrieve "Archived Event References" before sending requests, preserving token limits while keeping lore alive.

## Getting Started

⚠️ **Do not just double-click `index.html`!** Because EmotionUI uses modern browser features like ES Modules and IndexedDB, simply opening the file directly in your browser from your hard drive will cause CORS and loading errors.

You must serve it through a local web server. 
- **On a Computer**: Run a simple local server in the project folder (e.g., `python -m http.server`, or use VSCode's Live Server extension).
- **On your Phone**: You can actually serve EmotionUI directly from your phone! Use simple server apps like **SHTTPS** for Android. 

### Connecting Phone to PC Models
Because the frontend runs completely in your browser, you can easily open EmotionUI on your phone and connect it to a heavy LLM backend running on your PC (via LM Studio, KoboldCPP, llama.cpp, etc.). 
*Just make sure your PC backend is bound to `0.0.0.0` instead of `127.0.0.1` so that it is exposed and accessible to devices on your local network!*
