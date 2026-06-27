// Telegram bot messaging — used to push production-ready reminders to a team
// group even when no one has the app open. Server-side only (uses the bot token
// from env, never exposed to the client).

const API = "https://api.telegram.org";

function token(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

export function telegramConfigured(): boolean {
  return Boolean(token() && process.env.TELEGRAM_CHAT_ID);
}

// Send a Markdown message to the configured chat/group. Returns ok + any error.
export async function sendTelegram(
  text: string,
  chatId = process.env.TELEGRAM_CHAT_ID ?? ""
): Promise<{ ok: boolean; error?: string }> {
  if (!token()) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  if (!chatId) return { ok: false, error: "TELEGRAM_CHAT_ID not set" };
  try {
    const res = await fetch(`${API}/bot${token()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

// Helper to discover the chat id: returns recent updates (who messaged the bot /
// which groups it's in). Used by /api/reminders/chat-id during setup.
export async function getUpdates(): Promise<unknown> {
  if (!token()) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`${API}/bot${token()}/getUpdates`, {
      signal: AbortSignal.timeout(15_000),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "getUpdates failed" };
  }
}
