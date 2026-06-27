// Send production-ready reminders to the Telegram team group.
//   POST /api/reminders/send         → manual trigger (signed-in admin/employee)
//   GET  /api/reminders/send?secret= → cron trigger (no session; uses a secret)
//
// Loads all active products, finds which are due for a reminder TODAY (per each
// product's working.notifyDaysBefore vs its productionReady date), and posts a
// single summary message to the configured Telegram chat. Safe to call daily.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";
import { sendTelegram, telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";

interface DueReminder {
  name: string;
  readyDate: string;
  daysLeft: number;
  overdue: boolean;
  kind: "production" | "eta";
}

function daysUntil(iso: string): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// Shared lead-time logic: given a target date and chosen lead days, decide if a
// reminder is due today (0 in lead = "every day until the date").
function isDueToday(targetIso: string, lead: number[]): { left: number; overdue: boolean } | null {
  if (lead.length === 0) return null;
  const left = daysUntil(targetIso);
  if (left === null) return null;
  const everyDay = lead.includes(0);
  const matchesLead = lead.some((d) => d > 0 && left === d);
  const inEveryDayWindow = everyDay && left >= 0;
  const overdue = left < 0;
  if (!matchesLead && !inEveryDayWindow && !overdue) return null;
  return { left, overdue };
}

// Evaluate a raw product row's `working` slice for a production-ready reminder.
function dueFor(name: string, working: Record<string, unknown> | null): DueReminder | null {
  const w = working ?? {};
  if (!w.orderProcessing || w.dispatched) return null;
  const lead = Array.isArray(w.notifyDaysBefore) ? (w.notifyDaysBefore as number[]) : [];
  const hit = isDueToday(String(w.productionReady ?? ""), lead);
  if (!hit) return null;
  return { name, readyDate: String(w.productionReady ?? ""), daysLeft: hit.left, overdue: hit.overdue, kind: "production" };
}

// Evaluate a raw product row's `logistics` slice for an ETA (ship-at-port) reminder.
// Stops once the vessel is marked arrived.
function dueForEta(name: string, logistics: Record<string, unknown> | null): DueReminder | null {
  const l = logistics ?? {};
  if (l.arrived) return null;
  const lead = Array.isArray(l.notifyEtaDaysBefore) ? (l.notifyEtaDaysBefore as number[]) : [];
  const hit = isDueToday(String(l.eta ?? ""), lead);
  if (!hit) return null;
  return { name, readyDate: String(l.eta ?? ""), daysLeft: hit.left, overdue: hit.overdue, kind: "eta" };
}

async function runReminders() {
  if (!telegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)." },
      { status: 400 }
    );
  }

  const rows = await prisma.product.findMany({ where: { filed: false } });
  const due: DueReminder[] = [];
  for (const r of rows) {
    const prod = dueFor(r.name, r.working as Record<string, unknown> | null);
    if (prod) due.push(prod);
    const eta = dueForEta(r.name, r.logistics as Record<string, unknown> | null);
    if (eta) due.push(eta);
  }

  if (due.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "No reminders due today." });
  }

  due.sort((a, b) => a.daysLeft - b.daysLeft);

  const prodLines = due.filter((d) => d.kind === "production").map((d) => {
    if (d.overdue) return `🔴 *${d.name}* — overdue by ${Math.abs(d.daysLeft)} day(s) (was ${d.readyDate})`;
    if (d.daysLeft === 0) return `🔴 *${d.name}* — production-ready *today* (${d.readyDate})`;
    return `🟠 *${d.name}* — ready in ${d.daysLeft} day(s) on ${d.readyDate}`;
  });
  const etaLines = due.filter((d) => d.kind === "eta").map((d) => {
    if (d.overdue) return `🔴 *${d.name}* — ETA passed ${Math.abs(d.daysLeft)} day(s) ago (was ${d.readyDate}) — vessel not yet marked arrived`;
    if (d.daysLeft === 0) return `🚢 *${d.name}* — ship reaches port *today* (${d.readyDate})`;
    return `🚢 *${d.name}* — ship reaches port in ${d.daysLeft} day(s) on ${d.readyDate}`;
  });

  const sections: string[] = [];
  if (prodLines.length) sections.push(`📦 *Production*\n${prodLines.join("\n")}`);
  if (etaLines.length) sections.push(`🚢 *Shipment arrival (ETA)*\n${etaLines.join("\n")}`);
  const text = `🔔 *Reminders*\n\n${sections.join("\n\n")}`;

  const result = await sendTelegram(text);
  if (!result.ok) {
    return NextResponse.json({ error: `Telegram send failed: ${result.error}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: due.length, products: due.map((d) => d.name) });
}

// Manual trigger — requires a signed-in user with product access.
export async function POST() {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  return runReminders();
}

// Cron trigger — no session; authorised by a shared secret in the query string.
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret") ?? "";
  if (!process.env.REMINDER_CRON_SECRET || secret !== process.env.REMINDER_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runReminders();
}
