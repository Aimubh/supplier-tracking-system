import type { Stage, ProductStatus } from "./pipeline";

export interface MockProduct {
  id: string;
  name: string;
  category: string;
  sourceType: "INSTAGRAM" | "FACEBOOK" | "MARKETPLACE" | "EXHIBITION" | "OTHER";
  stage: Stage;
  status: ProductStatus;
  supplier: string;
  supplierType: "FACTORY" | "TRADING_COMPANY" | "UNKNOWN";
  unitPriceUsd: number; // indicative quoted unit price
  moq: number;
  targetMarkets: string[];
  // Lightweight gate snapshot for the card.
  gates: {
    sample: "PENDING" | "APPROVED" | "REJECTED";
    compliance: "BLOCKED" | "CLEARED" | "NOT_STARTED";
    costing: "GO" | "NO_GO" | "PENDING";
    qc: "PENDING" | "PASS" | "FAIL" | "NA";
  };
  group: "GIFTABLE" | "MID" | "COMMODITY";
  note?: string;
  rejectReason?: string;
}

// Products drawn from the live silicone quotation (Section 5 of the business plan).
export const MOCK_PRODUCTS: MockProduct[] = [
  {
    id: "p-collapsible-cup",
    name: "Collapsible Silicone Cup",
    category: "Drinkware / Travel",
    sourceType: "INSTAGRAM",
    stage: "IN_PRODUCTION",
    status: "ORDERED",
    supplier: "Shenzhen Hua Sil Co.",
    supplierType: "FACTORY",
    unitPriceUsd: 1.35,
    moq: 10000,
    targetMarkets: ["AMAZON_IN", "AMAZON_AE", "BLINKIT"],
    gates: { sample: "APPROVED", compliance: "CLEARED", costing: "GO", qc: "PENDING" },
    group: "GIFTABLE",
    note: "Strongest fit — light, unbreakable, packable, on-brand for travel range.",
  },
  {
    id: "p-glass-coffee-cup",
    name: "Glass Coffee Cup w/ Silicone Strap",
    category: "Drinkware",
    sourceType: "MARKETPLACE",
    stage: "COSTING_GO",
    status: "ON_HOLD",
    supplier: "Shenzhen Hua Sil Co.",
    supplierType: "FACTORY",
    unitPriceUsd: 1.9,
    moq: 10000,
    targetMarkets: ["AMAZON_IN", "AMAZON_AE"],
    gates: { sample: "APPROVED", compliance: "CLEARED", costing: "NO_GO", qc: "NA" },
    group: "GIFTABLE",
    note: "Margin looks good but glass is fragile + heavy. Breakage & freight kill it. On hold.",
  },
  {
    id: "p-phone-lanyard",
    name: "Silicone Phone Lanyard",
    category: "Accessories",
    sourceType: "INSTAGRAM",
    stage: "COMPLIANCE_OK",
    status: "ACTIVE",
    supplier: "Dongguan Bright Rubber",
    supplierType: "FACTORY",
    unitPriceUsd: 0.9,
    moq: 10000,
    targetMarkets: ["AMAZON_IN", "ZEPTO"],
    gates: { sample: "APPROVED", compliance: "CLEARED", costing: "PENDING", qc: "NA" },
    group: "GIFTABLE",
    note: "Design-led, brandable. Running backward-costing next.",
  },
  {
    id: "p-cooling-towel",
    name: "Cooling Towel",
    category: "Sports / Outdoor",
    sourceType: "FACEBOOK",
    stage: "SAMPLING",
    status: "ACTIVE",
    supplier: "Ningbo CoolTex",
    supplierType: "TRADING_COMPANY",
    unitPriceUsd: 1.32,
    moq: 10000,
    targetMarkets: ["AMAZON_IN"],
    gates: { sample: "PENDING", compliance: "NOT_STARTED", costing: "PENDING", qc: "NA" },
    group: "MID",
    note: "Decent use-case angle but competitive. Secondary priority.",
  },
  {
    id: "p-reusable-food-bag",
    name: "Reusable Silicone Food Bag",
    category: "Kitchen",
    sourceType: "MARKETPLACE",
    stage: "SUPPLIER_SOURCING",
    status: "ACTIVE",
    supplier: "Multiple quotes",
    supplierType: "UNKNOWN",
    unitPriceUsd: 0.85,
    moq: 10000,
    targetMarkets: ["AMAZON_IN", "BIGBASKET"],
    gates: { sample: "PENDING", compliance: "NOT_STARTED", costing: "PENDING", qc: "NA" },
    group: "MID",
  },
  {
    id: "p-quickdry-napkin",
    name: "Quick-Dry Napkin",
    category: "Kitchen",
    sourceType: "OTHER",
    stage: "VALIDATING",
    status: "ACTIVE",
    supplier: "—",
    supplierType: "UNKNOWN",
    unitPriceUsd: 0.55,
    moq: 10000,
    targetMarkets: ["AMAZON_IN"],
    gates: { sample: "PENDING", compliance: "NOT_STARTED", costing: "PENDING", qc: "NA" },
    group: "MID",
  },
  {
    id: "p-silicone-straps",
    name: "Silicone Straps (basic)",
    category: "Commodity",
    sourceType: "MARKETPLACE",
    stage: "DISCOVERED",
    status: "ACTIVE",
    supplier: "—",
    supplierType: "UNKNOWN",
    unitPriceUsd: 0.07,
    moq: 10000,
    targetMarkets: [],
    gates: { sample: "PENDING", compliance: "NOT_STARTED", costing: "PENDING", qc: "NA" },
    group: "COMMODITY",
    note: "Race to the bottom. Only useful as a bundle add-on.",
  },
  {
    id: "p-pebble-coasters",
    name: "Silicone Pebble Coasters",
    category: "Commodity",
    sourceType: "MARKETPLACE",
    stage: "DISCOVERED",
    status: "REJECTED",
    supplier: "—",
    supplierType: "UNKNOWN",
    unitPriceUsd: 0.32,
    moq: 10000,
    targetMarkets: [],
    gates: { sample: "PENDING", compliance: "NOT_STARTED", costing: "NO_GO", qc: "NA" },
    group: "COMMODITY",
    rejectReason: "No differentiation, very low ticket. Sold by everyone.",
  },
  {
    id: "p-basic-gloves",
    name: "Basic Silicone Gloves",
    category: "Commodity",
    sourceType: "MARKETPLACE",
    stage: "VALIDATING",
    status: "REJECTED",
    supplier: "—",
    supplierType: "UNKNOWN",
    unitPriceUsd: 0.54,
    moq: 10000,
    targetMarkets: [],
    gates: { sample: "PENDING", compliance: "NOT_STARTED", costing: "NO_GO", qc: "NA" },
    group: "COMMODITY",
    rejectReason: "Commodity, no margin. Bundle add-on only.",
  },
];
