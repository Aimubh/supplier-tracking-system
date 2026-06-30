// Single-product API.
//   GET    /api/products/:id → the FULL product incl. base64 media (lazy load)
//   PATCH  /api/products/:id → replace the product with a full updated object
//   DELETE /api/products/:id → remove the product

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { productToRow } from "@/lib/api-map";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// Fetch one product with all its data (media included). The store calls this to
// lazily load the full record after the light list, so heavy media only loads
// for the product the user actually opens.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  try {
    const product = await prisma.product.findUnique({ where: { id: params.id } });
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(product);
  } catch {
    return NextResponse.json({ error: "Failed to load product" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  try {
    const body = await req.json();
    // FLAGS-ONLY update: when the body carries just the filed/filedAt toggle (used
    // for file/reopen on light, media-stripped products), update ONLY those columns
    // — never rebuild the JSON slices, which would wipe media with defaults.
    const keys = Object.keys(body).filter((k) => k !== "id");
    const isFlagsOnly = keys.length > 0 && keys.every((k) => k === "filed" || k === "filedAt");
    if (isFlagsOnly) {
      const data: Record<string, unknown> = {};
      if (typeof body.filed === "boolean") data.filed = body.filed;
      if ("filedAt" in body) data.filedAt = body.filedAt ? new Date(body.filedAt as number) : null;
      const updated = await prisma.product.update({ where: { id: params.id }, data });
      return NextResponse.json(updated);
    }
    const updated = await prisma.product.update({
      where: { id: params.id },
      data: productToRow(body),
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  try {
    await prisma.product.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
