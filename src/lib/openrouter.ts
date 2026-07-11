// OpenRouter — free LLM helper for supplier search-query + HSN suggestions.
//
// Uses a FREE model (tencent/hy3:free by default — zero input/output cost). That
// model is a reasoning model: it spends tokens "thinking" before answering, so we
// give a generous max_tokens and read `content` (falling back to the last JSON
// object found in the reasoning trace). Server-side only — the key never reaches
// the client.

import { get_json_object } from "./json-extract";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function apiKey(): string {
  return process.env.OPENROUTER_API_KEY ?? "";
}
function model(): string {
  return process.env.OPENROUTER_MODEL || "tencent/hy3:free";
}

export function openRouterConfigured(): boolean {
  return Boolean(apiKey());
}

// Low-level chat call. Returns the assistant text (content, else reasoning),
// or "" on any failure. Never throws — callers degrade gracefully.
async function chat(prompt: string, maxTokens = 900): Promise<string> {
  if (!apiKey()) return "";
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        // OpenRouter attribution headers (optional but recommended).
        "HTTP-Referer": "https://supplier-tracking-system.vercel.app",
        "X-Title": "Sourcing Tracker",
      },
      body: JSON.stringify({
        model: model(),
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    // Prefer content; reasoning models sometimes leave content null and put the
    // answer in the reasoning trace — use that as a fallback source of JSON.
    return String(msg.content ?? msg.reasoning ?? "");
  } catch {
    return "";
  }
}

export interface SearchSuggestion {
  keywords: string[]; // Alibaba/1688 search terms, best first
  hsn: string; // likely 4-digit India HSN code (may be "")
  material: string; // primary material guess (may be "")
}

// Ask the free model for better supplier search keywords + a likely HSN, given a
// product name/description. Returns null if unavailable or unparseable so the
// caller can fall back to its existing behaviour.
export async function suggestSearchQueries(
  productName: string,
  description = ""
): Promise<SearchSuggestion | null> {
  const name = productName.trim();
  if (!name) return null;

  const prompt =
    `You are a sourcing assistant for importing goods from China (Alibaba/1688).\n` +
    `Product: "${name}"${description ? ` — ${description}` : ""}.\n` +
    `Return ONLY a compact JSON object, no explanation:\n` +
    `{"keywords":["3-5 concise Alibaba search terms, most specific first"],` +
    `"hsn":"most likely 4-digit India HSN code","material":"primary material"}`;

  const raw = await chat(prompt, 900);
  const obj = get_json_object(raw);
  if (!obj) return null;

  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 5)
    : [];
  const hsn = String(obj.hsn ?? "").replace(/[^0-9]/g, "").slice(0, 4);
  const material = String(obj.material ?? "").trim().toLowerCase();

  if (keywords.length === 0 && !hsn) return null;
  return { keywords, hsn, material };
}
