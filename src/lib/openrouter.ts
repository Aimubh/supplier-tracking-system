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
// A FREE vision-capable model for reading product images (zero cost).
function visionModel(): string {
  return process.env.OPENROUTER_VISION_MODEL || "openrouter/free";
}

export function openRouterConfigured(): boolean {
  return Boolean(apiKey());
}

type MessageContent = string | Array<Record<string, unknown>>;

// Low-level model call. Returns the assistant text (content, else reasoning),
// or "" on any failure. Never throws — callers degrade gracefully.
async function callModel(
  modelId: string,
  content: MessageContent,
  maxTokens = 900
): Promise<string> {
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
        model: modelId,
        messages: [{ role: "user", content }],
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

// Text-only convenience wrapper (uses the default text model).
async function chat(prompt: string, maxTokens = 900): Promise<string> {
  return callModel(model(), prompt, maxTokens);
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

// ─── FREE VISION: identify a product from an image ───────────────────────────

export interface ProductVision {
  itemName: string; // concise product name
  colour: string; // dominant colour
  material: string; // primary material
  dimension: string; // rough size guess (may be "")
  keywords: string[]; // Alibaba/1688 search terms
  hsn: string; // likely 4-digit India HSN
}

// Look at a product photo (public URL) with a FREE vision model and return the
// item's identity + search hints — no paid Gemini/SerpApi quota used. Returns
// null if unavailable/unparseable so callers can fall back.
export async function identifyProductFromImage(imageUrl: string): Promise<ProductVision | null> {
  if (!apiKey() || !imageUrl || imageUrl.startsWith("data:")) return null;

  const content = [
    {
      type: "text",
      text:
        "You are a China-sourcing assistant. Identify the manufactured product in this image " +
        "(ignore hands, background, props). Reply with ONLY a compact JSON object, no prose:\n" +
        '{"itemName":"concise product name","colour":"main colour","material":"primary material",' +
        '"dimension":"rough size like 84x530 mm or empty","keywords":["3-5 Alibaba search terms"],' +
        '"hsn":"most likely 4-digit India HSN"}',
    },
    { type: "image_url", image_url: { url: imageUrl } },
  ];

  const raw = await callModel(visionModel(), content, 1200);
  const obj = get_json_object(raw);
  if (!obj) return null;

  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 5)
    : [];
  const vision: ProductVision = {
    itemName: String(obj.itemName ?? obj.name ?? "").trim(),
    colour: String(obj.colour ?? obj.color ?? "").trim(),
    material: String(obj.material ?? "").trim().toLowerCase(),
    dimension: String(obj.dimension ?? "").trim(),
    keywords,
    hsn: String(obj.hsn ?? "").replace(/[^0-9]/g, "").slice(0, 4),
  };
  if (!vision.itemName && keywords.length === 0) return null;
  return vision;
}

// ─── SMART SUPPLIER PICKER ───────────────────────────────────────────────────

export interface SupplierPick {
  index: number; // index into the input list (0-based) of the recommended supplier
  reason: string; // one-line why (price vs reviews vs MOQ trade-off)
}

// Given a compact list of candidate suppliers, ask the free text model to pick the
// best one and say why. Input rows should be small (name, price, reviews, country).
// Returns null on failure so the caller keeps its own default (e.g. cheapest).
export async function pickBestSupplier(
  candidates: Array<{ name: string; priceUsd: number | null; reviews: number | null; rating: number | null; country: string }>
): Promise<SupplierPick | null> {
  if (!apiKey() || candidates.length === 0) return null;

  const rows = candidates
    .slice(0, 15)
    .map((c, i) => `${i}. ${c.name} | $${c.priceUsd ?? "?"} | ${c.reviews ?? 0} reviews | ★${c.rating ?? "?"} | ${c.country || "?"}`)
    .join("\n");

  const prompt =
    "You are a sourcing analyst choosing ONE supplier to buy from. Balance price, " +
    "reviews/rating (trust) and country. Prefer a low price with solid reviews over " +
    "the absolute cheapest with none.\nCandidates:\n" +
    rows +
    '\nReply with ONLY JSON: {"index":<number>,"reason":"one short line"}';

  const raw = await chat(prompt, 700);
  const obj = get_json_object(raw);
  if (!obj) return null;
  const index = Number(obj.index);
  if (!Number.isInteger(index) || index < 0 || index >= candidates.length) return null;
  return { index, reason: String(obj.reason ?? "").trim() };
}
