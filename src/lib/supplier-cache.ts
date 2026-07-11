// Two-tier supplier-search cache (backed by the CachedProduct table).
//
//   Tier 1 — COLLECTOR: after any live supplier search, saveToCache() stores the
//   returned products, tagged with the query hash + keywords (+ image hash). Over
//   many searches this accumulates thousands of product rows.
//
//   Tier 2 — SERVER: before calling a paid API, lookupCache() checks the cache in
//   priority order — exact query hash → keyword/title text → image hash — and
//   returns matches when there are enough, so repeat/similar searches cost nothing.
//
// Never throws: any DB error degrades to "cache miss" so the live search still runs.

import { createHash } from "crypto";
import { prisma } from "./db";
import type { RankCandidate } from "./supplier-ranking";

// How many cached matches count as "enough" to skip the live API.
const MIN_CACHE_HITS = 5;

export function hashText(s: string): string {
  return createHash("sha256").update(s.trim().toLowerCase()).digest("hex").slice(0, 32);
}

// A cheap, order-insensitive hash of image bytes — good enough to recognise the
// SAME image re-uploaded (not true perceptual similarity, but zero-cost).
export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

function normalizeKeywords(terms: string[]): string {
  return terms.map((t) => t.trim().toLowerCase()).filter(Boolean).join(" ");
}

function rowToCandidate(r: {
  title: string; supplierName: string; priceUsd: number | null; priceInr: number | null;
  reviews: number; rating: number; country: string; url: string; image: string; platform: string;
}): RankCandidate {
  return {
    name: r.supplierName || "Supplier",
    title: r.title,
    priceUsd: r.priceUsd,
    priceInr: r.priceInr,
    reviews: r.reviews || null,
    rating: r.rating || null,
    country: r.country,
    url: r.url,
    image: r.image,
    platform: r.platform,
  };
}

export interface CacheQuery {
  queryHash?: string; // hash of the exact query/link/image that's being searched
  keywords?: string[]; // search terms (from OpenRouter or the product name)
  imageHash?: string; // hash of the uploaded image bytes
}

// TIER 2 — try to satisfy a search from the cache. Returns [] on a miss (fewer
// than MIN_CACHE_HITS matches) so the caller falls back to the live API.
export async function lookupCache(q: CacheQuery): Promise<RankCandidate[]> {
  try {
    // 1) Exact query hash — the same link/image/query searched before.
    if (q.queryHash) {
      const exact = await prisma.cachedProduct.findMany({
        where: { queryHash: q.queryHash },
        orderBy: [{ priceUsd: "asc" }, { reviews: "desc" }],
        take: 20,
      });
      if (exact.length >= MIN_CACHE_HITS) {
        await bump(exact.map((r) => r.id));
        return exact.map(rowToCandidate);
      }
    }

    // 2) Image hash — the same photo re-uploaded (different wrapping query).
    if (q.imageHash) {
      const byImg = await prisma.cachedProduct.findMany({
        where: { imageHash: q.imageHash },
        orderBy: [{ priceUsd: "asc" }, { reviews: "desc" }],
        take: 20,
      });
      if (byImg.length >= MIN_CACHE_HITS) {
        await bump(byImg.map((r) => r.id));
        return byImg.map(rowToCandidate);
      }
    }

    // 3) Keyword / title text — cached products whose title OR stored keywords
    //    contain the search terms. Requires ALL terms to appear (AND) for
    //    precision, matched case-insensitively against title + keywords.
    const terms = (q.keywords ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 2);
    if (terms.length) {
      const byText = await prisma.cachedProduct.findMany({
        where: {
          AND: terms.map((t) => ({
            OR: [
              { title: { contains: t, mode: "insensitive" as const } },
              { keywords: { contains: t, mode: "insensitive" as const } },
            ],
          })),
        },
        orderBy: [{ priceUsd: "asc" }, { reviews: "desc" }],
        take: 20,
      });
      if (byText.length >= MIN_CACHE_HITS) {
        await bump(byText.map((r) => r.id));
        return byText.map(rowToCandidate);
      }
    }

    return []; // cache miss → caller runs the live search
  } catch {
    return [];
  }
}

// TIER 1 — store live-search results so future searches can reuse them. Upserts on
// (platform + url) so re-fetching the same product refreshes rather than duplicates.
export async function saveToCache(
  suppliers: RankCandidate[],
  q: CacheQuery
): Promise<void> {
  if (!suppliers.length) return;
  const keywords = normalizeKeywords(q.keywords ?? []);
  try {
    await Promise.all(
      suppliers.map((s) => {
        const dedupeKey = `${s.platform}::${s.url || s.title}`.slice(0, 500);
        const data = {
          queryHash: q.queryHash ?? "",
          keywords,
          imageHash: q.imageHash ?? "",
          title: s.title ?? "",
          supplierName: s.name ?? "",
          priceUsd: s.priceUsd ?? null,
          priceInr: s.priceInr ?? null,
          reviews: s.reviews ?? 0,
          rating: s.rating ?? 0,
          country: s.country ?? "",
          url: s.url ?? "",
          image: s.image ?? "",
          platform: s.platform ?? "",
        };
        return prisma.cachedProduct.upsert({
          where: { dedupeKey },
          create: { ...data, dedupeKey },
          // On refresh, keep the newest data and merge in the latest query tags.
          update: { ...data },
        });
      })
    );
  } catch {
    /* caching is best-effort — never fail the search because caching failed */
  }
}

async function bump(ids: string[]): Promise<void> {
  try {
    await prisma.cachedProduct.updateMany({
      where: { id: { in: ids } },
      data: { hitCount: { increment: 1 } },
    });
  } catch {
    /* non-critical */
  }
}
