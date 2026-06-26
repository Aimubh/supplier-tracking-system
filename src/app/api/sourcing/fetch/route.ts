// Bridge to the Vendex scraper backend.
//   POST /api/sourcing/fetch  { url }
// Submits the pasted Instagram/Alibaba link to the Vendex FastAPI service, polls
// the job to completion, picks the top-ranked supplier, enriches it (HSN/weight/
// colour guesses), and returns partial Sourcing inputs ready to fill the model.
//
// Vendex runs as a SEPARATE service (Python + Playwright). It is fragile by
// nature — scrapes can hang on CAPTCHAs or return placeholder rows — so this
// route is defensive: it times out, flags low-confidence/empty results, and
// never throws raw scraper internals at the client.

import { NextResponse } from "next/server";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";
import { enrichScraped, type ScrapedProduct } from "@/lib/sourcing-enrich";

export const dynamic = "force-dynamic";
// Reel jobs (download → frame → Gemini → image search) can take ~60-120s. Allow
// the route to run long enough to see them through.
export const maxDuration = 180;

const VENDEX = process.env.VENDEX_API_URL ?? "http://127.0.0.1:8001";
const VENDEX_TOKEN = process.env.VENDEX_API_TOKEN ?? "";
const POLL_TIMEOUT_MS = 160_000; // reel pipeline can take ~2 min
const POLL_EVERY_MS = 3_000;

function authHeaders(): Record<string, string> {
  return VENDEX_TOKEN
    ? { Authorization: `Bearer ${VENDEX_TOKEN}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;

  let url = "";
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Paste a valid http(s) link." }, { status: 400 });
  }

  // 0) If a job for this exact URL already completed, reuse it instantly — so
  // clicking "Fetch" again after a slow reel picks up the finished result rather
  // than kicking off another ~2-min scrape.
  let jobId = "";
  try {
    const r = await fetch(`${VENDEX}/api/v1/jobs?limit=20`, { headers: authHeaders() });
    if (r.ok) {
      const data = await r.json();
      const jobs = Array.isArray(data) ? data : data.jobs ?? [];
      const done = jobs.find(
        (j: Record<string, unknown>) =>
          j.status === "complete" &&
          (j.reelUrl === url || j.reel_url === url) &&
          Number(j.resultCount ?? j.result_count ?? 0) > 0
      );
      if (done) jobId = String(done.id ?? "");
    }
  } catch {
    // ignore — fall through to submitting a fresh job
  }

  // 1) Submit a new job only if we didn't find a completed one.
  if (!jobId) {
    try {
      const res = await fetch(`${VENDEX}/api/v1/process`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ reel_url: url }),
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Vendex rejected the job (${res.status}). Is the scraper service running?` },
          { status: 502 }
        );
      }
      const data = await res.json();
      jobId = String(data.job_id ?? "");
    } catch {
      return NextResponse.json(
        { error: "Could not reach the Vendex scraper service. Start it and try again." },
        { status: 502 }
      );
    }
  }
  if (!jobId) {
    return NextResponse.json({ error: "Vendex did not return a job id." }, { status: 502 });
  }

  // 2) Poll until complete / failed / timeout.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status = "queued";
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    try {
      const r = await fetch(`${VENDEX}/api/v1/jobs/${jobId}`, { headers: authHeaders() });
      if (!r.ok) continue;
      const j = await r.json();
      status = String(j.status ?? "");
      if (status === "complete" || status === "failed") break;
    } catch {
      // transient — keep polling
    }
  }
  if (status === "failed") {
    let reason = "The scrape failed (the source may have blocked it).";
    try {
      const r = await fetch(`${VENDEX}/api/v1/jobs/${jobId}`, { headers: authHeaders() });
      const j = await r.json();
      const msg = String(j.errorMessage ?? j.error_message ?? "");
      if (/quota|exceeded/i.test(msg)) {
        reason = "Alibaba data API monthly quota is used up — upgrade the RapidAPI plan or wait for the reset.";
      }
    } catch {
      /* keep generic */
    }
    return NextResponse.json({ error: reason }, { status: 502 });
  }
  if (status !== "complete") {
    // Reel jobs are slow; a timeout usually means it's STILL running, not blocked.
    // Return the jobId so the client can retry/poll rather than implying failure.
    return NextResponse.json(
      {
        error:
          "Still working on it — reels take ~1-2 min. It may finish shortly; click Fetch again in a moment to pick up the result.",
        jobId,
        stillRunning: true,
      },
      { status: 504 }
    );
  }

  // 3) Fetch suppliers, pick the top-ranked.
  let suppliers: ScrapedProduct[] = [];
  try {
    const r = await fetch(`${VENDEX}/api/v1/suppliers?job_id=${jobId}`, { headers: authHeaders() });
    const data = await r.json();
    suppliers = Array.isArray(data) ? data : data.suppliers ?? [];
  } catch {
    return NextResponse.json({ error: "Scrape completed but suppliers couldn't be loaded." }, { status: 502 });
  }
  if (suppliers.length === 0) {
    return NextResponse.json({ error: "No suppliers found for that link." }, { status: 404 });
  }

  // Top supplier = best matchScore (the Vendex API already ranks; take the first).
  const top = suppliers[0];

  // Detect the hollow placeholder row Vendex returns when a scrape is blocked.
  const looksEmpty =
    (!top.productName || top.productName.toLowerCase().startsWith("product #")) &&
    (!top.unitPriceUSD || top.unitPriceUSD === 0);

  const enriched = enrichScraped(top);

  return NextResponse.json({
    jobId,
    supplierCount: suppliers.length,
    lowConfidence: looksEmpty,
    note: looksEmpty
      ? "The scraper returned placeholder data (likely blocked). Verify or enter details manually."
      : "",
    inputs: enriched.inputs,
    flags: enriched.flags,
    raw: {
      supplierName: (top as Record<string, unknown>).supplierName ?? "",
      country: top.country ?? "",
      productUrl: (top as Record<string, unknown>).productUrl ?? "",
      productImageUrl: top.productImageUrl ?? "",
    },
    suppliers: mapSupplierList(suppliers),
  });
}

// Compact, UI-friendly list of suppliers so the user can click through and
// verify each result themselves.
function mapSupplierList(suppliers: ScrapedProduct[]) {
  return suppliers.slice(0, 20).map((s) => {
    const r = s as Record<string, unknown>;
    return {
      name: String(r.supplierName ?? "Supplier"),
      title: String(r.productName ?? ""),
      priceUsd: (r.unitPriceUSD as number) ?? null,
      priceInr: (r.unitPriceINR as number) ?? null,
      reviews: (r.reviewCount as number) ?? null,
      rating: (r.rating as number) ?? null,
      country: String(r.country ?? ""),
      url: String(r.productUrl ?? ""),
      image: String(r.productImageUrl ?? ""),
      platform: String(r.platform ?? ""),
    };
  });
}
