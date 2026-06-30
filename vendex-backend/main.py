from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
from models.database import init_db
from routers import jobs, process, health, suppliers, csv_upload
from services.telegram_bot import run_telegram_bot, bot_enabled
import os
import asyncio
import httpx
from utils.logger import get_logger

logger = get_logger(__name__)

# Daily production-reminder trigger. Calls the Supplier Tracking app's cron
# endpoint once a day so Telegram reminders fire even when no one has the app
# open. Configure REMINDER_APP_URL + REMINDER_CRON_SECRET to enable.
REMINDER_APP_URL = os.getenv("REMINDER_APP_URL", "http://localhost:3000")
REMINDER_CRON_SECRET = os.getenv("REMINDER_CRON_SECRET", "")

async def _daily_reminder_loop():
    if not REMINDER_CRON_SECRET:
        logger.info("Reminder loop disabled (REMINDER_CRON_SECRET not set)")
        return
    url = f"{REMINDER_APP_URL}/api/reminders/send?secret={REMINDER_CRON_SECRET}"
    while True:
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.get(url)
                logger.info(f"Daily reminder trigger: {r.status_code} {r.text[:120]}")
        except Exception as e:
            logger.warning(f"Reminder trigger failed: {e}")
        await asyncio.sleep(24 * 60 * 60)  # once a day

DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "./downloads")
FRAME_OUTPUT_DIR = os.getenv("FRAME_OUTPUT_DIR", "./frames")

# ── CORS origins ───────────────────────────────────────────────────────────────
# In production set CORS_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"
_cors_env = os.getenv("CORS_ORIGINS", "")
ALLOWED_ORIGINS: list[str] = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else ["http://localhost:3001", "http://localhost:3000"]
)

# ── Security headers middleware ────────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Only set HSTS in production (when not on localhost)
        if os.getenv("ENVIRONMENT", "development") == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(FRAME_OUTPUT_DIR, exist_ok=True)
    reminder_task = asyncio.create_task(_daily_reminder_loop())
    bot_task = None
    if bot_enabled():
        bot_task = asyncio.create_task(run_telegram_bot())
        logger.info("Telegram supplier bot started (send a product photo to the bot)")
    logger.info("Vendex backend started")
    yield
    reminder_task.cancel()
    if bot_task:
        bot_task.cancel()
    logger.info("Vendex backend shutting down")

app = FastAPI(
    title="Vendex API",
    version="1.0.0",
    lifespan=lifespan,
    # Disable the auto-generated docs in production
    docs_url=None if os.getenv("ENVIRONMENT") == "production" else "/docs",
    redoc_url=None if os.getenv("ENVIRONMENT") == "production" else "/redoc",
)

@app.get("/health")
async def root_health():
    return {"status": "ok", "message": "Vendex backend is running"}

app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Webhook-Secret"],
)

app.include_router(process.router, prefix="/api/v1", tags=["process"])
app.include_router(jobs.router, prefix="/api/v1", tags=["jobs"])
app.include_router(suppliers.router, prefix="/api/v1", tags=["suppliers"])
app.include_router(health.router, prefix="/api/v1", tags=["health"])
app.include_router(csv_upload.router, prefix="/api/v1", tags=["csv"])
