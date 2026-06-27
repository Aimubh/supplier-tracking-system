"use client";

// Live countdown board to a target date (the vessel ETA). Ticks every second and
// shows days / hours / minutes / seconds. Goes red once the ETA has passed (and
// counts up the overdue time). Renders nothing if no valid date is set.

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Ship } from "lucide-react";

interface Parts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  overdue: boolean;
  total: number; // signed ms remaining (negative = overdue)
}

// ISO date ("2026-07-22") → countdown parts. Targets local end-of-day so the
// timer doesn't read "0 days" for the whole arrival day.
function partsUntil(iso: string): Parts | null {
  if (!iso) return null;
  const target = new Date(iso + "T23:59:59");
  if (Number.isNaN(target.getTime())) return null;
  const diff = target.getTime() - Date.now();
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  return {
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    seconds: Math.floor((abs % 60_000) / 1_000),
    overdue,
    total: diff,
  };
}

function Cell({ value, label, danger }: { value: number; label: string; danger: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={clsx(
          "figure min-w-[58px] rounded-md border px-2 py-2 text-center text-[26px] font-semibold tabular-nums leading-none",
          danger
            ? "border-block/30 bg-block/5 text-block"
            : "border-line bg-surface text-ink"
        )}
      >
        {String(value).padStart(2, "0")}
      </div>
      <span className="mt-1 text-[10.5px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function EtaCountdown({ eta, arrived }: { eta: string; arrived?: boolean }) {
  const [parts, setParts] = useState<Parts | null>(() => partsUntil(eta));

  useEffect(() => {
    setParts(partsUntil(eta));
    if (!eta) return;
    const id = setInterval(() => setParts(partsUntil(eta)), 1000);
    return () => clearInterval(id);
  }, [eta]);

  if (!parts) return null;

  if (arrived) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-md border border-go/30 bg-go/5 px-4 py-3">
        <Ship className="h-4 w-4 text-go" />
        <span className="text-[13px] font-semibold text-ink">Vessel arrived at port</span>
        <span className="text-[12.5px] text-muted">ETA was {eta}</span>
      </div>
    );
  }

  const danger = parts.overdue || (!parts.overdue && parts.days === 0);

  return (
    <div
      className={clsx(
        "mt-4 rounded-md border px-4 py-3",
        parts.overdue ? "border-block/30 bg-block/5" : "border-line bg-base"
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <Ship className={clsx("h-4 w-4", parts.overdue ? "text-block" : "text-pending")} />
        <p className="eyebrow">
          {parts.overdue ? "Ship overdue at port" : "Time until ship reaches port"}
        </p>
        <span className="figure ml-auto text-[11px] text-muted">ETA {eta}</span>
      </div>
      <div className="flex items-end gap-2.5">
        <Cell value={parts.days} label="Days" danger={danger} />
        <span className="pb-5 text-[20px] font-semibold text-muted">:</span>
        <Cell value={parts.hours} label="Hours" danger={danger} />
        <span className="pb-5 text-[20px] font-semibold text-muted">:</span>
        <Cell value={parts.minutes} label="Min" danger={danger} />
        <span className="pb-5 text-[20px] font-semibold text-muted">:</span>
        <Cell value={parts.seconds} label="Sec" danger={danger} />
      </div>
      {parts.overdue && (
        <p className="mt-2 text-[12px] text-block">
          The ETA has passed — confirm arrival and mark the vessel arrived above.
        </p>
      )}
    </div>
  );
}
