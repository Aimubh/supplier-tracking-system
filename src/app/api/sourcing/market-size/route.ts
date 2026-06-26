// Best-effort market-size lookup for the Sourcing Model.
//   POST /api/sourcing/market-size  { query }
// Fetches the Amazon.in search results page for the query and parses what it can
// (listing count, prices, review counts, ratings) into a MarketSize snapshot.
//
// HEAVY CAVEAT: Amazon/Flipkart actively block server-side scraping. This will
// frequently return PARTIAL or EMPTY data (a CAPTCHA / robot page instead of
// results). That is expected — the route never throws; it returns whatever it
// got with `partial: true` and a note, so the recommendation engine can still
// produce a low-confidence read. For reliable data, plug in an official product
// API (e.g. a Rainforest/SerpAPI key) later behind this same route.

import { NextResponse } from "next/server";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";
import { aggregateMarket, type MarketListing } from "@/lib/market-size";

export const dynamic = "force-dynamic";

// A desktop browser UA — Amazon serves a robot page to obvious bots, this helps
// marginally but is not a guarantee.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function parseAmazon(html: string): { listings: MarketListing[]; blocked: boolean } {
  // Amazon returns a captcha/robot page when it blocks us.
  const blocked =
    /to discuss automated access|Enter the characters you see below|api-services-support@amazon/i.test(
      html
    );
  const listings: MarketListing[] = [];

  // Each result carries data-asin; pull a coarse slice around each and read price
  // (a-price-whole) and review count (aria-label "N ratings" / the small count).
  const blocks = html.split('data-asin="').slice(1);
  for (const b of blocks.slice(0, 60)) {
    const asin = b.slice(0, b.indexOf('"'));
    if (!asin || asin.length < 6) continue;
    const seg = b.slice(0, 4000);

    const titleM = seg.match(/<span class="[^"]*a-text-normal[^"]*">([^<]{6,})<\/span>/);
    const priceM = seg.match(/a-price-whole">([\d,]+)/);
    const reviewM = seg.match(/([\d,]+)\s*<\/span>\s*<\/a>\s*<\/div>/) || seg.match(/aria-label="([\d,]+)\s+rating/);
    const ratingM = seg.match(/([\d.]+)\s+out of 5 stars/);

    const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null;
    const reviews = reviewM ? parseInt(reviewM[1].replace(/,/g, ""), 10) : null;
    const rating = ratingM ? parseFloat(ratingM[1]) : null;

    if (price == null && reviews == null && rating == null) continue;
    listings.push({
      source: "amazon.in",
      title: titleM ? titleM[1].trim() : "",
      priceInr: price,
      reviewCount: reviews,
      rating,
      url: `https://www.amazon.in/dp/${asin}`,
    });
  }
  return { listings, blocked };
}

export async function POST(req: Request) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;

  let query = "";
  let imageUrl = "";
  try {
    const body = await req.json();
    query = String(body.query ?? "").trim();
    imageUrl = String(body.imageUrl ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!query && !imageUrl) {
    return NextResponse.json({ error: "A query or product image is required." }, { status: 400 });
  }

  // 1) PRIMARY: Google Lens (via Vendex) — 3-market retail comparison
  // (India / UAE / USA) from the product image. Real prices + reviews, localised.
  if (imageUrl) {
    try {
      const VENDEX = process.env.VENDEX_API_URL ?? "http://127.0.0.1:8001";
      const token = process.env.VENDEX_API_TOKEN ?? "";
      const lr = await fetch(`${VENDEX}/api/v1/market-size`, {
        method: "POST",
        headers: token
          ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
          : { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, query }),
        signal: AbortSignal.timeout(60_000),
      });
      if (lr.ok) {
        const d = await lr.json();
        const mk = d.markets ?? {};
        const region = (r: Record<string, unknown> = {}) => ({
          currency: String(r.currency ?? ""),
          currencyCode: String(r.currency_code ?? ""),
          avgPrice: (r.avg_price as number) ?? null,
          avgPriceInr: (r.avg_price_inr as number) ?? null,
          minPrice: (r.min_price as number) ?? null,
          maxPrice: (r.max_price as number) ?? null,
          count: (r.count as number) ?? 0,
          totalReviews: (r.total_reviews as number) ?? 0,
          avgRating: (r.avg_rating as number) ?? null,
        });
        const india = region(mk.india);
        const uae = region(mk.uae);
        const usa = region(mk.usa);
        const totalCount = india.count + uae.count + usa.count;
        if (totalCount > 0) {
          // India is the home market — drive the existing aggregates/recommendation off it.
          const ms = aggregateMarket(query || "product", [], false, "Source: Google Lens (3-market retail).");
          return NextResponse.json({
            ...ms,
            resultCount: india.count,
            avgPriceInr: india.avgPriceInr,
            totalReviews: india.totalReviews,
            avgRating: india.avgRating,
            note: "Retail prices via Google Lens, per market (India / UAE / USA).",
            comparison: { india, uae, usa, fetchedAt: Date.now() },
          });
        }
      }
    } catch {
      // Lens unavailable — fall through to the Amazon scrape.
    }
  }

  if (!query) {
    return NextResponse.json(
      aggregateMarket("product", [], true, "No market data (Lens returned nothing; no query for fallback).")
    );
  }

  const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;

  let html = "";
  let fetchOk = false;
  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      // Don't let a slow block hang the request forever.
      signal: AbortSignal.timeout(15_000),
    });
    fetchOk = res.ok;
    html = await res.text();
  } catch {
    const ms = aggregateMarket(query, [], true, "Could not reach Amazon.in (network/timeout).");
    return NextResponse.json(ms);
  }

  const { listings, blocked } = parseAmazon(html);
  const partial = blocked || !fetchOk || listings.length === 0;
  const note = blocked
    ? "Amazon served a robot/CAPTCHA page — data blocked. Treat as low confidence or enter manually."
    : listings.length === 0
    ? "No listings parsed (page layout may have changed or was blocked)."
    : listings.length < 5
    ? "Only a few listings parsed — partial data."
    : "";

  const ms = aggregateMarket(query, listings, partial, note);
  return NextResponse.json(ms);
}
