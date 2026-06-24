"use client";

import { type ReactNode } from "react";
import clsx from "clsx";

// Flat white card separated by a hairline. The Airtable system is color-block
// first — no spotlight glow, no atmospheric shadow. Kept the component name so
// existing call sites don't change; it now renders a calm editorial card.
export function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("glass glass-hover relative overflow-hidden rounded-lg", className)}>
      {children}
    </div>
  );
}
