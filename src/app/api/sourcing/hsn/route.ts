// HSN advisor endpoint.
//   POST /api/sourcing/hsn   { name, description, material?, imageUrl? }
// Returns the top-3 candidate HSN codes ranked by fit, each with duty (BCD+SWS)
// and GST. If an imageUrl is given and Gemini (via Vendex) is available, it first
// extracts the material/product so the match is sharper; otherwise it matches on
// the provided text alone.
//
// Advisory only — the correct HSN is the one that truly describes the goods;
// confirm on ICEGATE / with a CHA before ordering.

import { NextResponse } from "next/server";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";
import { suggestHsn } from "@/lib/hsn-advisor";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(req: Request) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;

  let name = "";
  let description = "";
  let material = "";
  let imageUrl = "";
  try {
    const body = await req.json();
    name = String(body.name ?? "").trim();
    description = String(body.description ?? "").trim();
    material = String(body.material ?? "").trim();
    imageUrl = String(body.imageUrl ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Optionally enrich from the image via Vendex/Gemini to get a cleaner product
  // name + material when the text is sparse.
  if (imageUrl && (!name || !material)) {
    try {
      const VENDEX = process.env.VENDEX_API_URL ?? "http://127.0.0.1:8001";
      const token = process.env.VENDEX_API_TOKEN ?? "";
      const r = await fetch(`${VENDEX}/api/v1/market-size`, {
        method: "POST",
        headers: token
          ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
          : { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
        signal: AbortSignal.timeout(20_000),
      });
      // market-size doesn't give material; this is a best-effort hook only.
      void r;
    } catch {
      /* best effort */
    }
  }

  const text = `${name} ${description}`.trim();
  if (!text && !material) {
    return NextResponse.json({ error: "Provide a product name or description." }, { status: 400 });
  }

  const candidates = suggestHsn(text, material, 3);
  if (candidates.length === 0) {
    return NextResponse.json({
      candidates: [],
      note: "No confident HSN match — describe the product's material and use, then retry or check ICEGATE.",
    });
  }

  return NextResponse.json({
    candidates,
    note: "Advisory only — confirm the correct code + current rate on ICEGATE / with your CHA before ordering.",
  });
}
