import clsx from "clsx";

type Tone = "seal" | "block" | "stamp" | "neutral";

// Status colors mapped to the Airtable semantic palette.
const TEXT: Record<Tone, string> = {
  seal: "text-go",
  block: "text-block",
  stamp: "text-pending",
  neutral: "text-muted",
};

// A status mark + label. (Editorial system: flat, no rotation/double-rule.)
export function Seal({
  label,
  tone = "neutral",
  mark,
  className,
}: {
  label: string;
  tone?: Tone;
  mark?: string;
  className?: string;
}) {
  const glyph =
    mark ?? (tone === "seal" ? "●" : tone === "block" ? "✕" : tone === "stamp" ? "●" : "—");
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-[13px] font-medium", TEXT[tone], className)}>
      <span aria-hidden>{glyph}</span>
      {label}
    </span>
  );
}

// A flat status chip for dense rows.
export function Chip({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const map: Record<Tone, string> = {
    seal: "bg-go/10 text-go border-go/25",
    block: "bg-block/10 text-block border-block/25",
    stamp: "bg-pending/12 text-pending border-pending/30",
    neutral: "bg-surface text-muted border-line",
  };
  return (
    <span
      className={clsx(
        "figure inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        map[tone]
      )}
    >
      {label}
    </span>
  );
}
