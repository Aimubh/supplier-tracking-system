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

const VENDEX = process.env.VENDEX_API_URL ?? "http://127.0.0.1:8001";
const VENDEX_TOKEN = process.env.VENDEX_API_TOKEN ?? "";
const POLL_TIMEOUT_MS = 120_000; // give the scraper up to 2 minutes
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

  // 1) Submit the job.
  let jobId = "";
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
    return NextResponse.json({ error: "The scrape failed (the source may have blocked it)." }, { status: 502 });
  }
  if (status !== "complete") {
    return NextResponse.json(
      { error: "The scrape timed out — Alibaba likely blocked it. Try again or enter details manually." },
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
  });
}
