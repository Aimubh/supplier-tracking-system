// Production-ready reminders. The team sets one or more lead times (e.g. "3 days
// before", "1 day before", or "every day until") against a product's
// productionReady date. This computes, for "today", whether a product is due for
// a reminder and how it should read — used to surface in-app banners.
//
// In-app only: it evaluates whenever the app is open (no background scheduler).

import type { Product } from "./store";

// The selectable lead-time options. 0 is the sentinel for "every day until".
export const NOTIFY_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: "7 days before" },
  { value: 3, label: "3 days before" },
  { value: 2, label: "2 days before" },
  { value: 1, label: "1 day before" },
  { value: 0, label: "Every day until" },
];

export interface ProductionReminder {
  productId: string;
  productName: string;
  readyDate: string; // ISO
  daysLeft: number; // whole days from today to the ready date (can be negative)
  tone: "stamp" | "block" | "seal"; // ochre upcoming / red overdue / green on-time
  message: string;
}

// Whole days between today (local midnight) and an ISO date string.
function daysUntil(iso: string): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// Should this product show a reminder today, given its selected lead times?
export function reminderForProduct(p: Product): ProductionReminder | null {
  const w = p.working;
  if (!w?.orderProcessing || w.dispatched) return null; // only while in production
  const lead = Array.isArray(w.notifyDaysBefore) ? w.notifyDaysBefore : [];
  if (lead.length === 0) return null;
  const left = daysUntil(w.productionReady);
  if (left === null) return null;

  const everyDay = lead.includes(0);
  // Fires when today matches a chosen lead time, OR "every day until" is on and
  // we're between now and the ready date, OR it's overdue.
  const matchesLead = lead.some((d) => d > 0 && left === d);
  const inEveryDayWindow = everyDay && left >= 0;
  const overdue = left < 0;

  if (!matchesLead && !inEveryDayWindow && !overdue) return null;

  let tone: ProductionReminder["tone"] = "stamp";
  let message: string;
  if (overdue) {
    tone = "block";
    message = `Production ready date passed ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago.`;
  } else if (left === 0) {
    tone = "block";
    message = "Production-ready date is today.";
  } else {
    message = `Production ready in ${left} day${left === 1 ? "" : "s"}.`;
  }

  return {
    productId: p.id,
    productName: p.name,
    readyDate: w.productionReady,
    daysLeft: left,
    tone,
    message,
  };
}

// All active reminders across the catalogue, soonest first.
export function activeReminders(products: Product[]): ProductionReminder[] {
  return products
    .filter((p) => !p.filed)
    .map(reminderForProduct)
    .filter((r): r is ProductionReminder => r !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
