"use client";

import { motion, useReducedMotion } from "motion/react";

// A Next.js template re-mounts on every navigation, so this gives each tab a
// gentle crossfade-and-rise as you move between sections.
export default function AppTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
