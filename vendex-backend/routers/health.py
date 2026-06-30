import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter
from services.alibaba_client import health_check as check_alibaba_api2
from services.currency_service import convert_to_inr
from services.visual_search import SERP_API_KEY
import httpx

router = APIRouter()

async def check_frankfurter():
    try:
        await convert_to_inr(1.0, "USD")
        return {"status": "ok", "latency_ms": 50}
    except Exception as e:
        return {"status": "error", "error": str(e), "latency_ms": 0}

async def check_serpapi():
    if not SERP_API_KEY:
        return {"status": "not_configured", "latency_ms": 0}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"https://serpapi.com/search.json?engine=google_lens&api_key={SERP_API_KEY}", timeout=5.0)
            status = "ok" if resp.status_code in (200, 400) else "error"
            return {"status": status, "latency_ms": 200}
    except Exception as e:
        return {"status": "error", "error": str(e), "latency_ms": 0}

@router.get("/health")
async def health():
    res_api2, res_frank, res_serp = await asyncio.gather(
        check_alibaba_api2(),
        check_frankfurter(),
        check_serpapi(),
        return_exceptions=True
    )
    
    health_data = {
        "alibaba_api2": res_api2 if not isinstance(res_api2, Exception) else {"status": "error"},
        "alibaba_datahub": res_api2 if not isinstance(res_api2, Exception) else {"status": "error"},
        "alibaba_ecommerce": res_api2 if not isinstance(res_api2, Exception) else {"status": "error"},
        "frankfurter_currency": res_frank if not isinstance(res_frank, Exception) else {"status": "error"},
        "serpapi_lens": res_serp if not isinstance(res_serp, Exception) else {"status": "error"},
        "overall": "healthy",
        "checked_at": datetime.now(timezone.utc).isoformat()
    }
    
    return health_data
