// Per-SKU sourcing & margin model — an exact in-app replica of the
// LAZERECOM_Sourcing_Model.xlsx "SKU Model" + "Assumptions" sheets.
//
// Backward-costing, per the app-logic skill: we never mark up the supplier price.
// We compute the landed cost from the FOB quote, then for each channel start from
// the realistic selling price, subtract every channel cost, and what remains is
// the contribution. The verdict is GO when the best channel clears the target
// margin. "Max FOB @ target" is the counter-offer ceiling — the highest FOB we
// can pay on the primary channel and still hit the target contribution margin.
//
// Every formula here was verified to the decimal against the reference workbook.

// ---- Assumptions (the "Drivers & Assumptions" sheet) -------------------------
// Defaults match the workbook (mid-Jun 2026). All are editable per product so a
// user can run any scenario, exactly like the blue input cells in the sheet.
export interface SourcingAssumptions {
  usdToInr: number; // USD → INR
  usdToAed: number; // USD → AED (AED pegged at 3.6725)
  freightPctIndia: number; // freight % of FOB, China → India (default)
  clearancePct: number; // clearance / CHA / inland handling, % of CIF
  bcdPct: number; // Basic Customs Duty % (HS-code dependent)
  swsPct: number; // Social Welfare Surcharge, % of BCD
  gstSalePct: number; // GST on India sale
  amazonReferralPct: number; // Amazon.in referral % (applies only when price > threshold)
  amazonReferralThreshold: number; // ₹ price above which referral applies
  amazonFixedFee: number; // ₹/listing (closing + shipping)
  adPct: number; // ad spend % of net realization
  qCommTakePct: number; // quick-commerce all-in take rate
  uaeReferralPct: number; // UAE Amazon/Noon referral %
  uaeFulfilAed: number; // UAE fulfilment AED/listing
  uaeDutyPct: number; // UAE import duty % on CIF
  uaeVatPct: number; // UAE VAT % (creditable)
  freightPctUae: number; // freight % of FOB, China → UAE
  targetMarginPct: number; // target contribution margin (drives Max FOB)
  qCommFloorPct: number; // min margin to justify q-commerce take + listing fee
}

export const DEFAULT_ASSUMPTIONS: SourcingAssumptions = {
  usdToInr: 94.5,
  usdToAed: 3.6725,
  freightPctIndia: 0.12,
  clearancePct: 0.04,
  bcdPct: 0.1,
  swsPct: 0.1,
  gstSalePct: 0.18,
  amazonReferralPct: 0.06,
  amazonReferralThreshold: 1000,
  amazonFixedFee: 70,
  adPct: 0.1,
  qCommTakePct: 0.33,
  uaeReferralPct: 0.15,
  uaeFulfilAed: 8,
  uaeDutyPct: 0.05,
  uaeVatPct: 0.05,
  freightPctUae: 0.15,
  targetMarginPct: 0.45,
  qCommFloorPct: 0.55,
};

// ---- Per-SKU inputs (the editable columns of the "SKU Model" sheet) ----------
export interface SourcingInputs {
  itemName: string;
  variant: string; // variant / spec
  colour: string;
  hsnCode: string;
  size: string; // free text dimension, e.g. "84×530 mm"
  unitWeightG: number; // unit weight (g)
  packUnits: number; // pieces per listing/pack
  fobUsd: number; // FOB / ex-works, $/piece
  freightPctOverride: number | null; // override India freight % for bulky SKUs
  bcdPctOverride: number | null; // override BCD % per HS code
  orderQty: number; // order quantity (pieces)
  sellPriceInr: number; // India sell price (₹ incl GST)
  sellPriceAed: number; // UAE sell price (AED)
  referenceAmazonLink: string;
}

export const DEFAULT_SOURCING_INPUTS: SourcingInputs = {
  itemName: "",
  variant: "",
  colour: "",
  hsnCode: "",
  size: "",
  unitWeightG: 0,
  packUnits: 1,
  fobUsd: 0,
  freightPctOverride: null,
  bcdPctOverride: null,
  orderQty: 0,
  sellPriceInr: 0,
  sellPriceAed: 0,
  referenceAmazonLink: "",
};

export type Channel = "AMAZON_INDIA" | "Q_COMMERCE" | "UAE_EXPORT";
export type SourcingVerdict = "GO" | "NO_GO" | "PENDING";

export interface ChannelResult {
  channel: Channel;
  label: string;
  net: number; // net realization after channel costs (₹ for India, AED for UAE)
  contribution: number; // net − landed, per piece
  contributionPct: number; // contribution as a fraction of net (0–1)
  clearsTarget: boolean;
}

export interface SourcingResult {
  // Landed cost build-up (₹ per piece)
  cifInr: number;
  dutyInr: number; // BCD + SWS
  clearanceInr: number;
  landedInr: number; // CIF + duty + clearance
  totalLandedInr: number; // landed × order qty

  // Per-channel contribution
  channels: ChannelResult[];
  primaryChannel: Channel | null; // best channel that clears target (else best overall)
  bestContributionPct: number;

  // Counter-offer ceiling on the primary channel (USD/piece)
  maxFobUsd: number;

  verdict: SourcingVerdict;
}

// Effective freight / BCD with per-SKU overrides applied.
function eff(a: SourcingAssumptions, i: SourcingInputs) {
  return {
    freightIndia: i.freightPctOverride ?? a.freightPctIndia,
    bcd: i.bcdPctOverride ?? a.bcdPct,
  };
}

// Landed cost per piece in ₹ (India). CIF = FOB × (1+freight) × FX.
function landedIndia(a: SourcingAssumptions, i: SourcingInputs) {
  const { freightIndia, bcd } = eff(a, i);
  const cif = i.fobUsd * (1 + freightIndia) * a.usdToInr;
  const duty = cif * bcd * (1 + a.swsPct);
  const clearance = cif * a.clearancePct;
  const landed = cif + duty + clearance;
  return { cif, duty, clearance, landed };
}

function amazonIndia(a: SourcingAssumptions, i: SourcingInputs, landed: number): ChannelResult {
  const netExclGst = i.sellPriceInr / (1 + a.gstSalePct);
  const referral =
    i.sellPriceInr > a.amazonReferralThreshold ? netExclGst * a.amazonReferralPct : 0;
  const net = netExclGst - referral - a.amazonFixedFee - netExclGst * a.adPct;
  const contribution = net - landed;
  const contributionPct = netExclGst > 0 ? contribution / netExclGst : 0;
  return {
    channel: "AMAZON_INDIA",
    label: "Amazon India",
    net,
    contribution,
    contributionPct,
    clearsTarget: contributionPct >= a.targetMarginPct,
  };
}

function qCommerce(a: SourcingAssumptions, i: SourcingInputs, landed: number): ChannelResult {
  const netExclGst = i.sellPriceInr / (1 + a.gstSalePct);
  const net = netExclGst - netExclGst * a.qCommTakePct;
  const contribution = net - landed;
  const contributionPct = netExclGst > 0 ? contribution / netExclGst : 0;
  // Q-commerce only counts as viable above its own (higher) floor.
  return {
    channel: "Q_COMMERCE",
    label: "Q-Commerce",
    net,
    contribution,
    contributionPct,
    clearsTarget: contributionPct >= a.qCommFloorPct,
  };
}

function uaeExport(a: SourcingAssumptions, i: SourcingInputs): ChannelResult {
  // UAE landed in AED: CIF (China→UAE freight) + 5% duty. VAT is creditable → excluded.
  const cifAed = i.fobUsd * (1 + a.freightPctUae) * a.usdToAed;
  const landedAed = cifAed * (1 + a.uaeDutyPct);
  const netExclVat = i.sellPriceAed / (1 + a.uaeVatPct);
  const net = netExclVat - netExclVat * a.uaeReferralPct - a.uaeFulfilAed;
  const contribution = net - landedAed;
  const contributionPct = netExclVat > 0 ? contribution / netExclVat : 0;
  return {
    channel: "UAE_EXPORT",
    label: "UAE Export",
    net,
    contribution,
    contributionPct,
    clearsTarget: contributionPct >= a.targetMarginPct,
  };
}

// Max FOB ($/pc) on the primary channel that still hits the target margin.
// landed = FOB × k, so solve target = (channelNet − FOB·k)/net for FOB.
function maxFobForChannel(
  a: SourcingAssumptions,
  i: SourcingInputs,
  channel: Channel
): number {
  const { freightIndia, bcd } = eff(a, i);
  if (channel === "UAE_EXPORT") {
    const kAed = (1 + a.freightPctUae) * a.usdToAed * (1 + a.uaeDutyPct);
    const netExclVat = i.sellPriceAed / (1 + a.uaeVatPct);
    const net = netExclVat - netExclVat * a.uaeReferralPct - a.uaeFulfilAed;
    return kAed > 0 ? (net - a.targetMarginPct * netExclVat) / kAed : 0;
  }
  // India channels share the same landed-cost slope k (₹ per $ of FOB).
  const kInr = (1 + freightIndia) * a.usdToInr * (1 + bcd * (1 + a.swsPct) + a.clearancePct);
  const netExclGst = i.sellPriceInr / (1 + a.gstSalePct);
  let net: number;
  if (channel === "Q_COMMERCE") {
    net = netExclGst - netExclGst * a.qCommTakePct;
  } else {
    const referral =
      i.sellPriceInr > a.amazonReferralThreshold ? netExclGst * a.amazonReferralPct : 0;
    net = netExclGst - referral - a.amazonFixedFee - netExclGst * a.adPct;
  }
  return kInr > 0 ? (net - a.targetMarginPct * netExclGst) / kInr : 0;
}

export function computeSourcing(
  a: SourcingAssumptions,
  i: SourcingInputs
): SourcingResult {
  const { cif, duty, clearance, landed } = landedIndia(a, i);

  const channels: ChannelResult[] = [
    amazonIndia(a, i, landed),
    qCommerce(a, i, landed),
    uaeExport(a, i),
  ];

  // Primary channel: the highest-contribution channel that clears its target;
  // if none clears, fall back to the highest-contribution channel overall.
  const clearing = channels.filter((c) => c.clearsTarget);
  const pool = clearing.length > 0 ? clearing : channels;
  const best = pool.reduce((a, b) => (b.contributionPct > a.contributionPct ? b : a), pool[0]);

  const hasData = i.fobUsd > 0 && (i.sellPriceInr > 0 || i.sellPriceAed > 0);
  const verdict: SourcingVerdict = !hasData
    ? "PENDING"
    : clearing.length > 0
    ? "GO"
    : "NO_GO";

  return {
    cifInr: cif,
    dutyInr: duty,
    clearanceInr: clearance,
    landedInr: landed,
    totalLandedInr: landed * (i.orderQty || 0),
    channels,
    primaryChannel: hasData ? best.channel : null,
    bestContributionPct: best.contributionPct,
    maxFobUsd: hasData ? maxFobForChannel(a, i, best.channel) : 0,
    verdict,
  };
}
