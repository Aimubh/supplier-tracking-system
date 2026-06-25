// Single-manufacturer API.
//   PATCH  /api/manufacturers/:id → replace with a full updated object
//   DELETE /api/manufacturers/:id → remove the company

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { manufacturerToRow } from "@/lib/api-map";
import { requireTabAccess, MANUFACTURER_TABS } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const denied = await requireTabAccess(MANUFACTURER_TABS);
  if (denied) return denied;
  try {
    const body = await req.json();
    const updated = await prisma.manufacturer.update({
      where: { id: params.id },
      data: manufacturerToRow(body),
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const denied = await requireTabAccess(MANUFACTURER_TABS);
  if (denied) return denied;
  try {
    await prisma.manufacturer.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete company" }, { status: 500 });
  }
}
