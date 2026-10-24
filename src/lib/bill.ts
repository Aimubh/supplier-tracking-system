// Builds a clean, invoice-style order bill as self-contained HTML and opens it in
// a new window for the browser's "Save as PDF" (print) flow. Kept independent of
// the app's CSS so the printed page is predictable.

import { itemLabel, type Product, type CurrencyCode, type ExpenseMoneyField } from "./store";
import { bankChargesInr, computeOrderSummary, convertPayment, enteredRate, expenseCurrency, goodsPaid, goodsPayments } from "./order-summary";
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
export function openOrderBill(
  p: Product,
  dateLabel: string,
  display?: CurrencyCode,
  rates?: Rates | null,
  // Historical rate tables by ISO date, so each payment is valued on the day
  // it was made rather than at today's rate.
  ratesByDate: Record<string, Rates | null> = {}
) {
  const r = rates ?? null;
  // Summary figures are normalised into the product currency (using rates), then
  // converted once into the display currency below.
  const s = computeOrderSummary(p, r, ratesByDate);
  const prodCur = p.working.rateCurrency ?? "INR";
  const disp = display ?? prodCur;
  const sym = SYM[disp];
  const L = p.logistics;
  const e = p.expenses;
  const wk = p.working;

  // Third-party commission is disclosed on the bill but deliberately excluded
  // from every total — computeOrderSummary never sees it. Printing it inside the
  // Summary table would imply it had been costed.
  const tp = wk.thirdPartyPayment && (wk.thirdPartyCompany.trim() || wk.thirdPartyCommissionPct > 0);
  const thirdPartyHtml = tp
    ? `
    <h2>Third party</h2>
    <div class="grid">
      <div><span>Company</span><span>${esc(wk.thirdPartyCompany.trim() || "—")}</span></div>
      <div><span>Commission</span><span>${
        wk.thirdPartyCommissionPct > 0 ? esc(String(wk.thirdPartyCommissionPct)) + "%" : "—"
      }</span></div>
    </div>
    <p class="muted">Disclosed for reference — not included in the totals above.</p>`
    : "";
  // computeOrderSummary already expressed every aggregate in the product currency,
  // so the display conversion is a single product→display step.
  const cP = (n: number) => convert(n, prodCur, disp, r);
  // Payment amounts convert at the rate on the day they were settled, not
  // today's — otherwise a paid invoice changes value every time it's opened.
  const cPay = (n: number, field: "rateValue" | "advancePaid" | "shipmentAdvance") =>
    convertPayment(p, n, field, prodCur, disp, r, ratesByDate);
  // Convert a single expense field from ITS OWN currency straight to display.
  const cField = (field: ExpenseMoneyField, n: number) => convert(n, expenseCurrency(p, field), disp, r);
  const money = (n: number) => `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  // Converted aggregates in the display currency.
  const dGoods = cPay(s.goodsTotal, "rateValue");
  const dExpenses = cP(s.expensesTotal);
  const dFinal = dGoods + dExpenses;
  const dProdAdv = cPay(s.advancePaid, "advancePaid");
  const dShipAdv = cPay(s.shipmentAdvance, "shipmentAdvance");
  const dTotalPaid = dProdAdv + dShipAdv;
  const dOutstanding = Math.max(dFinal - dTotalPaid, 0);
  const dPerUnit = s.totalQty > 0 ? dFinal / s.totalQty : 0;
  // Pieces per unit (set/pack) — see order-summary-view.tsx for the editable
  // field. Only worth its own line when it differs from "per unit".
  const packUnits = p.sourcing?.inputs?.packUnits || 1;
  const dPerPiece = packUnits > 1 ? dPerUnit / packUnits : dPerUnit;

  // Itemised charge rows (skip zero lines to keep the bill tidy). Each row is
  // converted from its own field currency; India transport is in product currency.
  const chargeRows: [string, number][] = [
    ["Ocean freight (POL → POD)", cField("oceanFreight", e.oceanFreight || 0)],
    ["DO charge", cField("doCharge", e.doCharge || 0)],
    ["THC — terminal handling", cField("thcCharge", e.thcCharge || 0)],
    ["CFS — freight station", cField("cfsCharge", e.cfsCharge || 0)],
    ["WGMT — weighment", cField("wgmtCharge", e.wgmtCharge || 0)],
    ["GST on charges", cField("gstCharge", e.gstCharge || 0)],
    ["Customs duty (BCD + SWS)", cField("dutyActual", e.dutyActual || 0)],
    ["CHA charges", cField("chaCharges", e.chaCharges || 0)],
    ["Last-mile transport", cField("lastMileCost", e.lastMileCost || 0)],
    ["Port-to-warehouse transport", cP(p.logistics.indiaTransportCost || 0)],
    ["Other", cField("otherExpense", e.otherExpense || 0)],
    ["Bank charges on payments", convert(bankChargesInr(p), "INR", disp, r)],
  ];
  const chargesHtml =
    chargeRows
      .filter(([, v]) => v > 0)
      .map(
        ([label, v]) =>
          `<tr><td>${esc(label)}</td><td class="num">${esc(money(v))}</td></tr>`
      )
      .join("") || `<tr><td class="muted">No expenses recorded yet</td><td class="num">—</td></tr>`;

  // ---- Product payments: each payment with the USD rate it was paid at, the
  // balance still to pay, and whether the goods are fully paid.
  const foreign = prodCur !== disp;
  const today = foreign ? convert(1, prodCur, disp, r) : 1;
  const rateTxt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const PAY_LABEL: Record<string, string> = {
    DEPOSIT: "Advance", BALANCE: "Balance", FREIGHT: "Freight", DUTY: "Duty", CHA: "CHA", OTHER: "Other",
  };
  type Line = { label: string; date: string; amount: number; cur: CurrencyCode; rate: string; value: number; approx: boolean; bank: number; paid: boolean };
  const lines: Line[] = (p.payments ?? [])
    .filter((x) => (x.amount || 0) > 0)
    .map((x) => {
      const cur = (x.currency || prodCur) as CurrencyCode;
      // The rate typed for this payment; none entered yet = today's rate, an estimate.
      const entered = enteredRate(x, cur);
      const table = entered && entered[cur] && entered[disp] ? entered : null;
      const value = convert(x.amount, cur, disp, table ?? r);
      const rate = cur === disp ? "—" : table ? rateTxt(x.fxRate as number) : `${rateTxt(value / x.amount)} est.`;
      return { label: PAY_LABEL[x.type] ?? x.type, date: (x.status === "PAID" ? x.paidDate : x.dueDate) || "—", amount: x.amount, cur,
        rate, value, approx: cur !== disp && !table, bank: x.bankCharges || 0, paid: x.status === "PAID" };
    });

  const goodsTotalPc = s.goodsTotal;          // order value, product currency
  const paidPc = Math.min(goodsPaid(p), goodsTotalPc || goodsPaid(p));
  const listedPc = goodsPayments(p).reduce((a, x) => a + (x.amount || 0), 0);
  // A product with only the old typed advance: show it as the advance line.
  if (goodsPayments(p).length === 0 && paidPc > 0) {
    lines.unshift({ label: "Advance", date: "—", amount: paidPc, cur: prodCur, rate: foreign ? `${rateTxt(dProdAdv / paidPc)} est.` : "—",
      value: dProdAdv, approx: foreign, bank: 0, paid: true });
  }
  // The part of the order not on any payment line yet is the balance to pay.
  const unlisted = Math.max(goodsTotalPc - Math.max(listedPc, goodsPayments(p).length ? 0 : paidPc), 0);
  if (unlisted > 0.005) {
    lines.push({ label: "Balance", date: "to be paid", amount: unlisted, cur: prodCur, rate: foreign ? `${rateTxt(today)} today, est.` : "—",
      value: convert(unlisted, prodCur, disp, r), approx: foreign, bank: 0, paid: false });
  }

  const balancePc = Math.max(goodsTotalPc - paidPc, 0);
  const payStatus = goodsTotalPc <= 0 ? null
    : balancePc <= 0.005 ? { cls: "paid", text: "FULLY PAID" }
    : paidPc > 0 ? { cls: "part", text: `PARTLY PAID · ${SYM[prodCur]}${balancePc.toLocaleString(undefined, { maximumFractionDigits: 2 })} balance still to pay` }
    : { cls: "none", text: "NOT PAID YET" };
  const bankTotal = lines.reduce((a, l) => a + l.bank, 0);
  const sym0 = (c: CurrencyCode) => SYM[c] ?? "";

  const paymentsHtml = goodsTotalPc > 0 || lines.length
    ? `
    <h2>Product payments ${payStatus ? `<span class="pill ${payStatus.cls}">${esc(payStatus.text)}</span>` : ""}</h2>
    <table class="pay">
      <tr class="head"><td>Payment</td><td>Date paid</td><td class="num">Amount</td><td class="num">${esc(prodCur)} rate (₹)</td><td class="num">Value (${esc(disp)})</td><td class="num">Bank charges</td><td class="num">Status</td></tr>
      ${lines.map((l) => `<tr>
        <td>${esc(l.label)}</td><td>${esc(l.date)}</td>
        <td class="num">${esc(sym0(l.cur))}${esc(l.amount.toLocaleString(undefined, { maximumFractionDigits: 2 }))}</td>
        <td class="num">${esc(l.rate)}</td>
        <td class="num">${l.approx ? "≈ " : ""}${esc(money(l.value))}</td>
        <td class="num">${l.bank ? esc(`₹${l.bank.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`) : "—"}</td>
        <td class="num"><span class="st ${l.paid ? "ok" : "due"}">${l.paid ? "Paid" : "Pending"}</span></td></tr>`).join("")}
    </table>
    <p class="muted" style="font-size:11px;margin:6px 0 0">Paid ${esc(sym0(prodCur))}${esc(paidPc.toLocaleString(undefined, { maximumFractionDigits: 2 }))} = ${esc(money(dProdAdv))} at the rates paid${balancePc > 0.005 ? ` · balance ${esc(sym0(prodCur))}${esc(balancePc.toLocaleString(undefined, { maximumFractionDigits: 2 }))} ≈ ${esc(money(convert(balancePc, prodCur, disp, r)))} at today's rate` : ""}${bankTotal ? ` · bank charges ₹${esc(bankTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 }))}` : ""}.
      "est." / ≈ means no rate has been entered for that payment yet, so today's rate is used.</p>`
    : "";

  // First product photo. Records from the light list arrive with media stripped,
  // so for those the photo is pulled in after the window opens (see the end).
  const firstPhoto = (w: Product["working"] | undefined) =>
    w?.productMedia?.find((m) => m.kind === "image")?.data || w?.productImage || "";
  const photo = firstPhoto(wk);

  // Payment status — when the product hasn't fully arrived, flag the amount due.
  const statusBanner = s.arrived
    ? `<div class="status paid">✓ Order arrived &amp; settled — ${esc(money(dTotalPaid))} paid of ${esc(money(dFinal))}.</div>`
    : `<div class="status due">⚠ Order in progress — not yet arrived in inventory. Amount due: <strong>${esc(money(dOutstanding))}</strong></div>`;

  // Payments breakdown rows (product + shipment) inside the summary totals.
  const dueRow = `
      <tr><td>Product paid so far</td><td class="num">${esc(money(dProdAdv))}</td></tr>
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
  tr.head td { font-size: 11px; color: #41454d; text-transform: uppercase; letter-spacing: .08em; }
  table.pay td { padding: 6px 4px; font-size: 12px; }
  .pill { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-size: 10px; letter-spacing: .06em; vertical-align: middle; }
  .pill.paid { background: #e3f3e3; color: #006400; } .pill.part { background: #fdf3e2; color: #9a5b00; } .pill.none { background: #fdecea; color: #aa2d00; }
  .st { font-weight: 600; } .st.ok { color: #006400; } .st.due { color: #9a5b00; }
  .photo { display: block; width: 132px; height: 132px; object-fit: cover; border: 1px solid #e6e6e6; border-radius: 8px; margin: 4px 0 12px; }
  .photo[hidden] { display: none; }
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
        <svg width="42" height="42" viewBox="0 0 200 200" fill="#181d26" aria-label="Lazer Believe">
          <path d="M4 4 Q50 16 96 4 Q84 50 96 96 Q50 84 4 96 Q16 50 4 4 Z"/>
          <path d="M104 4 Q150 16 196 4 Q184 50 196 96 Q150 84 104 96 Q116 50 104 4 Z"/>
          <path d="M4 104 Q50 116 96 104 Q84 150 96 196 Q50 184 4 196 Q16 150 4 104 Z"/>
          <path d="M104 104 Q150 116 196 104 Q184 150 196 196 Q150 184 104 196 Q116 150 104 104 Z"/>
          <path fill="#fff" d="M100 70 Q112 88 130 100 Q112 112 100 130 Q88 112 70 100 Q88 88 100 70 Z"/>
          <circle fill="#fff" cx="100" cy="100" r="9"/>
          <path d="M150 12 L182 6 L176 38 L168 24 Z"/>
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
    <img id="photo" class="photo" alt="" src="${esc(photo)}"${photo ? "" : " hidden"}>
    <div class="grid">
      <div><span>Name</span><span>${esc(p.name)}</span></div>
      <div><span>Item</span><span>${esc(itemLabel(p) || "—")}</span></div>
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
      <div><span>Paid so far</span><span>${s.advancePaid > 0 ? esc(money(dProdAdv)) : "—"}</span></div>
      <div><span>Balance to pay</span><span>${balancePc > 0.005 ? esc(`${sym0(prodCur)}${balancePc.toLocaleString(undefined, { maximumFractionDigits: 2 })}`) : "—"}</span></div>
      <div><span>Payment status</span><span>${payStatus ? esc(payStatus.text.split(" · ")[0]) : "—"}</span></div>
      <div><span>Start date</span><span>${esc(s.startDate || "—")}</span></div>
      <div><span>End date</span><span>${esc(s.endDate || "—")}</span></div>
    </div>
    ${paymentsHtml}

    <h2>Charges &amp; expenses (${esc(disp)})</h2>
    <table>${chargesHtml}</table>

    <h2>Summary</h2>
    <table class="totals">
      <tr><td>Order amount (goods)</td><td class="num">${esc(money(dGoods))}</td></tr>
      <tr class="rule"><td>Total expenses</td><td class="num">${esc(money(dExpenses))}</td></tr>
      <tr class="final"><td><strong>Final landed cost</strong></td><td class="num"><strong>${esc(money(dFinal))}</strong></td></tr>
      ${s.totalQty > 0 ? `<tr><td class="muted">Per unit</td><td class="num muted">${esc(money(dPerUnit))}</td></tr>` : ""}
      ${s.totalQty > 0 && packUnits > 1 ? `<tr><td class="muted">Per piece (${esc(String(packUnits))}/unit)</td><td class="num muted">${esc(money(dPerPiece))}</td></tr>` : ""}
      ${dueRow}
    </table>
    ${thirdPartyHtml}

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

  // The window had to open synchronously inside the click (or pop-up blockers
  // eat it), so a light record's photo is fetched now and dropped into place.
  if (!photo && p._light) {
    fetch(`/api/products/${p.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((full: Partial<Product> | null) => {
        const src = firstPhoto(full?.working);
        const img = w.document.getElementById("photo") as HTMLImageElement | null;
        if (src && img) { img.src = src; img.hidden = false; }
      })
      .catch(() => {}); // a bill without a photo is still a correct bill
  }
}
