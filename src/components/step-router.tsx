"use client";

import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { motion, useReducedMotion, EASE } from "./motion";
import { SpotlightCard } from "./spotlight-card";
import { ProductSwitcher } from "./product-switcher";
import { useStore } from "@/lib/store";
import { PackageOpen } from "lucide-react";
import type { TabKey } from "@/lib/access";

import { MarketPanel, SupplierPanel, CompliancePanel, CostingPanel } from "./panels/pre-order";
import {
  ProductDecisionPanel,
  DesignProcessingPanel,
  DispatchPanel,
} from "./panels/on-working";
import {
  DispatchDocsPanel,
  CustomClearancePanel,
  ArrivalPanel,
} from "./panels/post-order";

// Map (tab, step) → the panel component to render.
const PANELS: Record<TabKey, Record<number, () => JSX.Element | null>> = {
  dashboard: {},
  directory: {},
  "pre-order": { 1: MarketPanel, 2: SupplierPanel, 3: CompliancePanel, 4: CostingPanel },
  "on-working": {
    1: ProductDecisionPanel,
    2: DesignProcessingPanel,
    3: DispatchPanel,
  },
  "post-order": {
    1: DispatchDocsPanel,
    2: CustomClearancePanel,
    3: ArrivalPanel,
  },
};

export function StepRouter({ tab }: { tab: TabKey }) {
  const searchParams = useSearchParams();
  const reduce = useReducedMotion();
  const { active } = useStore();
  const step = Number(searchParams.get("step")) || 1;
  const Panel = PANELS[tab]?.[step] ?? null;

  return (
    <div>
      {/* Active-product bar */}
      <div className="mb-4">
        <ProductSwitcher />
      </div>

      <SpotlightCard className="min-h-[420px] p-6">
        {!active ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface text-ink ring-1 ring-inset ring-line">
              <PackageOpen className="h-6 w-6" />
            </div>
            <div>
              <h2 className="font-display text-lg font-medium text-ink">
                Pick a product to begin
              </h2>
              <p className="mt-1.5 max-w-sm text-[14px] text-muted">
                Create or select a product above. Each step you fill in attaches to it, so
                one product flows through the whole pipeline.
              </p>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${tab}-${step}`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={reduce ? {} : { opacity: 1, y: 0 }}
              exit={reduce ? {} : { opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              {Panel ? <Panel /> : <p className="text-muted">Step not found.</p>}
            </motion.div>
          </AnimatePresence>
        )}
      </SpotlightCard>
    </div>
  );
}
