"use client";

import clsx from "clsx";
import { Seal } from "./seal";
import { motion, staggerParent, riseItem, stampItem, useReducedMotion } from "./motion";
import type { ProcessStep } from "@/lib/steps";

// Process steps rendered as manifest line-items, revealed in sequence. Gate rows
// carry a customs seal that stamps itself onto the page.
export function StepList({ steps }: { steps: ProcessStep[] }) {
  const reduce = useReducedMotion();

  return (
    <div className="sheet rounded-sm">
      {/* Column header, like a form */}
      <div className="flex items-center gap-4 border-b border-rule px-5 py-2.5">
        <span className="eyebrow w-8">No.</span>
        <span className="eyebrow flex-1">Step</span>
        <span className="eyebrow">Status</span>
      </div>

      <motion.ol
        variants={reduce ? undefined : staggerParent}
        initial={reduce ? undefined : "hidden"}
        animate={reduce ? undefined : "show"}
      >
        {steps.map((step, i) => (
          <motion.li
            key={step.n}
            variants={reduce ? undefined : riseItem}
            className={clsx(
              "flex gap-4 px-5 py-4",
              i < steps.length - 1 && "border-b border-rule",
              step.gate && "bg-stamp-soft/30"
            )}
          >
            {/* Line number */}
            <div className="figure w-8 shrink-0 pt-0.5 text-[15px] font-semibold text-muted">
              {String(step.n).padStart(2, "0")}
            </div>

            {/* Body */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h3 className="font-display text-[15px] font-bold tracking-tight text-ink">
                  {step.title}
                </h3>
                {step.gate &&
                  (reduce ? (
                    <Seal label="Gate" tone="stamp" mark="✷" />
                  ) : (
                    <motion.span variants={stampItem} className="inline-flex">
                      <Seal label="Gate" tone="stamp" mark="✷" />
                    </motion.span>
                  ))}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{step.desc}</p>

              {/* Empty entry slot — fill later */}
              <div className="figure mt-3 flex items-center justify-center rounded-sm border border-dashed border-rule bg-paper/60 px-3 py-4 text-[10px] uppercase tracking-wider text-muted/60">
                No entry recorded
              </div>
            </div>
          </motion.li>
        ))}
      </motion.ol>
    </div>
  );
}
