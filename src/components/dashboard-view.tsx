"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Boxes,
  ShieldAlert,
  Wallet,
  Ship,
  PackageOpen,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Check,
  Circle,
  ImageIcon,
  Eye,
  Search,
  X,
  Bell,
} from "lucide-react";
import { useStore, type Product } from "@/lib/store";
import { computeCosting } from "@/lib/costing";
import { activeReminders } from "@/lib/production-reminder";
import { getFlow, type Flow, type PhaseKey, type PhaseState } from "@/lib/flow";
import { SpotlightCard } from "./spotlight-card";
import { Reveal, Stagger, Item, motion, AnimatePresence, useReducedMotion } from "./motion";
import { ProductViewModal } from "./product-view-modal";

const PHASE_LABEL: Record<PhaseKey, string> = {
  "pre-order": "Pre",
  "on-working": "Work",
  "post-order": "Post",
};

const PHASE_FULL: Record<PhaseKey, string> = {
  "pre-order": "Pre-Order",
  "on-working": "On-Working",
  "post-order": "Post-Order",
};

function PhasePill({ tab, state }: { tab: PhaseKey; state: PhaseState }) {
  const cls =
    state === "done"
      ? "bg-go/10 text-go ring-go/25"
      : state === "active"
        ? "bg-ink text-white ring-ink"
        : "bg-surface text-muted ring-line";
  return (
    <span className={clsx("figure rounded px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset", cls)}>
      {PHASE_LABEL[tab]}
    </span>
  );
}

const CUR_SYM: Record<string, string> = { USD: "$", INR: "₹", CNY: "¥" };

// Small product thumbnail for the dashboard rows — the first product photo
// (from the media gallery or the legacy single image), or a placeholder icon.
function ProductThumb({ p }: { p: Product }) {
  const media = p.working.productMedia ?? [];
  // Real image bytes are only present once the full record is loaded (on open).
  const img = media.find((m) => m.kind === "image" && m.data)?.data || p.working.productImage;
  if (img) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={img}
        alt={p.name}
        className="h-9 w-9 shrink-0 rounded-md border border-line object-cover"
      />
    );
  }
  // No bytes loaded yet — placeholder. A filled icon hints a photo exists on the
  // server (it loads when the row is opened).
  return (
    <span className={clsx(
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line",
      p._hasPhoto ? "bg-ink/5 text-muted" : "bg-surface text-line-strong"
    )}>
      <ImageIcon className="h-4 w-4" />
    </span>
  );
}

// Compact dropdown for the dashboard filter bar.
function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 appearance-none rounded-sm border border-line bg-white px-3 text-[13px] font-medium text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

type PhaseFilter = "all" | PhaseKey | "complete";
type StatusFilter = "all" | "on-track" | "alerts" | "arrived" | "in-process";

export function DashboardView() {
  const { products, active, setActiveId, reopenProduct, ensureFull } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [tgSending, setTgSending] = useState(false);
  const [tgMsg, setTgMsg] = useState<string | null>(null);

  async function sendTelegramReminders() {
    setTgSending(true);
    setTgMsg(null);
    try {
      const res = await fetch("/api/reminders/send", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTgMsg(data.error ?? "Failed to send.");
      } else {
        setTgMsg(data.sent > 0 ? `Sent ${data.sent} reminder(s) to Telegram.` : "No reminders due today.");
      }
    } catch {
      setTgMsg("Could not reach the server.");
    } finally {
      setTgSending(false);
    }
  }
  // Filters for the product list.
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Capital for the CURRENT (active) product — its agreed total, advance paid,
  // and the remaining balance, shown in that product's own currency.
  const capSym = CUR_SYM[active?.working.rateCurrency ?? "INR"] ?? "$";
  const capTotal = active?.working.rateValue ?? 0;
  const capPaid = Math.min(active?.working.advancePaid ?? 0, capTotal);
  const capPending = Math.max(capTotal - capPaid, 0);

  const flows = products.map((p) => ({ p, f: getFlow(p) }));

  // Distinct categories present, for the category filter dropdown.
  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort();

  // Apply the active filters to the list.
  const q = query.trim().toLowerCase();
  const filteredFlows = flows.filter(({ p, f }) => {
    if (q && !(`${p.name} ${p.category} ${p.supplier.name}`.toLowerCase().includes(q))) return false;
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (phaseFilter !== "all") {
      if (phaseFilter === "complete") {
        if (f.percent !== 100) return false;
      } else if (f.phases[phaseFilter] !== "active") {
        return false;
      }
    }
    if (statusFilter === "alerts" && f.alerts.length === 0) return false;
    if (statusFilter === "on-track" && (f.alerts.length > 0 || f.percent === 100)) return false;
    if (statusFilter === "arrived" && !p.logistics.handedToInventory) return false;
    if (statusFilter === "in-process" && (f.percent === 100 || p.filed)) return false;
    return true;
  });
  const filtersActive = q !== "" || phaseFilter !== "all" || statusFilter !== "all" || categoryFilter !== "all";
  function clearFilters() {
    setQuery("");
    setPhaseFilter("all");
    setStatusFilter("all");
    setCategoryFilter("all");
  }

  const totals = flows.reduce(
    (acc, { p }) => {
      // Arrived = fully landed / handed to inventory.
      if (p.logistics.handedToInventory) acc.arrived += 1;
      // Listing pending = landed in inventory but not yet listed for sale.
      // (No "listed" field yet — this is a placeholder proxy until that lands.)
      if (p.logistics.handedToInventory) acc.listingPending += 1;
      return acc;
    },
    { arrived: 0, listingPending: 0 }
  );

  const STATS = [
    { label: "Total products", value: String(products.length), note: "in the system", icon: Boxes, tint: "text-ink", chip: "bg-surface" },
    { label: "Arrival status", value: `${totals.arrived}/${products.length}`, note: "landed to inventory", icon: Ship, tint: "text-go", chip: "bg-go/10" },
    { label: "Listing pending", value: String(totals.listingPending), note: "ready, not yet listed", icon: ShieldAlert, tint: "text-pending", chip: "bg-pending/10" },
  ];

  const reminders = activeReminders(products);

  return (
    <main className="px-7 py-6">
      {(reminders.length > 0 || tgMsg) && (
        <div className="mb-5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Reminders</p>
            <div className="flex items-center gap-2">
              {tgMsg && <span className="text-[12px] text-muted">{tgMsg}</span>}
              <button
                onClick={sendTelegramReminders}
                disabled={tgSending}
                className="flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-surface-strong disabled:opacity-60"
              >
                <Bell className="h-3.5 w-3.5" />
                {tgSending ? "Sending…" : "Send to Telegram"}
              </button>
            </div>
          </div>
          {reminders.map((r) => {
            const Icon = r.kind === "eta" ? Ship : Bell;
            return (
            <button
              key={`${r.kind}:${r.productId}`}
              onClick={() => setActiveId(r.productId)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-md border px-4 py-2.5 text-left transition",
                r.tone === "block"
                  ? "border-block/30 bg-block/5 hover:bg-block/10"
                  : "border-pending/30 bg-pending/5 hover:bg-pending/10"
              )}
            >
              <Icon className={clsx("h-4 w-4 shrink-0", r.tone === "block" ? "text-block" : "text-pending")} />
              <span className="text-[13px] font-semibold text-ink">{r.productName}</span>
              <span className={clsx("text-[12.5px]", r.tone === "block" ? "text-block" : "text-muted")}>
                {r.message}
              </span>
              <span className="figure ml-auto text-[11px] text-muted">
                {r.kind === "eta" ? "ETA" : "ready"} {r.readyDate}
              </span>
            </button>
            );
          })}
        </div>
      )}
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((s) => (
          <Item key={s.label}>
            <SpotlightCard className="p-5">
              <div className={clsx("flex h-10 w-10 items-center justify-center rounded-md", s.chip)}>
                <s.icon className={`h-5 w-5 ${s.tint}`} />
              </div>
              <p className="figure mt-4 text-3xl font-semibold leading-none text-ink">{s.value}</p>
              <p className="mt-2 text-[14px] font-medium text-body">{s.label}</p>
              <p className="mt-0.5 text-[12px] text-muted">{s.note}</p>
            </SpotlightCard>
          </Item>
        ))}

        {/* Overall capital — current product's total, with paid + pending */}
        <Item>
          <SpotlightCard className="p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-coral/10">
              <Wallet className="h-5 w-5 text-coral" />
            </div>
            <p className="figure mt-4 text-3xl font-semibold leading-none text-ink">
              {capTotal > 0 ? `${capSym}${capTotal.toLocaleString()}` : "—"}
            </p>
            <p className="mt-2 text-[14px] font-medium text-body">Overall capital</p>
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {active ? active.name : "no product selected"}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-go/10 px-2.5 py-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-go/80">Paid</p>
                <p className="figure text-[14px] font-semibold text-go">{capSym}{capPaid.toLocaleString()}</p>
              </div>
              <div className="rounded-md bg-pending/10 px-2.5 py-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-pending/90">Pending</p>
                <p className="figure text-[14px] font-semibold text-pending">{capSym}{capPending.toLocaleString()}</p>
              </div>
            </div>
          </SpotlightCard>
        </Item>
      </Stagger>

      <Reveal className="mt-5" delay={0.1}>
        <SpotlightCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="eyebrow">Live process status</span>
            <Link href="/on-working?step=1" className="flex items-center gap-1 text-[13px] font-medium text-link hover:underline">
              New candidate <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Filter bar */}
          {products.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search product, category, supplier…"
                  className="h-9 w-full rounded-sm border border-line bg-white pl-9 pr-3 text-[13px] text-ink placeholder:text-line-strong focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
                />
              </div>
              <FilterSelect value={phaseFilter} onChange={(v) => setPhaseFilter(v as PhaseFilter)} options={[
                { value: "all", label: "All phases" },
                { value: "pre-order", label: "Pre-Order" },
                { value: "on-working", label: "On-Working" },
                { value: "post-order", label: "Post-Order" },
                { value: "complete", label: "Complete" },
              ]} />
              <FilterSelect value={statusFilter} onChange={(v) => setStatusFilter(v as StatusFilter)} options={[
                { value: "all", label: "Any status" },
                { value: "in-process", label: "In process" },
                { value: "on-track", label: "On track" },
                { value: "alerts", label: "Has alerts" },
                { value: "arrived", label: "Arrived" },
              ]} />
              {categories.length > 0 && (
                <FilterSelect value={categoryFilter} onChange={setCategoryFilter} options={[
                  { value: "all", label: "All categories" },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]} />
              )}
              {filtersActive && (
                <button onClick={clearFilters} className="flex items-center gap-1 rounded-sm border border-line bg-white px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:text-ink">
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              )}
              <span className="ml-auto text-[12px] text-muted">{filteredFlows.length} of {flows.length}</span>
            </div>
          )}

          {products.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-ink text-white">
                <PackageOpen className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-display text-lg font-medium text-ink">No candidates yet</h2>
                <p className="mt-1.5 max-w-sm text-[14px] text-muted">
                  Create a product to start it through the pipeline. Its live stage, progress and alerts appear here in real time.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface">
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Product</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Category</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Phase</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Progress</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Order qty</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Status</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFlows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-[13px] text-muted">
                        No products match these filters.{" "}
                        <button onClick={clearFilters} className="font-medium text-link hover:underline">Clear filters</button>
                      </td>
                    </tr>
                  ) : (
                    filteredFlows.map(({ p, f }) => (
                      <ProductRow
                        key={p.id}
                        p={p}
                        f={f}
                        open={openId === p.id}
                        onToggle={() => { setOpenId((cur) => (cur === p.id ? null : p.id)); ensureFull(p.id); }}
                        onView={() => { setViewId(p.id); ensureFull(p.id); }}
                        onResume={() => setActiveId(p.id)}
                        onReopen={() => reopenProduct(p.id)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SpotlightCard>
      </Reveal>

      <AnimatePresence>
        {viewId && <ProductViewModal id={viewId} onClose={() => setViewId(null)} />}
      </AnimatePresence>
    </main>
  );
}

// A product table row: a clickable summary <tr> that expands into a full-width
// detail <tr> with key facts + the step-by-step progress.
function ProductRow({
  p,
  f,
  open,
  onToggle,
  onView,
  onResume,
  onReopen,
}: {
  p: Product;
  f: Flow;
  open: boolean;
  onToggle: () => void;
  onView: () => void;
  onResume: () => void;
  onReopen: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <>
      {/* Summary row (click anywhere to expand) */}
      <tr
        onClick={onToggle}
        className={clsx(
          "cursor-pointer border-b border-line align-middle transition-colors hover:bg-surface",
          open && "bg-surface"
        )}
      >
        {/* Expand chevron */}
        <td className="px-3 py-3">
          <ChevronDown
            className={clsx(
              "h-4 w-4 text-muted transition-transform",
              open && "rotate-180 text-ink"
            )}
          />
        </td>

        {/* Product */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-2.5">
            {/* Thumbnail — first product photo, or a placeholder */}
            <ProductThumb p={p} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-medium text-ink">{p.name}</span>
                {f.percent === 100 && <CheckCircle2 className="h-4 w-4 shrink-0 text-go" />}
                {p.filed && (
                  <span className="figure shrink-0 rounded bg-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted ring-1 ring-inset ring-line">
                    filed
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-muted">{f.stageLabel}</p>
            </div>
          </div>
        </td>

        {/* Category */}
        <td className="px-3 py-3 text-[13px] text-body">{p.category || "—"}</td>

        {/* Phase pills */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            <PhasePill tab="pre-order" state={f.phases["pre-order"]} />
            <PhasePill tab="on-working" state={f.phases["on-working"]} />
            <PhasePill tab="post-order" state={f.phases["post-order"]} />
          </div>
        </td>

        {/* Progress */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-strong">
              <div className="h-full rounded-full bg-ink transition-all duration-500" style={{ width: `${f.percent}%` }} />
            </div>
            <span className="figure text-[11px] text-muted">{f.percent}%</span>
          </div>
        </td>

        {/* Order qty */}
        <td className="px-3 py-3 text-right">
          <span className="figure text-[13px] font-semibold text-ink">
            {p.working.moq > 0 ? p.working.moq.toLocaleString() : "—"}
          </span>
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          {f.alerts.length > 0 ? (
            <span
              className={clsx(
                "figure rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset",
                f.alerts[0].tone === "block" ? "bg-block/10 text-block ring-block/25" : "bg-pending/12 text-pending ring-pending/30"
              )}
            >
              {f.alerts[0].text}
              {f.alerts.length > 1 ? ` +${f.alerts.length - 1}` : ""}
            </span>
          ) : f.percent === 100 ? (
            <span className="figure rounded bg-go/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-go ring-1 ring-inset ring-go/25">
              complete
            </span>
          ) : (
            <span className="text-[12px] text-go">on track</span>
          )}
        </td>

        {/* Actions */}
        <td className="px-3 py-3">
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onView}
              className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-brand-600"
            >
              <Eye className="h-3.5 w-3.5" /> View
            </button>
            {p.filed ? (
              <button
                onClick={onReopen}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-surface"
              >
                Reopen <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : f.next ? (
              <Link
                href={`/${f.next.tab}?step=${f.next.step}`}
                onClick={onResume}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-surface"
              >
                {f.next.label} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <span className="figure rounded-lg bg-go/10 px-3 py-1.5 text-[12.5px] font-medium text-go ring-1 ring-inset ring-go/25">
                Complete
              </span>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded detail row (spans all 8 columns) */}
      {open && (
        <tr className="bg-surface">
          <td colSpan={8} className="p-0">
            <AnimatePresence initial={false}>
              <motion.div
                initial={reduce ? false : { height: 0, opacity: 0 }}
                animate={reduce ? {} : { height: "auto", opacity: 1 }}
                exit={reduce ? {} : { height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <DetailPanel p={p} f={f} />
              </motion.div>
            </AnimatePresence>
          </td>
        </tr>
      )}
    </>
  );
}

// The detail view shown when a product row is expanded: key facts + the full
// step checklist grouped by phase.
function DetailPanel({ p, f }: { p: Product; f: Flow }) {
  const costing = computeCosting(p.costing, p.compliance.dutyRatePct, p.compliance.igstRatePct);
  // Prefer the first uploaded image from the gallery; fall back to legacy single image.
  const media = p.working.productMedia ?? [];
  const heroImage = media.find((m) => m.kind === "image")?.data || p.working.productImage;
  const mediaCount = media.length;
  const facts: { label: string; value: string; tone?: "go" | "block" | "pending" }[] = [
    { label: "Category", value: p.category || "—" },
    { label: "Supplier", value: p.supplier.name || "—" },
    {
      label: "Supplier check",
      value: p.supplier.verification.replace("_", " ").toLowerCase(),
      tone: p.supplier.verification === "VERIFIED" ? "go" : "pending",
    },
    {
      label: "Compliance",
      value: p.compliance.status === "CLEARED" ? "cleared" : "blocked",
      tone: p.compliance.status === "CLEARED" ? "go" : "block",
    },
    { label: "HS code", value: p.compliance.hsCode || "—" },
    {
      label: "Costing verdict",
      value: costing.verdict === "GO" ? "GO" : costing.verdict === "NO_GO" ? "NO-GO" : "pending",
      tone: costing.verdict === "GO" ? "go" : costing.verdict === "NO_GO" ? "block" : "pending",
    },
    {
      label: "Net margin",
      value: costing.verdict === "PENDING" ? "—" : `${costing.netMarginPct.toFixed(1)}%`,
      tone: costing.verdict === "GO" ? "go" : costing.verdict === "NO_GO" ? "block" : undefined,
    },
    { label: "Order qty (MOQ)", value: p.working.moq > 0 ? p.working.moq.toLocaleString() : "—" },
    { label: "Total amount", value: p.working.rateValue > 0 ? `${p.working.rate} ${p.working.rateValue.toLocaleString()} ${p.working.rateCurrency ?? "INR"}` : "—" },
    {
      label: "Sample",
      value: p.working.sampleResult.toLowerCase(),
      tone:
        p.working.sampleResult === "APPROVED" ? "go" : p.working.sampleResult === "REJECTED" ? "block" : "pending",
    },
    { label: "B/L number", value: p.logistics.blNumber || "—" },
    {
      label: "Customs",
      value: p.logistics.outOfCharge ? "out of charge" : p.logistics.boeFiled ? "BOE filed" : "—",
      tone: p.logistics.outOfCharge ? "go" : undefined,
    },
  ];

  const toneCls = (t?: "go" | "block" | "pending") =>
    t === "go" ? "text-go" : t === "block" ? "text-block" : t === "pending" ? "text-pending" : "text-ink";

  const phases: PhaseKey[] = ["pre-order", "on-working", "post-order"];

  return (
    <div className="border-t border-line px-5 py-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* Left: image + key facts */}
        <div className="space-y-3">
          {heroImage ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImage}
                alt={p.name}
                className="h-40 w-full rounded-md object-cover ring-1 ring-inset ring-line"
              />
              {mediaCount > 1 && (
                <span className="figure absolute bottom-2 right-2 rounded bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  +{mediaCount - 1} more
                </span>
              )}
            </div>
          ) : (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-surface text-muted">
              <ImageIcon className="h-6 w-6" />
              <span className="text-[11px]">No product photo yet</span>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-md border border-line bg-surface px-3.5 py-3">
            {facts.map((x) => (
              <div key={x.label} className="min-w-0">
                <dt className="eyebrow">{x.label}</dt>
                <dd className={clsx("figure mt-0.5 truncate text-[12.5px] font-semibold capitalize", toneCls(x.tone))}>
                  {x.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Right: full step checklist by phase */}
        <div>
          <p className="eyebrow mb-2">Progress detail · {f.doneCount} of {f.total} steps done</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {phases.map((tab) => {
              const steps = f.steps.filter((s) => s.tab === tab);
              const done = steps.filter((s) => s.done).length;
              return (
                <div key={tab} className="rounded-md border border-line bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-ink">{PHASE_FULL[tab]}</span>
                    <span className="figure text-[11px] text-muted">
                      {done}/{steps.length}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {steps.map((s) => {
                      const isNext = f.next?.tab === s.tab && f.next?.step === s.step;
                      return (
                        <li key={`${s.tab}-${s.step}`} className="flex items-center gap-2">
                          {s.done ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-go" strokeWidth={3} />
                          ) : (
                            <Circle
                              className={clsx("h-3.5 w-3.5 shrink-0", isNext ? "text-ink" : "text-line-strong")}
                            />
                          )}
                          <span
                            className={clsx(
                              "truncate text-[12px]",
                              s.done ? "text-body" : isNext ? "font-medium text-ink" : "text-muted"
                            )}
                          >
                            {s.label}
                          </span>
                          {isNext && (
                            <span className="figure ml-auto rounded bg-ink px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                              next
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          {p.working.sampleResult === "REJECTED" && p.working.rejectReason && (
            <p className="mt-3 rounded-md bg-block/10 px-3 py-2 text-[12px] text-block ring-1 ring-inset ring-block/20">
              Sample rejected — {p.working.rejectReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
