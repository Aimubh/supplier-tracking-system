// Sub-tabs for each working tab — the finalized structure.
// Gate steps are flagged so the UI highlights the hard checkpoints.

export interface ProcessStep {
  n: number;
  title: string;
  desc: string;
  gate?: boolean; // a hard checkpoint that must pass before proceeding
}

// 2) PRE-ORDER — decide before we spend a rupee.
export const PRE_ORDER_STEPS: ProcessStep[] = [
  {
    n: 1,
    title: "Market check",
    desc: "Competitor prices and realistic demand on each channel we would sell on.",
  },
  {
    n: 2,
    title: "Find and vet the supplier",
    desc: "Confirm it is a real factory, not a middleman.",
  },
  {
    n: 3,
    title: "Check compliance",
    desc: "HS code, duty / GST, and whether it needs BIS or any import licence.",
    gate: true,
  },
  {
    n: 4,
    title: "Costing check",
    desc: "Work the price backwards from what we can sell at; decide go or no-go.",
    gate: true,
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
