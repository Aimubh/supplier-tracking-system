import clsx from "clsx";
import {
  XCircle,
  ShieldCheck,
  Calculator,
  FlaskConical,
  PackageCheck,
  Factory,
  Store,
  HelpCircle,
} from "lucide-react";
import type { MockProduct } from "@/lib/mock-data";
import { StatusPill, GroupTag } from "./badges";

type GateState = "ok" | "bad" | "pending" | "na";

function GateMark({
  icon: Icon,
  state,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  state: GateState;
  label: string;
}) {
  const map: Record<GateState, string> = {
    ok: "text-go",
    bad: "text-block",
    pending: "text-muted/50",
    na: "text-muted/25",
  };
  return (
    <span title={`${label} gate`} className={clsx("inline-flex", map[state])}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function SupplierIcon({ type }: { type: MockProduct["supplierType"] }) {
  if (type === "FACTORY") return <Factory className="h-3 w-3 text-muted" />;
  if (type === "TRADING_COMPANY") return <Store className="h-3 w-3 text-muted" />;
  return <HelpCircle className="h-3 w-3 text-muted/50" />;
}

export function ProductCard({ p }: { p: MockProduct }) {
  const sampleState: GateState =
    p.gates.sample === "APPROVED" ? "ok" : p.gates.sample === "REJECTED" ? "bad" : "pending";
  const complianceState: GateState =
    p.gates.compliance === "CLEARED"
      ? "ok"
      : p.gates.compliance === "BLOCKED"
        ? "bad"
        : "pending";
  const costingState: GateState =
    p.gates.costing === "GO" ? "ok" : p.gates.costing === "NO_GO" ? "bad" : "pending";
  const qcState: GateState =
    p.gates.qc === "PASS"
      ? "ok"
      : p.gates.qc === "FAIL"
        ? "bad"
        : p.gates.qc === "NA"
          ? "na"
          : "pending";

  return (
    <div
      className={clsx(
        "group rounded-md border bg-white p-3 transition hover:border-line-strong",
        p.status === "REJECTED" ? "border-line opacity-70" : "border-line"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate font-display text-[14px] font-medium tracking-tight text-ink">
          {p.name}
        </p>
        <GroupTag group={p.group} />
      </div>
      <p className="eyebrow mt-1">{p.category}</p>

      {/* Figures */}
      <div className="mt-2.5 flex items-stretch gap-3 border-y border-line py-2">
        <div>
          <p className="eyebrow">USD/unit</p>
          <p className="figure mt-0.5 text-[14px] font-semibold text-ink">
            {p.unitPriceUsd.toFixed(2)}
          </p>
        </div>
        <div className="w-px bg-line" />
        <div>
          <p className="eyebrow">MOQ</p>
          <p className="figure mt-0.5 text-[14px] font-semibold text-ink">
            {p.moq.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Supplier */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
        <SupplierIcon type={p.supplierType} />
        <span className="truncate">{p.supplier}</span>
      </div>

      {/* Gate strip */}
      <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5">
        <div className="flex items-center gap-2">
          <GateMark icon={FlaskConical} state={sampleState} label="Sample" />
          <GateMark icon={ShieldCheck} state={complianceState} label="Compliance" />
          <GateMark icon={Calculator} state={costingState} label="Costing" />
          <GateMark icon={PackageCheck} state={qcState} label="QC" />
        </div>
        <StatusPill status={p.status} />
      </div>

      {p.rejectReason ? (
        <p className="mt-2.5 flex items-start gap-1.5 rounded border border-block/20 bg-block/8 px-2 py-1.5 text-[11px] leading-snug text-block">
          <XCircle className="mt-px h-3 w-3 shrink-0" />
          {p.rejectReason}
        </p>
      ) : p.note ? (
        <p className="mt-2.5 text-[11px] leading-snug text-muted">{p.note}</p>
      ) : null}
    </div>
  );
}
