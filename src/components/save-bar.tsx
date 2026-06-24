"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Check, RotateCcw, Save, ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { nextLocation, type PhaseKey } from "@/lib/flow";

// Sticky panel footer: Save commits the draft, flashes "Saved", then auto-advances
// to the next step (and into the next tab at a tab boundary). The current step is
// read from the URL so panels only need to pass their tab.
export function SaveBar({
  dirty,
  saved,
  onSave,
  onDiscard,
  tab,
}: {
  dirty: boolean;
  saved: boolean;
  onSave: () => void;
  onDiscard: () => void;
  tab: PhaseKey;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = Number(searchParams.get("step")) || 1;
  const [advancing, setAdvancing] = useState(false);
  const next = nextLocation(tab, step);

  function handleSave() {
    onSave(); // commits the draft + flashes "saved" in the panel
    setAdvancing(true);
    setTimeout(() => {
      if (next) router.push(`/${next.tab}?step=${next.step}`, { scroll: false });
      setAdvancing(false);
    }, 800);
  }

  const showSaved = saved || advancing;

  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
      <div className="text-[12px]">
        <AnimatePresence mode="wait">
          {showSaved ? (
            <motion.span
              key="saved"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 font-medium text-go"
            >
              <Check className="h-4 w-4" strokeWidth={3} /> Saved
              {advancing && next && (
                <span className="ml-1 inline-flex items-center gap-1 text-muted">
                  · next step <ArrowRight className="h-3 w-3" />
                </span>
              )}
            </motion.span>
          ) : dirty ? (
            <motion.span
              key="dirty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1.5 text-pending"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-pending" /> Unsaved changes
            </motion.span>
          ) : (
            <span className="text-muted">All changes saved</span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onDiscard}
          disabled={!dirty}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[14px] font-medium transition",
            dirty
              ? "border-line bg-white text-ink hover:bg-surface"
              : "cursor-not-allowed border-line text-line-strong"
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Discard
        </button>
        <button
          onClick={handleSave}
          disabled={advancing}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-medium transition",
            advancing
              ? "cursor-wait bg-surface-strong text-muted"
              : "bg-ink text-white hover:bg-brand-600"
          )}
        >
          <Save className="h-4 w-4" />
          {next ? "Save & next" : "Save & finish"}
        </button>
      </div>
    </div>
  );
}
