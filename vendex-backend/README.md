# Vendex Backend (supplier scraper + Telegram bot)

FastAPI service that powers the Pre-Order **Sourcing** features of the Supplier
Tracking System: identify a product from an image/reel link, find Alibaba
suppliers (RapidAPI DataHub, with a Google Lens fallback), and compare retail
prices across India / UAE / USA.

It also runs a **Telegram supplier bot**: send (or tag) the bot a product photo
and it replies with the best supplier (price + product link) plus other
suppliers selling the same item.

## Run (Windows)

```powershell
cd vendex-backend
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # then fill in real keys
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

The app (Next.js) talks to this backend on `http://localhost:8001`.

## Key pieces

- `main.py` — app + lifespan; starts the daily reminder loop and the Telegram bot.
- `services/telegram_bot.py` — long-polls Telegram, handles product photos.
- `services/visual_search.py` — Gemini + Google Lens product ID; currency-aware
  supplier/market data (each listing converted from its own currency to INR).
- `services/alibaba_client.py` — RapidAPI DataHub Alibaba lookups.
- `routers/process.py` — `/process`, `/process/image`, `/market-size` endpoints.

## Notes

- `.env`, `venv/`, `downloads/`, `frames/` are gitignored — never commit secrets.
- The Telegram bot and the app's reminder feature share one bot token; only one
  `getUpdates` poller can run per token at a time.
