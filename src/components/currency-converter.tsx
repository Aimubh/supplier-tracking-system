"use client";

import { useEffect, useState } from "react";
import { RefreshCw, TrendingUp, AlertCircle } from "lucide-react";
import type { CurrencyCode } from "@/lib/store";

// Currencies we convert between, with display meta.
const CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "USD", label: "USD — US Dollar", symbol: "$" },
  { code: "INR", label: "INR — Indian Rupee", symbol: "₹" },
  { code: "CNY", label: "CNY — Chinese Yuan", symbol: "¥" },
];

const SYMBOL: Record<CurrencyCode, string> = { USD: "$", INR: "₹", CNY: "¥" };

// Free, no-key FX endpoint. Returns a USD-based rate table for every currency,
// so we can convert between any pair from one fetch.
const FX_URL = "https://open.er-api.com/v6/latest/USD";

// Module-level cache so we don't refetch on every panel mount within a session.
let ratesCache: { rates: Record<string, number>; fetchedAt: number } | null = null;

export function CurrencyConverter({
  amount,
  currency,
  onCurrencyChange,
}: {
  amount: number;
  currency: CurrencyCode;
  onCurrencyChange: (c: CurrencyCode) => void;
}) {
  const [rates, setRates] = useState<Record<string, number> | null>(ratesCache?.rates ?? null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(ratesCache?.fetchedAt ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which currency to show the converted amount in (view-only preference).
  const [target, setTarget] = useState<CurrencyCode>(currency === "USD" ? "INR" : "USD");

  async function load(force = false) {
    // Reuse a cache that's under 10 minutes old unless forced.
    if (!force && ratesCache && Date.now() - ratesCache.fetchedAt < 10 * 60 * 1000) {
      setRates(ratesCache.rates);
      setUpdatedAt(ratesCache.fetchedAt);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(FX_URL);
      const data = await res.json();
      if (data.result !== "success" || !data.rates) throw new Error("bad response");
      ratesCache = { rates: data.rates, fetchedAt: Date.now() };
      setRates(data.rates);
      setUpdatedAt(ratesCache.fetchedAt);
    } catch {
      setError("Couldn't fetch live rates. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convert `amount` (in `currency`) into the target via the USD-based table.
  function convert(to: CurrencyCode): number | null {
    if (!rates) return null;
    const from = rates[currency];
    const target = rates[to];
    if (!from || !target) return null;
    // amount in USD = amount / rate[from]; then × rate[to].
    return (amount / from) * target;
  }

  const converted = convert(target);
  // Current market rate: 1 unit of the amount currency, in the target currency.
  const unitRate =
    rates && rates[currency] && rates[target] ? rates[target] / rates[currency] : null;

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-body">
          <TrendingUp className="h-3.5 w-3.5 text-ink" /> Live currency converter
        </span>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] font-medium text-link transition hover:underline disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Currency the entered amount is in (saved with the rate) */}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-body">Amount currency</span>
          <select
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value as CurrencyCode)}
            className="h-11 w-full appearance-none rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code} className="bg-white text-ink">
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {/* Currency to convert into */}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-body">Convert to</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as CurrencyCode)}
            className="h-11 w-full appearance-none rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code} className="bg-white text-ink">
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Converted amount + current market rate */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-white px-4 py-3">
          <p className="eyebrow">Converted amount · {target}</p>
          <p className="figure mt-0.5 text-[22px] font-semibold text-ink">
            {converted == null
              ? "—"
              : `${SYMBOL[target]} ${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          </p>
        </div>
        <div className="rounded-md border border-line bg-white px-4 py-3">
          <p className="eyebrow">Market rate</p>
          <p className="figure mt-0.5 text-[22px] font-semibold text-ink">
            {unitRate == null
              ? "—"
              : `1 ${currency} = ${SYMBOL[target]} ${unitRate.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {unitRate == null
              ? ""
              : `1 ${target} = ${SYMBOL[currency]} ${(1 / unitRate).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currency}`}
          </p>
        </div>
      </div>

      {/* Status line */}
      <div className="mt-2.5 text-[11px]">
        {error ? (
          <span className="flex items-center gap-1.5 text-block">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </span>
        ) : loading && !rates ? (
          <span className="text-muted">Fetching live market rates…</span>
        ) : updatedAt ? (
          <span className="text-muted">
            {SYMBOL[currency]} {amount.toLocaleString()} {currency} → {target} · live mid-market rate, updated{" "}
            {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
