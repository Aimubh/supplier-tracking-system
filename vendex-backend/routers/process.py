import uuid
import time
import os
import re
import shutil
import asyncio
import hmac
import hashlib
import json as _json
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from models.schemas import JobCreate, ProcessResponse, Platform, JobStatus
from pydantic import BaseModel
from utils.auth import require_admin
from models.database import save_job, update_job, save_supplier, update_csv_row
from services.downloader import download
from services.frame_extractor import extract_best_frames
from services.playwright_client import search_alibaba_with_playwright, scrape_product_url
from services.alibaba_client import search_and_enrich, get_item_detail
from services.image_host import upload_frame_to_public_url
from services.visual_search import VisualSearchResult
from services.normalizer import normalize_supplier_result
from utils.logger import get_logger

# Prefer the reliable RapidAPI (Alibaba DataHub) path over the Playwright scraper
# when a RAPIDAPI_KEY is configured. The scraper fights Alibaba's anti-bot wall
# (CAPTCHAs); the API returns the same data from RapidAPI's infrastructure.
USE_RAPIDAPI = bool(os.getenv("RAPIDAPI_KEY"))


def _is_product_url(url: str) -> bool:
    """Return True if the URL is a direct Alibaba product page (not a reel/video)."""
    return bool(re.search(
        r"alibaba\.com/.*(product-detail|offer-detail|[0-9]{10,}\.html)",
        url,
        re.IGNORECASE,
    ))

logger = get_logger(__name__)
router = APIRouter()

NEXTJS_WEBHOOK_URL = os.getenv("NEXTJS_WEBHOOK_URL")
NEXTJS_WEBHOOK_SECRET = os.getenv("NEXTJS_WEBHOOK_SECRET")

async def notify_nextjs(job_id: str, status: str):
    if not NEXTJS_WEBHOOK_URL or not NEXTJS_WEBHOOK_SECRET:
        return
    try:
        payload = _json.dumps({"job_id": job_id, "status": status}).encode()
        signature = hmac.new(
            NEXTJS_WEBHOOK_SECRET.encode(), payload, hashlib.sha256
        ).hexdigest()
        async with httpx.AsyncClient() as client:
            await client.post(
                NEXTJS_WEBHOOK_URL,
                content=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-webhook-signature": f"sha256={signature}",
                },
                timeout=5.0,
            )
    except Exception as e:
        logger.error(f"Webhook to Next.js failed: {e}")

async def run_pipeline(job_id: str, reel_url: str, label: str = "", csv_row_id: str = ""):
    stages = []
    detailed_logs = []
    pipeline_start = time.time()

    def log_event(stage, msg, data=None):
        detailed_logs.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": stage,
            "message": msg,
            "data": data
        })

    async def flush_logs():
        await update_job(job_id, {"detailed_logs": detailed_logs})

    detected_product = ""  # filled in by Gemini frame analysis for reel jobs
    try:
        is_product = _is_product_url(reel_url)

        # Seed all stages as "pending" immediately so the frontend can show the full roadmap
        pending_stages = [
            {"stage": "download",    "status": "pending", "message": "Waiting", "duration_ms": None, "timestamp": ""},
            {"stage": "extract",     "status": "pending", "message": "Waiting", "duration_ms": None, "timestamp": ""},
            {"stage": "search",      "status": "pending", "message": "Waiting", "duration_ms": None, "timestamp": ""},
            {"stage": "normalizing", "status": "pending", "message": "Waiting", "duration_ms": None, "timestamp": ""},
        ]
        await update_job(job_id, {"pipeline_stages": pending_stages})

        if is_product:
            await update_job(job_id, {"status": JobStatus.SEARCHING.value, "progress_percent": 30})

            t0 = time.time()
            if USE_RAPIDAPI:
                # Reliable path: pull the item id from the URL and fetch it from
                # the RapidAPI DataHub (item_detail) instead of scraping the page.
                log_event("search", "Direct product URL — fetching via RapidAPI DataHub", {"url": reel_url})
                m = re.search(r"(\d{10,})", reel_url)
                suppliers = []
                if m:
                    item_id = m.group(1)
                    detail = await get_item_detail(item_id)
                    if detail:
                        from services.alibaba_client import AlibabaSummary
                        item = detail.get("item", {})
                        img = item.get("image") or (item.get("images") or [""])[0] or ""
                        if img.startswith("//"):
                            img = "https:" + img
                        summary = AlibabaSummary(
                            item_id=item_id,
                            title=item.get("title", ""),
                            price_min=0.0, price_max=0.0, currency="USD",
                            moq=1, image_url=img,
                            supplier_name=(detail.get("company", {}) or {}).get("name", "Alibaba Supplier"),
                            country="", product_url=reel_url,
                        )
                        visual = VisualSearchResult(
                            product_name=item.get("title", "Product"),
                            keywords=["product"], confidence=0.7, source="direct_url",
                        )
                        from services.currency_service import convert_to_inr
                        _, inr_rate = await convert_to_inr(1, "USD")
                        sup = normalize_supplier_result(
                            summary, None, None, visual, inr_rate, 0.0, None, job_id, item_detail=detail
                        )
                        # Direct URL = the exact product, not a visual guess.
                        sup.match_score = 100.0
                        sup.match_source = "direct_url"
                        suppliers = [sup]
                if not suppliers:
                    log_event("search", "DataHub returned nothing — falling back to page scrape")
                    suppliers = await scrape_product_url(reel_url, job_id)
            else:
                log_event("search", "Direct product URL — scraping page", {"url": reel_url})
                suppliers = await scrape_product_url(reel_url, job_id)
            sc_ms = int((time.time() - t0) * 1000)
            log_event("search", f"Found {len(suppliers)} product(s)")

            stages += [
                {"stage": "download", "status": "done", "message": "Direct URL (skipped)", "duration_ms": 0, "timestamp": datetime.now(timezone.utc).isoformat()},
                {"stage": "extract",  "status": "done", "message": "Direct URL (skipped)", "duration_ms": 0, "timestamp": datetime.now(timezone.utc).isoformat()},
                {"stage": "search",   "status": "done", "message": f"Scraped {len(suppliers)} product(s)", "duration_ms": sc_ms, "timestamp": datetime.now(timezone.utc).isoformat()},
            ]
            await update_job(job_id, {"pipeline_stages": stages, "detailed_logs": detailed_logs})

        else:
            def _make_stages(done: list[dict], running_key: str, msg: str) -> list[dict]:
                """Return full stage list: done stages + current running + remaining pending."""
                order = ["download", "extract", "search", "normalizing"]
                result = list(done)
                for key in order[len(done):]:
                    if key == running_key:
                        result.append({"stage": key, "status": "running", "message": msg, "duration_ms": None, "timestamp": datetime.now(timezone.utc).isoformat()})
                    else:
                        result.append({"stage": key, "status": "pending", "message": "Waiting", "duration_ms": None, "timestamp": ""})
                return result

            # ── DOWNLOADING ───────────────────────────────────────────────────
            t0 = time.time()
            await update_job(job_id, {"status": JobStatus.DOWNLOADING.value, "progress_percent": 10,
                                      "pipeline_stages": _make_stages([], "download", f"Downloading reel…")})
            log_event("download", f"Downloading {reel_url}")
            await flush_logs()
            video_info = await download(reel_url, job_id)
            video_path = video_info["video_path"]
            dl_ms = int((time.time() - t0) * 1000)
            log_event("download", "Download complete", video_info)
            stages.append({"stage": "download", "status": "done", "message": "Video downloaded", "duration_ms": dl_ms, "timestamp": datetime.now(timezone.utc).isoformat()})
            await update_job(job_id, {"pipeline_stages": _make_stages(stages, "extract", "Waiting…"), "detailed_logs": detailed_logs})

            # ── EXTRACTING FRAMES ─────────────────────────────────────────────
            t0 = time.time()
            await update_job(job_id, {"status": JobStatus.EXTRACTING.value, "progress_percent": 35,
                                      "pipeline_stages": _make_stages(stages, "extract", "Extracting best frames…")})
            log_event("extract", "Extracting frames")
            await flush_logs()
            frames, detected_product = await extract_best_frames(video_path, job_id)
            if not frames:
                raise Exception("No valid frames extracted from video")
            ex_ms = int((time.time() - t0) * 1000)
            if detected_product:
                log_event("extract", f"Extracted {len(frames)} frames — product identified: {detected_product}")
            else:
                log_event("extract", f"Extracted {len(frames)} frames")
            stages.append({"stage": "extract", "status": "done", "message": f"{len(frames)} frames extracted", "duration_ms": ex_ms, "timestamp": datetime.now(timezone.utc).isoformat()})
            await update_job(job_id, {"pipeline_stages": _make_stages(stages, "search", "Waiting…"), "detailed_logs": detailed_logs})

            # ── SEARCHING SUPPLIERS ───────────────────────────────────────────
            t0 = time.time()
            await update_job(job_id, {"status": JobStatus.SEARCHING.value, "progress_percent": 55,
                                      "pipeline_stages": _make_stages(stages, "search", "Searching Alibaba…")})
            log_event("search", "Starting Alibaba image search")
            await flush_logs()

            async def _live_log(stage, msg, data=None):
                log_event(stage, msg, data)
                await flush_logs()

            if USE_RAPIDAPI:
                # Reliable path: host the chosen frame, then image-search Alibaba
                # via the RapidAPI DataHub (no CAPTCHA / scraper).
                def _trace(stage, msg, data=None):
                    log_event(stage, msg, data)
                log_event("search", "Using RapidAPI (Alibaba DataHub) image search")
                await flush_logs()
                img_url = await upload_frame_to_public_url(frames[0].path)
                visual = VisualSearchResult(
                    product_name=detected_product or label or "Product from reel",
                    keywords=(detected_product or "product").split(),
                    confidence=0.6 if detected_product else 0.3,
                    source="gemini",
                    raw_titles=[detected_product] if detected_product else [],
                )
                suppliers = await search_and_enrich(visual, job_id, tracer=_trace, img_url=img_url)
            else:
                suppliers = await search_alibaba_with_playwright(frames[0].path, job_id, log_cb=_live_log)
            sc_ms = int((time.time() - t0) * 1000)
            log_event("search", f"Found {len(suppliers)} products")
            stages.append({"stage": "search", "status": "done", "message": f"Found {len(suppliers)} suppliers", "duration_ms": sc_ms, "timestamp": datetime.now(timezone.utc).isoformat()})
            await update_job(job_id, {"pipeline_stages": stages, "detailed_logs": detailed_logs})

        # ── NORMALIZING ───────────────────────────────────────────────────────
        await update_job(job_id, {"status": JobStatus.NORMALIZING.value, "progress_percent": 90})
        log_event("normalize", "Saving to database")
        
        # Retry logic for DB saves (handling Neon connection drops)
        max_retries = 3
        for attempt in range(max_retries):
            try:
                for supplier in suppliers:
                    await save_supplier(supplier.model_dump())
                break # Success
            except Exception as e:
                if attempt == max_retries - 1:
                    raise e
                logger.warning(f"DB Save attempt {attempt + 1} failed, retrying in 2s... Error: {e}")
                await asyncio.sleep(2)

        stages.append({"stage": "normalizing", "status": "done", "message": f"Saved {len(suppliers)} suppliers", "duration_ms": 0, "timestamp": datetime.now(timezone.utc).isoformat()})

        # ── COMPLETE ──────────────────────────────────────────────────────────
        total_seconds = round(time.time() - pipeline_start, 1)
        log_event("pipeline", f"Completed in {total_seconds}s")
        detected_name = suppliers[0].product_name if suppliers else (detected_product or label or "Product from reel")

        await update_job(job_id, {
            "status": JobStatus.COMPLETE.value,
            "extracted_frame_url": "",
            "detected_product_name": detected_name,
            "detected_keywords": [],
            "result_count": len(suppliers),
            "progress_percent": 100,
            "pipeline_stages": stages,
            "detailed_logs": detailed_logs,
            "duration_seconds": total_seconds,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })

        # Mark the CSV row as done
        if csv_row_id:
            await update_csv_row(csv_row_id, {"status": "done", "job_id": job_id})

        await notify_nextjs(job_id, "complete")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        log_event("pipeline", "Job failed", {"error": str(e)})
        total_seconds = round(time.time() - pipeline_start, 1)
        await update_job(job_id, {
            "status": JobStatus.FAILED.value,
            "error_message": str(e),
            "detailed_logs": detailed_logs,
            "duration_seconds": total_seconds,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        if csv_row_id:
            await update_csv_row(csv_row_id, {"status": "failed"})
        await notify_nextjs(job_id, "failed")
    finally:
        shutil.rmtree(f"./downloads/{job_id}", ignore_errors=True)


async def run_image_pipeline(job_id: str, image_url: str, label: str = ""):
    """Image-search pipeline: a public image URL goes straight to Alibaba image
    search (via RapidAPI DataHub) — no video download or frame extraction."""
    stages = []
    detailed_logs = []
    start = time.time()

    def log_event(stage, msg, data=None):
        detailed_logs.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": stage, "message": msg, "data": data,
        })

    try:
        def _trace(stage, msg, data=None):
            log_event(stage, msg, data)

        # STEP 1 — identify the product from the image (Gemini + Google Lens).
        await update_job(job_id, {"status": JobStatus.SEARCHING.value, "progress_percent": 30})
        log_event("identify", "Analysing image (Gemini + Google Lens)", {"imgUrl": image_url})
        from services.visual_search import identify_product_combined
        visual = await identify_product_combined(image_url)
        if label:
            visual.product_name = label  # user-provided name wins
        log_event("identify", f"Identified: {visual.product_name}", {
            "keywords": visual.keywords, "source": visual.source, "confidence": visual.confidence,
        })
        await update_job(job_id, {"detected_product_name": visual.product_name, "progress_percent": 45})

        # STEP 2 — find Alibaba suppliers via DataHub (real wholesale FOB).
        log_event("search", "Searching Alibaba via RapidAPI DataHub")
        suppliers = []
        try:
            suppliers = await search_and_enrich(visual, job_id, tracer=_trace, img_url=image_url)
        except Exception as e:
            log_event("search", f"DataHub unavailable ({e})")
        # FALLBACK — if DataHub returned nothing (quota/empty), use Google Lens
        # shopping matches as suppliers (retail prices, flagged platform=google_lens).
        if not suppliers:
            from services.visual_search import suppliers_from_lens
            log_event("search", "DataHub empty — falling back to Google Lens suppliers")
            suppliers = await suppliers_from_lens(image_url, job_id)
            log_event("search", f"Lens fallback found {len(suppliers)} (retail prices)")
        else:
            log_event("search", f"Found {len(suppliers)} Alibaba suppliers")

        await update_job(job_id, {"status": JobStatus.NORMALIZING.value, "progress_percent": 90})
        for attempt in range(3):
            try:
                for s in suppliers:
                    await save_supplier(s.model_dump())
                break
            except Exception as e:
                if attempt == 2:
                    raise e
                await asyncio.sleep(2)

        detected = suppliers[0].product_name if suppliers else (label or "Uploaded product")
        await update_job(job_id, {
            "status": JobStatus.COMPLETE.value,
            "detected_product_name": detected,
            "result_count": len(suppliers),
            "progress_percent": 100,
            "duration_seconds": round(time.time() - start, 1),
            "detailed_logs": detailed_logs,
        })
    except Exception as e:
        logger.error(f"Image pipeline {job_id} failed: {e}")
        await update_job(job_id, {
            "status": JobStatus.FAILED.value,
            "error_message": str(e),
            "detailed_logs": detailed_logs,
        })


class ImageJobCreate(BaseModel):
    image_url: str
    label: str = ""


@router.post("/process/image")
async def process_image_job(payload: ImageJobCreate, _admin: str = Depends(require_admin)):
    """Search Alibaba directly from a hosted product image URL."""
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    await save_job({
        "id": job_id,
        "reel_url": payload.image_url,
        "platform": Platform.OTHER.value,
        "status": JobStatus.PENDING.value,
        "created_at": now, "updated_at": now,
        "progress_percent": 0, "pipeline_stages": [], "detected_keywords": [],
    })
    asyncio.create_task(run_image_pipeline(job_id, payload.image_url, payload.label))
    return {"job_id": job_id, "status": "queued", "message": "Image search started"}


class MarketSizeReq(BaseModel):
    query: str = ""
    image_url: str = ""


@router.post("/market-size")
async def market_size(payload: MarketSizeReq, _viewer: str = Depends(require_admin)):
    """Retail price comparison across India, UAE and USA from Google Lens
    shopping matches — by image URL or text query (3 Lens searches)."""
    from services.visual_search import market_data_3markets
    return await market_data_3markets(image_url=payload.image_url, query=payload.query)


@router.post("/process", response_model=ProcessResponse)
async def process_job(payload: JobCreate, _admin: str = Depends(require_admin)):
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()

    job_data = {
        "id": job_id,
        "reel_url": str(payload.reel_url),
        "platform": payload.platform.value if payload.platform else Platform.OTHER.value,
        "status": JobStatus.PENDING.value,
        "created_at": now,
        "updated_at": now,
        "progress_percent": 0,
        "pipeline_stages": [],
        "detected_keywords": []
    }

    await save_job(job_data)
    asyncio.create_task(run_pipeline(job_id, str(payload.reel_url)))
    return {"job_id": job_id, "status": "queued", "message": "Pipeline processing started"}


class BatchItem(BaseModel):
    url: str
    label: str = ""
    csv_row_id: str = ""

class BatchJobCreateV2(BaseModel):
    items: list[BatchItem]

# Best batch size is 2: each job uses 10 parallel browser tabs (= 10 Alibaba connections).
# 2 jobs = 20 simultaneous connections — pushing the limit but manageable.
# 3+ jobs = 30+ connections = mass CAPTCHAs on every tab, making things slower not faster.
batch_semaphore = asyncio.Semaphore(int(os.getenv("MAX_CONCURRENT_JOBS", "2")))

async def _bounded_run(job_id: str, url: str, label: str, csv_row_id: str):
    async with batch_semaphore:
        await run_pipeline(job_id, url, label, csv_row_id)

@router.post("/process/batch")
async def process_batch(payload: BatchJobCreateV2, _admin: str = Depends(require_admin)):
    # FastAPI BackgroundTasks runs tasks sequentially — use asyncio.create_task
    # so all jobs are scheduled onto the event loop immediately and run in parallel
    # (bounded by batch_semaphore).
    job_ids = []
    now = datetime.now(timezone.utc).isoformat()

    for item in payload.items:
        job_id = f"job_{uuid.uuid4().hex[:8]}"
        job_data = {
            "id": job_id,
            "reel_url": item.url,
            "platform": Platform.OTHER.value,
            "status": JobStatus.PENDING.value,
            "created_at": now,
            "updated_at": now,
            "progress_percent": 0,
            "pipeline_stages": [],
            "detected_keywords": [],
            "label": item.label,
            "csv_row_id": item.csv_row_id,
        }
        await save_job(job_data)
        job_ids.append({"job_id": job_id, "csv_row_id": item.csv_row_id})
        asyncio.create_task(_bounded_run(job_id, item.url, item.label, item.csv_row_id))

    return {"jobs": job_ids}
