import os
import json
import base64
import asyncio
import httpx
from collections import Counter
import re
from typing import List, Optional
from models.schemas import BaseModel
from utils.logger import get_logger

logger = get_logger(__name__)

SERP_API_KEY = os.getenv("SERP_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

class VisualSearchResult(BaseModel):
    product_name: str
    keywords: List[str]
    confidence: float
    source: str
    raw_titles: List[str] = []

STOP_WORDS = {"the", "a", "an", "and", "or", "but", "in", "on", "for", "with", "of", "at", 
              "by", "to", "buy", "online", "cheap", "price", "review", "new", "top", "best"}

def extract_keywords(titles: List[str]) -> List[str]:
    words = []
    for title in titles:
        clean = re.sub(r'[^a-zA-Z\s]', '', title).lower()
        for word in clean.split():
            if len(word) > 2 and word not in STOP_WORDS:
                words.append(word)
    
    counts = Counter(words)
    return [word for word, count in counts.most_common(5)]

async def identify_product_from_image(image_url: str) -> VisualSearchResult:
    fallback = VisualSearchResult(
        product_name="Product from reel",
        keywords=["product"],
        confidence=0.1,
        source="fallback"
    )
    
    if not SERP_API_KEY or image_url.startswith("data:image"):
        logger.info("Using fallback visual search")
        return fallback
        
    try:
        async with httpx.AsyncClient() as client:
            params = {
                "engine": "google_lens",
                "url": image_url,
                "api_key": SERP_API_KEY,
            }
            resp = await client.get("https://serpapi.com/search.json", params=params, timeout=20.0)
            if resp.status_code != 200:
                logger.error(f"SerpAPI Error: {resp.status_code}")
                return fallback
                
            data = resp.json()
            titles = []
            product_name = ""
            
            kg = data.get("knowledge_graph", [])
            if kg and isinstance(kg, list):
                product_name = kg[0].get("title", "")
            
            visual_matches = data.get("visual_matches", [])
            for match in visual_matches[:10]:
                if "title" in match:
                    titles.append(match["title"])
                    
            if not product_name and titles:
                product_name = titles[0]
                
            shopping = data.get("shopping_results", [])
            for shop in shopping[:3]:
                if "title" in shop:
                    titles.append(shop["title"])
                    
            if not product_name:
                return fallback
                
            keywords = extract_keywords(titles)
            
            return VisualSearchResult(
                product_name=product_name,
                keywords=keywords if keywords else ["product"],
                confidence=0.85 if kg else 0.6,
                source="google_lens",
                raw_titles=titles[:5]
            )
            
    except Exception as e:
        logger.error(f"Google Lens identification failed: {str(e)}")
        return fallback


async def identify_product_with_gemini(image_url: str) -> Optional[str]:
    """Ask Gemini to name the product in an image. Returns a short term or None."""
    if not GEMINI_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Fetch the image bytes (Gemini needs inline data, not a URL).
            img = await client.get(image_url, timeout=20)
            if img.status_code != 200:
                return None
            b64 = base64.b64encode(img.content).decode("utf-8")
            payload = {
                "contents": [{"parts": [
                    {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
                    {"text": (
                        "Identify the manufactured physical product in this image — the item a "
                        "buyer would source on Alibaba. Ignore hands, backgrounds, and any food or "
                        "material being demonstrated. Reply with ONLY a JSON object: "
                        '{"product": "<name in 3-6 words>"}'
                    )},
                ]}],
                "generationConfig": {"maxOutputTokens": 60, "temperature": 0.0},
            }
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite:generateContent?key={GEMINI_API_KEY}",
                headers={"Content-Type": "application/json"}, json=payload,
            )
            if resp.status_code != 200:
                logger.warning(f"Gemini image ID error {resp.status_code}")
                return None
            raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json").strip()
            return json.loads(raw).get("product") or None
    except Exception as e:
        logger.warning(f"Gemini image identification failed: {e}")
        return None


async def market_data_from_lens(image_url: str = "", query: str = "") -> dict:
    """Pull real market signals (price, rating, review counts) from Google Lens
    shopping matches. Returns aggregates the Sourcing Model's Market Size uses.
    Works from an image URL (visual product match) or a text query."""
    empty = {"listings": [], "count": 0, "avg_price": None, "total_reviews": 0,
             "avg_rating": None, "source": "google_lens", "partial": True,
             "note": "No market data from Lens."}
    if not SERP_API_KEY:
        return {**empty, "note": "SERP_API_KEY not set."}
    try:
        params = {"engine": "google_lens", "api_key": SERP_API_KEY, "type": "products"}
        if image_url and not image_url.startswith("data:image"):
            params["url"] = image_url
        if query:
            params["q"] = query
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
            if resp.status_code != 200:
                return {**empty, "note": f"Lens error {resp.status_code}."}
            data = resp.json()

        matches = data.get("visual_matches", []) + data.get("products", [])
        listings, prices, reviews, ratings = [], [], [], []
        for m in matches:
            pr = m.get("price", {})
            pval = pr.get("extracted_value") if isinstance(pr, dict) else None
            cur = pr.get("currency") if isinstance(pr, dict) else None
            rt = m.get("rating")
            rv = m.get("reviews")
            if pval is None and rt is None and rv is None:
                continue  # skip non-shopping web results
            listings.append({
                "title": m.get("title", ""), "price": pval, "currency": cur,
                "rating": rt, "reviews": rv, "source": m.get("source", ""),
                "link": m.get("link", ""),
            })
            if pval: prices.append(float(pval))
            if rt is not None:
                try: ratings.append(float(rt))
                except (ValueError, TypeError): pass
            if rv is not None:
                try: reviews.append(int(rv))
                except (ValueError, TypeError): pass

        return {
            "listings": listings[:25],
            "count": len(listings),
            "avg_price": round(sum(prices) / len(prices), 2) if prices else None,
            "total_reviews": sum(reviews),
            "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "source": "google_lens",
            "partial": len(listings) < 3,
            "note": "" if listings else "No shopping listings found by Lens.",
        }
    except Exception as e:
        logger.warning(f"Lens market data failed: {e}")
        return {**empty, "note": "Lens request failed."}


async def _lens_market_one(image_url: str, query: str, country: str) -> dict:
    """One Google Lens query localised to a country (gl). Returns aggregates in
    the market's native currency."""
    if not SERP_API_KEY:
        return {"count": 0, "avg_price": None, "currency": "", "total_reviews": 0,
                "avg_rating": None, "top": []}
    try:
        params = {"engine": "google_lens", "api_key": SERP_API_KEY, "type": "products",
                  "country": country}
        if image_url and not image_url.startswith("data:image"):
            params["url"] = image_url
        if query:
            params["q"] = query
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
            if resp.status_code != 200:
                return {"count": 0, "avg_price": None, "currency": "", "total_reviews": 0,
                        "avg_rating": None, "top": [], "error": resp.status_code}
            data = resp.json()
    except Exception as e:
        logger.warning(f"Lens market ({country}) failed: {e}")
        return {"count": 0, "avg_price": None, "currency": "", "total_reviews": 0,
                "avg_rating": None, "top": []}

    matches = data.get("visual_matches", []) + data.get("products", [])
    prices, reviews, ratings, currency, top = [], [], [], "", []
    for m in matches:
        pr = m.get("price", {})
        pval = pr.get("extracted_value") if isinstance(pr, dict) else None
        if pval is None:
            continue
        try:
            prices.append(float(pval))
        except (ValueError, TypeError):
            continue
        if not currency and isinstance(pr, dict):
            currency = pr.get("currency", "")
        rv = m.get("reviews"); rt = m.get("rating")
        if rv is not None:
            try: reviews.append(int(rv))
            except (ValueError, TypeError): pass
        if rt is not None:
            try: ratings.append(float(rt))
            except (ValueError, TypeError): pass
        if len(top) < 5:
            top.append({"title": str(m.get("title") or "")[:80], "price": float(pval),
                        "currency": currency, "source": m.get("source", ""), "link": m.get("link", "")})
    # Median resists outliers (bulk packs, accessories, mispriced listings) that
    # badly skew the mean — it's a far more representative "typical" retail price.
    def _median(xs: list) -> float:
        s = sorted(xs); n = len(s)
        if n == 0: return None
        mid = n // 2
        return round(s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2, 2)

    return {
        "count": len(prices),
        "avg_price": _median(prices),       # median, despite the key name
        "min_price": round(min(prices), 2) if prices else None,
        "max_price": round(max(prices), 2) if prices else None,
        "currency": currency,
        "total_reviews": sum(reviews),
        "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "top": sorted(top, key=lambda t: t["price"])[:5],  # cheapest representative few
    }


async def market_data_3markets(image_url: str = "", query: str = "") -> dict:
    """Retail price comparison across India, UAE and USA via Google Lens.
    Returns per-market aggregates in native currency plus an INR-converted figure
    for apples-to-apples comparison. Uses 3 Lens searches (one per market)."""
    in_m, ae_m, us_m = await asyncio.gather(
        _lens_market_one(image_url, query, "in"),
        _lens_market_one(image_url, query, "ae"),
        _lens_market_one(image_url, query, "us"),
    )

    from services.currency_service import convert_to_inr

    # Each market's prices are in its own currency — map by MARKET, not by parsing
    # Lens's currency glyph (the AED glyph is unreliable to match).
    async def with_inr(m: dict, code: str) -> dict:
        avg = m.get("avg_price")
        inr = None
        if avg is not None:
            if code == "INR":
                inr = round(avg, 2)
            else:
                try:
                    converted, _ = await convert_to_inr(avg, code)
                    inr = round(converted, 2)
                except Exception:
                    inr = None
        symbol = {"INR": "₹", "AED": "AED", "USD": "$"}.get(code, m.get("currency", ""))
        return {**m, "avg_price_inr": inr, "currency": symbol, "currency_code": code}

    india, uae, usa = await asyncio.gather(
        with_inr(in_m, "INR"), with_inr(ae_m, "AED"), with_inr(us_m, "USD")
    )
    return {
        "markets": {"india": india, "uae": uae, "usa": usa},
        "source": "google_lens",
        "note": "Retail prices from Google Lens shopping matches, localised per market.",
    }


# Google Lens returns the price currency as a glyph/symbol, not an ISO code.
# Map the common ones so we convert each listing from its REAL currency — a ¥35
# yuan listing must not be treated as $35. "$" is ambiguous (USD/CAD/AUD/…) but
# defaulting it to USD is the safe, most-common choice for these shopping results.
_CURRENCY_SYMBOLS = {
    "$": "USD", "US$": "USD", "usd": "USD",
    "₹": "INR", "rs": "INR", "rs.": "INR", "inr": "INR",
    "¥": "CNY", "cny": "CNY", "rmb": "CNY", "元": "CNY",  # see JPY note below
    "€": "EUR", "eur": "EUR",
    "£": "GBP", "gbp": "GBP",
    "aed": "AED", "dh": "AED", "د.إ": "AED",
    "₩": "KRW", "krw": "KRW",
    "jpy": "JPY",
    "ca$": "CAD", "a$": "AUD", "sg$": "SGD", "hk$": "HKD",
}


def _currency_to_iso(raw) -> str:
    """Best-effort map a Lens currency symbol/string to an ISO code. Defaults to
    USD when unknown (most Lens shopping prices are USD)."""
    if not raw:
        return "USD"
    s = str(raw).strip().lower()
    if s in _CURRENCY_SYMBOLS:
        return _CURRENCY_SYMBOLS[s]
    # Already an ISO-ish 3-letter code?
    up = str(raw).strip().upper()
    if len(up) == 3 and up.isalpha():
        return up
    # Try the symbol map case-sensitively (for $, ₹, ¥, €, £ glyphs).
    return _CURRENCY_SYMBOLS.get(str(raw).strip(), "USD")


async def suppliers_from_lens(image_url: str, job_id: str, inr_rate: float = 83.5) -> list:
    """Fallback supplier source: build SupplierResult rows from Google Lens
    shopping matches when the Alibaba (DataHub) API is unavailable. NOTE: Lens
    prices are RETAIL (what it sells for), not Alibaba wholesale FOB — flagged via
    platform='google_lens' and match_source='visual' so the UI can warn.

    Each listing is converted from its OWN currency (¥, ₹, €, £, AED, $…) to INR
    — never assume USD.
    """
    from models.schemas import SupplierResult
    from datetime import datetime, timezone
    from services.currency_service import convert_to_inr

    if not SERP_API_KEY or image_url.startswith("data:image"):
        return []

    # Call Lens directly so we can include ALL visual matches — even those
    # without a price (so a recognised-but-unpriced product still yields seller
    # names/links to chase), not just shopping listings.
    try:
        params = {"engine": "google_lens", "api_key": SERP_API_KEY, "url": image_url, "type": "products"}
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
            if resp.status_code != 200:
                return []
            data = resp.json()
    except Exception as e:
        logger.warning(f"Lens suppliers fetch failed: {e}")
        return []

    matches = data.get("visual_matches", []) + data.get("products", [])

    # Cache the USD→INR rate once so we can also report a USD figure per listing
    # (used for ranking/comparison) regardless of the listing's native currency.
    _, usd_inr = await convert_to_inr(1.0, "USD")
    if not usd_inr:
        usd_inr = inr_rate

    results = []
    for idx, m in enumerate(matches[:25]):
        pr = m.get("price", {})
        pval = pr.get("extracted_value") if isinstance(pr, dict) else None
        cur_raw = pr.get("currency") if isinstance(pr, dict) else None
        iso = _currency_to_iso(cur_raw)
        try:
            native = float(pval) if pval is not None else 0.0
        except (ValueError, TypeError):
            native = 0.0

        # Convert the listing's NATIVE price to INR using its real currency.
        if native > 0:
            inr, _ = await convert_to_inr(native, iso)
            # Derive a USD figure for ranking/comparison.
            usd = round(inr / usd_inr, 2) if usd_inr else native
        else:
            inr, usd = 0.0, 0.0

        src = str(m.get("source") or "Online seller")
        try:
            rv = int(m.get("reviews") or 0)
        except (ValueError, TypeError):
            rv = 0
        try:
            rt = float(m.get("rating") or 0)
        except (ValueError, TypeError):
            rt = 0.0
        results.append(SupplierResult(
            id=f"lens_{job_id}_{idx}",
            job_id=job_id,
            product_name=str(m.get("title") or "Product")[:160],
            product_image_url=str(m.get("thumbnail") or ""),
            supplier_name=src,
            supplier_type="supplier",
            company_name=src,
            country="", country_code="",
            unit_price_usd=usd or None,
            unit_price_inr=inr,
            original_currency=iso,
            original_price=native,
            price_range_min=usd or None, price_range_max=usd or None,
            moq=1, moq_unit="piece",
            total_price_inr=inr,
            rating=rt,
            review_count=rv,
            platform="google_lens",  # signals RETAIL price, not Alibaba FOB
            product_url=str(m.get("link") or ""),
            match_score=70.0 if usd else 50.0,
            match_source="visual",
            created_at=datetime.now(timezone.utc).isoformat(),
        ))
    # Priced + most-reviewed first.
    results.sort(key=lambda r: ((r.unit_price_usd or 0) > 0, r.review_count), reverse=True)
    return results


async def identify_product_combined(image_url: str) -> VisualSearchResult:
    """Run Google Lens and Gemini in parallel and merge into one result. Lens
    gives real web product matches; Gemini gives a clean product name. Prefer
    Gemini's concise name as the search term, enriched with Lens keywords."""
    lens, gemini_name = await asyncio.gather(
        identify_product_from_image(image_url),
        identify_product_with_gemini(image_url),
    )

    name = gemini_name or lens.product_name
    keywords = lens.keywords if lens.keywords and lens.keywords != ["product"] else []
    if gemini_name:
        keywords = extract_keywords([gemini_name]) + [k for k in keywords if k not in gemini_name.lower()]
    if not keywords:
        keywords = ["product"]

    # Confidence: highest when both agree something specific.
    confidence = 0.9 if (gemini_name and lens.source == "google_lens") else (
        0.75 if gemini_name or lens.source == "google_lens" else 0.2
    )
    source = "gemini+lens" if (gemini_name and lens.source == "google_lens") else (
        "gemini" if gemini_name else lens.source
    )
    return VisualSearchResult(
        product_name=name or "Uploaded product",
        keywords=keywords[:6],
        confidence=confidence,
        source=source,
        raw_titles=lens.raw_titles,
    )
