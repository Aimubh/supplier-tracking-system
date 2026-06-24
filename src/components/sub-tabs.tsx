"use client";

import clsx from "clsx";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { motion, useReducedMotion, EASE } from "./motion";
import { SpotlightCard } from "./spotlight-card";
import { FileText, ArrowRight, ShieldCheck } from "lucide-react";
import type { ProcessStep } from "@/lib/steps";

type Accent = "violet" | "blue" | "emerald";

export function SubTabs({
  steps,
}: {
  steps: ProcessStep[];
  accent?: Accent;
}) {
  const reduce = useReducedMotion();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const fallback = steps[0]?.n ?? 1;
  const param = Number(searchParams.get("step"));
  const active = steps.some((s) => s.n === param) ? param : fallback;
  const step = steps.find((s) => s.n === active) ?? steps[0];

  function setActive(n: number) {
    router.replace(`${pathname}?step=${n}`, { scroll: false });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[272px_1fr]">
      {/* Left: step index */}
      <nav className="glass h-fit rounded-lg p-2">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="eyebrow">Steps</span>
          <span className="figure text-[11px] text-line-strong">
            {String(steps.length).padStart(2, "0")}
          </span>
        </div>
        <ul className="space-y-0.5">
          {steps.map((s) => {
            const isActive = s.n === active;
            return (
              <li key={s.n}>
                <motion.button
                  onClick={() => setActive(s.n)}
                  whileHover={reduce ? undefined : { x: 3 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className={clsx(
                    "group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13.5px] transition",
                    isActive ? "text-white" : "text-body hover:bg-surface hover:text-ink"
                  )}
                >
                  {isActive &&
                    (reduce ? (
                      <span className="absolute inset-0 -z-10 rounded-md bg-ink" />
                    ) : (
                      <motion.span
                        layoutId="substep-active"
                        transition={{ type: "spring", stiffness: 500, damping: 34 }}
                        className="absolute inset-0 -z-10 rounded-md bg-ink"
                      />
                    ))}
                  <span
                    className={clsx(
                      "figure flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold transition",
                      isActive ? "bg-white/15 text-white" : "bg-surface text-muted group-hover:text-ink"
                    )}
                  >
                    {String(s.n).padStart(2, "0")}
                  </span>
                  <span className={clsx("min-w-0 flex-1 truncate", isActive && "font-medium")}>
                    {s.title}
                  </span>
                  {s.gate ? (
                    <ShieldCheck className={clsx("h-3.5 w-3.5", isActive ? "text-white" : "text-pending")} />
                  ) : isActive ? (
                    <ArrowRight className="h-3.5 w-3.5 text-white" />
                  ) : null}
                </motion.button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Right: content panel */}
      <SpotlightCard className="min-h-[420px]">
        {/* Panel header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="figure text-[13px] font-semibold text-muted">
              {String(step.n).padStart(2, "0")}
            </span>
            <span className="eyebrow">
              Step {step.n} of {steps.length}
            </span>
          </div>
          {step.gate && (
            <span className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-pending ring-1 ring-inset ring-pending/30">
              <ShieldCheck className="h-3 w-3" />
              Gate
            </span>
          )}
        </div>

        {/* Animated body */}
        <div className="px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.n}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={reduce ? {} : { opacity: 1, y: 0 }}
              exit={reduce ? {} : { opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <motion.h2
                className="font-display text-[22px] font-medium tracking-tight text-ink"
                initial={reduce ? false : { opacity: 0, x: -10 }}
                animate={reduce ? {} : { opacity: 1, x: 0 }}
                transition={{ duration: 0.35, ease: EASE, delay: 0.04 }}
              >
                {step.title}
              </motion.h2>
              <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-muted">
                {step.desc}
              </p>

              {/* Empty working area */}
              <motion.div
                initial={reduce ? false : { opacity: 0, scale: 0.98 }}
                animate={reduce ? {} : { opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}
                className="mt-6 flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line bg-surface text-center"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-ink ring-1 ring-line">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[14px] font-medium text-ink">No entry recorded</p>
                  <p className="mt-1 text-[12px] text-muted">
                    This step&apos;s working area is empty.
                  </p>
                </div>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
      </SpotlightCard>
    </div>
  );
}
