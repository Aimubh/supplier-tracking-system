"use client";

// The goods payments for one product: each remittance on its own row with the
// day it went out, the amount, and the USD rate it was paid at — typed in by
// hand from the bank's debit advice, never looked up. Paid and pending are
// worked out from the rows, so a balance paid weeks after the advance is valued
// at ITS rate, not the advance's. Freight / duty / CHA entries on the same list
// are left untouched.

import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { useStore, type Payment, type Product, type PaymentType } from "@/lib/store";
import { goodsPayments } from "@/lib/order-summary";
import { useFxRates, CURRENCY_SYMBOL } from "@/lib/fx";
import { Num } from "./fields";

const TYPES: { value: PaymentType; label: string }[] = [
  { value: "DEPOSIT", label: "Advance" },
  { value: "BALANCE", label: "Balance" },
  { value: "OTHER", label: "Other" },
];

// A small labelled field, with an optional note under the input.
function Lbl({ text, note, warn, children }: { text: string; note?: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block truncate text-[11px] font-medium text-body" title={text}>{text}</span>
      {children}
      {note && <span className={clsx("mt-1 block text-[10.5px] leading-tight", warn ? "font-medium text-pending" : "text-muted")}>{note}</span>}
    </label>
  );
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function PaymentsEditor({ p, onChange }: { p: Product; onChange: (next: Payment[]) => void }) {
  const { uid } = useStore();
  const fx = useFxRates();
  const cur = p.working.rateCurrency ?? "INR";
  const sym = CURRENCY_SYMBOL[cur];
  const foreign = cur !== "INR";
  const rows = goodsPayments(p);
  const others = (p.payments ?? []).filter((x) => !rows.includes(x));
  // ₹ per unit of the product currency today — only ever used as an estimate.
  const today = fx.rates && fx.rates.INR && fx.rates[cur] ? fx.rates.INR / fx.rates[cur] : null;

  const save = (next: Payment[]) => onChange([...others, ...next]);
  const update = (id: string, patch: Partial<Payment>) => save(rows.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const total = p.working.rateValue || 0;
  const listed = rows.reduce((a, x) => a + (x.amount || 0), 0);
  const paidRows = rows.filter((x) => x.status === "PAID");
  const paidAmt = paidRows.reduce((a, x) => a + (x.amount || 0), 0);
  const pendingAmt = Math.max(total - paidAmt, 0);

  // Rupees per row: the rate typed for it. A row with no rate yet (paid or not)
  // is only an estimate at today's rate, and says so.
  const valueOf = (x: Payment): { inr: number | null; rate: number | null; exact: boolean } => {
    if (!foreign) return { inr: x.amount || 0, rate: null, exact: true };
    if (x.fxRate) return { inr: (x.amount || 0) * x.fxRate, rate: x.fxRate, exact: true };
    return today ? { inr: (x.amount || 0) * today, rate: today, exact: false } : { inr: null, rate: null, exact: false };
  };
  const paidInr = paidRows.reduce((a, x) => a + (valueOf(x).inr ?? 0), 0);
  const paidExact = paidRows.every((x) => valueOf(x).exact);
  const bankTotal = rows.reduce((a, x) => a + (x.bankCharges || 0), 0);

  function add() {
    const remaining = r2(Math.max(total - listed, 0));
    save([...rows, {
      id: uid("pay"), type: rows.length ? "BALANCE" : "DEPOSIT", amount: remaining, currency: cur,
      dueDate: "", paidDate: "", status: "PENDING", proof: "",
    }]);
  }
  // A product with only the old single "advance paid" figure: turn it into a row.
  const typedAdvance = rows.length === 0 ? p.working.advancePaid || 0 : 0;
  function fromTypedAdvance() {
    save([{ id: uid("pay"), type: "DEPOSIT", amount: typedAdvance, currency: cur, dueDate: "", paidDate: "", status: "PAID", proof: "" }]);
  }

  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="eyebrow">Payments</p>
        <span className="text-right text-[11px] text-muted">each valued at the rate you enter · bank charges = commission + foreign bank + SWIFT, without GST · saves as you type</span>
      </div>

      {rows.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted">
            No payments listed yet. Add each payment with the date it was paid and the bank&apos;s rate from the debit advice.
          </p>
          {typedAdvance > 0 && (
            <button type="button" onClick={fromTypedAdvance}
              className="rounded-md bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-line hover:bg-white">
              Turn the typed advance ({sym}{typedAdvance.toLocaleString(undefined, { maximumFractionDigits: 2 })}) into a payment row
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((x) => {
            const v = valueOf(x);
            const date = x.status === "PAID" ? x.paidDate : x.dueDate;
            const needsRate = foreign && x.status === "PAID" && !x.fxRate;
            return (
              <div key={x.id} className="rounded-md border border-line bg-surface p-2.5">
                <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3">
                  <Lbl text="Payment">
                    <select value={x.type} onChange={(e) => update(x.id, { type: e.target.value as PaymentType })}
                      className="h-10 w-full rounded-sm border border-line bg-white px-2 text-[13px] text-ink focus:border-link focus:outline-none">
                      {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Lbl>
                  <Lbl text={x.status === "PAID" ? "Date paid" : "Due date"}>
                    <input type="date" value={date || ""}
                      onChange={(e) => update(x.id, x.status === "PAID" ? { paidDate: e.target.value, dueDate: x.dueDate || e.target.value } : { dueDate: e.target.value })}
                      className="h-10 w-full rounded-sm border border-line bg-white px-2 text-[13px] text-ink focus:border-link focus:outline-none" />
                  </Lbl>
                  <Lbl text={`Amount (${cur})`}>
                    <Num value={x.amount} onChange={(n) => update(x.id, { amount: n })} prefix={sym} placeholder="0" blankZero />
                  </Lbl>
                  {foreign && (
                    <Lbl text={`${cur} rate on ${x.status === "PAID" ? "day paid" : "payment day"} (₹ per ${sym}1)`}
                      note={needsRate ? "Enter the rate from the bank's debit advice" : undefined} warn={needsRate}>
                      <Num value={x.fxRate ?? 0} onChange={(n) => update(x.id, { fxRate: n > 0 ? n : undefined })} prefix="₹"
                        placeholder="from the bank's debit advice" blankZero />
                    </Lbl>
                  )}
                  <Lbl text="Bank charges (₹)">
                    <Num value={x.bankCharges ?? 0} onChange={(n) => update(x.id, { bankCharges: n > 0 ? n : undefined })} prefix="₹" placeholder="without GST" blankZero />
                  </Lbl>
                  <div className="flex h-10 items-center gap-3 self-end">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink">
                      <input type="checkbox" checked={x.status === "PAID"}
                        onChange={(e) => update(x.id, e.target.checked
                          ? { status: "PAID", paidDate: x.paidDate || x.dueDate }
                          : { status: "PENDING", dueDate: x.dueDate || x.paidDate, paidDate: "" })} />
                      Paid
                    </label>
                    <button type="button" onClick={() => save(rows.filter((y) => y.id !== x.id))} title="Remove this payment"
                      className="text-muted hover:text-block"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                {foreign && (
                  <p className={clsx("mt-1.5 text-[11px]", v.exact ? "text-body" : "text-pending")}>
                    {v.inr !== null ? `${v.exact ? "" : "≈ "}${inr(v.inr)}` : "—"}
                    {v.rate ? ` at ${v.rate.toFixed(v.exact ? 4 : 2)}` : ""}
                    {v.exact ? " · rate entered" : v.rate ? " · estimate at today's rate until a rate is entered" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={add}
          className="flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-line hover:bg-white">
          <Plus className="h-3.5 w-3.5" /> Add payment
        </button>
        {rows.length > 0 && total > 0 && Math.abs(listed - total) > 0.01 && (
          <span className="text-[11px] text-pending">Rows add up to {sym}{r2(listed).toLocaleString()} of the {sym}{total.toLocaleString()} order</span>
        )}
      </div>

      {rows.length > 0 && bankTotal > 0 && (
        <p className="mt-2 text-[12px] text-body">
          Bank charges on these payments: <span className="figure font-semibold text-ink">{inr(bankTotal)}</span>
          <span className="text-muted"> · added to landed cost</span>
        </p>
      )}
      {rows.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-md bg-go/10 px-2.5 py-2">
            <p className="eyebrow">Paid</p>
            <p className="figure font-semibold text-go">{sym}{r2(paidAmt).toLocaleString()}</p>
            {foreign && <p className={clsx("figure text-[11px]", paidExact ? "text-body" : "text-pending")}>{paidExact ? inr(paidInr) : `≈ ${inr(paidInr)} · a paid row has no rate yet`}</p>}
          </div>
          <div className="rounded-md bg-pending/10 px-2.5 py-2">
            <p className="eyebrow">Still to pay</p>
            <p className="figure font-semibold text-pending">{sym}{r2(pendingAmt).toLocaleString()}</p>
            {foreign && pendingAmt > 0 && today && <p className="figure text-[11px] text-body">≈ {inr(pendingAmt * today)} at today&apos;s {today.toFixed(2)}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
