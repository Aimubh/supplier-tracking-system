// Order Summary rollup — turns a product's scattered data into one P&L sheet.
// Reads what's already entered across the tabs and folds in the actual expenses
// recorded on the Order Summary page itself. Pure function, no side effects.

import type { Product, CurrencyCode } from "./store";
import { getFlow } from "./flow";

export interface OrderSummary {
  currency: CurrencyCode;
  // Order
  totalQty: number;
  rateTerm: string;
  goodsTotal: number; // agreed total for the goods (working.rateValue)
  // Payments
  advancePaid: number; // product advance
  goodsPending: number; // goods total minus advance
  shipmentValue: number; // shipment total
  shipmentAdvance: number; // shipment advance paid
  shipmentPending: number; // shipment total minus advance
  totalPaid: number; // product advance + shipment advance
  // Expenses (actuals recorded on this page)
  freight: number;
  duty: number;
  cha: number;
  lastMile: number;
  other: number;
  expensesTotal: number;
  // Landed
  finalExpense: number; // goods total + all expenses
  finalPerUnit: number;
  // Profit / loss
  sellingTotal: number;
  profit: number; // sellingTotal - finalExpense
  profitPct: number; // of selling
  profitable: boolean | null; // null when selling price not set
  // Status
  approvals: { label: string; ok: boolean | null }[];
  percent: number; // overall pipeline progress
  startDate: string; // production start
  endDate: string; // out-of-charge / arrival
  arrived: boolean; // product fully landed / handed to inventory
  outstanding: number; // amount still payable = final landed cost − advance paid
}

export function computeOrderSummary(p: Product): OrderSummary {
  const f = getFlow(p);
  const w = p.working;
  const e = p.expenses;
  const L = p.logistics;

  const totalQty = w.moq || 0;
  const goodsTotal = w.rateValue || 0;
  const advancePaid = Math.min(w.advancePaid || 0, goodsTotal);
  const goodsPending = Math.max(goodsTotal - advancePaid, 0);

  // Freight = itemised lines (ocean + destination charges + GST), falling back to
  // the legacy single freight figure if no itemised values are present.
  const freightItems =
    (e.oceanFreight || 0) + (e.doCharge || 0) + (e.thcCharge || 0) +
    (e.cfsCharge || 0) + (e.wgmtCharge || 0) + (e.gstCharge || 0);
  const freight = freightItems > 0 ? freightItems : e.freightActual || 0;
  const duty = e.dutyActual || 0;
  const cha = e.chaCharges || 0;
  // Last-mile = the expenses field plus the India transport cost recorded on the
  // Product Arrival step.
  const lastMile = (e.lastMileCost || 0) + (L.indiaTransportCost || 0);
  const other = e.otherExpense || 0;
  const expensesTotal = freight + duty + cha + lastMile + other;

  const finalExpense = goodsTotal + expensesTotal;
  const finalPerUnit = totalQty > 0 ? finalExpense / totalQty : 0;

  const sellingTotal = e.sellingPriceTotal || 0;
  const profit = sellingTotal - finalExpense;
  const profitPct = sellingTotal > 0 ? (profit / sellingTotal) * 100 : 0;
  const profitable = sellingTotal > 0 ? profit >= 0 : null;

  // Arrival = fully landed into inventory. Until then, the bill should flag the
  // amount still payable — the final landed cost minus everything paid so far
  // (the product advance plus the shipment advance).
  const arrived = !!L.handedToInventory;
  const shipmentValue = w.shipmentValue || 0;
  const shipmentAdvance = Math.min(w.shipmentAdvance || 0, shipmentValue);
  const shipmentPending = Math.max(shipmentValue - shipmentAdvance, 0);
  const totalPaid = advancePaid + shipmentAdvance;
  const outstanding = Math.max(finalExpense - totalPaid, 0);

  const approvals: OrderSummary["approvals"] = [
    { label: "Sample", ok: w.sampleResult === "APPROVED" ? true : w.sampleResult === "REJECTED" ? false : null },
    { label: "Logo / packaging", ok: w.packagingResult === "APPROVED" ? true : w.packagingResult === "REJECTED" ? false : null },
    { label: "Compliance", ok: p.compliance.status === "CLEARED" ? true : null },
    { label: "Dispatched", ok: w.dispatched ? true : null },
    { label: "Customs cleared", ok: L.outOfCharge ? true : null },
    { label: "In inventory", ok: L.handedToInventory ? true : null },
  ];

  return {
    currency: w.rateCurrency ?? "INR",
    totalQty,
    rateTerm: w.rate,
    goodsTotal,
    advancePaid,
    goodsPending,
    shipmentValue,
    shipmentAdvance,
    shipmentPending,
    totalPaid,
    freight,
    duty,
    cha,
    lastMile,
    other,
    expensesTotal,
    finalExpense,
    finalPerUnit,
    sellingTotal,
    profit,
    profitPct,
    profitable,
    approvals,
    percent: f.percent,
    startDate: w.productionStart || "",
    endDate: L.outOfChargeDate || L.eta || "",
    arrived,
    outstanding,
  };
}
