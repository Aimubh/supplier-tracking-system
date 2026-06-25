// One-off: populate an existing product (or create one) with the Ningbo → Nhava
// Sheva forwarder-quote example, spread across the right fields so the whole flow
// is visible filled in. Run: npm run db:seed:example
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Use the most recent product, or create a demo one if none exist.
  let target = await prisma.product.findFirst({ orderBy: { createdAt: "desc" } });
  if (!target) {
    target = await prisma.product.create({ data: { name: "Sample Import (Ningbo)", category: "Home & Living" } });
    console.log("No products found — created a demo product.");
  }

  const merge = (existing, patch) => ({ ...(existing && typeof existing === "object" ? existing : {}), ...patch });

  // ---- Pre-Order: market + supplier + compliance + costing ----
  const market = [
    { id: "mk-1", channel: "Amazon.in", competitorPrice: 1499, demandPerMonth: 800 },
    { id: "mk-2", channel: "Flipkart", competitorPrice: 1399, demandPerMonth: 500 },
  ];
  const supplier = merge(target.supplier, {
    name: "Ningbo Trading Co.",
    type: "TRADING",
    contact: "sales@ningbo-example.cn",
    verification: "VERIFIED",
    notes: "EXW Ningbo, all-in pickup quoted.",
  });
  const compliance = merge(target.compliance, {
    hsCode: "3924.10",
    dutyRatePct: 10,
    igstRatePct: 18,
    licenceRequired: false,
    licenceStatus: "NOT_REQUIRED",
    status: "CLEARED",
  });
  const costing = merge(target.costing, {
    marketplace: "AMAZON_IN",
    sellingPrice: 1499,
    exWorks: 7.2,
    freightPerUnit: 1.1,
    referralPct: 15,
    fulfilmentFee: 80,
    adPct: 10,
    returnPct: 5,
    requiredMarginPct: 20,
  });

  // ---- On-Working: product decision (sample/MOQ/rate EXW USD 854 all-in) ----
  const working = merge(target.working, {
    sampleResult: "APPROVED",
    sampleNotes: "Finish and colour match approved.",
    moq: 250,
    moqNote: "250 pkgs first order (test batch).",
    rate: "EXW",
    rateValue: 854, // EXW USD 854 all-in
    rateCurrency: "USD",
    advancePaid: 300,
    moldRequired: false,
    packagingResult: "APPROVED",
    packagingDone: true,
    orderProcessing: true,
    productionStart: "2026-06-10",
    productionReady: "2026-07-01",
    dispatched: true,
  });

  // ---- Post-Order: shipment lane + dimensions + movement + customs ----
  const logistics = merge(target.logistics, {
    pol: "Ningbo",
    pod: "Nhava Sheva",
    packages: 250,
    grossWeightKg: 7500,
    volumeCbm: 21.17,
    vessel: "MV Example Star",
    containerNo: "MSCU1234567",
    blNumber: "NBOSHA250617",
    shippingAgentName: "OceanLink Forwarders",
    shippingAgentNumber: "+91 22 4000 0000",
    shippingAgentContact: "Rahul (ops)",
    mLoading: true,
    mToPort: true,
    mUnloadedAtPort: true,
    mLoadedToShip: true,
    etd: "2026-07-03",
    eta: "2026-07-22",
    arrived: true,
    chaName: "Mundra Clearing Agents",
    chaNumber: "+91 22 5000 0000",
    chaContact: "Suresh",
    chaAppointed: true,
    clearancePort: "Nhava Sheva",
    boeFiled: true,
    boeNumber: "BOE-2026-44210",
    outOfCharge: true,
    handedToInventory: false,
    docImages: target.logistics?.docImages ?? {},
  });

  // ---- Order Summary: itemised freight from the quote ----
  // Ocean freight USD 65 W/M × 21.17 CBM ≈ 1376.  Destination charges converted
  // to USD here purely as example numbers (in practice you'd enter INR amounts).
  const expenses = merge(target.expenses, {
    oceanFreight: 1376, // USD 65 W/M × 21.17
    doCharge: 24, // DO INR2000/BL ≈ $24
    thcCharge: 286, // THC 1125/CBM × 21.17 ≈ INR23,816 ≈ $286
    cfsCharge: 255, // CFS 1000/CBM × 21.17 ≈ INR21,170 ≈ $255
    wgmtCharge: 4, // WGMT INR350/BL ≈ $4
    gstCharge: 354, // 18% GST on destination charges (example)
    dutyActual: 0,
    chaCharges: 60,
    lastMileCost: 120,
    otherExpense: 0,
    sellingPriceTotal: 250 * 1499, // qty × selling price (example revenue)
    notes: "Seeded from the Ningbo → Nhava Sheva forwarder quote example.",
  });

  await prisma.product.update({
    where: { id: target.id },
    data: { category: target.category || "Home & Living", market, supplier, compliance, costing, working, logistics, expenses },
  });

  console.log(`Updated "${target.name}" (${target.id}) with the example data.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
