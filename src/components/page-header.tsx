"use client";

import { motion, useReducedMotion, EASE } from "./motion";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  section,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  section?: string;
}) {
  const reduce = useReducedMotion();
  const t = (delay: number) =>
    reduce ? undefined : { duration: 0.5, ease: EASE, delay };

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-7 py-5">
        <div>
          <motion.p
            className="eyebrow"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={t(0)}
          >
            {eyebrow}
          </motion.p>
          <motion.h1
            className="mt-2 font-display text-[28px] font-medium leading-tight tracking-tight text-ink"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={t(0.06)}
          >
            {title}
          </motion.h1>
          {subtitle && (
            <motion.p
              className="mt-2 text-[14px] text-muted"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={reduce ? {} : { opacity: 1, y: 0 }}
              transition={t(0.12)}
            >
              {subtitle}
            </motion.p>
          )}
        </div>
        {section && (
          <motion.div
            className="relative hidden h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface font-display text-base font-medium text-ink sm:flex"
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={reduce ? {} : { scale: 1, opacity: 1 }}
            transition={
              reduce ? undefined : { type: "spring", stiffness: 380, damping: 18, delay: 0.16 }
            }
          >
            {section}
          </motion.div>
        )}
      </div>
    </header>
  );
}
