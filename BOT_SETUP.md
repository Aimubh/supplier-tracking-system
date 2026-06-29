# Supplier-Finder Telegram Bot

Tag the bot in a group with a product **photo** + a **hashtag**, and it replies with
the **top-5 suppliers**, re-ranked by what you care about.

| You send | Ranking |
|----------|---------|
| photo (no tag) | 100% image match (search order) |
| photo + `#prize` (or `#price`) | 60% image match + 40% **cheapest price** |
| photo + `#top` | 60% image match + 40% **best rating** |
| photo + `#review` | 60% image match + 40% **most reviews** |

The tag may be glued to the mention — `@yourbot#prize` works. The image/dimension
split is configurable via `RANK_IMAGE_WEIGHT` (default `0.6`).

The **same bot** also sends the production / ETA reminders (they share
`TELEGRAM_BOT_TOKEN`), so you only run one bot.

---

## One-time setup

### 1. Create the bot
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts.
2. Copy the token it gives you.
3. **Important for groups:** @BotFather → `/setprivacy` → select your bot → **Disable**.
   Otherwise the bot can't see group messages that don't start with `/`.
4. Add the bot to your group.

### 2. Fill in `.env`
```env
TELEGRAM_BOT_TOKEN="<token from BotFather>"
TELEGRAM_CHAT_ID="<group chat id, e.g. -1001234567890>"   # for reminders
TELEGRAM_WEBHOOK_SECRET="<any long random string>"
RANK_IMAGE_WEIGHT="0.6"        # optional, 60% image weight
BOT_MOCK_SUPPLIERS="0"         # 1 = test without the Vendex scraper
```
- Generate the webhook secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- Find the group chat id via the helper route `GET /api/reminders/chat-id` (after the bot has received one message in the group).

### 3. Register the webhook
Telegram needs a **public HTTPS** URL, so this works once deployed (Vercel) or via an
HTTPS tunnel (e.g. ngrok) for local testing. Then, signed in as **admin**:

```
POST /api/telegram/setup
```
It registers `https://<your-host>/api/telegram/webhook` using the base URL from
`NEXTAUTH_URL` (or the request origin). Check status any time:
```
GET /api/telegram/setup        # returns Telegram's getWebhookInfo
```

### 4. Use it
In the group, send a product photo with a caption like `@yourbot #prize`.
The bot replies with the ranked top-5.

---

## How it works (for maintainers)

- **`src/lib/supplier-ranking.ts`** — pure ranking: `parseRankTag`, `rankSuppliers`,
  `rankTopN`. Each dimension is min–max normalised across the candidate set, then
  blended `imageWeight·image + (1-imageWeight)·dimension`. No I/O — unit-testable.
- **`src/lib/vendex.ts`** — `searchSuppliersByImage(bytes, mime)`: hosts the image,
  runs the Vendex image search, returns `RankCandidate[]`. Falls back to mock data
  if Vendex is offline or `BOT_MOCK_SUPPLIERS=1` (so the bot never goes silent).
- **`src/app/api/telegram/webhook/route.ts`** — receives the Telegram update,
  verifies the secret header, downloads the photo, searches, ranks, replies to the
  originating chat. Public route (no app session); secured by the secret only.
- **`src/lib/telegram.ts`** — `downloadTelegramFile`, `setWebhook`, plus the existing
  `sendTelegram`. `sendTelegram(text, chatId)` replies into the group the message
  came from.

### Image-match score
The 60% "image" weight uses each result's **position** in the image search (best
match = highest). With SerpAPI Google Lens this is Google's own visual-similarity
rank — a genuine image signal.

---

## Real data — Google Lens via SerpAPI

The bot's real supplier data comes from **SerpAPI's Google Lens** reverse-image
search. It needs no separate scraper service — the search runs inside this app.

**Search priority** (in `src/lib/vendex.ts`):
1. **SerpAPI Google Lens** — used when `SERPAPI_KEY` is set. ← real data
2. **Vendex** — used if `VENDEX_API_URL` is reachable (legacy/optional).
3. **Mock** — fallback so the bot never goes silent.

### Turn on real data
1. Create a key at **serpapi.com** (free tier = 100 searches/month).
2. Add env vars (locally in `.env`, and in **Vercel → Settings → Environment Variables**):
   ```env
   SERPAPI_KEY="<your serpapi key>"
   BOT_MOCK_SUPPLIERS="0"
   ```
3. **Redeploy** on Vercel so the new vars take effect.
4. Tag the bot with a photo + `#prize` — it now returns real Google Lens matches.

Notes:
- Lens prices are **retail** (what shops sell for), not Alibaba wholesale FOB — the
  bot says so in its reply. Click the supplier links to find the FOB source.
- Non-USD prices are converted to USD for fair price ranking.
