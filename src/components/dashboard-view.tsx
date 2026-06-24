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
} from "lucide-react";
import { useStore, type Product } from "@/lib/store";
import { computeCosting } from "@/lib/costing";
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

export function DashboardView() {
  const { products, setActiveId, reopenProduct } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  const flows = products.map((p) => ({ p, f: getFlow(p) }));
  const totals = flows.reduce(
    (acc, { p, f }) => {
      acc.capital += p.payments.filter((x) => x.status === "PAID").reduce((s, x) => s + x.amount, 0);
      acc.openGates += f.alerts.length;
      if (f.phases["post-order"] === "active" || (f.steps.find((s) => s.tab === "post-order" && s.step === 1)?.done && !p.logistics.handedToInventory)) acc.inTransit += 1;
      if (f.percent === 100) acc.complete += 1;
      return acc;
    },
    { capital: 0, openGates: 0, inTransit: 0, complete: 0 }
  );

  const STATS = [
    { label: "Candidates", value: String(products.length), note: "in pipeline", icon: Boxes, tint: "text-ink", chip: "bg-surface" },
    { label: "Active alerts", value: String(totals.openGates), note: "gates & flags", icon: ShieldAlert, tint: "text-pending", chip: "bg-pending/10" },
    { label: "Capital committed", value: `$${totals.capital.toLocaleString()}`, note: "paid to date", icon: Wallet, tint: "text-coral", chip: "bg-coral/10" },
    { label: "Completed", value: String(totals.complete), note: "handed to inventory", icon: Ship, tint: "text-go", chip: "bg-go/10" },
  ];

  return (
    <main className="px-7 py-6">
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
      </Stagger>

      <Reveal className="mt-5" delay={0.1}>
        <SpotlightCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="eyebrow">Live process status</span>
            <Link href="/on-working?step=1" className="flex items-center gap-1 text-[13px] font-medium text-link hover:underline">
              New candidate <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

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
            <div className="divide-y divide-line">
              {flows.map(({ p, f }) => (
                <ProductRow
                  key={p.id}
                  p={p}
                  f={f}
                  open={openId === p.id}
                  onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
                  onView={() => setViewId(p.id)}
                  onResume={() => setActiveId(p.id)}
                  onReopen={() => reopenProduct(p.id)}
                />
              ))}
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

// A product row: a clickable summary header that expands into full details +
// the step-by-step progress for that product.
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
    <div className={clsx("transition-colors", open && "bg-surface")}>
      {/* Header (click to expand) */}
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-1 items-center gap-3 px-5 py-4 text-left lg:grid-cols-[1.4fr_1fr_1.2fr_auto]"
      >
        {/* Name + stage + phase pills */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={clsx(
                "h-4 w-4 shrink-0 text-muted transition-transform",
                open && "rotate-180 text-ink"
              )}
            />
            <span className="truncate text-[15px] font-medium text-ink">{p.name}</span>
            {f.percent === 100 && <CheckCircle2 className="h-4 w-4 shrink-0 text-go" />}
            {p.filed && (
              <span className="figure shrink-0 rounded bg-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted ring-1 ring-inset ring-line">
                filed
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 pl-6">
            <PhasePill tab="pre-order" state={f.phases["pre-order"]} />
            <PhasePill tab="on-working" state={f.phases["on-working"]} />
            <PhasePill tab="post-order" state={f.phases["post-order"]} />
            <span className="ml-1 truncate text-[12px] text-muted">{f.stageLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 pl-6">
            <span className="eyebrow">Order qty</span>
            <span className="figure text-[12px] font-semibold text-ink">
              {p.working.moq > 0 ? p.working.moq.toLocaleString() : "—"}
            </span>
            <span className="text-[11px] text-muted">units</span>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between">
            <span className="eyebrow">Progress</span>
            <span className="figure text-[11px] text-body">
              {f.doneCount}/{f.total} · {f.percent}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-strong">
            <div
              className="h-full rounded-full bg-ink transition-all duration-500"
              style={{ width: `${f.percent}%` }}
            />
          </div>
        </div>

        {/* Alerts */}
        <div className="flex flex-wrap gap-1.5">
          {f.alerts.length === 0 ? (
            <span className="text-[12px] text-go">no flags</span>
          ) : (
            f.alerts.map((a, i) => (
              <span
                key={i}
                className={clsx(
                  "figure rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset",
                  a.tone === "block" ? "bg-block/10 text-block ring-block/25" : "bg-pending/12 text-pending ring-pending/30"
                )}
              >
                {a.text}
              </span>
            ))
          )}
        </div>

        {/* View + Next action / resume / reopen */}
        <div className="flex items-center gap-2 lg:justify-self-end" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onView}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-brand-600"
          >
            <Eye className="h-3.5 w-3.5" /> View
          </button>
          {p.filed ? (
            <button
              onClick={onReopen}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-surface"
            >
              Reopen <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : f.next ? (
            <Link
              href={`/${f.next.tab}?step=${f.next.step}`}
              onClick={onResume}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-surface"
            >
              {f.next.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="figure rounded-lg bg-go/10 px-3 py-1.5 text-[13px] font-medium text-go ring-1 ring-inset ring-go/25">
              Complete
            </span>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={reduce ? {} : { height: "auto", opacity: 1 }}
            exit={reduce ? {} : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <DetailPanel p={p} f={f} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
    { label: "Total amount", value: p.working.rateValue > 0 ? `${p.working.rate} ${p.working.rateValue.toLocaleString()} ${p.working.rateCurrency ?? "USD"}` : "—" },
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
