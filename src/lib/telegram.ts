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

// ---- receive side (the supplier-finder bot) ---------------------------------
// These power the webhook: download the photo a user sent, then reply into the
// same chat the message came from (which may be a group, not TELEGRAM_CHAT_ID).

export function botToken(): string {
  return token();
}

// Resolve a Telegram file_id to a temporary download path, then fetch the bytes.
// Telegram file links live ~1h; we download immediately. Returns the raw bytes.
export async function downloadTelegramFile(
  fileId: string
): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string }> {
  if (!token()) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const meta = await fetch(`${API}/bot${token()}/getFile?file_id=${encodeURIComponent(fileId)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const data = await meta.json();
    if (!data.ok || !data.result?.file_path) {
      return { ok: false, error: data.description ?? "getFile failed" };
    }
    const path: string = data.result.file_path;
    const bin = await fetch(`${API}/file/bot${token()}/${path}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!bin.ok) return { ok: false, error: `download HTTP ${bin.status}` };
    const buf = new Uint8Array(await bin.arrayBuffer());
    // Infer a content type from the extension (Telegram photos are jpg).
    const mime = path.endsWith(".png")
      ? "image/png"
      : path.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
    return { ok: true, bytes: buf, mime };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "download failed" };
  }
}

// Register (or clear) the webhook URL Telegram should POST updates to. Pass a
// secretToken so the webhook can verify requests really come from Telegram.
export async function setWebhook(
  url: string,
  secretToken: string
): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  if (!token()) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`${API}/bot${token()}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secretToken || undefined,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "setWebhook failed" };
  }
}
