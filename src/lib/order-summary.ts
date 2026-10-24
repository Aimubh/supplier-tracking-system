// Order Summary rollup — turns a product's scattered data into one P&L sheet.
// Reads what's already entered across the tabs and folds in the actual expenses
// recorded on the Order Summary page itself. Pure function, no side effects.

import type { Product, Payment, CurrencyCode, ExpenseMoneyField } from "./store";
import { getFlow } from "./flow";
import { convert, convertAsOf, type Rates } from "./fx";

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

// ---- per-field valuation date ------------------------------------------------
// A payment is worth what it cost on the day it was made. Converting a May
// deposit at today's rate makes a settled invoice drift in value every time the
// page is opened, so each amount is converted at the rate for its own date.

// The date a payment field was settled on. Prefers an actual payment record,
// then the order date, then undefined (caller falls back to the live rate).
export function paymentDate(
  p: Product,
  field: "rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance"
): string | undefined {
  const paid = (p.payments ?? []).filter((x) => x.status === "PAID" && x.paidDate);
  if (field === "advancePaid") {
    const deposit = paid.find((x) => x.type === "DEPOSIT") ?? paid[0];
    if (deposit?.paidDate) return deposit.paidDate;
  }
  if (field === "shipmentAdvance") {
    const freight = paid.find((x) => x.type === "FREIGHT");
    if (freight?.paidDate) return freight.paidDate;
  }
  // Order value is struck when the order is placed.
  return p.working.productionStart || undefined;
}

// The rate actually paid, if it was recorded on the payment. Returned as a
// USD-based table so it drops into convert() unchanged. Only meaningful for
// USD->INR; anything else falls back to the market rate.
export function paymentFxTable(
  p: Product,
  field: "rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance"
): Rates | null {
  const paid = (p.payments ?? []).filter((x) => x.status === "PAID" && x.fxRate);
  if (paid.length === 0) return null;
  if (field === "advancePaid" || field === "rateValue") {
    // Several instalments at different rates: weight by amount so the blended
    // rate reflects what was actually remitted, not just the first payment's.
    const total = paid.reduce((a, x) => a + (x.amount || 0), 0);
    if (total <= 0) return null;
    const blended = paid.reduce((a, x) => a + (x.amount || 0) * (x.fxRate as number), 0) / total;
    return { USD: 1, INR: blended };
  }
  const freight = paid.find((x) => x.type === "FREIGHT");
  return freight?.fxRate ? { USD: 1, INR: freight.fxRate } : null;
}

// Convert a payment figure into the display currency at the rate the money
// actually moved: the rate recorded on the remittance when there is one, else
// the market rate on the payment date, else live. Every view that shows a goods
// or advance amount goes through here, so the bill, the Order Summary and the
// dashboard can never disagree on what a paid order cost.
export function convertPayment(
  p: Product,
  n: number,
  field: "rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance",
  from: CurrencyCode,
  to: CurrencyCode,
  rates: Rates | null,
  ratesByDate: Record<string, Rates | null> = {}
): number {
  // Goods: every instalment at the rate ENTERED for it (from the bank's debit
  // advice), blended by amount. Rates are never looked up automatically: a paid
  // instalment with no rate entered yet counts at today's rate, as an estimate,
  // and the payments box flags it until a rate is typed in.
  if (field === "rateValue" || field === "advancePaid") {
    const blended = instalmentValue(p, from, to, rates);
    if (blended !== null) {
      if (field === "advancePaid") return n * blended;
      // Order total: the part already paid at the rates it was paid at; the
      // balance not yet paid at today's rate — an estimate until it's paid.
      const paidPart = Math.min(goodsPaidAmount(p), n);
      return paidPart * blended + convert(n - paidPart, from, to, rates);
    }
  }
  const actual = paymentFxTable(p, field);
  if (actual && actual[from] && actual[to]) return convert(n, from, to, actual);
  return convertAsOf(n, from, to, paymentDate(p, field), ratesByDate, rates);
}

// Goods payments: everything on the payments list except freight/duty/CHA.
export function goodsPayments(p: Product): Payment[] {
  return (p.payments ?? []).filter((x) => x.type !== "FREIGHT" && x.type !== "DUTY" && x.type !== "CHA");
}

// What has actually been paid toward the goods, in the product currency. The
// payments list is the truth once it has entries; the single typed "advance
// paid" figure is used only for products that have no payments list yet.
export function goodsPaid(p: Product): number {
  return goodsPayments(p).length ? goodsPaidAmount(p) : p.working.advancePaid || 0;
}
function goodsPaidAmount(p: Product): number {
  return goodsPayments(p).filter((x) => x.status === "PAID").reduce((a, x) => a + (x.amount || 0), 0);
}

// The rate table for one payment: the rate typed for it, as "rupees per 1 unit
// of the payment's currency". Null when none was entered.
export function enteredRate(x: Payment, from: CurrencyCode): Rates | null {
  return x.fxRate ? ({ [x.currency || from]: 1, INR: x.fxRate } as Rates) : null;
}

// Value of one unit of `from` across the PAID goods instalments, each at the
// rate entered for it, or today's rate (an estimate) where none was entered.
// Null when there is nothing to blend or today's rate hasn't loaded yet.
function instalmentValue(
  p: Product,
  from: CurrencyCode,
  to: CurrencyCode,
  live: Rates | null
): number | null {
  const paid = (p.payments ?? []).filter(
    (x) => x.status === "PAID" && (x.amount || 0) > 0 && x.type !== "FREIGHT" && x.type !== "DUTY" && x.type !== "CHA"
  );
  const total = paid.reduce((a, x) => a + x.amount, 0);
  if (total <= 0) return null;
  let value = 0;
  for (const x of paid) {
    if ((x.currency || from) !== from) return null; // mixed currencies: don't guess
    const entered = enteredRate(x, from);
    const table = entered && entered[from] && entered[to] ? entered : live;
    if (from !== to && !(table && table[from] && table[to])) return null;
    value += convert(x.amount, from, to, table);
  }
  return value / total;
}

// Every date this product needs a historical rate for, so a view can preload them.
export function valuationDates(p: Product): string[] {
  const fields = ["rateValue", "advancePaid", "shipmentValue", "shipmentAdvance"] as const;
  const dates = fields.map((f) => paymentDate(p, f));
  for (const x of p.payments ?? []) if (x.status === "PAID" && x.paidDate) dates.push(x.paidDate);
  return Array.from(new Set(dates.filter(Boolean) as string[]));
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
export function computeOrderSummary(
  p: Product,
  rates: Rates | null = null,
  // Historical tables keyed by ISO date, from useRatesForDates(). When a date
  // is missing the live table is used, so this stays backward-compatible.
  ratesByDate: Record<string, Rates | null> = {}
): OrderSummary {
  const f = getFlow(p);
  const w = p.working;
  const e = p.expenses;
  const L = p.logistics;
  const base = prodCurrency(p);
  // Normalise an expense field from its own currency into the product base.
  const ex = (field: ExpenseMoneyField) => convert((e[field] as number) || 0, expenseCurrency(p, field), base, rates);
  // Normalise a payment amount from its own currency into the product base.
  const pay = (field: "rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance") =>
    convertAsOf((w[field] as number) || 0, paymentCurrency(p, field), base,
                paymentDate(p, field), ratesByDate, rates);

  const totalQty = w.moq || 0;
  const goodsTotal = pay("rateValue");
  const advancePaid = Math.min(
    convertAsOf(goodsPaid(p), paymentCurrency(p, "advancePaid"), base, paymentDate(p, "advancePaid"), ratesByDate, rates),
    goodsTotal
  );
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
