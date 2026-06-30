from fastapi import APIRouter, Query, HTTPException, Depends
from utils.auth import require_viewer
from typing import List, Optional
from models.database import get_pool, to_camel
import json
import httpx
import os

router = APIRouter()

@router.post("/suppliers/compare/insights")
async def compare_insights(body: dict, _viewer: str = Depends(require_viewer)):
    """
    Call Gemini 1.5 Flash (free tier) to generate comparison insights.
    Expects body: { suppliers: [...SupplierResult] }
    """
    suppliers = body.get("suppliers", [])
    if len(suppliers) < 2:
        raise HTTPException(400, "Need at least 2 suppliers to compare")
    if len(suppliers) > 4:
        suppliers = suppliers[:4]

    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "GEMINI_API_KEY not configured — get a free key at aistudio.google.com")

    def summarise(s):
        props = s.get("productProperties") or s.get("product_properties") or {}
        return {
            "name": s.get("productName") or s.get("product_name", ""),
            "supplier": s.get("supplierName") or s.get("supplier_name", ""),
            "country": s.get("country", ""),
            "price_inr": s.get("unitPriceINR") or s.get("unitPriceInr") or s.get("unit_price_inr", 0),
            "price_usd": s.get("unitPriceUSD") or s.get("unitPriceUsd") or s.get("unit_price_usd", 0),
            "moq": s.get("moq", 1),
            "rating": s.get("rating", 0),
            "review_count": s.get("reviewCount") or s.get("review_count", 0),
            "verified": s.get("verified", False),
            "gold_supplier": s.get("goldSupplier") or s.get("gold_supplier", False),
            "trade_assurance": s.get("tradeAssurance") or s.get("trade_assurance", False),
            "years_on_platform": s.get("yearsOnPlatform") or s.get("years_on_platform", 0),
            "delivery_days": s.get("estimatedDeliveryDays") or s.get("estimated_delivery_days"),
            "ranking": props.get("ranking", ""),
            "reorder_rate": props.get("reorder_rate") or s.get("reorderRate", ""),
            "on_time_delivery": props.get("on_time_delivery_rate") or s.get("onTimeDeliveryRate", ""),
            "certifications": s.get("certifications", []),
            "sample_available": s.get("sampleAvailable") or s.get("sample_available", False),
        }

    summaries = [summarise(s) for s in suppliers]
    prompt = f"""You are a B2B sourcing analyst helping an Indian buyer compare Alibaba suppliers.

Here are {len(summaries)} suppliers being compared (data in JSON):
{json.dumps(summaries, indent=2)}

Give a structured comparison analysis with these sections:

**Best Overall Pick** — which supplier and why in 2 sentences
**Best Price** — which is cheapest and any caveats
**Most Trustworthy** — based on badges, years, rating, certifications
**Fastest Delivery** — who ships fastest to India
**Key Risks** — 2-3 bullet points on risks across these options
**Recommendation** — 3 bullet points of actionable advice for this buyer

Be concise. Use supplier names (not numbers). Focus on what matters for an Indian buyer importing from China/other countries."""

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.4},
            },
        )

    if resp.status_code != 200:
        raise HTTPException(502, f"Gemini API error: {resp.text[:200]}")

    data = resp.json()
    try:
        insight_text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        raise HTTPException(502, f"Unexpected Gemini response: {str(data)[:200]}")

    return {"insights": insight_text}

@router.get("/suppliers")
async def get_suppliers(
    job_id: str,
    country_codes: str = None,
    supplier_type: str = None,
    min_price_inr: float = 0,
    max_price_inr: float = 1000000,
    min_moq: int = 1,
    max_moq: int = 10000,
    min_rating: float = 0.0,
    verified_only: bool = False,
    trade_assurance_only: bool = False,
    platforms: str = None,
    sort_by: str = "match_score",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = 20,
    _viewer: str = Depends(require_viewer)
):
    # Build WHERE clause with asyncpg $N positional params
    conditions = ["job_id = $1"]
    params: list = [job_id]

    def p():
        return f"${len(params) + 1}"

    if country_codes:
        codes = country_codes.split(",")
        placeholders = ", ".join(f"${len(params)+i+1}" for i in range(len(codes)))
        conditions.append(f"country_code IN ({placeholders})")
        params.extend(codes)

    if supplier_type:
        types = supplier_type.split(",")
        placeholders = ", ".join(f"${len(params)+i+1}" for i in range(len(types)))
        conditions.append(f"supplier_type IN ({placeholders})")
        params.extend(types)

    conditions.append(f"unit_price_inr BETWEEN {p()} AND ${len(params)+2}")
    params.extend([min_price_inr, max_price_inr])

    conditions.append(f"moq BETWEEN {p()} AND ${len(params)+2}")
    params.extend([min_moq, max_moq])

    if min_rating > 0:
        conditions.append(f"rating >= {p()}")
        params.append(min_rating)

    if verified_only:
        conditions.append("verified = 1")

    if trade_assurance_only:
        conditions.append("trade_assurance = 1")

    if platforms:
        plats = platforms.split(",")
        placeholders = ", ".join(f"${len(params)+i+1}" for i in range(len(plats)))
        conditions.append(f"platform IN ({placeholders})")
        params.extend(plats)

    valid_sorts = ['match_score', 'unit_price_inr', 'rating', 'estimated_delivery_days']
    safe_sort = sort_by if sort_by in valid_sorts else 'match_score'
    dir_str = "ASC" if sort_dir.lower() == "asc" else "DESC"

    where = " AND ".join(conditions)
    order_clause = f"""
        ORDER BY
          CASE WHEN country_code = 'IN' THEN 0
               WHEN country_code = 'CN' THEN 1
               ELSE 2 END ASC,
          {safe_sort} {dir_str}
    """

    params.extend([page_size, (page - 1) * page_size])
    limit_offset = f"LIMIT ${len(params)-1} OFFSET ${len(params)}"

    query = f"SELECT * FROM suppliers WHERE {where} {order_clause} {limit_offset}"
    count_query = f"SELECT COUNT(*) FROM suppliers WHERE {where}"
    count_params = params[:-2]  # strip LIMIT/OFFSET

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        total = await conn.fetchval(count_query, *count_params)

    formatted_suppliers = []
    for row in rows:
        row_dict = dict(row)
        for key in ('shipping_methods', 'certifications', 'product_properties', 'raw_api_response'):
            if key in row_dict:
                empty = '{}' if key in ('product_properties', 'raw_api_response') else '[]'
                try:
                    row_dict[key] = json.loads(row_dict[key] or empty)
                except Exception:
                    row_dict[key] = {} if key in ('product_properties', 'raw_api_response') else []
        formatted_suppliers.append({to_camel(k): v for k, v in row_dict.items()})

    return {
        "suppliers": formatted_suppliers,
        "total": total,
        "page": page,
        "page_size": page_size
    }
