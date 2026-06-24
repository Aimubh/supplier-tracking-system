// Domain model for the sourcing pipeline.
// Mirrors Section 4 (Workflow State Machine) of the technical design.
// Kept framework-agnostic so the real backend can reuse these definitions.

export type Phase = "EVALUATE" | "PRODUCTION" | "LOGISTICS";

export type Stage =
  | "DISCOVERED"
  | "VALIDATING"
  | "SUPPLIER_SOURCING"
  | "SAMPLING"
  | "SAMPLE_OK"
  | "COMPLIANCE_OK"
  | "COSTING_GO"
  | "PO_ISSUED"
  | "IN_PRODUCTION"
  | "QC_PASS"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "ARRIVED"
  | "CUSTOMS"
  | "CLEARED"
  | "DELIVERED"
  | "RECEIVED"
  | "HANDED_OFF";

export type ProductStatus =
  | "ACTIVE"
  | "ON_HOLD"
  | "REJECTED"
  | "ORDERED"
  | "LANDED";

export interface StageDef {
  key: Stage;
  label: string;
  phase: Phase;
  // A hard gate: the stage cannot be entered until its checkpoint passes.
  gate?: boolean;
  // Short description of what must be true to reach this stage.
  gateRule?: string;
}

export const PHASES: Record<Phase, { label: string; blurb: string }> = {
  EVALUATE: {
    label: "Phase A · Evaluate & Decide",
    blurb: "Pre-order. Validate demand, vet supplier, prove the economics.",
  },
  PRODUCTION: {
    label: "Phase B · Order & Production",
    blurb: "PO issued by us. Pay on milestones. Never pay balance before QC.",
  },
  LOGISTICS: {
    label: "Phase C · Logistics & Landing",
    blurb: "Ship, clear customs, receive, reconcile, hand off to inventory.",
  },
};

// Ordered list of every stage in the pipeline.
export const STAGES: StageDef[] = [
  { key: "DISCOVERED", label: "Discovered", phase: "EVALUATE" },
  { key: "VALIDATING", label: "Validating", phase: "EVALUATE" },
  { key: "SUPPLIER_SOURCING", label: "Supplier Sourcing", phase: "EVALUATE" },
  { key: "SAMPLING", label: "Sampling", phase: "EVALUATE" },
  {
    key: "SAMPLE_OK",
    label: "Sample OK",
    phase: "EVALUATE",
    gate: true,
    gateRule: "Physical sample APPROVED.",
  },
  {
    key: "COMPLIANCE_OK",
    label: "Compliance OK",
    phase: "EVALUATE",
    gate: true,
    gateRule: "HS code, duty & licence CLEARED before ordering.",
  },
  {
    key: "COSTING_GO",
    label: "Costing GO",
    phase: "EVALUATE",
    gate: true,
    gateRule: "Per-market backward-costing verdict = GO.",
  },
  { key: "PO_ISSUED", label: "PO Issued", phase: "PRODUCTION" },
  { key: "IN_PRODUCTION", label: "In Production", phase: "PRODUCTION" },
  {
    key: "QC_PASS",
    label: "QC Pass",
    phase: "PRODUCTION",
    gate: true,
    gateRule: "Pre-shipment QC = PASS. Unblocks balance payment.",
  },
  { key: "SHIPPED", label: "Shipped", phase: "LOGISTICS" },
  { key: "IN_TRANSIT", label: "In Transit", phase: "LOGISTICS" },
  { key: "ARRIVED", label: "Arrived", phase: "LOGISTICS" },
  { key: "CUSTOMS", label: "Customs", phase: "LOGISTICS" },
  { key: "CLEARED", label: "Cleared", phase: "LOGISTICS" },
  { key: "DELIVERED", label: "Delivered", phase: "LOGISTICS" },
  { key: "RECEIVED", label: "Received (GRN)", phase: "LOGISTICS" },
  { key: "HANDED_OFF", label: "Handed Off", phase: "LOGISTICS" },
];

export const STAGE_INDEX: Record<Stage, number> = STAGES.reduce(
  (acc, s, i) => {
    acc[s.key] = i;
    return acc;
  },
  {} as Record<Stage, number>
);

export function stageDef(key: Stage): StageDef {
  return STAGES[STAGE_INDEX[key]];
}

export function phaseStages(phase: Phase): StageDef[] {
  return STAGES.filter((s) => s.phase === phase);
}

// Has a product reached / passed a given stage?
export function hasReached(current: Stage, target: Stage): boolean {
  return STAGE_INDEX[current] >= STAGE_INDEX[target];
}
