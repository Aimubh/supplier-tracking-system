"use client";

// Read-only "View" modal opened from a dashboard row. Shows the real-time data
// that was actually filled for one product across every phase — Pre-Order,
// On-Working and Post-Order — pulled live from the store. Nothing here is
// editable; it's a faithful snapshot of what the team has entered so far.
//
// Layout goal: readability. Data is split into phase tabs so you're never
// scrolling one long wall, and every field is a label-left / value-right row
// that reads like a printed spec sheet.

import { useState } from "react";
import clsx from "clsx";
import { useStore, type MediaItem, type CurrencyCode } from "@/lib/store";
import { computeCosting } from "@/lib/costing";
import { getFlow, type PhaseKey } from "@/lib/flow";
import { motion, AnimatePresence, useReducedMotion } from "./motion";
import {
  X,
  Boxes,
  Building2,
  ShieldCheck,
  Calculator,
  FlaskConical,
  Truck,
  FileText,
  ImageIcon,
  CheckCircle2,
  Check,
  Minus,
} from "lucide-react";

type Tone = "go" | "block" | "pending" | "muted";

interface Field {
  label: string;
  value: string;
  tone?: Tone;
  /** render the value as a status chip rather than plain text */
  chip?: boolean;
}

const dash = (v: string | number) => (v === "" || v === 0 || v == null ? "—" : String(v));
const money = (n: number) => (n > 0 ? `$${n.toLocaleString()}` : "—");
const pct = (n: number) => (n ? `${n}%` : "—");
const CURRENCY_SYMBOL: Record<CurrencyCode, string> = { USD: "$", INR: "₹", CNY: "¥" };

// Build the total / paid / pending rows for one payment (product or shipment).
function payRows(name: string, total: number, advance: number, currency: CurrencyCode): Field[] {
  if (!total) return [];
  const sym = CURRENCY_SYMBOL[currency ?? "INR"];
  const adv = Math.min(advance ?? 0, total);
  const pending = Math.max(total - adv, 0);
  const pc = (n: number) => Math.round((n / total) * 100);
  return [
    { label: `${name} total`, value: `${sym}${total.toLocaleString()} ${currency}` },
    { label: `${name} paid`, value: `${sym}${adv.toLocaleString()} · ${pc(adv)}%`, tone: "go" },
    { label: `${name} pending`, value: `${sym}${pending.toLocaleString()} · ${pc(pending)}%`, tone: pending > 0 ? "pending" : "go" },
  ];
}

export function ProductViewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { products } = useStore();
  const reduce = useReducedMotion();
  const p = products.find((x) => x.id === id);
  const [tab, setTab] = useState<PhaseKey>("pre-order");

  if (!p) return null;
  const f = getFlow(p);
  const costing = computeCosting(p.costing, p.compliance.dutyRatePct, p.compliance.igstRatePct);
  const L = p.logistics;
  const w = p.working;

  // Media galleries, with legacy single-image fallback.
  const productMedia: MediaItem[] =
    w.productMedia?.length
      ? w.productMedia
      : w.productImage
        ? [{ id: "legacy-p", kind: "image", fileName: "image", fileType: "image/*", data: w.productImage }]
        : [];
  const sampleMedia: MediaItem[] =
    w.sampleMedia?.length
      ? w.sampleMedia
      : w.sampleImage
        ? [{ id: "legacy-s", kind: "image", fileName: "image", fileType: "image/*", data: w.sampleImage }]
        : [];
  const packagingMedia: MediaItem[] = w.packagingMedia ?? [];
  const heroImage = productMedia.find((m) => m.kind === "image")?.data;

  const yn = (b: boolean, on = "Yes", off = "No"): Omit<Field, "label"> => ({
    value: b ? on : off,
    tone: b ? "go" : "muted",
    chip: true,
  });

  // Top summary chips — the numbers people glance at first.
  const verdictTone: Tone =
    costing.verdict === "GO" ? "go" : costing.verdict === "NO_GO" ? "block" : "pending";
  const verdictText = costing.verdict === "GO" ? "GO" : costing.verdict === "NO_GO" ? "NO-GO" : "Pending";
  const capital = p.payments.filter((x) => x.status === "PAID").reduce((s, x) => s + x.amount, 0);

  const summary = [
    { label: "Progress", value: `${f.percent}%`, tone: f.percent === 100 ? ("go" as Tone) : undefined },
    { label: "Costing", value: verdictText, tone: verdictTone },
    { label: "Order qty", value: w.moq > 0 ? w.moq.toLocaleString() : "—" },
    { label: "Capital paid", value: capital > 0 ? `$${capital.toLocaleString()}` : "—" },
  ];

  // ---- Field groups per phase ----
  const preGroups: Group[] = [
    {
      icon: Building2,
      title: "Supplier",
      fields: [
        { label: "Name", value: dash(p.supplier.name) },
        { label: "Type", value: p.supplier.type.toLowerCase(), tone: "muted" },
        { label: "Contact", value: dash(p.supplier.contact) },
        {
          label: "Verification",
          value: p.supplier.verification.replace("_", " ").toLowerCase(),
          tone: p.supplier.verification === "VERIFIED" ? "go" : "pending",
          chip: true,
        },
        { label: "Notes", value: dash(p.supplier.notes) },
      ],
    },
    {
      icon: ShieldCheck,
      title: "Compliance",
      fields: [
        { label: "HS code", value: dash(p.compliance.hsCode) },
        { label: "Duty rate", value: pct(p.compliance.dutyRatePct) },
        { label: "IGST rate", value: pct(p.compliance.igstRatePct) },
        {
          label: "Licence",
          value: p.compliance.licenceRequired ? p.compliance.licenceStatus.toLowerCase() : "not required",
          tone: p.compliance.licenceStatus === "OBTAINED" || !p.compliance.licenceRequired ? "go" : "pending",
          chip: true,
        },
        {
          label: "Status",
          value: p.compliance.status === "CLEARED" ? "Cleared" : "Blocked",
          tone: p.compliance.status === "CLEARED" ? "go" : "block",
          chip: true,
        },
      ],
    },
    {
      icon: Calculator,
      title: "Costing",
      fields: [
        { label: "Marketplace", value: dash(p.costing.marketplace) },
        { label: "Selling price", value: money(p.costing.sellingPrice) },
        { label: "Ex-works", value: money(p.costing.exWorks) },
        { label: "Freight / unit", value: money(p.costing.freightPerUnit) },
        { label: "Referral", value: pct(p.costing.referralPct) },
        { label: "Fulfilment fee", value: money(p.costing.fulfilmentFee) },
        { label: "Ad (TACOS)", value: pct(p.costing.adPct) },
        { label: "Returns", value: pct(p.costing.returnPct) },
        { label: "Required margin", value: pct(p.costing.requiredMarginPct) },
        { label: "Landed cost", value: money(Math.round(costing.landedCost * 100) / 100) },
        {
          label: "Net margin",
          value: costing.verdict === "PENDING" ? "—" : `${costing.netMarginPct.toFixed(1)}%`,
          tone: costing.verdict === "GO" ? "go" : costing.verdict === "NO_GO" ? "block" : undefined,
        },
        { label: "Verdict", value: verdictText, tone: verdictTone, chip: true },
      ],
    },
  ];

  const workingFields: Field[] = [
    {
      label: "Sample result",
      value: w.sampleResult.toLowerCase(),
      tone: w.sampleResult === "APPROVED" ? "go" : w.sampleResult === "REJECTED" ? "block" : "pending",
      chip: true,
    },
  ];
  if (w.sampleResult === "REJECTED") workingFields.push({ label: "Reject reason", value: dash(w.rejectReason), tone: "block" });
  workingFields.push(
    { label: "Sample notes", value: dash(w.sampleNotes) },
    { label: "Order qty (MOQ)", value: w.moq > 0 ? w.moq.toLocaleString() : "—" },
    { label: "MOQ note", value: dash(w.moqNote) },
    { label: "Rate term", value: w.rateValue > 0 ? w.rate : "—" },
    ...payRows("Product", w.rateValue, w.advancePaid, w.rateCurrency),
    ...payRows("Shipment", w.shipmentValue, w.shipmentAdvance, w.shipmentCurrency),
    { label: "Mould required", ...yn(w.moldRequired, "Required", "Not required") },
    {
      label: "Logo / packaging",
      value: (w.packagingResult ?? "PENDING").toLowerCase(),
      tone: w.packagingResult === "APPROVED" ? "go" : w.packagingResult === "REJECTED" ? "block" : "pending",
      chip: true,
    },
    { label: "Order processing", ...yn(w.orderProcessing) },
    { label: "Production start", value: dash(w.productionStart) },
    { label: "Production ready", value: dash(w.productionReady) },
    { label: "Dispatched", ...yn(w.dispatched) },
  );
  if (w.packagingResult === "REJECTED" && w.packagingRejectReason)
    workingFields.push({ label: "Logo reject reason", value: dash(w.packagingRejectReason), tone: "block" });

  const onWorkingGroups: Group[] = [
    {
      icon: FlaskConical,
      title: "Production & sample",
      fields: workingFields,
      media: [...productMedia, ...sampleMedia, ...packagingMedia],
    },
    {
      icon: Calculator,
      title: "Payments",
      payments: p.payments,
    },
  ];

  const postGroups: Group[] = [
    {
      icon: Truck,
      title: "Shipment & movement",
      fields: [
        { label: "POL (origin)", value: dash(L.pol) },
        { label: "POD (destination)", value: dash(L.pod) },
        { label: "Packages", value: dash(L.packages) },
        { label: "Gross weight", value: L.grossWeightKg > 0 ? `${L.grossWeightKg.toLocaleString()} kg` : "—" },
        { label: "Volume", value: L.volumeCbm > 0 ? `${L.volumeCbm} CBM` : "—" },
        { label: "Vessel", value: dash(L.vessel) },
        { label: "Container no.", value: dash(L.containerNo) },
        { label: "B/L number", value: dash(L.blNumber) },
        { label: "Shipping agent", value: dash(L.shippingAgentName) },
        { label: "Agent number", value: dash(L.shippingAgentNumber) },
        { label: "Agent contact", value: dash(L.shippingAgentContact) },
        { label: "Loading", ...yn(L.mLoading, "Done", "Pending") },
        { label: "To port", ...yn(L.mToPort, "Done", "Pending") },
        { label: "Unloaded at port", ...yn(L.mUnloadedAtPort, "Done", "Pending") },
        { label: "Loaded to ship", ...yn(L.mLoadedToShip, "Done", "Pending") },
        { label: "ETD", value: dash(L.etd) },
        { label: "ETA", value: dash(L.eta) },
        { label: "Arrived", ...yn(L.arrived) },
      ],
    },
    {
      icon: FileText,
      title: "Export documents",
      checklist: [
        { label: "Commercial invoice", on: L.ciCollected },
        { label: "Packing list", on: L.packingListCollected },
        { label: "Certificate of origin", on: L.cooCollected },
        { label: "Shipping bill", on: L.shippingBill },
        { label: "LC / payment proof", on: L.lcPayment },
        { label: "Marine insurance", on: L.insurance },
        { label: "Fumigation / phyto", on: L.fumigation },
        { label: "Inspection certificate", on: L.inspectionCert },
      ],
    },
    {
      icon: ShieldCheck,
      title: "Customs clearance",
      fields: [
        { label: "CHA", value: dash(L.chaName) },
        { label: "CHA number", value: dash(L.chaNumber) },
        { label: "CHA contact", value: dash(L.chaContact) },
        { label: "CHA appointed", ...yn(L.chaAppointed) },
        { label: "IGM number", value: dash(L.igmNumber) },
        { label: "IGM date", value: dash(L.igmDate) },
        { label: "IGM line no.", value: dash(L.igmLineNo) },
        { label: "BOE number", value: dash(L.boeNumber) },
        { label: "BOE date", value: dash(L.boeDate) },
        { label: "Clearance port", value: dash(L.clearancePort) },
        { label: "BOE filed", ...yn(L.boeFiled) },
        { label: "Assessed", ...yn(L.assessed) },
        { label: "Assessable value", value: money(L.assessableValue) },
        { label: "BCD", value: money(L.bcdAmount) },
        { label: "SWS", value: money(L.swsAmount) },
        { label: "IGST paid", value: money(L.igstPaid) },
        { label: "Duty + IGST paid", ...yn(L.dutyCharged) },
        { label: "Examination", ...yn(L.examDone, "Done", "Pending") },
        { label: "Port days", value: dash(L.portDays) },
        { label: "Out of charge", value: L.outOfCharge ? "Yes" : "No", tone: L.outOfCharge ? "go" : "pending", chip: true },
        { label: "Out-of-charge date", value: dash(L.outOfChargeDate) },
      ],
    },
    {
      icon: Boxes,
      title: "Receipt & GRN",
      fields: [
        { label: "Chassis no.", value: dash(L.chassisNo) },
        { label: "Port-to-warehouse", value: L.indiaTransportCost > 0 ? `₹${L.indiaTransportCost.toLocaleString()}` : "—" },
        { label: "Ordered qty", value: dash(L.orderedQty) },
        { label: "Received qty", value: dash(L.receivedQty) },
        { label: "Invoiced qty", value: dash(L.invoicedQty) },
        { label: "Handed to inventory", value: L.handedToInventory ? "Yes" : "No", tone: L.handedToInventory ? "go" : "pending", chip: true },
      ],
    },
  ];

  const TABS: { key: PhaseKey; label: string; groups: Group[]; market?: boolean }[] = [
    { key: "pre-order", label: "Pre-Order", groups: preGroups, market: true },
    { key: "on-working", label: "On-Working", groups: onWorkingGroups },
    { key: "post-order", label: "Post-Order", groups: postGroups },
  ];
  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm sm:p-6"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduce ? {} : { opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-white shadow-lift"
          initial={reduce ? false : { y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={reduce ? {} : { y: 16, opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start gap-4 border-b border-line px-6 py-5">
            {/* Thumbnail */}
            {heroImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroImage}
                alt={p.name}
                className="h-16 w-16 shrink-0 rounded-md object-cover ring-1 ring-inset ring-line"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-surface text-muted">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <span className="eyebrow">Live product data</span>
              <div className="mt-0.5 flex items-center gap-2">
                <h2 className="truncate font-display text-xl font-medium text-ink">{p.name}</h2>
                {f.percent === 100 && <CheckCircle2 className="h-5 w-5 shrink-0 text-go" />}
              </div>
              <p className="mt-0.5 text-[13px] text-muted">
                {dash(p.category)} · {f.stageLabel} · {f.doneCount}/{f.total} steps
              </p>
            </div>

            <button
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-body transition hover:bg-surface hover:text-ink"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            {summary.map((s) => (
              <div key={s.label} className="bg-white px-5 py-3">
                <p className="eyebrow">{s.label}</p>
                <p className={clsx("figure mt-0.5 text-lg font-semibold", toneText(s.tone) || "text-ink")}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {/* Phase tabs */}
          <div className="flex gap-1 border-b border-line px-4 pt-3">
            {TABS.map((t) => {
              const state = f.phases[t.key];
              const isActive = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={clsx(
                    "relative flex items-center gap-1.5 rounded-t-md px-4 py-2.5 text-[13.5px] font-medium transition",
                    isActive ? "text-ink" : "text-muted hover:text-ink"
                  )}
                >
                  <span
                    className={clsx(
                      "h-1.5 w-1.5 rounded-full",
                      state === "done" ? "bg-go" : state === "active" ? "bg-ink" : "bg-line-strong"
                    )}
                  />
                  {t.label}
                  {isActive && (
                    <motion.span
                      layoutId="view-tab-underline"
                      className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? {} : { opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                {activeTab.market && <MarketCard market={p.market} />}
                {activeTab.groups.map((g) => (
                  <GroupCard key={g.title} group={g} />
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ---- Group model -------------------------------------------------------------

interface Group {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  fields?: Field[];
  checklist?: { label: string; on: boolean }[];
  payments?: { id: string; type: string; amount: number; currency: string; status: string }[];
  media?: MediaItem[];
}

function GroupCard({ group }: { group: Group }) {
  const { icon: Icon, title } = group;
  return (
    <section className="overflow-hidden rounded-md border border-line bg-white">
      <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-[14px] font-medium text-ink">{title}</h3>
      </div>

      {group.media && group.media.length > 0 && (
        <div className="grid grid-cols-3 gap-2 px-4 pt-4 sm:grid-cols-5">
          {group.media.map((m) => (
            <MediaThumb key={m.id} item={m} />
          ))}
        </div>
      )}

      {group.fields && <FieldRows fields={group.fields} />}
      {group.checklist && <Checklist items={group.checklist} />}
      {group.payments && <Payments items={group.payments} />}
    </section>
  );
}

// Label-left / value-right rows on hairline dividers — the readable spec-sheet look.
function FieldRows({ fields }: { fields: Field[] }) {
  return (
    <dl className="divide-y divide-line">
      {fields.map((x) => (
        <div key={x.label} className="flex items-start gap-4 px-4 py-2.5">
          <dt className="w-40 shrink-0 text-[13px] text-muted">{x.label}</dt>
          <dd className="min-w-0 flex-1 text-right">
            {x.chip ? (
              <Chip tone={x.tone}>{x.value}</Chip>
            ) : (
              <span className={clsx("text-[13.5px] font-medium capitalize", toneText(x.tone) || "text-ink")}>
                {x.value}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Checklist({ items }: { items: { label: string; on: boolean }[] }) {
  return (
    <ul className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2">
      {items.map((d) => (
        <li key={d.label} className="flex items-center gap-2.5 bg-white px-4 py-2.5">
          <span
            className={clsx(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              d.on ? "bg-go/12 text-go" : "bg-surface text-line-strong"
            )}
          >
            {d.on ? <Check className="h-3 w-3" strokeWidth={3} /> : <Minus className="h-3 w-3" />}
          </span>
          <span className={clsx("text-[13px]", d.on ? "text-ink" : "text-muted")}>{d.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Payments({ items }: { items: { id: string; type: string; amount: number; currency: string; status: string }[] }) {
  if (items.length === 0)
    return <p className="px-4 py-4 text-[13px] text-muted">No payments recorded yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((pay) => (
        <li key={pay.id} className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[13px] font-medium capitalize text-ink">{pay.type.toLowerCase()}</span>
          <span className="flex items-center gap-3">
            <span className="figure text-[13.5px] text-ink">
              {pay.currency} {pay.amount.toLocaleString()}
            </span>
            <Chip tone={pay.status === "PAID" ? "go" : "pending"}>{pay.status.toLowerCase()}</Chip>
          </span>
        </li>
      ))}
    </ul>
  );
}

function MarketCard({ market }: { market: { id: string; channel: string; competitorPrice: number; demandPerMonth: number }[] }) {
  return (
    <section className="overflow-hidden rounded-md border border-line bg-white">
      <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink">
          <Boxes className="h-4 w-4" />
        </span>
        <h3 className="text-[14px] font-medium text-ink">Market research</h3>
      </div>
      {market.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted">No channels added yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {market.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[13px] font-medium text-ink">{m.channel || "—"}</span>
              <span className="figure text-[13px] text-muted">
                {money(m.competitorPrice)} · {m.demandPerMonth.toLocaleString()}/mo
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Small helpers -----------------------------------------------------------

function Chip({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  const cls =
    tone === "go"
      ? "bg-go/10 text-go ring-go/25"
      : tone === "block"
        ? "bg-block/10 text-block ring-block/25"
        : tone === "pending"
          ? "bg-pending/12 text-pending ring-pending/30"
          : "bg-surface text-muted ring-line";
  return (
    <span className={clsx("figure inline-flex items-center rounded px-2 py-0.5 text-[12px] font-semibold capitalize ring-1 ring-inset", cls)}>
      {children}
    </span>
  );
}

function toneText(tone?: Tone) {
  return tone === "go"
    ? "text-go"
    : tone === "block"
      ? "text-block"
      : tone === "pending"
        ? "text-pending"
        : tone === "muted"
          ? "text-muted"
          : "";
}

// Read-only media thumbnail: image opens full, video plays, PDF opens in a tab.
function MediaThumb({ item }: { item: MediaItem }) {
  if (item.kind === "video") {
    return (
      <div className="relative aspect-square overflow-hidden rounded-md border border-line bg-surface">
        <video src={item.data} className="h-full w-full object-cover" controls />
        <span className="pointer-events-none absolute left-1 top-1 rounded bg-ink/70 px-1 py-0.5 text-[8px] font-semibold uppercase text-white">
          video
        </span>
      </div>
    );
  }
  if (item.kind === "pdf") {
    return (
      <a
        href={item.data}
        target="_blank"
        rel="noreferrer"
        title={item.fileName}
        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-line bg-surface text-coral transition hover:bg-white"
      >
        <FileText className="h-6 w-6" />
        <span className="px-1 text-center text-[9px] text-muted line-clamp-2">{item.fileName}</span>
      </a>
    );
  }
  return (
    <a href={item.data} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-md border border-line">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.data} alt={item.fileName} className="h-full w-full object-cover" />
    </a>
  );
}
