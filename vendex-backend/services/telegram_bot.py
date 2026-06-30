"""
Telegram supplier-search bot.

Send (or tag the bot with) a PRODUCT PHOTO in a chat/group and the bot replies
with the best supplier (FOB price + product link) plus every other supplier
selling the same product.

Flow per incoming photo:
  1. long-poll Telegram getUpdates for new photo messages
  2. download the largest photo size from Telegram -> host on a public CDN
  3. identify the product (Gemini + Google Lens) and find suppliers
     (RapidAPI Alibaba DataHub if quota available, else Google Lens fallback)
  4. format and reply in the same chat

Enabled by setting TELEGRAM_BOT_TOKEN. Runs as a background task started in
main.py's lifespan. Stateless except for the last processed update offset.
"""

import os
import asyncio
import tempfile
import uuid
import httpx

from utils.logger import get_logger
from services.image_host import upload_frame_to_public_url
from services.visual_search import (
    identify_product_combined,
    suppliers_from_lens,
)
from services.alibaba_client import search_and_enrich

logger = get_logger(__name__)

API = "https://api.telegram.org"


def _token() -> str:
    return os.getenv("TELEGRAM_BOT_TOKEN", "")


def bot_enabled() -> bool:
    return bool(_token())


# ── Telegram helpers ────────────────────────────────────────────────────────

async def _api(method: str, **params):
    """Call a Telegram Bot API method, returning the `result` payload or None."""
    if not _token():
        return None
    try:
        async with httpx.AsyncClient(timeout=70) as c:
            r = await c.get(f"{API}/bot{_token()}/{method}", params=params)
            data = r.json()
            if not data.get("ok"):
                logger.warning(f"Telegram {method} failed: {data.get('description')}")
                return None
            return data.get("result")
    except Exception as e:
        logger.warning(f"Telegram {method} error: {e}")
        return None


async def _send_message(chat_id, text: str, reply_to: int | None = None):
    if not _token():
        return
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
    }
    if reply_to:
        payload["reply_to_message_id"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            await c.post(f"{API}/bot{_token()}/sendMessage", json=payload)
    except Exception as e:
        logger.warning(f"Telegram sendMessage error: {e}")


async def _get_file_url(file_id: str) -> str:
    """Resolve a Telegram file_id to a temporary download URL."""
    result = await _api("getFile", file_id=file_id)
    if not result or "file_path" not in result:
        return ""
    return f"{API}/file/bot{_token()}/{result['file_path']}"


async def _download_and_host(file_url: str) -> str:
    """Download a Telegram-hosted photo and re-host on a public CDN so Google
    Lens / Alibaba image search can fetch it (Telegram file URLs embed the bot
    token and are not durable)."""
    try:
        async with httpx.AsyncClient(timeout=40) as c:
            r = await c.get(file_url)
            if r.status_code != 200:
                return ""
            content = r.content
    except Exception as e:
        logger.warning(f"Photo download failed: {e}")
        return ""

    tmp = os.path.join(tempfile.gettempdir(), f"tg_{uuid.uuid4().hex[:8]}.jpg")
    try:
        with open(tmp, "wb") as f:
            f.write(content)
        public = await upload_frame_to_public_url(tmp)
        return public
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


# ── Supplier search + formatting ────────────────────────────────────────────

_CUR_GLYPH = {"USD": "$", "INR": "₹", "CNY": "¥", "EUR": "€", "GBP": "£",
              "AED": "AED ", "JPY": "¥", "KRW": "₩", "CAD": "C$", "AUD": "A$"}


def _fmt_price(s) -> str:
    """Show the listing's price in INR (the figure that matters here), and where
    the original was in a non-INR currency, show that native price too — never
    mislabel a yuan/euro price as dollars."""
    inr = getattr(s, "unit_price_inr", None)
    native = getattr(s, "original_price", None)
    iso = (getattr(s, "original_currency", "") or "").upper()

    if inr:
        if native and iso and iso != "INR":
            glyph = _CUR_GLYPH.get(iso, iso + " ")
            return f"₹{inr:,.0f}  ({glyph}{native:g} {iso})"
        return f"₹{inr:,.0f}"
    # No INR figure but maybe a native price exists.
    if native and iso:
        glyph = _CUR_GLYPH.get(iso, iso + " ")
        return f"{glyph}{native:g} {iso}"
    return "price n/a"


def _is_retail(suppliers) -> bool:
    return bool(suppliers) and all(
        getattr(s, "platform", "") == "google_lens" for s in suppliers
    )


def _format_reply(product_name: str, suppliers: list) -> str:
    if not suppliers:
        return (
            f"🔍 *{product_name}*\n\n"
            "I couldn't find any matching suppliers for this image.\n"
            "Try a clearer, well-lit photo of just the product."
        )

    retail = _is_retail(suppliers)
    src_label = (
        "Google Lens (retail prices — not wholesale FOB)"
        if retail else "Alibaba DataHub (wholesale FOB)"
    )

    best = suppliers[0]
    lines = [f"🛒 *{product_name}*", f"_Source: {src_label}_", ""]

    # Best supplier highlight
    lines.append("🏆 *Best match*")
    lines.append(f"• *{(best.supplier_name or best.company_name or 'Supplier')[:60]}*")
    lines.append(f"• Price: *{_fmt_price(best)}*")
    if getattr(best, "country", ""):
        lines.append(f"• Country: {best.country}")
    if getattr(best, "review_count", 0):
        rt = f" ★{best.rating:.1f}" if getattr(best, "rating", 0) else ""
        lines.append(f"• {best.review_count} reviews{rt}")
    if getattr(best, "product_url", ""):
        lines.append(f"• [Open product]({best.product_url})")
    lines.append("")

    # All other suppliers
    others = suppliers[1:9]
    if others:
        lines.append(f"📋 *Other suppliers ({len(others)})*")
        for i, s in enumerate(others, start=2):
            name = (s.supplier_name or s.company_name or "Supplier")[:40]
            url = getattr(s, "product_url", "")
            link = f" — [link]({url})" if url else ""
            lines.append(f"{i}. {name} · {_fmt_price(s)}{link}")
        lines.append("")

    if retail:
        lines.append(
            "⚠️ Prices above are *retail* (what these stores sell for). "
            "Wholesale FOB on Alibaba will be lower — check the product links."
        )
    return "\n".join(lines)


async def _find_suppliers(image_url: str) -> tuple[str, list]:
    """Identify the product and return (product_name, suppliers[])."""
    job_id = f"tg_{uuid.uuid4().hex[:8]}"
    visual = await identify_product_combined(image_url)
    product_name = visual.product_name or "Uploaded product"

    suppliers: list = []
    # Prefer real Alibaba wholesale FOB when the DataHub quota is available.
    try:
        suppliers = await search_and_enrich(visual, job_id, img_url=image_url)
    except Exception as e:
        logger.info(f"DataHub unavailable, falling back to Lens: {e}")

    # Fallback: Google Lens shopping matches (retail prices but real links).
    if not suppliers:
        suppliers = await suppliers_from_lens(image_url, job_id)

    return product_name, suppliers


async def _handle_photo(chat_id, message_id: int, file_id: str):
    await _send_message(
        chat_id,
        "🔎 Got it — searching for suppliers of this product… (15-30s)",
        reply_to=message_id,
    )

    file_url = await _get_file_url(file_id)
    if not file_url:
        await _send_message(chat_id, "❌ Couldn't fetch the photo from Telegram.", reply_to=message_id)
        return

    public_url = await _download_and_host(file_url)
    if not public_url or public_url.startswith("data:"):
        await _send_message(
            chat_id,
            "❌ Couldn't host the image for search. Please try again.",
            reply_to=message_id,
        )
        return

    try:
        product_name, suppliers = await _find_suppliers(public_url)
        reply = _format_reply(product_name, suppliers)
    except Exception as e:
        logger.error(f"Supplier search failed: {e}", exc_info=True)
        reply = "❌ Search failed while looking up suppliers. Please try again."

    await _send_message(chat_id, reply, reply_to=message_id)


def _largest_photo_id(message: dict) -> str:
    """Telegram sends a photo as multiple sizes; pick the largest (last)."""
    photos = message.get("photo") or []
    if not photos:
        return ""
    return photos[-1].get("file_id", "")


async def _process_update(update: dict):
    message = update.get("message") or update.get("channel_post") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    message_id = message.get("message_id")
    if chat_id is None:
        return

    file_id = _largest_photo_id(message)
    # Also accept an image sent as a file/document.
    if not file_id:
        doc = message.get("document") or {}
        if str(doc.get("mime_type", "")).startswith("image/"):
            file_id = doc.get("file_id", "")

    if file_id:
        await _handle_photo(chat_id, message_id, file_id)
        return

    # Plain /start or text — give a hint (only in private chats to avoid group spam).
    text = (message.get("text") or "").strip()
    if chat.get("type") == "private" and text.startswith("/start"):
        await _send_message(
            chat_id,
            "👋 Send me a *photo of a product* and I'll find the best supplier "
            "with the price and product link, plus other suppliers selling the same item.",
        )


async def run_telegram_bot():
    """Long-poll Telegram for product photos. Started from main.py lifespan."""
    if not bot_enabled():
        logger.info("Telegram bot disabled (TELEGRAM_BOT_TOKEN not set)")
        return

    me = await _api("getMe")
    if me:
        logger.info(f"Telegram supplier bot online as @{me.get('username')}")
    else:
        logger.warning("Telegram bot token set but getMe failed — check the token")

    offset = 0
    # Skip the backlog: start from the latest update so we don't reprocess old photos.
    latest = await _api("getUpdates", offset=-1, timeout=0)
    if latest:
        offset = latest[-1]["update_id"] + 1

    while True:
        try:
            updates = await _api(
                "getUpdates",
                offset=offset,
                timeout=50,
                allowed_updates='["message","channel_post"]',
            )
            if updates:
                for u in updates:
                    offset = u["update_id"] + 1
                    # Process each update independently; one failure shouldn't
                    # stall the poll loop.
                    asyncio.create_task(_process_update(u))
        except Exception as e:
            logger.warning(f"Telegram poll loop error: {e}")
            await asyncio.sleep(5)
