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
import { suggestSearchQueries, openRouterConfigured } from "@/lib/openrouter";

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

  // (HSN matching runs on the product text directly — fast, offline, no API.)
  void imageUrl;

  let text = `${name} ${description}`.trim();
  if (!text && !material) {
    return NextResponse.json({ error: "Provide a product name or description." }, { status: 400 });
  }

  // Enrich with the free OpenRouter (Tencent) model: it suggests the material and
  // extra keywords, which sharpen the offline HSN keyword match — especially when
  // the product name alone is vague. Best-effort; never blocks the response.
  let aiHint: { keywords: string[]; hsn: string; material: string } | null = null;
  if (openRouterConfigured()) {
    aiHint = await suggestSearchQueries(name || text, description);
    if (aiHint) {
      if (!material && aiHint.material) material = aiHint.material;
      // Fold the AI keywords into the text so suggestHsn has more signal.
      if (aiHint.keywords.length) text = `${text} ${aiHint.keywords.join(" ")}`.trim();
    }
  }

  const candidates = suggestHsn(text, material, 3);
  if (candidates.length === 0) {
    return NextResponse.json({
      candidates: [],
      aiKeywords: aiHint?.keywords ?? [],
      aiHsn: aiHint?.hsn ?? "",
      note: "No confident HSN match — describe the product's material and use, then retry or check ICEGATE.",
    });
  }

  return NextResponse.json({
    candidates,
    aiKeywords: aiHint?.keywords ?? [], // free-model Alibaba search terms
    aiHsn: aiHint?.hsn ?? "", // free-model's own HSN guess (for cross-check)
    note: "Advisory only — confirm the correct code + current rate on ICEGATE / with your CHA before ordering.",
  });
}
