"use client";

// Order Summary — a per-product P&L sheet. Rolls up amounts, payments, dates and
// approval status from the pipeline, lets the team edit any figure inline (before
// downloading the bill), and offers a "Show in" currency filter that converts
// every displayed/summary figure into one currency using live FX rates.

import { useState } from "react";
import clsx from "clsx";
import {
  Receipt,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  PackageOpen,
  Check,
  Minus,
  X,
  FileDown,
  RefreshCw,
} from "lucide-react";
import { useStore, type Product, type Expenses, type Working, type Logistics, type CurrencyCode } from "@/lib/store";
import { computeOrderSummary } from "@/lib/order-summary";
import { openOrderBill } from "@/lib/bill";
import { useFxRates, convert, CURRENCY_SYMBOL } from "@/lib/fx";
import { SpotlightCard } from "./spotlight-card";
import { Reveal, Stagger, Item } from "./motion";

const CURRENCIES: CurrencyCode[] = ["INR", "USD", "CNY"];

function downloadBill(p: Product, show: CurrencyCode, rates: Record<string, number> | null) {
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  openOrderBill(p, date, show, rates);
}

function fmtMoney(sym: string, n: number) {
  return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function OrderSummaryView() {
  const { products } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [show, setShow] = useState<CurrencyCode>("INR"); // display currency
  const fx = useFxRates();

  const dispSym = CURRENCY_SYMBOL[show];
  // Convert an amount (in its source currency) into the chosen display currency.
  const toDisp = (amount: number, from: CurrencyCode) => convert(amount, from, show, fx.rates);

  const rows = products.map((p) => ({ p, s: computeOrderSummary(p) }));

  // Portfolio totals — converted to the display currency per product source.
  const tot = rows.reduce(
    (a, { p, s }) => {
      const prodCur = p.working.rateCurrency ?? "INR";
      a.goods += toDisp(s.goodsTotal, prodCur);
      a.expenses += toDisp(s.expensesTotal, prodCur); // expenses entered in product currency
      a.final += toDisp(s.finalExpense, prodCur);
      a.selling += toDisp(s.sellingTotal, prodCur);
      a.profit += toDisp(s.profit, prodCur);
      return a;
    },
    { goods: 0, expenses: 0, final: 0, selling: 0, profit: 0 }
  );

  const STATS: { label: string; value: string; note: string; tone?: "go" | "block" }[] = [
    { label: "Total order value", value: fmtMoney(dispSym, tot.goods), note: "goods, all products" },
    { label: "Total expenses", value: fmtMoney(dispSym, tot.expenses), note: "freight, duty, CHA, last-mile" },
    { label: "Final landed cost", value: fmtMoney(dispSym, tot.final), note: "goods + expenses" },
    {
      label: tot.profit >= 0 ? "Projected profit" : "Projected loss",
      value: fmtMoney(dispSym, Math.abs(tot.profit)),
      note: "vs expected revenue",
      tone: tot.selling > 0 ? (tot.profit >= 0 ? "go" : "block") : undefined,
    },
  ];

  return (
    <main className="px-7 py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-white">
            <Receipt className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="font-display text-[22px] font-medium tracking-tight text-ink">Order Summary</h1>
            <p className="text-[13px] text-muted">Per-product P&amp;L — edit any figure inline, then download the bill.</p>
          </div>
        </div>

        {/* Currency conversion filter */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-muted">Show in</span>
          <select
            value={show}
            onChange={(e) => setShow(e.target.value as CurrencyCode)}
            className="h-9 appearance-none rounded-sm border border-line bg-white px-3 text-[13px] font-medium text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={fx.refresh}
            disabled={fx.loading}
            title={fx.updatedAt ? `Live rate, updated ${new Date(fx.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Fetch live rates"}
            className="flex h-9 w-9 items-center justify-center rounded-sm border border-line bg-white text-muted transition hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-4 w-4", fx.loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {!fx.rates && (
        <p className="mb-3 text-[12px] text-muted">Fetching live exchange rates… amounts show in their entered currency until rates load.</p>
      )}

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((s) => (
          <Item key={s.label}>
            <SpotlightCard className="p-5">
              <p className="figure text-3xl font-semibold leading-none text-ink">
                <span className={clsx(s.tone === "go" && "text-go", s.tone === "block" && "text-block")}>{s.value}</span>
              </p>
              <p className="mt-2 text-[14px] font-medium text-body">{s.label}</p>
              <p className="mt-0.5 text-[12px] text-muted">{s.note}</p>
            </SpotlightCard>
          </Item>
        ))}
      </Stagger>

      <Reveal className="mt-5" delay={0.1}>
        <SpotlightCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="eyebrow">Per-product P&amp;L</span>
            <span className="text-[11px] text-muted">All figures in {show}</span>
          </div>

          {products.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-ink text-white">
                <PackageOpen className="h-6 w-6" />
              </div>
              <p className="max-w-sm text-[14px] text-muted">
                No products yet. Once a product is in the pipeline, its financial summary appears here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface">
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Product</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Qty</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Order amount</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Paid</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Expenses</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Final cost</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Profit / loss</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, s }) => {
                    const prodCur = p.working.rateCurrency ?? "INR";
                    const c = (n: number) => toDisp(n, prodCur);
                    const profit = c(s.profit);
                    return (
                      <SummaryRow
                        key={p.id}
                        p={p}
                        open={openId === p.id}
                        onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
                        dispSym={dispSym}
                        show={show}
                        rates={fx.rates}
                        toDisp={toDisp}
                        cells={{
                          qty: s.totalQty,
                          order: c(s.goodsTotal),
                          paid: c(s.advancePaid),
                          expenses: c(s.expensesTotal),
                          final: c(s.finalExpense),
                          profit,
                          profitable: s.profitable,
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SpotlightCard>
      </Reveal>
    </main>
  );
}

function SummaryRow({
  p,
  open,
  onToggle,
  dispSym,
  show,
  rates,
  toDisp,
  cells,
}: {
  p: Product;
  open: boolean;
  onToggle: () => void;
  dispSym: string;
  show: CurrencyCode;
  rates: Record<string, number> | null;
  toDisp: (n: number, from: CurrencyCode) => number;
  cells: { qty: number; order: number; paid: number; expenses: number; final: number; profit: number; profitable: boolean | null };
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={clsx("cursor-pointer border-b border-line align-middle transition-colors hover:bg-surface", open && "bg-surface")}
      >
        <td className="px-3 py-3">
          <ChevronDown className={clsx("h-4 w-4 text-muted transition-transform", open && "rotate-180 text-ink")} />
        </td>
        <td className="px-3 py-3">
          <span className="text-[14px] font-medium text-ink">{p.name}</span>
          <p className="text-[11.5px] text-muted">{p.category || "—"} · {p.working.rate}</p>
        </td>
        <td className="px-3 py-3 text-right figure text-[13px] text-ink">{cells.qty > 0 ? cells.qty.toLocaleString() : "—"}</td>
        <td className="px-3 py-3 text-right figure text-[13px] text-ink">{cells.order > 0 ? fmtMoney(dispSym, cells.order) : "—"}</td>
        <td className="px-3 py-3 text-right figure text-[13px] text-go">{cells.paid > 0 ? fmtMoney(dispSym, cells.paid) : "—"}</td>
        <td className="px-3 py-3 text-right figure text-[13px] text-body">{cells.expenses > 0 ? fmtMoney(dispSym, cells.expenses) : "—"}</td>
        <td className="px-3 py-3 text-right figure text-[13px] font-semibold text-ink">{cells.final > 0 ? fmtMoney(dispSym, cells.final) : "—"}</td>
        <td className="px-3 py-3 text-right">
          <div className="flex items-center justify-end gap-3">
            {cells.profitable === null ? (
              <span className="text-[12px] text-muted">set price</span>
            ) : (
              <span className={clsx("figure inline-flex items-center gap-1 text-[13px] font-semibold", cells.profitable ? "text-go" : "text-block")}>
                {cells.profitable ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {fmtMoney(dispSym, Math.abs(cells.profit))}
              </span>
            )}
            <button
              onClick={(ev) => { ev.stopPropagation(); downloadBill(p, show, rates); }}
              title="Download order bill (PDF)"
              className="flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[12px] font-medium text-ink transition hover:bg-surface"
            >
              <FileDown className="h-3.5 w-3.5" /> Bill
            </button>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="bg-surface">
          <td colSpan={8} className="p-0">
            <PnlSheet p={p} show={show} dispSym={dispSym} rates={rates} toDisp={toDisp} />
          </td>
        </tr>
      )}
    </>
  );
}

// The detailed P&L sheet — everything editable. Inputs stay in each value's own
// source currency (so you edit the real saved number); summary/P&L figures are
// converted into the chosen display currency.
function PnlSheet({
  p,
  show,
  dispSym,
  rates,
  toDisp,
}: {
  p: Product;
  show: CurrencyCode;
  dispSym: string;
  rates: Record<string, number> | null;
  toDisp: (n: number, from: CurrencyCode) => number;
}) {
  const { patchProduct } = useStore();
  const e = p.expenses;
  const w = p.working;
  const l = p.logistics;
  const prodCur = w.rateCurrency ?? "INR";
  const shipCur = w.shipmentCurrency ?? "INR";
  const prodSym = CURRENCY_SYMBOL[prodCur];
  const shipSym = CURRENCY_SYMBOL[shipCur];

  const setExpense = <K extends keyof Expenses>(key: K, value: Expenses[K]) =>
    patchProduct(p.id, "expenses", { ...e, [key]: value });
  const setWorking = <K extends keyof Working>(key: K, value: Working[K]) =>
    patchProduct(p.id, "working", { ...w, [key]: value });
  const setLogistics = <K extends keyof Logistics>(key: K, value: Logistics[K]) =>
    patchProduct(p.id, "logistics", { ...l, [key]: value });

  // Derived figures in the display currency.
  const goodsTotal = toDisp(w.rateValue || 0, prodCur);
  const prodAdv = toDisp(Math.min(w.advancePaid || 0, w.rateValue || 0), prodCur);
  const shipAdv = toDisp(Math.min(w.shipmentAdvance || 0, w.shipmentValue || 0), shipCur);
  const freightFields: (keyof Expenses)[] = ["oceanFreight", "doCharge", "thcCharge", "cfsCharge", "wgmtCharge", "gstCharge"];
  const otherFields: (keyof Expenses)[] = ["dutyActual", "chaCharges", "lastMileCost", "otherExpense"];
  const expSum =
    [...freightFields, ...otherFields].reduce((s, k) => s + ((e[k] as number) || 0), 0) +
    (l.indiaTransportCost || 0);
  const expensesDisp = toDisp(expSum, prodCur);
  const finalDisp = goodsTotal + expensesDisp;
  const perUnit = (w.moq || 0) > 0 ? finalDisp / (w.moq as number) : 0;
  const arrived = !!l.handedToInventory;
  const outstanding = Math.max(finalDisp - (prodAdv + shipAdv), 0);

  // Every individual cost line, in the display currency (for the itemised
  // breakdown). Product/expense amounts are entered in the product currency.
  const COST_LABELS: Record<string, string> = {
    oceanFreight: "Ocean freight", doCharge: "DO charge", thcCharge: "THC (terminal handling)",
    cfsCharge: "CFS (freight station)", wgmtCharge: "WGMT (weighment)", gstCharge: "GST on charges",
    dutyActual: "Customs duty + IGST", chaCharges: "CHA charges", lastMileCost: "Last-mile (extra)",
    otherExpense: "Other", indiaTransport: "Port-to-warehouse transport",
  };
  const costLines: { label: string; amount: number }[] = [
    ...[...freightFields, ...otherFields].map((k) => ({ label: COST_LABELS[k as string], amount: toDisp((e[k] as number) || 0, prodCur) })),
    { label: COST_LABELS.indiaTransport, amount: toDisp(l.indiaTransportCost || 0, prodCur) },
  ].filter((x) => x.amount > 0);

  const FREIGHT_META: Record<string, { label: string; hint: string }> = {
    oceanFreight: { label: "Ocean freight", hint: "POL → POD" },
    doCharge: { label: "DO charge", hint: "delivery order" },
    thcCharge: { label: "THC", hint: "terminal handling" },
    cfsCharge: { label: "CFS", hint: "freight station" },
    wgmtCharge: { label: "WGMT", hint: "weighment" },
    gstCharge: { label: "GST", hint: "on destination charges" },
  };
  const OTHER_META: Record<string, { label: string; hint: string }> = {
    dutyActual: { label: "Duty + IGST", hint: "customs duty & taxes" },
    chaCharges: { label: "CHA charges", hint: "clearing agent fees" },
    lastMileCost: { label: "Last-mile (extra)", hint: "adds to India transport" },
    otherExpense: { label: "Other", hint: "inspection, insurance…" },
  };

  return (
    <div className="border-t border-line px-5 py-5">
      <p className="mb-3 text-[11px] text-muted">
        Inputs are in each value&apos;s own currency. Summary figures shown in <strong className="text-ink">{show}</strong>.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr]">
        {/* Left: editable order + payments + approvals */}
        <div className="space-y-4">
          {/* Order — editable */}
          <div className="rounded-md border border-line bg-white p-4">
            <p className="eyebrow mb-3">Order</p>
            <div className="grid grid-cols-2 gap-3">
              <FieldNum label="Quantity (MOQ)" value={w.moq} onChange={(v) => setWorking("moq", v)} />
              <FieldSelect label="Rate term" value={w.rate} options={["FOB", "CIF", "EXW", "FCA"]} onChange={(v) => setWorking("rate", v as Working["rate"])} />
              <FieldDate label="Start date" value={w.productionStart} onChange={(v) => setWorking("productionStart", v)} />
              <FieldDate label="End date (out-of-charge)" value={l.outOfChargeDate} onChange={(v) => setLogistics("outOfChargeDate", v)} />
            </div>
          </div>

          {/* Payments — editable, each in its own currency */}
          <div className="rounded-md border border-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Product payment</p>
              <CurrencyPill value={prodCur} onChange={(c) => setWorking("rateCurrency", c)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldMoney label="Total" sym={prodSym} value={w.rateValue} onChange={(v) => setWorking("rateValue", v)} />
              <FieldMoney label="Advance paid" sym={prodSym} value={w.advancePaid} onChange={(v) => setWorking("advancePaid", v)} />
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted">Freight &amp; other expenses are recorded in this currency.</p>

            <div className="mb-3 mt-4 flex items-center justify-between">
              <p className="eyebrow">Shipment payment</p>
              <CurrencyPill value={shipCur} onChange={(c) => setWorking("shipmentCurrency", c)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldMoney label="Total" sym={shipSym} value={w.shipmentValue} onChange={(v) => setWorking("shipmentValue", v)} />
              <FieldMoney label="Advance paid" sym={shipSym} value={w.shipmentAdvance} onChange={(v) => setWorking("shipmentAdvance", v)} />
            </div>
          </div>

          {/* Approvals (read-only status) */}
          <div className="rounded-md border border-line bg-white p-4">
            <p className="eyebrow mb-3">Approvals &amp; status</p>
            <ul className="grid grid-cols-2 gap-2">
              {computeOrderSummary(p).approvals.map((a) => (
                <li key={a.label} className="flex items-center gap-2">
                  <span className={clsx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    a.ok === true ? "bg-go/12 text-go" : a.ok === false ? "bg-block/12 text-block" : "bg-surface text-line-strong")}>
                    {a.ok === true ? <Check className="h-3 w-3" strokeWidth={3} /> : a.ok === false ? <X className="h-3 w-3" strokeWidth={3} /> : <Minus className="h-3 w-3" />}
                  </span>
                  <span className={clsx("text-[12.5px]", a.ok === true ? "text-ink" : "text-muted")}>{a.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right: editable expenses + converted P&L */}
        <div className="space-y-4">
          <div className="rounded-md border border-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Freight &amp; destination</p>
              <CurrencyPill value={prodCur} onChange={(c) => setWorking("rateCurrency", c)} />
            </div>
            <div className="space-y-2.5">
              {freightFields.map((k) => (
                <ExpenseInput key={k} sym={prodSym} label={FREIGHT_META[k].label} hint={FREIGHT_META[k].hint}
                  value={(e[k] as number) || 0} onChange={(v) => setExpense(k, v as never)} />
              ))}
            </div>
          </div>

          <div className="rounded-md border border-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Other expenses</p>
              <CurrencyPill value={prodCur} onChange={(c) => setWorking("rateCurrency", c)} />
            </div>
            <div className="space-y-2.5">
              {otherFields.map((k) => (
                <ExpenseInput key={k} sym={prodSym} label={OTHER_META[k].label} hint={OTHER_META[k].hint}
                  value={(e[k] as number) || 0} onChange={(v) => setExpense(k, v as never)} />
              ))}
              <div className="border-t border-line pt-2.5">
                <ExpenseInput sym={prodSym} label="Expected revenue" hint="total selling value"
                  value={e.sellingPriceTotal || 0} onChange={(v) => setExpense("sellingPriceTotal", v as never)} />
              </div>
            </div>
          </div>

          {/* Cost summary — itemised cost lines, then totals, in display currency */}
          <div className="rounded-md border border-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Cost summary</p>
              <span className="text-[11px] text-muted">in {show}</span>
            </div>
            <dl className="space-y-2 text-[13px]">
              {/* Itemised expense lines first */}
              {costLines.length > 0 ? (
                costLines.map((c) => <Line key={c.label} label={c.label} value={fmtMoney(dispSym, c.amount)} muted />)
              ) : (
                <p className="text-[12px] text-muted">No expenses recorded yet.</p>
              )}
              <div className="border-t border-line pt-2">
                <Line label="Total expenses" value={fmtMoney(dispSym, expensesDisp)} bold />
              </div>

              {/* Goods + all-in landed cost */}
              <div className="border-t border-line pt-2">
                <Line label="Order amount (goods)" value={fmtMoney(dispSym, goodsTotal)} />
              </div>
              <div className="border-t border-line pt-2">
                <Line label="= Total landed cost" value={fmtMoney(dispSym, finalDisp)} bold />
                <p className="mt-0.5 text-right text-[11px] text-muted">
                  {(w.moq || 0) > 0 ? `${fmtMoney(dispSym, perUnit)} / unit · ` : ""}factory → our warehouse, all-in
                </p>
              </div>

              {!arrived && (
                <div className="flex items-center justify-between rounded-md bg-block/10 px-2.5 py-1.5 ring-1 ring-inset ring-block/20">
                  <span className="text-[13px] font-medium text-block">Pending / amount due</span>
                  <span className="figure text-[14px] font-semibold text-block">{fmtMoney(dispSym, outstanding)}</span>
                </div>
              )}
            </dl>
            <button
              onClick={() => downloadBill(p, show, rates)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-brand-600"
            >
              <FileDown className="h-4 w-4" /> Download order bill (PDF)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- small editable field helpers --------------------------------------------

// Compact currency dropdown shown in section headers.
function CurrencyPill({ value, onChange }: { value: CurrencyCode; onChange: (c: CurrencyCode) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CurrencyCode)}
      onClick={(e) => e.stopPropagation()}
      className="h-7 appearance-none rounded-sm border border-line bg-white px-2 text-[11px] font-semibold text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
      title="Change currency for these amounts"
    >
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}

function FieldNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-body">{label}</span>
      <input type="number" value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} placeholder="0"
        className="figure h-10 w-full rounded-sm border border-line bg-white px-3 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
    </label>
  );
}

function FieldMoney({ label, sym, value, onChange }: { label: string; sym: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-body">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{sym}</span>
        <input type="number" value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} placeholder="0"
          className="figure h-10 w-full rounded-sm border border-line bg-white pl-7 pr-3 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
      </div>
    </label>
  );
}

function FieldDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-body">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-sm border border-line bg-white px-3 text-[13px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
    </label>
  );
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-body">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full appearance-none rounded-sm border border-line bg-white px-3 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function ExpenseInput({ sym, label, hint, value, onChange }: { sym: string; label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-28 shrink-0">
        <span className="block text-[13px] font-medium text-body">{label}</span>
        <span className="block text-[10.5px] text-muted">{hint}</span>
      </span>
      <div className="relative flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{sym}</span>
        <input type="number" value={value || ""} onChange={(ev) => onChange(parseFloat(ev.target.value) || 0)} placeholder="0"
          className="figure h-10 w-full rounded-sm border border-line bg-white pl-7 pr-3 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
      </div>
    </label>
  );
}

function Line({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={clsx(muted ? "text-[12.5px] text-muted" : "text-muted", bold && "font-medium text-ink")}>{label}</span>
      <span className={clsx("figure", bold ? "text-[14px] font-semibold text-ink" : muted ? "text-[12.5px] text-body" : "text-ink")}>{value}</span>
    </div>
  );
}
