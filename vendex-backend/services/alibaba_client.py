import os
import httpx
import asyncio
from datetime import datetime
from typing import List, Optional, Dict
from pydantic import BaseModel
from utils.rate_limiter import alibaba_throttler
from utils.retry import auto_retry
from utils.logger import get_logger
from services.supplier_classifier import classify_supplier
from services.currency_service import convert_to_inr, estimate_shipping_cost_inr
from utils.scoring import calculate_match_score
from models.schemas import SupplierResult
from services.visual_search import VisualSearchResult
from services.normalizer import normalize_supplier_result

logger = get_logger(__name__)

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY")

HOSTS = {
    "datahub":    "alibaba-datahub.p.rapidapi.com",
    "ecommerce":  "alibaba-ecommerce.p.rapidapi.com",
    "package":    "16881.p.rapidapi.com",
    "api2":       "alibaba-api2.p.rapidapi.com",
}

def get_headers(host_key: str):
    return {
        "x-rapidapi-key": RAPIDAPI_KEY or "",
        "x-rapidapi-host": HOSTS[host_key]
    }

class AlibabaSummary(BaseModel):
    item_id: str
    title: str
    price_min: float
    price_max: float
    currency: str
    moq: int
    image_url: str
    supplier_name: str
    country: str
    product_url: str
    rating: float = 0.0

class AlibabaSkuDetail(BaseModel):
    item_id: str
    title: str
    description: str
    images: List[str]
    price_min: float
    price_max: float
    moq: int
    currency: str
    company_name: str
    supplier_country: str
    country_code: str
    verified: bool
    gold_supplier: bool
    trade_assurance: bool
    years_on_platform: Optional[int] = None
    response_rate: str
    response_time: str
    business_type: str
    certifications: List[str]
    product_categories_count: int

class PackageDetail(BaseModel):
    weight_kg: float
    shipping_methods: List[str]
    estimated_delivery_days: Optional[int]

def _mock_summary(keywords: List[str], i: int) -> AlibabaSummary:
    return AlibabaSummary(
        item_id=f"mock{i}",
        title=f"Mock Product for {' '.join(keywords)}",
        price_min=10.0 + i, price_max=20.0 + i, currency="USD",
        moq=100, image_url="", supplier_name=f"Mock Supplier {i}",
        country="China", product_url="https://alibaba.com"
    )

@auto_retry(3)
@auto_retry(3)
async def image_search_products(img_url: str, page: int = 1, tracer: Optional[callable] = None) -> List[AlibabaSummary]:
    """Search Alibaba products directly by image URL using alibaba-datahub item_search_image."""
    if not RAPIDAPI_KEY:
        logger.warning("No RAPIDAPI_KEY, returning mock search results")
        return [_mock_summary(["product"], i) for i in range(3)]

    async with alibaba_throttler:
        async with httpx.AsyncClient() as client:
            try:
                params = {"imgUrl": img_url, "page": str(page)}
                if tracer:
                    tracer("search", "Starting Alibaba image search", {"imgUrl": img_url, "page": page})

                resp = await client.get(
                    f"https://{HOSTS['datahub']}/item_search_image",
                    params=params,
                    headers=get_headers("datahub"),
                    timeout=20.0,
                )

                if tracer:
                    tracer("search", f"Image search response: {resp.status_code}", {
                        "status": resp.status_code,
                        "body_preview": resp.text[:2000]
                    })

                if resp.status_code == 429:
                    raise httpx.RequestError("Rate Limited")

                if resp.status_code != 200:
                    logger.error(f"Image search API error: {resp.text}")
                    return []

                data = resp.json()
                # RapidAPI quota errors come back as HTTP 200 with a `message`.
                if isinstance(data, dict) and "exceeded" in str(data.get("message", "")).lower():
                    logger.error(f"RapidAPI quota exhausted: {data.get('message')}")
                    raise RuntimeError("RAPIDAPI_QUOTA_EXCEEDED")
                result_list = data.get("result", {}).get("resultList", [])
                summaries = []

                for entry in result_list[:20]:
                    item = entry.get("item", {})
                    if not item:
                        continue
                    try:
                        sku = item.get("sku", {}).get("def", {})
                        price_str = sku.get("priceModule", {}).get("priceFormatted", "$0")
                        moq_str = sku.get("quantityModule", {}).get("minOrder", {}).get("quantity", "1")

                        # Parse price range e.g. "$1.99-2.30" or "$11.90"
                        price_str_clean = price_str.replace("$", "").replace(",", "").strip()
                        if "-" in price_str_clean:
                            parts = price_str_clean.split("-")
                            price_min = float(parts[0].strip())
                            price_max = float(parts[1].strip())
                        else:
                            price_min = price_max = float(price_str_clean or 0)

                        # Fix protocol-relative URLs
                        img = item.get("image", "")
                        if img.startswith("//"):
                            img = "https:" + img
                        item_url = item.get("itemUrl", "")
                        if item_url.startswith("//"):
                            item_url = "https:" + item_url

                        try:
                            rating = float(item.get("averageStarRate", 0) or 0)
                        except (ValueError, TypeError):
                            rating = 0.0

                        summaries.append(AlibabaSummary(
                            item_id=str(item.get("itemId", "")),
                            title=item.get("title", ""),
                            price_min=price_min,
                            price_max=price_max,
                            currency="USD",
                            moq=int(moq_str) if str(moq_str).isdigit() else 1,
                            image_url=img,
                            supplier_name=item.get("supplierName", "Alibaba Supplier"),
                            country="",
                            product_url=item_url,
                            rating=rating,
                        ))
                    except Exception as parse_err:
                        logger.warning(f"Skipping item due to parse error: {parse_err}")

                if tracer:
                    tracer("search", f"Parsed {len(summaries)} products from image search", {
                        "total_in_response": len(result_list),
                        "parsed": len(summaries),
                    })

                return summaries

            except Exception as e:
                logger.error(f"Image search request failed: {e}")
                if tracer:
                    tracer("search", "Image search failed", {"error": str(e)})
                return []


_sku_cache = {}

@auto_retry(3)
async def get_item_sku(item_id: str, tracer: Optional[callable] = None) -> Optional[AlibabaSkuDetail]:
    if not RAPIDAPI_KEY: return None
    if item_id in _sku_cache: return _sku_cache[item_id]
    
    async with alibaba_throttler:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    f"https://{HOSTS['datahub']}/item_sku",
                    params={"itemId": item_id},
                    headers=get_headers("datahub"),
                    timeout=15.0
                )
                
                if resp.status_code == 200:
                    data = resp.json().get("result", {})
                    # ... rest of extract logic ...
                    res = AlibabaSkuDetail(
                        item_id=item_id,
                        title=data.get("itemInfo", {}).get("title", ""),
                        description=data.get("itemInfo", {}).get("description", ""),
                        images=data.get("itemInfo", {}).get("images", []),
                        price_min=min([p.get("price", 0) for p in data.get("skuInfos", []) if p.get("price")] or [0]),
                        price_max=max([p.get("price", 0) for p in data.get("skuInfos", []) if p.get("price")] or [0]),
                        moq=1,
                        currency="USD",
                        company_name=data.get("supplierInfo", {}).get("companyName", "Unknown"),
                        supplier_country=data.get("supplierInfo", {}).get("country", "China"),
                        country_code=data.get("supplierInfo", {}).get("countryCode", "CN"),
                        verified=bool(data.get("supplierInfo", {}).get("verified")),
                        gold_supplier=bool(data.get("supplierInfo", {}).get("goldSupplier")),
                        trade_assurance=bool(data.get("supplierInfo", {}).get("tradeAssurance")),
                        years_on_platform=int(data.get("supplierInfo", {}).get("years") or 0) or None,
                        response_rate=data.get("tradeInfo", {}).get("responseRate", "90%"),
                        response_time=data.get("tradeInfo", {}).get("responseTime", "< 24h"),
                        business_type=data.get("supplierInfo", {}).get("businessType", "Trading"),
                        certifications=data.get("supplierInfo", {}).get("certifications", []),
                        product_categories_count=len(data.get("supplierInfo", {}).get("productCategories", []))
                    )
                    _sku_cache[item_id] = res
                    return res
                else:
                    if tracer: tracer("search", f"SKU fetch failed: {resp.status_code}", {"itemId": item_id, "body": resp.text[:500]})
            except Exception as e:
                logger.error(f"SKU fetch failed for {item_id}: {e}")
            return None

@auto_retry(3)
async def get_package_detail(item_id: str, store_id: str, tracer: Optional[callable] = None) -> Optional[PackageDetail]:
    if not RAPIDAPI_KEY: return None
    async with alibaba_throttler:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    f"https://{HOSTS['package']}/package_detail",
                    params={"itemId": item_id, "storeId": store_id},
                    headers=get_headers("package"),
                    timeout=15.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return PackageDetail(
                        weight_kg=float(data.get("weight", 0.5) or 0.5),
                        shipping_methods=data.get("shippingMethods", ["Standard"]),
                        estimated_delivery_days=int(data.get("deliveryDays", 15) or 15)
                    )
            except Exception as e:
                logger.error(f"Package detail fetch failed for {item_id}: {e}")
            return None

async def search_and_enrich(visual_result: VisualSearchResult, job_id: str, tracer: Optional[callable] = None, img_url: str = "") -> List[SupplierResult]:
    # Prefer direct image search if we have a public URL; fallback to keyword mock
    if img_url:
        summaries = await image_search_products(img_url, tracer=tracer)
    else:
        summaries = [_mock_summary(visual_result.keywords, i) for i in range(3)]
        if tracer:
            tracer("search", "No image URL available — using mock results", {})
    results = []
    
    async def enrich_worker(summary: AlibabaSummary):
        detail = await get_item_detail(summary.item_id, tracer=tracer)
        sku = await get_item_sku(summary.item_id, tracer=tracer)
        pkg = await get_package_detail(summary.item_id, "store_1", tracer=tracer) if sku else None
        
        _, inr_rate = await convert_to_inr(1, summary.currency)

        # Use real package data if available, otherwise no delivery info
        if pkg and pkg.estimated_delivery_days:
            delivery_days = pkg.estimated_delivery_days
            shipping_cost_inr, _ = await estimate_shipping_cost_inr(
                getattr(sku, "country_code", "CN")
            )
        else:
            delivery_days = None
            shipping_cost_inr = 0.0

        return normalize_supplier_result(
            summary, sku, pkg, visual_result,
            inr_rate, shipping_cost_inr, delivery_days, job_id,
            item_detail=detail
        )

    tasks = [enrich_worker(s) for s in summaries]
    completed = await asyncio.gather(*tasks, return_exceptions=True)
    
    for r in completed:
        if isinstance(r, SupplierResult):
            results.append(r)
            
    # deduplicate by item_id
    seen = set()
    dedup = []
    for r in sorted(results, key=lambda x: x.match_score, reverse=True):
        if r.item_id not in seen:
            dedup.append(r)
            seen.add(r.item_id)
            
    if tracer: tracer("search", "Supplier enrichment complete", {"found": len(dedup)})
    return dedup

@auto_retry(3)
async def get_item_detail(item_id: str, tracer: Optional[callable] = None) -> Optional[Dict]:
    """Fetch full item details including properties and rich description."""
    if not RAPIDAPI_KEY: return None
    
    async with alibaba_throttler:
        async with httpx.AsyncClient() as client:
            try:
                if tracer: tracer("enrich", "Fetching rich item detail", {"itemId": item_id})
                resp = await client.get(
                    f"https://{HOSTS['datahub']}/item_detail",
                    params={"itemId": item_id},
                    headers=get_headers("datahub"),
                    timeout=20.0
                )
                if resp.status_code == 200:
                    data = resp.json().get("result", {})
                    if tracer: tracer("enrich", "Rich detail fetched", {"itemId": item_id})
                    return data
            except Exception as e:
                logger.error(f"Item detail fetch failed for {item_id}: {e}")
            return None

async def health_check() -> Dict:
    if not RAPIDAPI_KEY:
        return {"status": "not_configured", "latency_ms": 0}
    
    start_time = datetime.now()
    async with alibaba_throttler:
        async with httpx.AsyncClient() as client:
            try:
                # Use a lightweight endpoint for health check
                resp = await client.get(
                    f"https://{HOSTS['api2']}/",
                    headers=get_headers("api2"),
                    timeout=5.0
                )
                latency = (datetime.now() - start_time).total_seconds() * 1000
                status = "ok" if resp.status_code in (200, 404, 401) else "error"
                return {"status": status, "latency_ms": int(latency)}
            except Exception as e:
                return {"status": "error", "error": str(e), "latency_ms": 0}
