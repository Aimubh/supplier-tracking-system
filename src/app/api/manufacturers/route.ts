// Manufacturers (directory) collection API.
//   GET  /api/manufacturers → list all (newest first, matching the directory UI)
//   POST /api/manufacturers → create from a full manufacturer object

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { manufacturerToRow } from "@/lib/api-map";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.manufacturer.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: "Failed to load directory" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = manufacturerToRow(body);
    const created = await prisma.manufacturer.create({
      data: body.id ? { id: String(body.id), ...data } : data,
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create company" }, { status: 500 });
  }
}
