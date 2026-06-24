"use client";

import { useEffect, useState } from "react";

// Live countdown to a target date (production-ready date). Updates every second.
export function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!target) {
    return (
      <p className="text-[12px] text-muted">Set a production-ready date to start the countdown.</p>
    );
  }
  if (now === null) return null; // avoid SSR/client mismatch

  const end = new Date(target).getTime();
  const diff = end - now;
  const done = diff <= 0;

  const days = Math.max(0, Math.floor(diff / 86400000));
  const hours = Math.max(0, Math.floor((diff % 86400000) / 3600000));
  const mins = Math.max(0, Math.floor((diff % 3600000) / 60000));
  const secs = Math.max(0, Math.floor((diff % 60000) / 1000));

  if (done) {
    return (
      <span className="figure inline-flex items-center gap-2 rounded-lg bg-go/15 px-3 py-2 text-[13px] font-semibold text-go ring-1 ring-inset ring-go/30">
        ● Production time reached
      </span>
    );
  }

  const cell = (n: number, label: string) => (
    <div className="flex flex-col items-center rounded-lg border border-line bg-surface px-3 py-2">
      <span className="figure text-xl font-semibold text-ink">{String(n).padStart(2, "0")}</span>
      <span className="eyebrow mt-0.5">{label}</span>
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      {cell(days, "days")}
      {cell(hours, "hrs")}
      {cell(mins, "min")}
      {cell(secs, "sec")}
    </div>
  );
}
