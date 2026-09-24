export function evaluateLorebook(characterBook, history, newUserText) {
  if (!characterBook || !Array.isArray(characterBook.entries)) return "";
  
  // Combine last few messages to scan for keywords
  const scanText = `${newUserText} ${(history || []).slice(-3).map((m) => m.content).join("\n")}`;
  const lowerScan = scanText.toLowerCase();

  const activated = [];
  
  for (const entry of characterBook.entries) {
    if (entry.enabled === false) continue;
    if (!entry.content || !Array.isArray(entry.keys)) continue;

    let matched = false;
    for (const key of entry.keys) {
      if (!key) continue;
      // Depending on case_sensitive flag
      if (entry.case_sensitive) {
        if (scanText.includes(key)) { matched = true; break; }
      } else {
        if (lowerScan.includes(key.toLowerCase())) { matched = true; break; }
      }
    }
    
    if (matched) {
      activated.push(entry);
    }
  }

  if (!activated.length) return "";

  // Sort by insertion_order (default to 0 if missing)
  activated.sort((a, b) => (a.insertion_order || 0) - (b.insertion_order || 0));

  return activated.map(e => e.content).join("\n\n");
}
