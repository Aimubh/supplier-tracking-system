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
