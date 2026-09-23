"use client";

// Shared live FX rates. One USD-based rate table is fetched (free, no key) and
// cached at module level, so any component can convert between USD / INR / CNY.

import { useEffect, useState } from "react";
import type { CurrencyCode } from "./store";

const FX_URL = "https://open.er-api.com/v6/latest/USD";

// Historical rates, by date. A payment made in May must be valued at May's rate,
// not today's — otherwise a settled invoice keeps changing value every time the
// page is opened. open.er-api.com serves only the latest rate, so dated lookups
// go to Frankfurter (ECB reference rates, free, no key).
const FX_HISTORICAL_URL = "https://api.frankfurter.dev/v1";

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

// One cache entry per ISO date. Historical rates never change, so these are
// kept for the life of the page.
const historicalCache = new Map<string, Rates | null>();
const historicalInflight = new Map<string, Promise<Rates | null>>();

// Rates as they stood on `date` (YYYY-MM-DD). Returns null if unavailable, so
// callers can fall back to the live table rather than silently mis-converting.
export async function fetchRatesOn(date: string): Promise<Rates | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (historicalCache.has(date)) return historicalCache.get(date) ?? null;
  const pending = historicalInflight.get(date);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(`${FX_HISTORICAL_URL}/${date}?base=USD`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.rates) throw new Error("no rates");
      // Frankfurter omits the base currency from the table; convert() needs it.
      const rates: Rates = { USD: 1, ...data.rates };
      historicalCache.set(date, rates);
      return rates;
    } catch {
      historicalCache.set(date, null); // don't retry a bad date every render
      return null;
    } finally {
      historicalInflight.delete(date);
    }
  })();
  historicalInflight.set(date, p);
  return p;
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

// Convert using the rate that applied on `date`, falling back to the live table
// when that date hasn't loaded (or the API had no data for it). `byDate` is what
// useRatesForDates() returns.
export function convertAsOf(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  date: string | undefined,
  byDate: Record<string, Rates | null>,
  live: Rates | null
): number {
  const dated = date ? byDate[date] : null;
  return convert(amount, from, to, dated ?? live);
}

// Load the historical tables for a set of dates. Re-renders as each arrives, so
// figures settle onto their correct rate rather than blocking the page.
export function useRatesForDates(dates: (string | undefined)[]) {
  const [byDate, setByDate] = useState<Record<string, Rates | null>>({});
  // Stable key so the effect only re-runs when the actual set of dates changes.
  const key = Array.from(new Set(dates.filter(Boolean) as string[])).sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(",") : [];
    if (wanted.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        wanted.map(async (d) => [d, await fetchRatesOn(d)] as const)
      );
      if (cancelled) return;
      setByDate((prev) => {
        const next = { ...prev };
        for (const [d, r] of entries) next[d] = r;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return byDate;
}
