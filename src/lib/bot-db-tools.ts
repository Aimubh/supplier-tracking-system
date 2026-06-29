// Read-only database query helpers for the Telegram Q&A bot.
//
// These are the ONLY ways the AI can touch the database. Every function READS
// (findMany/aggregate) — none mutate. The AI never writes raw SQL; it calls
// these curated functions, so it cannot write, delete, or leak arbitrary data.
// All access goes through Prisma against the existing Product/Manufacturer tables.

import { prisma } from "./db";

// The pipeline phase a product is in, derived from its JSON slices. Mirrors the
// done-flags in src/lib/flow.ts but reads defensively (raw rows may omit fields).
type Phase = "pre-order" | "on-working" | "post-order" | "done";

function j(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

interface RawProduct {
  id: string; name: string; category: string; filed: boolean;
  createdAt: Date; updatedAt: Date;
  market: unknown; supplier: unknown; compliance: unknown; costing: unknown;
  working: unknown; logistics: unknown; expenses: unknown; payments: unknown;
}

// Derive the current phase + progress for a raw product row.
function phaseOf(p: RawProduct): { phase: Phase; percent: number; nextStep: string } {
  const w = j(p.working), l = j(p.logistics), c = j(p.compliance), s = j(p.supplier);
  const steps: { label: string; done: boolean; phase: Phase }[] = [
    { label: "Market check", done: arr(p.market).length > 0, phase: "pre-order" },
    { label: "Vet supplier", done: s.verification === "VERIFIED", phase: "pre-order" },
    { label: "Compliance", done: c.status === "CLEARED", phase: "pre-order" },
    { label: "Product decision", done: w.sampleResult === "APPROVED" && num(w.moq) > 0 && num(w.rateValue) > 0, phase: "on-working" },
    { label: "Design processing", done: w.packagingResult === "APPROVED" && !!w.orderProcessing, phase: "on-working" },
    { label: "Dispatch", done: !!w.dispatched, phase: "on-working" },
    { label: "Dispatch & docs", done: !!l.mLoadedToShip && !!l.blNumber, phase: "post-order" },
    { label: "Customs clearance", done: !!l.arrived && !!l.outOfCharge, phase: "post-order" },
    { label: "Arrival & GRN", done: !!l.handedToInventory, phase: "post-order" },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);
  const next = steps.find((x) => !x.done);
  const phase: Phase = next ? next.phase : "done";
  return { phase, percent, nextStep: next ? next.label : "Complete" };
}

// Order value + paid + expenses for a raw product (in its product currency).
function moneyOf(p: RawProduct): { qty: number; orderValue: number; advancePaid: number; expenses: number; currency: string } {
  const w = j(p.working), e = j(p.expenses), l = j(p.logistics);
  const orderValue = num(w.rateValue);
  const advancePaid = Math.min(num(w.advancePaid), orderValue);
  const expenseFields = ["oceanFreight", "doCharge", "thcCharge", "cfsCharge", "wgmtCharge", "gstCharge", "dutyActual", "chaCharges", "lastMileCost", "otherExpense"];
  const expenses = expenseFields.reduce((sum, k) => sum + num(e[k]), 0) + num(l.indiaTransportCost);
  return { qty: num(w.moq), orderValue, advancePaid, expenses, currency: String(w.rateCurrency ?? "INR") };
}

const PRODUCT_SELECT = {
  id: true, name: true, category: true, filed: true, createdAt: true, updatedAt: true,
  market: true, supplier: true, compliance: true, costing: true,
  working: true, logistics: true, expenses: true, payments: true,
} as const;

// ---- TOOL IMPLEMENTATIONS ----------------------------------------------------

// Count / list active products, optionally filtered by phase or category.
export async function listProducts(opts: { phase?: Phase; category?: string; includeFiled?: boolean } = {}) {
  const rows = (await prisma.product.findMany({
    where: { filed: opts.includeFiled ? undefined : false },
    select: PRODUCT_SELECT,
    orderBy: { createdAt: "desc" },
  })) as RawProduct[];

  let items = rows.map((p) => {
    const f = phaseOf(p);
    return { id: p.id, name: p.name, category: p.category || "—", phase: f.phase, percent: f.percent, nextStep: f.nextStep };
  });
  if (opts.phase) items = items.filter((x) => x.phase === opts.phase);
  if (opts.category) items = items.filter((x) => x.category.toLowerCase().includes(opts.category!.toLowerCase()));
  return { count: items.length, products: items.slice(0, 50) };
}

// Full detail for one product by (partial, case-insensitive) name or id.
export async function getProduct(nameOrId: string) {
  const rows = (await prisma.product.findMany({ select: PRODUCT_SELECT })) as RawProduct[];
  const q = nameOrId.toLowerCase().trim();
  const p = rows.find((r) => r.id === nameOrId) ?? rows.find((r) => r.name.toLowerCase().includes(q));
  if (!p) return { found: false, message: `No product matching "${nameOrId}".` };
  const f = phaseOf(p), m = moneyOf(p), c = j(p.compliance), s = j(p.supplier), l = j(p.logistics);
  return {
    found: true,
    name: p.name, category: p.category || "—", filed: p.filed,
    phase: f.phase, percent: f.percent, nextStep: f.nextStep,
    supplier: String(s.name ?? "—"), supplierVerified: s.verification === "VERIFIED",
    hsCode: String(c.hsCode ?? "—"), complianceStatus: String(c.status ?? "—"),
    quantity: m.qty, orderValue: m.orderValue, advancePaid: m.advancePaid, expenses: m.expenses, currency: m.currency,
    eta: String(l.eta ?? "—"), arrived: !!l.handedToInventory,
    updatedAt: p.updatedAt.toISOString().slice(0, 10),
  };
}

// Portfolio financial totals across active products (sums in each product's own
// currency — noted per item; a mixed-currency caveat is returned).
export async function financialSummary() {
  const rows = (await prisma.product.findMany({ where: { filed: false }, select: PRODUCT_SELECT })) as RawProduct[];
  const byCurrency: Record<string, { orderValue: number; paid: number; expenses: number; count: number }> = {};
  for (const p of rows) {
    const m = moneyOf(p);
    const b = (byCurrency[m.currency] ??= { orderValue: 0, paid: 0, expenses: 0, count: 0 });
    b.orderValue += m.orderValue; b.paid += m.advancePaid; b.expenses += m.expenses; b.count++;
  }
  return {
    activeProducts: rows.length,
    byCurrency,
    note: "Totals are grouped by each product's own currency (not converted). Landed cost ≈ orderValue + expenses.",
  };
}

// Counts of products in each phase — a quick pipeline overview.
export async function pipelineOverview() {
  const rows = (await prisma.product.findMany({ where: { filed: false }, select: PRODUCT_SELECT })) as RawProduct[];
  const counts: Record<string, number> = { "pre-order": 0, "on-working": 0, "post-order": 0, done: 0 };
  for (const p of rows) counts[phaseOf(p).phase]++;
  return { activeProducts: rows.length, byPhase: counts };
}

// Compact, READ-ONLY snapshot of ALL active products + manufacturers, sized to
// fit in an LLM context for one-shot Q&A. Strips base64/media; keeps the facts a
// question might need. Safe: pure reads, no raw SQL, no secrets.
export async function dataSummary() {
  const [prodRows, manRows] = await Promise.all([
    prisma.product.findMany({ where: { filed: false }, select: PRODUCT_SELECT, orderBy: { createdAt: "desc" } }) as Promise<RawProduct[]>,
    prisma.manufacturer.findMany({
      select: {
        id: true, name: true, type: true, verification: true, city: true,
        productLines: true, repName: true, repNumber: true, website: true, moq: true, rating: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const products = prodRows.map((p) => {
    const f = phaseOf(p), m = moneyOf(p), c = j(p.compliance), s = j(p.supplier), l = j(p.logistics);
    return {
      name: p.name,
      category: p.category || "—",
      phase: f.phase,
      progressPct: f.percent,
      nextStep: f.nextStep,
      supplier: String(s.name ?? "—"),
      supplierVerified: s.verification === "VERIFIED",
      hsCode: String(c.hsCode ?? "—"),
      compliance: String(c.status ?? "—"),
      quantity: m.qty,
      orderValue: m.orderValue,
      advancePaid: m.advancePaid,
      expenses: m.expenses,
      currency: m.currency,
      eta: String(l.eta ?? "—"),
      arrivedInInventory: !!l.handedToInventory,
      lastUpdated: p.updatedAt.toISOString().slice(0, 10),
    };
  });

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    activeProductCount: products.length,
    products,
    manufacturerCount: manRows.length,
    manufacturers: manRows,
  };
}

// Search manufacturers/suppliers by name, city, type, or product lines. Returns
// only useful text fields — base64 images/catalogs are stripped (huge + useless
// in an AI context).
export async function searchManufacturers(query: string) {
  const rows = await prisma.manufacturer.findMany({
    select: {
      id: true, name: true, type: true, verification: true, city: true,
      productLines: true, repName: true, repNumber: true, website: true,
      moq: true, rating: true, notes: true,
    },
    orderBy: { name: "asc" },
  });
  const q = query.toLowerCase().trim();
  const matches = (q
    ? rows.filter((m) => JSON.stringify(m).toLowerCase().includes(q))
    : rows
  ).slice(0, 25);
  return { count: matches.length, manufacturers: matches };
}
