// Backward-costing engine. Per the docs: we never mark up the supplier price.
// Start from the realistic channel selling price, subtract every channel cost and
// the landed cost, and what remains is our margin → GO / NO-GO.

import type { Costing, Verdict } from "./store";

export interface CostingResult {
  landedCost: number; // ex-works + freight + duty + IGST, per unit
  channelCost: number; // referral + fulfilment + ads + returns
  netProfit: number; // per unit
  netMarginPct: number; // of selling price
  targetLandedCost: number; // max we can pay and still hit required margin
  verdict: Verdict;
}

export function computeCosting(c: Costing, dutyRatePct = 0, igstRatePct = 0): CostingResult {
  const selling = c.sellingPrice || 0;

  // Landed cost per unit: supplier price + freight, plus duty & IGST on (ex-works+freight).
  const dutiable = c.exWorks + c.freightPerUnit;
  const duty = dutiable * (dutyRatePct / 100);
  const igst = (dutiable + duty) * (igstRatePct / 100);
  const landedCost = dutiable + duty + igst;

  // Channel costs taken off the selling price.
  const referral = selling * (c.referralPct / 100);
  const ads = selling * (c.adPct / 100);
  const returns = selling * (c.returnPct / 100);
  const channelCost = referral + c.fulfilmentFee + ads + returns;

  const netProfit = selling - channelCost - landedCost;
  const netMarginPct = selling > 0 ? (netProfit / selling) * 100 : 0;

  // Max landed cost we can afford and still clear the required margin.
  const targetLandedCost = selling - channelCost - selling * (c.requiredMarginPct / 100);

  let verdict: Verdict = "PENDING";
  if (selling > 0 && (c.exWorks > 0 || landedCost > 0)) {
    verdict = netMarginPct >= c.requiredMarginPct ? "GO" : "NO_GO";
  }

  return {
    landedCost,
    channelCost,
    netProfit,
    netMarginPct,
    targetLandedCost,
    verdict,
  };
}
