import { Chip } from "./seal";
import type { ProductStatus } from "@/lib/pipeline";

export function StatusPill({ status }: { status: ProductStatus }) {
  const map: Record<ProductStatus, "seal" | "block" | "stamp" | "neutral"> = {
    ACTIVE: "seal",
    ON_HOLD: "stamp",
    REJECTED: "block",
    ORDERED: "neutral",
    LANDED: "neutral",
  };
  return <Chip label={status.replace("_", " ")} tone={map[status]} />;
}

export function GroupTag({
  group,
}: {
  group: "GIFTABLE" | "MID" | "COMMODITY";
}) {
  const label = { GIFTABLE: "Giftable", MID: "Mid", COMMODITY: "Commodity" }[group];
  return (
    <span className="figure rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
      {label}
    </span>
  );
}
