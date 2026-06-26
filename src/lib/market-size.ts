// Market-size assessment for the Sourcing Model. Aggregates what we can pull
// from Indian e-commerce search results (Amazon.in / Flipkart) into a simple
// read on demand + competition, and combines it with the model's own margin
// verdict to give a SELL / CAUTION / AVOID recommendation.
//
// NOTE: e-commerce scraping is unreliable (Amazon/Flipkart block bots hard), so
// every field here is optional and the logic degrades gracefully — a partial or
// empty scrape still yields a (low-confidence) recommendation rather than an error.

// One competing listing observed on an e-commerce site.
export interface MarketListing {
  source: string; // "amazon.in" | "flipkart" | ...
  title: string;
  priceInr: number | null;
  reviewCount: number | null;
  rating: number | null;
  url: string;
}

// Per-market retail snapshot (India / UAE / USA) from Google Lens.
export interface MarketRegion {
  currency: string; // ₹ / AED / $
  currencyCode: string; // INR / AED / USD
  avgPrice: number | null; // typical (median) retail price, native currency
  avgPriceInr: number | null; // same, converted to INR for comparison
  minPrice: number | null;
  maxPrice: number | null;
  count: number;
  totalReviews: number;
  avgRating: number | null;
}

export interface MarketComparison {
  india: MarketRegion;
  uae: MarketRegion;
  usa: MarketRegion;
  fetchedAt: number | null;
}

// The aggregated market snapshot stored per product.
export interface MarketSize {
  fetchedAt: number | null; // epoch ms, null if never run
  query: string;
  listings: MarketListing[];
  // Aggregates (computed, but stored so the sheet shows them without re-scrape).
  resultCount: number; // how many competing listings found
  avgPriceInr: number | null;
  medianPriceInr: number | null;
  totalReviews: number; // sum of review counts seen (demand proxy)
  avgRating: number | null;
  partial: boolean; // true if the scrape was incomplete / blocked
  note: string; // human note about scrape quality
  comparison?: MarketComparison; // 3-market retail comparison (India/UAE/USA)
}

export const EMPTY_MARKET_SIZE: MarketSize = {
  fetchedAt: null,
  query: "",
  listings: [],
  resultCount: 0,
  avgPriceInr: null,
  medianPriceInr: null,
  totalReviews: 0,
  avgRating: null,
  partial: false,
  note: "",
};

export type MarketVerdict = "SELL" | "CAUTION" | "AVOID" | "UNKNOWN";

export interface MarketRecommendation {
  verdict: MarketVerdict;
  score: number; // 0–100 composite
  reasons: string[];
}

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Roll a list of raw listings into the stored aggregate snapshot.
export function aggregateMarket(
  query: string,
  listings: MarketListing[],
  partial: boolean,
  note: string
): MarketSize {
  const prices = listings.map((l) => l.priceInr).filter((p): p is number => p != null && p > 0);
  const reviews = listings.map((l) => l.reviewCount).filter((r): r is number => r != null);
  const ratings = listings.map((l) => l.rating).filter((r): r is number => r != null);
  return {
    fetchedAt: Date.now(),
    query,
    listings,
    resultCount: listings.length,
    avgPriceInr: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    medianPriceInr: median(prices),
    totalReviews: reviews.reduce((a, b) => a + b, 0),
    avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    partial,
    note,
  };
}

// Combine market signals + the model's best contribution margin into a verdict.
//   marginPct is a fraction (0.45 = 45%); pass the model's bestContributionPct.
export function recommend(m: MarketSize, marginPct: number): MarketRecommendation {
  const reasons: string[] = [];
  if (m.fetchedAt == null) {
    return { verdict: "UNKNOWN", score: 0, reasons: ["No market data fetched yet."] };
  }

  let score = 50;

  // Demand signal: total reviews across competing listings (proxy for sales volume).
  if (m.totalReviews >= 5000) {
    score += 20;
    reasons.push(`Strong demand — ${m.totalReviews.toLocaleString("en-IN")} reviews across listings.`);
  } else if (m.totalReviews >= 500) {
    score += 8;
    reasons.push(`Moderate demand — ${m.totalReviews.toLocaleString("en-IN")} reviews seen.`);
  } else if (m.totalReviews > 0) {
    score -= 5;
    reasons.push(`Thin demand signal — only ${m.totalReviews} reviews found.`);
  }

  // Competition: too many near-identical listings = crowded.
  if (m.resultCount >= 40) {
    score -= 12;
    reasons.push(`Crowded — ${m.resultCount}+ competing listings.`);
  } else if (m.resultCount > 0 && m.resultCount <= 10) {
    score += 8;
    reasons.push(`Low competition — ${m.resultCount} listings.`);
  }

  // Margin from the costing model (the most important factor).
  if (marginPct >= 0.45) {
    score += 22;
    reasons.push(`Healthy margin — ${(marginPct * 100).toFixed(0)}% contribution.`);
  } else if (marginPct >= 0.25) {
    score += 5;
    reasons.push(`Workable margin — ${(marginPct * 100).toFixed(0)}%.`);
  } else if (marginPct > 0) {
    score -= 15;
    reasons.push(`Thin margin — ${(marginPct * 100).toFixed(0)}%.`);
  } else {
    score -= 25;
    reasons.push("Negative margin at current FOB / sell price.");
  }

  // Quality bar of the competition.
  if (m.avgRating != null && m.avgRating < 3.8) {
    score += 6;
    reasons.push(`Incumbents are weak (avg ${m.avgRating.toFixed(1)}★) — room to win on quality.`);
  }

  if (m.partial) reasons.push("⚠ Market data is partial — treat as low confidence.");

  score = Math.max(0, Math.min(100, score));
  const verdict: MarketVerdict = score >= 65 ? "SELL" : score >= 45 ? "CAUTION" : "AVOID";
  return { verdict, score, reasons };
}
