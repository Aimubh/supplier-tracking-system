// Builds a clean, invoice-style order bill as self-contained HTML and opens it in
// a new window for the browser's "Save as PDF" (print) flow. Kept independent of
// the app's CSS so the printed page is predictable.

import type { Product, CurrencyCode, ExpenseMoneyField } from "./store";
import { computeOrderSummary, expenseCurrency } from "./order-summary";
import { convert, type Rates } from "./fx";

const SYM: Record<CurrencyCode, string> = { USD: "$", INR: "₹", CNY: "¥" };

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

// `display` + `rates` are optional — when provided, every money figure is shown
// in that currency (matching the Order Summary "Show in" filter). Product amounts
// are in the product currency; shipment amounts in the shipment currency.
export function openOrderBill(p: Product, dateLabel: string, display?: CurrencyCode, rates?: Rates | null) {
  const r = rates ?? null;
  // Summary figures are normalised into the product currency (using rates), then
  // converted once into the display currency below.
  const s = computeOrderSummary(p, r);
  const prodCur = p.working.rateCurrency ?? "INR";
  const disp = display ?? prodCur;
  const sym = SYM[disp];
  const L = p.logistics;
  const e = p.expenses;
  // computeOrderSummary already expressed every aggregate in the product currency,
  // so the display conversion is a single product→display step.
  const cP = (n: number) => convert(n, prodCur, disp, r);
  // Convert a single expense field from ITS OWN currency straight to display.
  const cField = (field: ExpenseMoneyField, n: number) => convert(n, expenseCurrency(p, field), disp, r);
  const money = (n: number) => `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  // Converted aggregates in the display currency.
  const dGoods = cP(s.goodsTotal);
  const dExpenses = cP(s.expensesTotal);
  const dFinal = dGoods + dExpenses;
  const dProdAdv = cP(s.advancePaid);
  const dShipAdv = cP(s.shipmentAdvance); // already in product currency via summary
  const dTotalPaid = dProdAdv + dShipAdv;
  const dOutstanding = Math.max(dFinal - dTotalPaid, 0);
  const dPerUnit = s.totalQty > 0 ? dFinal / s.totalQty : 0;

  // Itemised charge rows (skip zero lines to keep the bill tidy). Each row is
  // converted from its own field currency; India transport is in product currency.
  const chargeRows: [string, number][] = [
    ["Ocean freight (POL → POD)", cField("oceanFreight", e.oceanFreight || 0)],
    ["DO charge", cField("doCharge", e.doCharge || 0)],
    ["THC — terminal handling", cField("thcCharge", e.thcCharge || 0)],
    ["CFS — freight station", cField("cfsCharge", e.cfsCharge || 0)],
    ["WGMT — weighment", cField("wgmtCharge", e.wgmtCharge || 0)],
    ["GST on charges", cField("gstCharge", e.gstCharge || 0)],
    ["Customs duty + IGST", cField("dutyActual", e.dutyActual || 0)],
    ["CHA charges", cField("chaCharges", e.chaCharges || 0)],
    ["Last-mile transport", cField("lastMileCost", e.lastMileCost || 0)],
    ["Port-to-warehouse transport", cP(p.logistics.indiaTransportCost || 0)],
    ["Other", cField("otherExpense", e.otherExpense || 0)],
  ];
  const chargesHtml =
    chargeRows
      .filter(([, v]) => v > 0)
      .map(
        ([label, v]) =>
          `<tr><td>${esc(label)}</td><td class="num">${esc(money(v))}</td></tr>`
      )
      .join("") || `<tr><td class="muted">No expenses recorded yet</td><td class="num">—</td></tr>`;

  // Payment status — when the product hasn't fully arrived, flag the amount due.
  const statusBanner = s.arrived
    ? `<div class="status paid">✓ Order arrived &amp; settled — ${esc(money(dTotalPaid))} paid of ${esc(money(dFinal))}.</div>`
    : `<div class="status due">⚠ Order in progress — not yet arrived in inventory. Amount due: <strong>${esc(money(dOutstanding))}</strong></div>`;

  // Payments breakdown rows (product + shipment) inside the summary totals.
  const dueRow = `
      <tr><td>Product advance paid</td><td class="num">${esc(money(dProdAdv))}</td></tr>
      <tr><td>Shipment advance paid</td><td class="num">${esc(money(dShipAdv))}</td></tr>
      <tr><td>Total paid</td><td class="num">${esc(money(dTotalPaid))}</td></tr>
      ${s.arrived ? "" : `<tr class="due-row"><td><strong>Pending / amount due</strong></td><td class="num"><strong>${esc(money(dOutstanding))}</strong></td></tr>`}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Order Bill — ${esc(p.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #181d26; margin: 0; padding: 40px; background: #fff; }
  .sheet { max-width: 760px; margin: 0 auto; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #181d26; padding-bottom: 16px; }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .brand small { display:block; font-size: 11px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: #41454d; margin-top: 2px; }
  .doc { text-align: right; }
  .doc h1 { font-size: 18px; margin: 0; }
  .doc p { margin: 2px 0 0; font-size: 12px; color: #41454d; }
  h2 { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #41454d; margin: 26px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 7px 0; border-bottom: 1px solid #eee; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: #9297a0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 28px; font-size: 13px; margin-top: 6px; }
  .grid div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f1f1; }
  .grid span:first-child { color: #41454d; }
  .grid span:last-child { font-weight: 600; font-variant-numeric: tabular-nums; }
  .totals td { border: none; padding: 6px 0; }
  .totals .rule td { border-top: 1px solid #ddd; }
  .totals .final td { border-top: 2px solid #181d26; font-size: 15px; padding-top: 10px; }
  .go td { color: #006400; }
  .loss td { color: #aa2d00; }
  .due-row td { color: #aa2d00; }
  .status { margin-top: 18px; padding: 12px 14px; border-radius: 8px; font-size: 13px; }
  .status.due { background: #fdf0eb; border: 1px solid #f0c4b4; color: #aa2d00; }
  .status.paid { background: #eef7ee; border: 1px solid #b9deba; color: #006400; }
  .foot { margin-top: 36px; font-size: 11px; color: #9297a0; border-top: 1px solid #eee; padding-top: 12px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  .noprint { text-align:center; margin-bottom: 20px; }
  .btn { font: inherit; font-size: 13px; font-weight: 600; background: #181d26; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer; }
</style></head>
<body>
  <div class="noprint"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
  <div class="sheet">
    <div class="top">
      <div class="brand" style="display:flex;align-items:center;gap:12px">
        <svg width="40" height="40" viewBox="0 0 100 100" fill="#181d26" aria-label="Lazer Believe">
          <path d="M6 6 H46 A40 40 0 0 1 6 46 Z"/><path d="M94 6 V46 A40 40 0 0 1 54 6 Z"/>
          <path d="M6 94 V54 A40 40 0 0 1 46 94 Z"/><path d="M94 94 H54 A40 40 0 0 1 94 54 Z"/>
          <circle cx="50" cy="50" r="5.5"/><path d="M74 4 L96 4 L96 26 L88.5 18.5 L80 27 L71.5 18.5 L80 10 Z"/>
        </svg>
        <span>Lazer Believe<small>Lazer Ecommerce Ventures Pvt. Ltd.</small></span>
      </div>
      <div class="doc">
        <h1>Order Bill</h1>
        <p>${esc(dateLabel)}</p>
      </div>
    </div>

    ${statusBanner}

    <h2>Product</h2>
    <div class="grid">
      <div><span>Name</span><span>${esc(p.name)}</span></div>
      <div><span>Category</span><span>${esc(p.category || "—")}</span></div>
      <div><span>Supplier</span><span>${esc(p.supplier?.name || "—")}</span></div>
      <div><span>Rate term</span><span>${esc(s.rateTerm)}</span></div>
      <div><span>POL → POD</span><span>${esc(L.pol || "—")} → ${esc(L.pod || "—")}</span></div>
      <div><span>B/L number</span><span>${esc(L.blNumber || "—")}</span></div>
      <div><span>Packages</span><span>${L.packages > 0 ? esc(String(L.packages)) : "—"}</span></div>
      <div><span>Weight / Volume</span><span>${L.grossWeightKg > 0 ? esc(L.grossWeightKg.toLocaleString()) + " kg" : "—"} / ${L.volumeCbm > 0 ? esc(String(L.volumeCbm)) + " CBM" : "—"}</span></div>
    </div>

    <h2>Order</h2>
    <div class="grid">
      <div><span>Quantity</span><span>${s.totalQty > 0 ? esc(s.totalQty.toLocaleString()) : "—"}</span></div>
      <div><span>Order amount</span><span>${s.goodsTotal > 0 ? esc(money(dGoods)) : "—"}</span></div>
      <div><span>Advance paid</span><span>${s.advancePaid > 0 ? esc(money(dProdAdv)) : "—"}</span></div>
      <div><span>Balance pending</span><span>${s.goodsPending > 0 ? esc(money(cP(s.goodsPending))) : "—"}</span></div>
      <div><span>Start date</span><span>${esc(s.startDate || "—")}</span></div>
      <div><span>End date</span><span>${esc(s.endDate || "—")}</span></div>
    </div>

    <h2>Charges &amp; expenses (${esc(disp)})</h2>
    <table>${chargesHtml}</table>

    <h2>Summary</h2>
    <table class="totals">
      <tr><td>Order amount (goods)</td><td class="num">${esc(money(dGoods))}</td></tr>
      <tr class="rule"><td>Total expenses</td><td class="num">${esc(money(dExpenses))}</td></tr>
      <tr class="final"><td><strong>Final landed cost</strong></td><td class="num"><strong>${esc(money(dFinal))}</strong></td></tr>
      ${s.totalQty > 0 ? `<tr><td class="muted">Per unit</td><td class="num muted">${esc(money(dPerUnit))}</td></tr>` : ""}
      ${dueRow}
    </table>

    <p class="foot">Generated from the Supplier Tracking System · ${esc(dateLabel)}. Figures in ${esc(disp)}. This is an internal order summary, not a tax invoice.</p>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 350); };</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    alert("Please allow pop-ups to download the bill.");
    return;
  }
  w.document.write(html);
  w.document.close();
}
