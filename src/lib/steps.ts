// Sub-tabs for each working tab — the finalized structure.
// Gate steps are flagged so the UI highlights the hard checkpoints.

export interface ProcessStep {
  n: number;
  title: string;
  desc: string;
  gate?: boolean; // a hard checkpoint that must pass before proceeding
}

// 2) PRE-ORDER — decide before we spend a rupee.
// Streamlined to the single Sourcing model step (Market check / supplier vetting /
// compliance / costing are folded into it — paste a link or image and the model
// computes landed cost, channel margins, HSN and the GO / NO-GO verdict).
export const PRE_ORDER_STEPS: ProcessStep[] = [
  {
    n: 1,
    title: "Sourcing model",
    desc: "Full per-SKU landed cost and channel margins — the LAZERECOM model with a GO / NO-GO verdict and counter-offer ceiling.",
  },
];

// 3) ON-WORKING / PRODUCTION — after we decide to buy.
export const ON_WORKING_STEPS: ProcessStep[] = [
  {
    n: 1,
    title: "Product Decision",
    desc: "Sample check, order quantity (MOQ), rate term and mould setup — the core buy decision in one place.",
    gate: true,
  },
  {
    n: 2,
    title: "Design Processing",
    desc: "Approve the logo / packaging proofs, then mark the order in processing and set the production countdown.",
  },
  {
    n: 3,
    title: "Dispatch",
    desc: "Mark the goods dispatched once production is complete.",
    gate: true,
  },
];

// 4) POST-ORDER / LOGISTICS — getting it home.
export const POST_ORDER_STEPS: ProcessStep[] = [
  {
    n: 1,
    title: "Dispatch and Documentation",
    desc: "Goods load onto the vessel; collect Commercial Invoice, Packing List, and the Bill of Lading.",
  },
  {
    n: 2,
    title: "Custom Clearance",
    desc: "Sea transit & unloading at the Indian port, then file the Bill of Entry, pay duty + IGST, get out of charge.",
  },
  {
    n: 3,
    title: "Product arrival State",
    desc: "Last-mile to our warehouse; goods received and checked (GRN), then handed to inventory.",
  },
];
