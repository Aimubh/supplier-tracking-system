"use client";

// Shared live FX rates. One USD-based rate table is fetched (free, no key) and
// cached at module level, so any component can convert between USD / INR / CNY.

import { useEffect, useState } from "react";
import type { CurrencyCode } from "./store";

const FX_URL = "https://open.er-api.com/v6/latest/USD";

export type Rates = Record<string, number>;

let ratesCache: { rates: Rates; fetchedAt: number } | null = null;
let inflight: Promise<Rates | null> | null = null;

async function fetchRates(force = false): Promise<Rates | null> {
  if (!force && ratesCache && Date.now() - ratesCache.fetchedAt < 10 * 60 * 1000) {
    return ratesCache.rates;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(FX_URL);
      const data = await res.json();
      if (data.result !== "success" || !data.rates) throw new Error("bad");
      ratesCache = { rates: data.rates, fetchedAt: Date.now() };
      return data.rates as Rates;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Convert an amount from one currency to another via the USD-based table.
export function convert(amount: number, from: CurrencyCode, to: CurrencyCode, rates: Rates | null): number {
  if (from === to || !rates) return amount;
  const rFrom = rates[from];
  const rTo = rates[to];
  if (!rFrom || !rTo) return amount;
  return (amount / rFrom) * rTo;
}

// Hook: returns the live rate table (null until loaded), a loading flag, the
// last-updated timestamp, and a manual refresh.
export function useFxRates() {
  const [rates, setRates] = useState<Rates | null>(ratesCache?.rates ?? null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(ratesCache?.fetchedAt ?? null);
  const [loading, setLoading] = useState(false);

  const load = async (force = false) => {
    setLoading(true);
    const r = await fetchRates(force);
    if (r) {
      setRates(r);
      setUpdatedAt(ratesCache?.fetchedAt ?? Date.now());
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!ratesCache) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { rates, updatedAt, loading, refresh: () => load(true) };
}

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = { USD: "$", INR: "₹", CNY: "¥" };
