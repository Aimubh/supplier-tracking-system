// Single-product API.
//   PATCH  /api/products/:id → replace the product with a full updated object
//   DELETE /api/products/:id → remove the product

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { productToRow } from "@/lib/api-map";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

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
