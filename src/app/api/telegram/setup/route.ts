// Telegram webhook setup — admin-only.
//   POST /api/telegram/setup        → register the webhook with Telegram
//   GET  /api/telegram/setup        → show current webhook info (debug)
//
// Registers Telegram to POST updates to /api/telegram/webhook, authenticated by
// TELEGRAM_WEBHOOK_SECRET. The public base URL comes from NEXTAUTH_URL (set in
// prod) or the request origin. Run this ONCE after deploying, or whenever the
// URL/secret changes. Admin session required — registering a webhook controls
// where the bot's messages go.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-guard";
import { setWebhook, botToken } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const TG_API = "https://api.telegram.org";

function baseUrl(req: Request): string {
  const env = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (env) return env;
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!secret) {
    return NextResponse.json(
      { error: "Set TELEGRAM_WEBHOOK_SECRET in .env first (any long random string)." },
      { status: 400 }
    );
  }
  const base = baseUrl(req);
  if (base.startsWith("http://")) {
    return NextResponse.json(
      { error: `Telegram requires HTTPS for webhooks. Current base is ${base}. Deploy (Vercel) or use an HTTPS tunnel, then set NEXTAUTH_URL.` },
      { status: 400 }
    );
  }
  const url = `${base}/api/telegram/webhook`;
  const res = await setWebhook(url, secret);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, webhook: url, message: "Webhook registered. Tag the bot with a photo + #prize/#top/#review." });
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!botToken()) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 400 });
  try {
    const r = await fetch(`${TG_API}/bot${botToken()}/getWebhookInfo`, { signal: AbortSignal.timeout(15_000) });
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "getWebhookInfo failed" }, { status: 502 });
  }
}
