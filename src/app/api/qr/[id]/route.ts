// PUBLIC product view for a scanned QR — no auth (anyone with the QR can view).
//   GET /api/qr/<id>
// Returns ONLY the display fields + media the scan page needs (no costing, no
// payments, no internal pipeline data). Read-only.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function j(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

interface MediaItem { id: string; kind: string; fileName: string; fileType: string; data: string }
function mediaOf(v: unknown): MediaItem[] {
  return Array.isArray(v) ? (v as MediaItem[]).filter((m) => m && typeof m.data === "string") : [];
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const p = await prisma.product.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, category: true, working: true, supplier: true, qrGen: true },
    });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const w = j(p.working);
    const s = j(p.supplier);
    const g = j((p as Record<string, unknown>).qrGen);
    const media = mediaOf(w.productMedia);

    return NextResponse.json({
      id: p.id,
      name: p.name,
      category: p.category || "",
      supplier: String(s.name ?? g.supplierName ?? ""),
      supplierState: String(g.supplierState ?? ""),
      owner: String(g.ownerName ?? ""),
      moq: num(w.moq) || num(g.moq),
      rate: num(w.rateValue) || num(g.rate),
      rateCurrency: String(w.rateCurrency ?? g.rateCurrency ?? "INR"),
      sampleCharges: num(g.sampleCharges),
      sampleCurrency: String(g.sampleCurrency ?? "INR"),
      orderDate: String(g.orderDate ?? w.productionStart ?? ""),
      receivedDate: String(g.receivedDate ?? ""),
      media: media.map((m) => ({ kind: m.kind, fileType: m.fileType, fileName: m.fileName, data: m.data })),
    });
  } catch {
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
