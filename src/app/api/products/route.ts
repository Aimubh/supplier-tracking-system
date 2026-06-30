// Products collection API.
//   GET  /api/products          → full list (all data incl. base64 media)
//   GET  /api/products?light=1  → LIGHT list: media base64 stripped (huge payload
//                                 reduction). Each product keeps one tiny thumbnail
//                                 + a `_light: true` flag; full media loads lazily
//                                 via GET /api/products/:id. Scales to many products.
//   POST /api/products → create a product from a full product object

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { productToRow } from "@/lib/api-map";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";

// Always hit the DB fresh; this data changes constantly.
export const dynamic = "force-dynamic";

// Drop the heavy base64 payload from a media array, keeping only lightweight
// metadata (id/kind/fileName) so counts + types still render. `hasData` flags
// that real bytes exist on the server (loaded lazily via /api/products/:id).
function stripMediaArray(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((m) => {
    if (!m || typeof m !== "object") return m;
    const { data, ...rest } = m as Record<string, unknown>;
    return { ...rest, data: "", hasData: typeof data === "string" && data.length > 0 };
  });
}

// Produce a LIGHT version of a product: every base64-bearing field is emptied
// (no thumbnails embedded either — those are full-size and would defeat the
// purpose). All the SCALAR fields the list views need (name, category, money,
// phase flags, dates) are preserved. Full media loads lazily per product.
function toLight(p: Record<string, unknown>): Record<string, unknown> {
  const working = { ...(p.working as Record<string, unknown> | null ?? {}) };
  const hasPhoto =
    (Array.isArray(working.productMedia) && (working.productMedia as unknown[]).some(
      (m) => m && typeof m === "object" && typeof (m as Record<string, unknown>).data === "string" && ((m as Record<string, unknown>).data as string).length > 0
    )) || (typeof working.productImage === "string" && (working.productImage as string).length > 0);

  working.productMedia = stripMediaArray(working.productMedia);
  working.sampleMedia = stripMediaArray(working.sampleMedia);
  working.packagingMedia = stripMediaArray(working.packagingMedia);
  working.productImage = "";
  working.sampleImage = "";

  const logistics = { ...(p.logistics as Record<string, unknown> | null ?? {}) };
  logistics.docImages = stripMediaArray(logistics.docImages);

  return {
    ...p,
    working,
    logistics,
    _hasPhoto: hasPhoto, // dashboard shows a "has image" hint; real img loads on open
    _light: true, // media stripped — load the full record before editing/saving
  };
}

export async function GET(req: Request) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  const light = new URL(req.url).searchParams.get("light") === "1";
  try {
    const products = await prisma.product.findMany({ orderBy: { createdAt: "asc" } });
    if (light) {
      return NextResponse.json(products.map((p) => toLight(p as Record<string, unknown>)));
    }
    return NextResponse.json(products);
  } catch {
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  try {
    const body = await req.json();
    const data = productToRow(body);
    // Honour a client-provided id if present so optimistic UI ids stick.
    const created = await prisma.product.create({
      data: body.id ? { id: String(body.id), ...data } : data,
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}
