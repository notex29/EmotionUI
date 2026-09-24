let initialized = false;

export function parseMessageMarkdown(text) {
  if (!text) return "";
  
  if (typeof marked === "undefined") {
    // Fallback if marked failed to load
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Ensure every single newline is treated as a separate paragraph
  // CAI often has single newlines that should be separated, but don't break code blocks!
  let mdText = text;
  if (!mdText.includes("\`\`\`")) {
    mdText = mdText.replace(/\n+/g, '\n\n');
  } else {
    mdText = mdText.split(/(\`\`\`[\s\S]*?\`\`\`)/).map((part, i) => {
      return i % 2 === 0 ? part.replace(/\n+/g, '\n\n') : part;
    }).join('');
  }

  if (!initialized) {
    const renderer = {
      // Make paragraphs focusable for screen readers
      paragraph(token) {
        return `<p tabindex="0" role="text" dir="auto">${this.parser.parseInline(token.tokens)}</p>\n`;
      },
      // Actions / Italics
      em(token) {
        return `<em class="chat-action" tabindex="0" role="text">${this.parser.parseInline(token.tokens)}</em>`;
      },
      // Bold
      strong(token) {
        return `<strong tabindex="0" role="text">${this.parser.parseInline(token.tokens)}</strong>`;
      }
    };

    const dialogueExtension = {
      name: 'dialogue',
      level: 'inline',
      start(src) { return src.match(/["“]/)?.index; },
      tokenizer(src, tokens) {
        const rule = /^["“]([^"”]+)["”]/;
        const match = rule.exec(src);
        if (match) {
          const token = {
            type: 'dialogue',
            raw: match[0],
            text: match[1],
            tokens: []
          };
          this.lexer.inlineTokens(token.text, token.tokens);
          return token;
        }
      },
      renderer(token) {
        // Render quotes with standalone screen reader focus
        return `<span class="chat-dialogue" tabindex="0" role="text">"${this.parser.parseInline(token.tokens)}"</span>`;
      }
    };

    marked.use({ 
      renderer,
      extensions: [dialogueExtension],
      breaks: true,
      gfm: true
    });
    
    initialized = true;
  }

  // Parse and return
  return marked.parse(mdText);
}
