"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

const inputCls =
  "h-11 w-full rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink placeholder:text-line-strong transition focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-body">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputCls}
    />
  );
}

export function Num({
  value,
  onChange,
  placeholder,
  step,
  prefix,
  blankZero,
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  step?: string;
  prefix?: string;
  // Show an empty field (placeholder) when the value is 0, instead of "0".
  blankZero?: boolean;
}) {
  const display = !Number.isFinite(value) || (blankZero && value === 0) ? "" : value;
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-muted">
          {prefix}
        </span>
      )}
      <input
        type="number"
        value={display}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        placeholder={placeholder}
        step={step ?? "any"}
        className={clsx(inputCls, "figure", prefix && "pl-7")}
      />
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={clsx(inputCls, "appearance-none")}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-white text-ink">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2.5">
      <span
        className={clsx(
          "relative h-5 w-9 rounded-full border transition",
          on ? "border-ink bg-ink" : "border-line bg-surface-strong"
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition",
            on ? "left-[18px]" : "left-0.5"
          )}
        />
      </span>
      <span className="text-[14px] text-body">{label}</span>
    </button>
  );
}

// A read-only computed figure tile.
export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "go" | "block" | "pending";
}) {
  const color = {
    default: "text-ink",
    go: "text-go",
    block: "text-block",
    pending: "text-pending",
  }[tone];
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <p className="eyebrow">{label}</p>
      <p className={clsx("figure mt-1 text-lg font-semibold", color)}>{value}</p>
    </div>
  );
}

// Section title inside a panel.
export function PanelHead({
  title,
  desc,
  right,
}: {
  title: string;
  desc?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-[22px] font-medium tracking-tight text-ink">{title}</h2>
        {desc && <p className="mt-1 max-w-prose text-[14px] text-muted">{desc}</p>}
      </div>
      {right}
    </div>
  );
}
