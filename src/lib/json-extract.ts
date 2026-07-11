// Extract the first valid JSON object from a string that may also contain
// prose, markdown fences, or an LLM's reasoning trace. Returns null if none.

export function get_json_object(text: string): Record<string, unknown> | null {
  if (!text) return null;

  // Strip ```json … ``` fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);

  for (const c of candidates) {
    // Scan for balanced {...} spans and try to parse each, longest first.
    const spans = balancedObjects(c).sort((a, b) => b.length - a.length);
    for (const span of spans) {
      try {
        const parsed = JSON.parse(span);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* try the next span */
      }
    }
  }
  return null;
}

// Return every top-level {...} substring (brace-balanced) found in the text.
function balancedObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(s.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}
