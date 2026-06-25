// Products collection API.
//   GET  /api/products → list all products (oldest first, matching the UI order)
//   POST /api/products → create a product from a full product object

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { productToRow } from "@/lib/api-map";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";

// Always hit the DB fresh; this data changes constantly.
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  try {
    const products = await prisma.product.findMany({ orderBy: { createdAt: "asc" } });
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
