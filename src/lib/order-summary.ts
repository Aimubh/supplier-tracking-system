// Order Summary rollup — turns a product's scattered data into one P&L sheet.
// Reads what's already entered across the tabs and folds in the actual expenses
// recorded on the Order Summary page itself. Pure function, no side effects.

import type { Product, CurrencyCode, ExpenseMoneyField } from "./store";
import { getFlow } from "./flow";
import { convert, type Rates } from "./fx";

// ---- per-field currency resolution ------------------------------------------
// Each money field may carry its own currency override. When absent, expense and
// product fields fall back to the product currency, shipment fields to the
// shipment currency — i.e. the original single-currency-per-section behaviour.

export function prodCurrency(p: Product): CurrencyCode {
  return p.working.rateCurrency ?? "INR";
}
export function shipCurrency(p: Product): CurrencyCode {
  return p.working.shipmentCurrency ?? "INR";
}

// Currency an itemised expense field is entered in.
export function expenseCurrency(p: Product, field: ExpenseMoneyField): CurrencyCode {
  return p.expenses.fieldCurrency?.[field] ?? prodCurrency(p);
}

// Currency a payment amount is entered in. rateValue/advancePaid default to the
// product currency; shipmentValue/shipmentAdvance to the shipment currency.
export function paymentCurrency(
  p: Product,
  field: "rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance"
): CurrencyCode {
  const override = p.working.paymentCurrency?.[field];
  if (override) return override;
  return field.startsWith("shipment") ? shipCurrency(p) : prodCurrency(p);
}

// All itemised expense money fields, in display order.
export const EXPENSE_MONEY_FIELDS: ExpenseMoneyField[] = [
  "oceanFreight", "doCharge", "thcCharge", "cfsCharge", "wgmtCharge", "gstCharge",
  "dutyActual", "chaCharges", "lastMileCost", "otherExpense",
];

// Sum every itemised expense field, converting each from its own currency into
// `to` using live rates. `indiaTransportCost` (a Logistics field) is treated as
// being in the product currency, matching the original behaviour. Returns the
// total expressed in `to`. With rates=null, convert() is an identity, so this
// degrades to the old raw sum (fine while rates load / for same-currency data).
export function expensesIn(p: Product, to: CurrencyCode, rates: Rates | null): number {
  const e = p.expenses;
  const fields = EXPENSE_MONEY_FIELDS.reduce(
    (sum, k) => sum + convert((e[k] as number) || 0, expenseCurrency(p, k), to, rates),
    0
  );
  const india = convert(p.logistics.indiaTransportCost || 0, prodCurrency(p), to, rates);
  return fields + india;
}

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

// `rates` is optional. When provided, every amount is normalised into the
// PRODUCT currency (working.rateCurrency) before being summed — so fields entered
// in different currencies add up correctly. When omitted (or null), convert() is
// an identity and the function behaves exactly as before (raw single-currency
// sums). The summary's figures are therefore all expressed in the product
// currency; the view/bill then convert that single base into the display currency.
export function computeOrderSummary(p: Product, rates: Rates | null = null): OrderSummary {
  const f = getFlow(p);
  const w = p.working;
  const e = p.expenses;
  const L = p.logistics;
  const base = prodCurrency(p);
  // Normalise an expense field from its own currency into the product base.
  const ex = (field: ExpenseMoneyField) => convert((e[field] as number) || 0, expenseCurrency(p, field), base, rates);
  // Normalise a payment amount from its own currency into the product base.
  const pay = (field: "rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance") =>
    convert((w[field] as number) || 0, paymentCurrency(p, field), base, rates);

  const totalQty = w.moq || 0;
  const goodsTotal = pay("rateValue");
  const advancePaid = Math.min(pay("advancePaid"), goodsTotal);
  const goodsPending = Math.max(goodsTotal - advancePaid, 0);

  // Freight = itemised lines (ocean + destination charges + GST), falling back to
  // the legacy single freight figure if no itemised values are present. Each line
  // is converted from its own currency into the product base first.
  const freightItems =
    ex("oceanFreight") + ex("doCharge") + ex("thcCharge") +
    ex("cfsCharge") + ex("wgmtCharge") + ex("gstCharge");
  const freight = freightItems > 0 ? freightItems : convert(e.freightActual || 0, base, base, rates);
  const duty = ex("dutyActual");
  const cha = ex("chaCharges");
  // Last-mile = the expenses field plus the India transport cost recorded on the
  // Product Arrival step (India transport is in the product currency).
  const lastMile = ex("lastMileCost") + convert(L.indiaTransportCost || 0, base, base, rates);
  const other = ex("otherExpense");
  const expensesTotal = freight + duty + cha + lastMile + other;

  const finalExpense = goodsTotal + expensesTotal;
  const finalPerUnit = totalQty > 0 ? finalExpense / totalQty : 0;

  const sellingTotal = ex("sellingPriceTotal");
  const profit = sellingTotal - finalExpense;
  const profitPct = sellingTotal > 0 ? (profit / sellingTotal) * 100 : 0;
  const profitable = sellingTotal > 0 ? profit >= 0 : null;

  // Arrival = fully landed into inventory. Until then, the bill should flag the
  // amount still payable — the final landed cost minus everything paid so far
  // (the product advance plus the shipment advance).
  const arrived = !!L.handedToInventory;
  const shipmentValue = pay("shipmentValue");
  const shipmentAdvance = Math.min(pay("shipmentAdvance"), shipmentValue);
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
