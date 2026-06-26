// Image-upload → supplier search bridge.
//   POST /api/sourcing/fetch-image   (multipart form: file=<image>)
// Hosts the uploaded product photo on a public CDN (catbox.moe — same host the
// Vendex pipeline uses), then asks the Vendex /process/image endpoint to image-
// search Alibaba and return the top supplier. Faster + more reliable than reels:
// it skips video download and frame extraction entirely.

import { NextResponse } from "next/server";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";
import { enrichScraped, type ScrapedProduct } from "@/lib/sourcing-enrich";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VENDEX = process.env.VENDEX_API_URL ?? "http://127.0.0.1:8001";
const VENDEX_TOKEN = process.env.VENDEX_API_TOKEN ?? "";
const POLL_TIMEOUT_MS = 90_000;
const POLL_EVERY_MS = 2_500;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

function authHeaders(): Record<string, string> {
  return VENDEX_TOKEN
    ? { Authorization: `Bearer ${VENDEX_TOKEN}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Upload bytes to catbox.moe (public, no key) → returns a public image URL.
async function hostImage(bytes: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", bytes, filename || "upload.jpg");
  const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//i.test(text)) {
    throw new Error("Image host rejected the upload");
  }
  return text;
}

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
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Please upload an image file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 8 MB)." }, { status: 400 });
  }

  // 2) Host it publicly so Alibaba's image search can fetch it.
  let imageUrl = "";
  try {
    imageUrl = await hostImage(file, file.name);
  } catch {
    return NextResponse.json({ error: "Couldn't host the image. Try again." }, { status: 502 });
  }

  // 3) Kick off the Vendex image-search job.
  let jobId = "";
  try {
    const res = await fetch(`${VENDEX}/api/v1/process/image`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ image_url: imageUrl, label }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Vendex rejected the search (${res.status}). Is the scraper service running?` },
        { status: 502 }
      );
    }
    jobId = String((await res.json()).job_id ?? "");
  } catch {
    return NextResponse.json(
      { error: "Could not reach the Vendex service. Start it and try again." },
      { status: 502 }
    );
  }
  if (!jobId) return NextResponse.json({ error: "No job id returned." }, { status: 502 });

  // 4) Poll to completion.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status = "queued";
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    try {
      const r = await fetch(`${VENDEX}/api/v1/jobs/${jobId}`, { headers: authHeaders() });
      if (!r.ok) continue;
      status = String((await r.json()).status ?? "");
      if (status === "complete" || status === "failed") break;
    } catch {
      /* transient */
    }
  }
  if (status === "failed") {
    // Surface the real reason if we can read it (e.g. RapidAPI quota).
    let reason = "Image search failed.";
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
    return NextResponse.json(
      { error: "Still searching — try again in a moment.", jobId, stillRunning: true },
      { status: 504 }
    );
  }

  // 5) Pull the top supplier and enrich.
  let suppliers: ScrapedProduct[] = [];
  try {
    const r = await fetch(`${VENDEX}/api/v1/suppliers?job_id=${jobId}`, { headers: authHeaders() });
    const data = await r.json();
    suppliers = Array.isArray(data) ? data : data.suppliers ?? [];
  } catch {
    return NextResponse.json({ error: "Search done but suppliers couldn't load." }, { status: 502 });
  }
  if (suppliers.length === 0) {
    return NextResponse.json({ error: "No matching suppliers found for that image." }, { status: 404 });
  }

  const top = suppliers[0];
  const enriched = enrichScraped(top);

  // Lens fallback gives RETAIL prices, not Alibaba wholesale FOB — warn so the
  // FOB field isn't mistaken for a factory quote.
  const isRetail = top.platform === "google_lens";

  return NextResponse.json({
    jobId,
    supplierCount: suppliers.length,
    lowConfidence: isRetail,
    note: isRetail
      ? "Shown from Google Lens (retail prices, not Alibaba wholesale FOB) — Alibaba data API quota is out. Treat FOB as approximate."
      : "",
    inputs: enriched.inputs,
    flags: enriched.flags,
    raw: {
      supplierName: (top as Record<string, unknown>).supplierName ?? "",
      country: top.country ?? "",
      productUrl: (top as Record<string, unknown>).productUrl ?? "",
      productImageUrl: top.productImageUrl ?? imageUrl,
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
