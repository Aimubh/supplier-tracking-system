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
}

function daysUntil(iso: string): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// Evaluate a raw product row's `working` slice for a due reminder today.
function dueFor(name: string, working: Record<string, unknown> | null): DueReminder | null {
  const w = working ?? {};
  if (!w.orderProcessing || w.dispatched) return null;
  const lead = Array.isArray(w.notifyDaysBefore) ? (w.notifyDaysBefore as number[]) : [];
  if (lead.length === 0) return null;
  const left = daysUntil(String(w.productionReady ?? ""));
  if (left === null) return null;

  const everyDay = lead.includes(0);
  const matchesLead = lead.some((d) => d > 0 && left === d);
  const inEveryDayWindow = everyDay && left >= 0;
  const overdue = left < 0;
  if (!matchesLead && !inEveryDayWindow && !overdue) return null;

  return { name, readyDate: String(w.productionReady ?? ""), daysLeft: left, overdue };
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
    const hit = dueFor(r.name, r.working as Record<string, unknown> | null);
    if (hit) due.push(hit);
  }

  if (due.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "No reminders due today." });
  }

  due.sort((a, b) => a.daysLeft - b.daysLeft);
  const lines = due.map((d) => {
    if (d.overdue) return `🔴 *${d.name}* — overdue by ${Math.abs(d.daysLeft)} day(s) (was ${d.readyDate})`;
    if (d.daysLeft === 0) return `🔴 *${d.name}* — production-ready *today* (${d.readyDate})`;
    return `🟠 *${d.name}* — ready in ${d.daysLeft} day(s) on ${d.readyDate}`;
  });
  const text = `🔔 *Production reminders*\n\n${lines.join("\n")}`;

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
