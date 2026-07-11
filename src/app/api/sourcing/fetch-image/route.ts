// Image-upload → supplier search bridge (Sourcing model auto-fill).
//   POST /api/sourcing/fetch-image   (multipart form: file=<image>)
//
// Uses the SAME image-search path as the live Telegram bot
// (lib/vendex.searchSuppliersByImage): hosts the photo on a robust CDN chain
// (imgbb → litterbox → catbox) then searches TMAPI (1688/Alibaba wholesale) →
// Google Lens (retail) → mock. This works on Vercel with NO local Python
// backend — the previous catbox-only + localhost:8001 path failed in production
// ("Couldn't host the image").

import { NextResponse } from "next/server";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";
import { enrichScraped, type ScrapedProduct } from "@/lib/sourcing-enrich";
import { searchSuppliersByImage } from "@/lib/vendex";
import type { RankCandidate } from "@/lib/supplier-ranking";
import { suggestSearchQueries, openRouterConfigured } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(req: Request) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;

  // 1) Read the uploaded file.
  let file: File | null = null;
  let label = "";
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
    label = String(form.get("label") ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }
  // Accept anything that IS an image, plus iPhone HEIC/HEIF (whose browser MIME
  // type is often empty or "image/heic"). The client converts HEIC→JPEG before
  // upload; this is a defensive net so a mislabelled type doesn't hard-block.
  const name = (file.name ?? "").toLowerCase();
  const looksImage =
    file.type.startsWith("image/") ||
    file.type === "" ||
    /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/.test(name);
  if (!looksImage) {
    return NextResponse.json({ error: "Please upload an image file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 8 MB)." }, { status: 400 });
  }

  // 2) If we have a product label, ask the free OpenRouter model for search
  //    keywords — they tag the cache so future text searches can reuse the
  //    results, and improve matching.
  let keywords: string[] = [];
  if (label && openRouterConfigured()) {
    const hint = await suggestSearchQueries(label);
    if (hint) keywords = hint.keywords;
  }

  // 3) Search suppliers by image (cache-first, then hosts + live search).
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await searchSuppliersByImage(bytes, file.type || "image/jpeg", keywords);

  if (!result.ok || result.suppliers.length === 0) {
    return NextResponse.json(
      { error: result.error ?? "No matching suppliers found for that image." },
      { status: result.error?.includes("No match") ? 404 : 502 }
    );
  }

  // 3) Pick the best supplier to auto-fill and enrich it into SKU inputs.
  const top = pickRepresentative(result.suppliers);
  const enriched = enrichScraped(toScraped(top));

  // Lens/retail results aren't Alibaba wholesale FOB — flag so the FOB field
  // isn't mistaken for a factory quote.
  const isRetail = top.platform === "google_lens";

  return NextResponse.json({
    supplierCount: result.suppliers.length,
    lowConfidence: isRetail,
    note: result.note ?? (isRetail
      ? "Shown from Google Lens (retail prices, not Alibaba wholesale FOB). Treat FOB as approximate."
      : ""),
    inputs: enriched.inputs,
    flags: enriched.flags,
    raw: {
      supplierName: top.name ?? "",
      country: top.country ?? "",
      productUrl: top.url ?? "",
      productImageUrl: top.image ?? "",
    },
    suppliers: result.suppliers.slice(0, 20).map((s) => ({
      name: s.name,
      title: s.title,
      priceUsd: s.priceUsd,
      priceInr: s.priceInr,
      reviews: s.reviews,
      rating: s.rating,
      country: s.country,
      url: s.url,
      image: s.image,
      platform: s.platform,
    })),
  });
}

// Map a search candidate into the ScrapedProduct shape enrichScraped expects.
function toScraped(c: RankCandidate): ScrapedProduct {
  return {
    productName: c.title || c.name,
    unitPriceUSD: c.priceUsd ?? undefined,
    priceRangeMin: c.priceUsd ?? undefined,
    country: c.country,
    productImageUrl: c.image,
    platform: c.platform,
  };
}

// Pick the best supplier to auto-fill, not just the first result (often an
// outlier — e.g. a $954 bulk carton). Prefer the CHEAPEST realistic price after
// discarding statistical outliers via the IQR rule. Falls back to the first
// result when nothing is priced.
function pickRepresentative(suppliers: RankCandidate[]): RankCandidate {
  const priceOf = (s: RankCandidate) => s.priceUsd ?? s.priceInr ?? undefined;
  const priced = suppliers.filter((s) => {
    const p = priceOf(s);
    return typeof p === "number" && p > 0;
  });
  if (priced.length === 0) return suppliers[0];
  if (priced.length <= 2) {
    return priced.reduce((a, b) => (priceOf(b)! < priceOf(a)! ? b : a));
  }
  const prices = priced.map((s) => priceOf(s)!).sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  const upperFence = q3 + 1.5 * (q3 - q1);
  const sane = priced.filter((s) => priceOf(s)! <= upperFence);
  const pool = sane.length > 0 ? sane : priced;
  return pool.reduce((a, b) => (priceOf(b)! < priceOf(a)! ? b : a));
}
