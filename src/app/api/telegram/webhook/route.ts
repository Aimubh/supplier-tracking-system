// Telegram webhook — the supplier-finder bot.
//   POST /api/telegram/webhook   (called by Telegram on each incoming message)
//
// Flow: a user in a group sends a product PHOTO and tags the bot with a hashtag,
// e.g.  "@lazer_finderBot #prize".  The bot:
//   1) verifies the request is really from Telegram (secret header),
//   2) downloads the photo,
//   3) image-searches Alibaba via Vendex (mock fallback if offline),
//   4) re-ranks the suppliers by the tag — 60% image match + 40% price/top/review,
//   5) replies the top-5 into the SAME chat.
//
// This is a PUBLIC endpoint (no app session — Telegram has none), so it is
// authorised only by the shared secret token, mirroring how the reminder cron
// route is secured. It never mutates app data; it only reads suppliers and replies.

import { NextResponse } from "next/server";
import { downloadTelegramFile, sendTelegram } from "@/lib/telegram";
import { searchSuppliersByImage } from "@/lib/vendex";
import { rankTopN, type RankedCandidate, type RankTag } from "@/lib/supplier-ranking";
import { suggestHsn } from "@/lib/hsn-advisor";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // image search can take ~60-90s

// Minimal shape of the Telegram update we care about.
interface TgPhotoSize { file_id: string; width: number; height: number; file_size?: number }
interface TgMessage {
  message_id: number;
  chat: { id: number };
  caption?: string;
  text?: string;
  photo?: TgPhotoSize[];
}
interface TgUpdate { message?: TgMessage }

function dimensionLabel(tag: RankTag): string {
  if (tag.dimension === "price") return "cheapest price";
  if (tag.dimension === "top") return "best rating";
  if (tag.dimension === "review") return "most reviews";
  return "image match";
}

// Top-5 candidate Indian HSN codes for the product, derived from the supplier
// titles, each with its duty calculation. Returns a multi-line block, or "".
// `landedInr` (cheapest supplier's price, INR) lets us show the actual ₹ duty.
function hsnBlock(top: RankedCandidate[], landedInr: number | null): string {
  // Pool the titles so keyword matching has the most text to work with.
  const text = top.map((s) => s.title).filter(Boolean).join(" ");
  if (!text.trim()) return "";
  const cands = suggestHsn(text, "", 5);
  if (cands.length === 0) return "";

  const pct = (f: number) => `${Math.round(f * 100)}%`;
  // Only flag "lowest duty" if duties actually differ across candidates.
  const minDuty = Math.min(...cands.map((c) => c.effectiveDutyPct));
  const allSame = cands.every((c) => Math.abs(c.effectiveDutyPct - minDuty) < 1e-9);
  const rows = cands.map((c, i) => {
    const bcd = pct(c.bcdPct);
    const sws = pct(c.bcdPct * c.swsPct); // SWS = 10% OF the BCD
    const eff = pct(c.effectiveDutyPct);
    const gst = pct(c.gstPct);
    const isLowest = !allSame && Math.abs(c.effectiveDutyPct - minDuty) < 1e-9;
    const tag = isLowest ? " ✅ lowest duty" : "";
    // Per-unit duty in ₹ when we know the cheapest landed price.
    const dutyInr = landedInr != null ? ` ≈ ₹${Math.round(landedInr * c.effectiveDutyPct).toLocaleString("en-IN")}/unit` : "";
    return (
      `${i + 1}. *${c.hsn}* — ${escapeMd(c.title)}${tag}\n` +
      `    BCD ${bcd} + SWS ${sws} = *${eff} duty*, then GST ${gst}${dutyInr}`
    );
  });

  const lead = landedInr != null ? ` · est. on ₹${Math.round(landedInr).toLocaleString("en-IN")}/unit` : "";
  return `🏷️ *Top HSN codes* (India import, duty on CIF${lead})\n${rows.join("\n")}`;
}

// Build the Markdown reply for the top-N ranked suppliers.
function formatReply(top: RankedCandidate[], tag: RankTag, note?: string): string {
  const pct = Math.round(tag.imageWeight * 100);
  const header =
    tag.dimension === null
      ? "🔎 *Top suppliers* (ranked by image match)"
      : `🔎 *Top suppliers* — ${pct}% image + ${100 - pct}% ${dimensionLabel(tag)}`;

  const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  const lines = top.map((s, i) => {
    // Prefer the INR value; fall back to converting USD at ~83.
    const retailInr = s.priceInr != null ? s.priceInr : s.priceUsd != null ? s.priceUsd / 0.012 : null;
    let price = "price n/a";
    if (retailInr != null) {
      // Estimated wholesale/FOB band: retail is typically 2-3x the factory price,
      // so wholesale ≈ 30-50% of retail. Clearly an ESTIMATE, not a real quote.
      const wholesaleLo = retailInr * 0.3;
      const wholesaleHi = retailInr * 0.5;
      price = `retail ${inr(retailInr)} · est. wholesale ${inr(wholesaleLo)}–${inr(wholesaleHi)}`;
    }
    const stars = s.rating != null ? `⭐${s.rating}` : "";
    const revs = s.reviews != null ? `(${s.reviews.toLocaleString()} reviews)` : "";
    const meta = [stars, revs].filter(Boolean).join(" · ");
    const name = s.url ? `[${escapeMd(s.name)}](${s.url})` : `*${escapeMd(s.name)}*`;
    return `${i + 1}. ${name}\n   ${price}${meta ? " · " + meta : ""}`;
  });

  // Cheapest landed estimate (mid of the wholesale band of the cheapest supplier)
  // to express duty in ₹ per unit.
  const prices = top
    .map((s) => (s.priceInr != null ? s.priceInr : s.priceUsd != null ? s.priceUsd / 0.012 : null))
    .filter((n): n is number => n != null);
  const cheapest = prices.length ? Math.min(...prices) : null;
  const landedEst = cheapest != null ? cheapest * 0.4 : null; // mid of 30–50% wholesale band

  const hsn = hsnBlock(top, landedEst);
  const estNote = "💡 Wholesale is an *estimate* (≈30–50% of retail). HSN/duty are suggestions — verify before filing.";
  const footer = `\n\n${estNote}${note ? `\n⚠️ ${escapeMd(note)}` : ""}`;
  return `${header}\n\n${lines.join("\n")}${hsn ? `\n\n${hsn}` : ""}${footer}`;
}

// Escape Telegram-Markdown-significant chars in dynamic text.
function escapeMd(s: string): string {
  return s.replace(/([_*\[\]()])/g, "\\$1");
}

export async function POST(req: Request) {
  // 1) Authorise: Telegram echoes our secret in this header. Reject anything else.
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true }); // ack malformed updates; don't retry-loop
  }

  const msg = update.message;
  // Always 200 so Telegram doesn't redeliver; we just don't act on non-photo msgs.
  if (!msg?.chat?.id) return NextResponse.json({ ok: true });
  const chatId = String(msg.chat.id);
  const caption = msg.caption ?? msg.text ?? "";

  // Only act when a photo is attached. (A bare text mention with no image can't
  // be searched.) Nudge the user if they forgot the image.
  if (!msg.photo || msg.photo.length === 0) {
    if (/@\w*bot/i.test(caption) || caption.includes("#")) {
      await sendTelegram("📷 Send a product *photo* and tag me with `#prize`, `#top`, or `#review`.", chatId);
    }
    return NextResponse.json({ ok: true });
  }

  // 2) Pick the largest photo size (best for image search) and download it.
  const best = msg.photo[msg.photo.length - 1];
  const file = await downloadTelegramFile(best.file_id);
  if (!file.ok) {
    await sendTelegram(`⚠️ Couldn't fetch your image: ${file.error}`, chatId);
    return NextResponse.json({ ok: true });
  }

  // Acknowledge immediately — the search can take a while.
  await sendTelegram("⏳ Searching suppliers for your image…", chatId);

  // 3) Image search → suppliers (mock fallback if Vendex is offline).
  const result = await searchSuppliersByImage(file.bytes, file.mime);
  if (!result.ok || result.suppliers.length === 0) {
    await sendTelegram(`😕 ${result.error ?? "No suppliers found for that image."}`, chatId);
    return NextResponse.json({ ok: true });
  }

  // 4) Parse the tag and re-rank (60% image + 40% dimension).
  const { tag, top } = rankTopN(result.suppliers, caption, 5);

  // 5) Reply the ranked top-5.
  const reply = formatReply(top, tag, result.note);
  const sent = await sendTelegram(reply, chatId);
  if (!sent.ok) {
    // Last-ditch: report the failure so it's not silent.
    await sendTelegram(`⚠️ Found suppliers but couldn't format the reply: ${sent.error}`, chatId);
  }

  return NextResponse.json({ ok: true });
}
