// Single source of truth for a product's live status across the whole pipeline.
// Both the dashboard and the panels read from here so they never disagree.

import type { Product } from "./store";
import { computeCosting } from "./costing";

export type PhaseKey = "pre-order" | "on-working" | "post-order";
export type PhaseState = "done" | "active" | "todo";

export interface StepStatus {
  tab: PhaseKey;
  step: number;
  label: string;
  done: boolean;
}

export interface Flow {
  steps: StepStatus[];
  doneCount: number;
  total: number;
  percent: number;
  // current stage label, e.g. "On-Working · MOQ decision"
  stageLabel: string;
  // the next pending step (for the resume link), or null if complete
  next: { tab: PhaseKey; step: number; label: string } | null;
  phases: Record<PhaseKey, PhaseState>;
  alerts: { tone: "block" | "pending"; text: string }[];
}

const PHASE_NAME: Record<PhaseKey, string> = {
  "pre-order": "Pre-Order",
  "on-working": "On-Working",
  "post-order": "Post-Order",
};

// Number of sub-steps in each tab.
const STEP_COUNT: Record<PhaseKey, number> = {
  "pre-order": 4,
  "on-working": 3,
  "post-order": 3,
};

// The ordered tabs, so the last step of one flows into the first of the next.
const TAB_ORDER: PhaseKey[] = ["pre-order", "on-working", "post-order"];

// Given the current (tab, step), return where Save should advance to — the next
// step in the tab, or the first step of the next tab. Null if it's the very end.
export function nextLocation(
  tab: PhaseKey,
  step: number
): { tab: PhaseKey; step: number } | null {
  if (step < STEP_COUNT[tab]) return { tab, step: step + 1 };
  const idx = TAB_ORDER.indexOf(tab);
  if (idx < TAB_ORDER.length - 1) return { tab: TAB_ORDER[idx + 1], step: 1 };
  return null; // end of the whole pipeline
}

export function getFlow(p: Product): Flow {
  const costing = computeCosting(p.costing, p.compliance.dutyRatePct, p.compliance.igstRatePct);
  const w = p.working;
  const l = p.logistics;

  // Define every step and whether its data marks it done.
  const steps: StepStatus[] = [
    // Pre-Order
    { tab: "pre-order", step: 1, label: "Market check", done: p.market.length > 0 },
    { tab: "pre-order", step: 2, label: "Vet supplier", done: p.supplier.verification === "VERIFIED" },
    { tab: "pre-order", step: 3, label: "Compliance", done: p.compliance.status === "CLEARED" },
    { tab: "pre-order", step: 4, label: "Costing", done: costing.verdict === "GO" },
    // On-Working
    {
      tab: "on-working",
      step: 1,
      label: "Product Decision",
      done: w.sampleResult === "APPROVED" && w.moq > 0 && w.rateValue > 0,
    },
    {
      tab: "on-working",
      step: 2,
      label: "Design Processing",
      done: w.packagingResult === "APPROVED" && w.orderProcessing,
    },
    { tab: "on-working", step: 3, label: "Dispatch", done: w.dispatched },
    // Post-Order
    { tab: "post-order", step: 1, label: "Dispatch & docs", done: l.mLoadedToShip && !!l.blNumber },
    { tab: "post-order", step: 2, label: "Custom clearance", done: l.arrived && l.outOfCharge },
    { tab: "post-order", step: 3, label: "Arrival & GRN", done: l.handedToInventory },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = Math.round((doneCount / total) * 100);

  // Next pending step = first not-done step.
  const nextStep = steps.find((s) => !s.done) ?? null;
  const next = nextStep
    ? { tab: nextStep.tab, step: nextStep.step, label: nextStep.label }
    : null;

  // Current stage = the next pending step's location (or "complete").
  const stageLabel = next
    ? `${PHASE_NAME[next.tab]} · ${next.label}`
    : "Complete · handed to inventory";

  // Phase status pills.
  const phaseState = (tab: PhaseKey): PhaseState => {
    const inPhase = steps.filter((s) => s.tab === tab);
    const allDone = inPhase.every((s) => s.done);
    const anyDone = inPhase.some((s) => s.done);
    if (allDone) return "done";
    if (anyDone) return "active";
    // active if it's the current phase even with nothing done yet
    return next?.tab === tab ? "active" : "todo";
  };

  // Real-time alerts.
  const alerts: Flow["alerts"] = [];
  if (w.sampleResult === "REJECTED") alerts.push({ tone: "block", text: "Sample rejected" });
  if (w.packagingResult === "REJECTED") alerts.push({ tone: "block", text: "Logo rejected" });
  if (p.compliance.status !== "CLEARED" && p.compliance.hsCode)
    alerts.push({ tone: "pending", text: "Compliance not cleared" });
  if (costing.verdict === "NO_GO") alerts.push({ tone: "block", text: "Costing is NO-GO" });
  const balancePending = p.payments.some((x) => x.type === "BALANCE" && x.status === "PENDING");
  if (balancePending && w.sampleResult !== "APPROVED")
    alerts.push({ tone: "pending", text: "Balance locked" });
  if (l.portDays >= 4 && !l.outOfCharge)
    alerts.push({ tone: "pending", text: "Demurrage risk" });

  return {
    steps,
    doneCount,
    total,
    percent,
    stageLabel,
    next,
    phases: {
      "pre-order": phaseState("pre-order"),
      "on-working": phaseState("on-working"),
      "post-order": phaseState("post-order"),
    },
    alerts,
  };
}
