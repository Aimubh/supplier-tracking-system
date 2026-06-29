// Weighted supplier ranking for the Telegram finder bot.
//
// When a user tags the bot with an image + a hashtag, the image search returns a
// list of candidate suppliers (already roughly ordered by visual match). The tag
// shifts how that list is re-ranked:
//
//   #prize / #price  → 60% image match + 40% cheapest price
//   #top             → 60% image match + 40% best rating
//   #review          → 60% image match + 40% most reviews
//   (no tag)         → 100% image match (keep the search order)
//
// Everything here is a PURE function of its inputs — no network, no Telegram, no
// FX — so the maths can be unit-tested in isolation. The bot route wires it up.

// A candidate supplier from the image search. A superset-compatible subset of
// SourcingSupplier (store.tsx), plus an optional imageScore the search may
// provide. Kept local so this module has no React/store dependency.
export interface RankCandidate {
  name: string;
  title: string;
  priceUsd: number | null;
  priceInr: number | null;
  reviews: number | null;
  rating: number | null; // 0–5 typically
  country: string;
  url: string;
  image: string;
  platform: string;
  // 0–1 visual-similarity score if the search engine returns one. When absent,
  // the candidate's position in the input list is used as the image signal (the
  // search already orders by match), so this stays optional and back-compatible.
  imageScore?: number;
}

export type RankDimension = "price" | "top" | "review";

export interface RankTag {
  dimension: RankDimension | null; // null = no recognised tag (image-only)
  raw: string | null; // the matched hashtag text, for echoing back
  imageWeight: number; // 0–1
  dimensionWeight: number; // 0–1 (imageWeight + dimensionWeight === 1)
}

// Default blend when a dimension tag is present. Configurable via env so the
// split can be tuned without a code change (RANK_IMAGE_WEIGHT, 0–1).
function imageWeightFromEnv(): number {
  const raw = Number(process.env.RANK_IMAGE_WEIGHT);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  return 0.6;
}

// Map a hashtag word to a ranking dimension. Tolerant of synonyms and the common
// "prize" misspelling of "price".
const TAG_TO_DIMENSION: Record<string, RankDimension> = {
  prize: "price",
  price: "price",
  cheap: "price",
  cheapest: "price",
  top: "top",
  best: "top",
  rating: "top",
  rated: "top",
  review: "review",
  reviews: "review",
  reviewed: "review",
};

// Parse the first recognised #hashtag out of a message caption. Tolerant of:
//   "@lazer_DipatchBot#prize"  (no space, tag glued to the mention)
//   "find me this #TOP please" (mixed case, surrounded by text)
//   "#review"                  (bare)
// Returns the dimension + the resolved weights. Unknown/absent tag → image-only.
export function parseRankTag(caption: string | null | undefined): RankTag {
  const text = caption ?? "";
  const imageWeight = imageWeightFromEnv();
  // Grab every #word token (letters only after the #), case-insensitive.
  const matches = text.match(/#([a-z]+)/gi) ?? [];
  for (const m of matches) {
    const word = m.slice(1).toLowerCase();
    const dim = TAG_TO_DIMENSION[word];
    if (dim) {
      return { dimension: dim, raw: m, imageWeight, dimensionWeight: 1 - imageWeight };
    }
  }
  return { dimension: null, raw: null, imageWeight: 1, dimensionWeight: 0 };
}

// --- normalisation helpers ----------------------------------------------------
// Each dimension is scored to 0–1 across the candidate set so the weighted blend
// is comparable. We min–max within the set (relative ranking), which is what the
// user wants: "the cheapest of THESE", "the best-rated of THESE".

// Image signal in 0–1. Prefer an explicit imageScore; otherwise derive it from
// list position (first = 1.0, last → ~0), since the search returns best-first.
function imageScores(cands: RankCandidate[]): number[] {
  const hasExplicit = cands.some((c) => typeof c.imageScore === "number");
  if (hasExplicit) {
    return cands.map((c) => clamp01(typeof c.imageScore === "number" ? c.imageScore : 0));
  }
  const n = cands.length;
  if (n <= 1) return cands.map(() => 1);
  // Position 0 → 1, position n-1 → 0 (linear). Keeps the search's own order as
  // the image dimension when no similarity number is available.
  return cands.map((_, i) => 1 - i / (n - 1));
}

// Cheaper = higher score. Uses priceUsd, falling back to priceInr. Missing prices
// score 0 (we can't claim they're cheap). min price → 1, max → 0.
function priceScores(cands: RankCandidate[]): number[] {
  const prices = cands.map((c) => c.priceUsd ?? c.priceInr ?? null);
  const present = prices.filter((p): p is number => typeof p === "number" && p > 0);
  if (present.length === 0) return cands.map(() => 0);
  const min = Math.min(...present);
  const max = Math.max(...present);
  return prices.map((p) => {
    if (typeof p !== "number" || p <= 0) return 0;
    if (max === min) return 1; // all equal → all best
    return 1 - (p - min) / (max - min); // cheaper → closer to 1
  });
}

// Higher rating = higher score. Normalised within the set. Missing → 0.
function ratingScores(cands: RankCandidate[]): number[] {
  return minMaxHigher(cands.map((c) => c.rating));
}

// More reviews = higher score. Normalised within the set. Missing → 0.
function reviewScores(cands: RankCandidate[]): number[] {
  return minMaxHigher(cands.map((c) => c.reviews));
}

// Generic "higher is better" min–max over a nullable numeric column.
function minMaxHigher(vals: (number | null)[]): number[] {
  const present = vals.filter((v): v is number => typeof v === "number" && v >= 0);
  if (present.length === 0) return vals.map(() => 0);
  const min = Math.min(...present);
  const max = Math.max(...present);
  return vals.map((v) => {
    if (typeof v !== "number" || v < 0) return 0;
    if (max === min) return 1;
    return (v - min) / (max - min);
  });
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export interface RankedCandidate extends RankCandidate {
  score: number; // final blended 0–1
  imageScoreUsed: number; // the 0–1 image signal that fed the blend
  dimensionScore: number; // the 0–1 dimension signal that fed the blend
}

// Re-rank candidates by the parsed tag. Returns a NEW array sorted best-first,
// each annotated with its component scores (handy for the reply / debugging).
// Stable: ties keep the original (search) order.
export function rankSuppliers(cands: RankCandidate[], tag: RankTag): RankedCandidate[] {
  const img = imageScores(cands);
  const dimArr =
    tag.dimension === "price"
      ? priceScores(cands)
      : tag.dimension === "top"
      ? ratingScores(cands)
      : tag.dimension === "review"
      ? reviewScores(cands)
      : cands.map(() => 0); // no tag → dimension unused (weight 0)

  const scored: RankedCandidate[] = cands.map((c, i) => {
    const imageScoreUsed = img[i];
    const dimensionScore = dimArr[i];
    const score = tag.imageWeight * imageScoreUsed + tag.dimensionWeight * dimensionScore;
    return { ...c, score, imageScoreUsed, dimensionScore };
  });

  // Sort by score desc; stable tie-break on original index.
  return scored
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
    .map(({ c }) => c);
}

// Convenience: parse + rank + take top N in one call.
export function rankTopN(cands: RankCandidate[], caption: string | null | undefined, n = 5) {
  const tag = parseRankTag(caption);
  const ranked = rankSuppliers(cands, tag);
  return { tag, top: ranked.slice(0, n), all: ranked };
}
