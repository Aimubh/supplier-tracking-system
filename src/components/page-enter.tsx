"use client";

import { motion, staggerParent, riseItem, useReducedMotion } from "./motion";
import type { ReactNode } from "react";

// Orchestrated page-load entrance: staggers direct children up into place.
export function PageEnter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

export function EnterItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={riseItem}>
      {children}
    </motion.div>
  );
}
