// Setup helper: shows recent Telegram updates so you can find the chat id to put
// in TELEGRAM_CHAT_ID. Add the bot to your group, send any message in the group,
// then open this endpoint — look for "chat":{"id": -100…} in the output.
//   GET /api/reminders/chat-id   (admin/employee with product access)

import { NextResponse } from "next/server";
import { requireTabAccess, PRODUCT_TABS } from "@/lib/api-guard";
import { getUpdates } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireTabAccess(PRODUCT_TABS);
  if (denied) return denied;
  const updates = await getUpdates();
  return NextResponse.json(updates);
}
