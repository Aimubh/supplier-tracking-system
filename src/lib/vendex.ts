// Vendex image-search bridge (server-side).
//
// Given raw image bytes, host them publicly, ask the Vendex scraper to image-
// search Alibaba, poll to completion, and return a normalised supplier list
// shaped for ranking (RankCandidate). This is the same pipeline the
// /api/sourcing/fetch-image route uses, factored out so the Telegram bot can
// reuse it without duplicating the polling logic.
//
// MOCK MODE: if Vendex is unreachable (or BOT_MOCK_SUPPLIERS=1), returns a small
// deterministic sample set so the ranking + bot reply can be tested end-to-end
// without the scraper service running.

import type { RankCandidate } from "./supplier-ranking";

const VENDEX = process.env.VENDEX_API_URL ?? "http://127.0.0.1:8001";
const VENDEX_TOKEN = process.env.VENDEX_API_TOKEN ?? "";
const POLL_TIMEOUT_MS = 90_000;
const POLL_EVERY_MS = 2_500;

// SerpAPI Google Lens — direct reverse-image search, no separate scraper service.
const SERPAPI_KEY = process.env.SERPAPI_KEY ?? "";
// USD-per-unit conversion for non-USD Lens prices, so price ranking is comparable.
const FX_TO_USD: Record<string, number> = { USD: 1, "$": 1, INR: 0.012, "₹": 0.012, EUR: 1.08, "€": 1.08, GBP: 1.27, "£": 1.27, CNY: 0.14, "¥": 0.14, AED: 0.27 };

function authHeaders(): Record<string, string> {
  return VENDEX_TOKEN
    ? { Authorization: `Bearer ${VENDEX_TOKEN}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockForced(): boolean {
  return process.env.BOT_MOCK_SUPPLIERS === "1";
}

// Upload bytes to catbox.moe (public, no key) → public image URL Alibaba can fetch.
async function hostImage(bytes: Uint8Array, mime: string): Promise<string> {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const form = new FormData();
  form.append("reqtype", "fileupload");
  // Wrap bytes in a Blob for multipart upload.
  form.append("fileToUpload", new Blob([bytes as BlobPart], { type: mime }), `upload.${ext}`);
  const res = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//i.test(text)) throw new Error("Image host rejected the upload");
  return text;
}

export interface SupplierSearchResult {
  ok: boolean;
  mock: boolean; // true when the mock set was returned (Vendex unreachable)
  suppliers: RankCandidate[];
  note?: string; // e.g. retail-price warning
  error?: string;
}

// Deterministic sample suppliers for mock mode — varied price/rating/reviews so
// the #prize/#top/#review re-ranking visibly differs between tags. Order here is
// the "image match" order (best visual match first).
function mockSuppliers(): RankCandidate[] {
  // Deliberately decorrelated: price, rating and reviews each peak on a DIFFERENT
  // supplier, so #prize / #top / #review each produce a visibly different order.
  return [
    { name: "Yiwu Best Pen Co.", title: "6-in-1 Multicolour Gel Pen", priceUsd: 0.55, priceInr: 46, reviews: 320, rating: 4.5, country: "CN", url: "https://example.com/a", image: "", platform: "alibaba" }, // best image match
    { name: "Shenzhen WriteWell", title: "Retractable Pen Set (6 colours)", priceUsd: 0.31, priceInr: 26, reviews: 210, rating: 4.3, country: "CN", url: "https://example.com/b", image: "", platform: "alibaba" }, // CHEAPEST
    { name: "Guangzhou Office Supply", title: "Premium 6-Colour Pen", priceUsd: 0.72, priceInr: 60, reviews: 9000, rating: 4.6, country: "CN", url: "https://example.com/c", image: "", platform: "alibaba" }, // MOST REVIEWS
    { name: "Ningbo Stationery Ltd", title: "Multi-colour Ballpoint Pen", priceUsd: 0.49, priceInr: 41, reviews: 140, rating: 4.9, country: "CN", url: "https://example.com/d", image: "", platform: "alibaba" }, // BEST RATING
    { name: "Hangzhou Pen Factory", title: "Economy Multicolour Pen", priceUsd: 0.63, priceInr: 52, reviews: 75, rating: 4.1, country: "CN", url: "https://example.com/e", image: "", platform: "alibaba" },
    { name: "BrowseBazaar Retail", title: "6-colour pen (retail)", priceUsd: 2.5, priceInr: 208, reviews: 60, rating: 4.4, country: "US", url: "https://example.com/f", image: "", platform: "google_lens" }, // pricey retail outlier
  ];
}

// Map a raw Vendex supplier row into a RankCandidate. imageScore is taken from a
// similarity field if Vendex provides one (it does not today — kept for forward-
// compat); otherwise left undefined so ranking falls back to list position.
function toCandidate(s: Record<string, unknown>): RankCandidate {
  const sim = s.similarity ?? s.imageScore ?? s.matchScore;
  return {
    name: String(s.supplierName ?? "Supplier"),
    title: String(s.productName ?? ""),
    priceUsd: (s.unitPriceUSD as number) ?? null,
    priceInr: (s.unitPriceINR as number) ?? null,
    reviews: (s.reviewCount as number) ?? null,
    rating: (s.rating as number) ?? null,
    country: String(s.country ?? ""),
    url: String(s.productUrl ?? ""),
    image: String(s.productImageUrl ?? ""),
    platform: String(s.platform ?? ""),
    imageScore: typeof sim === "number" ? sim : undefined,
  };
}

// --- SerpAPI Google Lens (direct reverse-image search) -----------------------
// Maps a Lens visual_matches row into a RankCandidate. The row's `position` is
// Google's own visual-similarity rank, which becomes the image-match signal.
function lensToCandidate(m: Record<string, unknown>, index: number, total: number): RankCandidate {
  const price = m.price as { extracted_value?: number; currency?: string } | undefined;
  let priceUsd: number | null = null;
  if (price && typeof price.extracted_value === "number") {
    const cur = String(price.currency ?? "USD");
    const rate = FX_TO_USD[cur] ?? 1;
    priceUsd = price.extracted_value * rate;
  }
  // position is 1-based and best-first; convert to a 0–1 image score (1 = best).
  const pos = typeof m.position === "number" ? m.position : index + 1;
  const imageScore = total > 1 ? Math.max(0, 1 - (pos - 1) / (total - 1)) : 1;
  return {
    name: String(m.source ?? m.title ?? "Source"),
    title: String(m.title ?? ""),
    priceUsd,
    priceInr: priceUsd != null ? Math.round(priceUsd / 0.012) : null,
    reviews: typeof m.reviews === "number" ? m.reviews : null,
    rating: typeof m.rating === "number" ? m.rating : null,
    country: "",
    url: String(m.link ?? ""),
    image: String(m.thumbnail ?? m.image ?? ""),
    platform: "google_lens",
    imageScore,
  };
}

// Reverse-image search via SerpAPI Google Lens. Returns visual matches with
// prices/ratings/reviews. Requires SERPAPI_KEY and a public image URL.
async function searchViaSerpApi(imageUrl: string): Promise<RankCandidate[]> {
  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    type: "visual_matches",
    api_key: SERPAPI_KEY,
    hl: "en",
  });
  const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`SerpAPI: ${data.error}`);
  const matches: Record<string, unknown>[] = Array.isArray(data.visual_matches) ? data.visual_matches : [];
  // Keep matches that have at least a price OR look like a shopping result.
  const usable = matches.slice(0, 30);
  return usable.map((m, i) => lensToCandidate(m, i, usable.length));
}

// Run the full image → suppliers pipeline. Never throws; returns a result object.
// Priority: SerpAPI Lens (if SERPAPI_KEY) → Vendex (if reachable) → mock.
export async function searchSuppliersByImage(
  bytes: Uint8Array,
  mime: string
): Promise<SupplierSearchResult> {
  if (mockForced()) {
    return { ok: true, mock: true, suppliers: mockSuppliers(), note: "Mock data (BOT_MOCK_SUPPLIERS=1)." };
  }

  // PRIMARY: SerpAPI Google Lens — real reverse-image search, no Vendex needed.
  if (SERPAPI_KEY) {
    try {
      const imageUrl = await hostImage(bytes, mime);
      const suppliers = await searchViaSerpApi(imageUrl);
      if (suppliers.length > 0) {
        return {
          ok: true,
          mock: false,
          suppliers,
          note: "Prices are retail (Google Lens). Alibaba wholesale FOB will be lower — check the links.",
        };
      }
      // No matches → fall through to Vendex/mock below.
    } catch (e) {
      // Lens failed (quota/network) → try Vendex, else mock. Don't go silent.
      const msg = e instanceof Error ? e.message : "lens failed";
      if (!process.env.VENDEX_API_URL || mockForced()) {
        return { ok: true, mock: true, suppliers: mockSuppliers(), note: `Lens search unavailable (${msg}) — showing sample data.` };
      }
      // else fall through to the Vendex attempt
    }
  }

  try {
    // 1) Host the image publicly.
    const imageUrl = await hostImage(bytes, mime);

    // 2) Kick off the Vendex image-search job.
    const submit = await fetch(`${VENDEX}/api/v1/process/image`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ image_url: imageUrl, label: "telegram-bot" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!submit.ok) throw new Error(`Vendex rejected the search (HTTP ${submit.status})`);
    const jobId = String((await submit.json()).job_id ?? "");
    if (!jobId) throw new Error("Vendex returned no job id");

    // 3) Poll to completion.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = "queued";
    while (Date.now() < deadline) {
      await sleep(POLL_EVERY_MS);
      try {
        const r = await fetch(`${VENDEX}/api/v1/jobs/${jobId}`, { headers: authHeaders(), signal: AbortSignal.timeout(10_000) });
        if (!r.ok) continue;
        status = String((await r.json()).status ?? "");
        if (status === "complete" || status === "failed") break;
      } catch {
        /* transient poll error — keep trying until deadline */
      }
    }
    if (status === "failed") return { ok: false, mock: false, suppliers: [], error: "Image search failed (scraper error or quota)." };
    if (status !== "complete") return { ok: false, mock: false, suppliers: [], error: "Image search timed out — try again in a moment." };

    // 4) Pull suppliers.
    const r = await fetch(`${VENDEX}/api/v1/suppliers?job_id=${jobId}`, { headers: authHeaders(), signal: AbortSignal.timeout(15_000) });
    const data = await r.json();
    const raw: Record<string, unknown>[] = Array.isArray(data) ? data : data.suppliers ?? [];
    if (raw.length === 0) return { ok: false, mock: false, suppliers: [], error: "No matching suppliers found for that image." };

    const suppliers = raw.slice(0, 20).map(toCandidate);
    const isRetail = suppliers.every((s) => s.platform === "google_lens");
    return {
      ok: true,
      mock: false,
      suppliers,
      note: isRetail ? "Prices shown are retail (Google Lens) — Alibaba wholesale FOB will be lower." : undefined,
    };
  } catch (e) {
    // Vendex unreachable / network error → graceful mock fallback so the bot
    // still responds (and is testable) rather than going silent.
    const msg = e instanceof Error ? e.message : "search failed";
    return {
      ok: true,
      mock: true,
      suppliers: mockSuppliers(),
      note: `Image search backend offline (${msg}) — showing sample data.`,
    };
  }
}
