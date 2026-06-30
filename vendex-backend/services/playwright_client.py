"""
Alibaba Playwright scraper — uses data-testid selectors plus JSON-LD schema
extraction for reliable USD prices.

Currency approach:
  - Set intl_locale_currency_code=USD cookie before navigation
  - Append ?selectedCurrencyCode=USD to every product URL as a fallback
  - Read JSON-LD schema.org data which always contains USD price
"""

import asyncio
import json
import os
import random
import re
import uuid
from datetime import datetime, timezone

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

from models.schemas import SupplierResult, SupplierType
from utils.currency import usd_to_inr, inr_to_usd
from utils.logger import get_logger

# Path to save/reuse session cookies so Alibaba doesn't treat us as a fresh bot
_SESSION_FILE = os.path.join(os.path.dirname(__file__), "..", "alibaba_session.json")

# Cookies that must be present and non-expired for the session to be usable.
# _m_h5_tk  — short-lived token used in API request signing (~24h)
# xlly_s    — session integrity / anti-bot cookie (~24–48h)
# If either is missing or past its expiry the whole session file is stale.
_CRITICAL_COOKIES = {"_m_h5_tk", "xlly_s"}

def _is_session_valid() -> bool:
    """
    Return True only if the saved session file exists AND all critical cookies
    are present with a future expiry timestamp.  Deletes the file if invalid.
    """
    if not os.path.exists(_SESSION_FILE):
        return False
    try:
        import json as _json, time as _time
        with open(_SESSION_FILE) as fh:
            data = _json.load(fh)
        cookies = {c["name"]: c for c in data.get("cookies", [])}
        now = _time.time()
        for name in _CRITICAL_COOKIES:
            c = cookies.get(name)
            if c is None:
                get_logger(__name__).info(f"Session invalid: cookie '{name}' missing — deleting session")
                os.remove(_SESSION_FILE)
                return False
            exp = c.get("expires", -1)
            # -1 means session-only (gone when browser closed); treat as expired
            if exp < 0 or exp <= now:
                get_logger(__name__).info(
                    f"Session invalid: cookie '{name}' expired "
                    f"({(now - exp) / 3600:.1f}h ago) — deleting session"
                )
                os.remove(_SESSION_FILE)
                return False
        return True
    except Exception as e:
        get_logger(__name__).warning(f"Could not validate session file: {e} — ignoring it")
        return False

logger = get_logger(__name__)


def _parse_price(text: str) -> float:
    """Extract the first positive numeric float from a price string."""
    if not text:
        return 0.0
    cleaned = re.sub(r"[^\d.,]", " ", text)
    parts = re.findall(r"[\d,]+(?:\.\d+)?", cleaned)
    for p in parts:
        try:
            val = float(p.replace(",", ""))
            if val > 0:
                return val
        except ValueError:
            continue
    return 0.0


async def _get_text_any(page, selectors: list[str]) -> str:
    """Try multiple selectors, return first non-empty text result."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                text = (await loc.text_content() or "").strip()
                if text:
                    return text
        except Exception:
            continue
    return ""


async def _get_attr_any(page, selectors: list[str], attr: str) -> str:
    """Try multiple selectors for an attribute, return first match."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                val = await loc.get_attribute(attr) or ""
                if val:
                    return val
        except Exception:
            continue
    return ""


async def _extract_jsonld(page) -> dict:
    """
    Extract the schema.org Product JSON-LD from the page.
    This gives us: name, image[], offers.price (USD), offers.priceCurrency,
    brand.name (supplier), sku.
    Always available, unaffected by DOM changes.
    """
    try:
        scripts = await page.locator('script[type="application/ld+json"]').all()
        for script in scripts:
            raw = (await script.text_content() or "").strip()
            try:
                data = json.loads(raw)
                # May be a list or a single object
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if item.get("@type") == "Product":
                        return item
            except json.JSONDecodeError:
                continue
    except Exception:
        pass
    return {}


async def _extract_product_data(page, url: str, index: int, job_id: str, log_cb=None) -> SupplierResult | None:
    """
    Navigate to a product page and extract all available information.

    Uses a three-tier strategy:
      1. JSON-LD schema.org (most reliable — title, USD price, images, supplier)
      2. data-testid selectors (confirmed from live Alibaba HTML)
      3. Class/text pattern fallbacks
    """
    try:
        # Append USD currency param to URL
        sep = "&" if "?" in url else "?"
        url_usd = url + sep + "selectedCurrencyCode=USD"

        # Block heavy assets but keep scripts + Alibaba CDN styles (CAPTCHA needs them)
        _BLOCKED_DOMAINS_PROD = (
            "google-analytics.com", "googletagmanager.com", "doubleclick.net",
            "criteo.com", "facebook.com", "twitter.com", "linkedin.com",
            "hotjar.com", "segment.io", "amplitude.com", "mixpanel.com",
        )
        async def _block_assets_prod(route):
            req = route.request
            # Block images/media/fonts unconditionally
            if req.resource_type in ("image", "media", "font"):
                await route.abort()
                return
            # Block 3rd-party stylesheets — but keep alicdn.com (CAPTCHA CSS lives there)
            if req.resource_type == "stylesheet" and "alicdn.com" not in req.url:
                await route.abort()
                return
            if any(d in req.url for d in _BLOCKED_DOMAINS_PROD):
                await route.abort()
                return
            await route.continue_()
        await page.route("**/*", _block_assets_prod)

        if log_cb:
            await log_cb("search", f"[{index+1}] Loading product page", {"url": url})
        await page.goto(url_usd, wait_until="domcontentloaded", timeout=30000)

        # Solve CAPTCHA — if unsolved, refresh and try once more
        for _nav_attempt in range(2):
            captcha_clean = await _check_and_handle_captcha(page, f"product-nav-{index}")
            if captcha_clean:
                break
            # Check if h1 is already present (product loaded despite CAPTCHA check returning False)
            try:
                await page.wait_for_selector("h1", timeout=2000)
                captcha_clean = True
                break
            except Exception:
                pass
            if _nav_attempt == 0:
                logger.warning(f"[{index}] CAPTCHA unresolved — refreshing page and retrying")
                await page.reload(wait_until="domcontentloaded", timeout=30000)

        if not captcha_clean:
            # Page is still blocked — don't extract garbage data, signal for retry
            logger.warning(f"[{index}] CAPTCHA unresolved after refresh — flagging for retry")
            return None

        # Wait for h1 then scroll to trigger lazy-loaded sections
        try:
            await page.wait_for_selector("h1", timeout=6000)
        except Exception:
            pass
        # Scroll to trigger lazy-loaded sections: seller card, ranking, logistics
        await page.evaluate("window.scrollTo(0, 800)")
        await asyncio.sleep(0.6)
        await page.evaluate("window.scrollTo(0, 2500)")
        await asyncio.sleep(0.6)
        await page.evaluate("window.scrollTo(0, 5000)")
        await asyncio.sleep(0.5)

        # ── Single JS pass: grab everything in one round-trip ─────────────────
        d = await page.evaluate(r"""() => {
            const $ = (sel, root) => (root||document).querySelector(sel);
            const $$ = (sel, root) => Array.from((root||document).querySelectorAll(sel));
            const txt = (sel, root) => { const el = $(sel,root); return el ? (el.innerText||el.textContent||'').trim() : ''; };

            // JSON-LD — may be array, take Product type
            let ld = {};
            try {
                const raw = $('script[type="application/ld+json"]')?.textContent || '{}';
                const parsed = JSON.parse(raw);
                ld = Array.isArray(parsed) ? (parsed.find(x=>x['@type']==='Product')||parsed[0]||{}) : parsed;
            } catch(e){}
            const ldOffer = ld.offers || {};

            // Title
            const title = ld.name || txt('h1') || '';

            // Images — from JSON-LD (most reliable, already full URLs)
            const imgs = [];
            (Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : []).forEach(s => {
                if(s && !s.endsWith('.gif')) imgs.push(s.startsWith('//') ? 'https:'+s : s);
            });
            if(!imgs.length) {
                const og = $('meta[property="og:image"]');
                if(og?.content) imgs.push(og.content);
            }

            // Price tiers — actual class is .module_price .price-item (confirmed from live DOM)
            // Each price-item text: "200 - 999 packs\n₹203.76"
            const tierEls = $$('.module_price .price-item, [data-testid="ladder-price"] .price-item');
            const tiers = tierEls.map(el => {
                const parts = (el.innerText||'').trim().split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
                return {qty: parts[0]||'', price: parts[1]||'', raw: parts.join(' ')};
            }).filter(t => t.price);

            // MOQ — from first price tier qty or dedicated element
            const moqText = txt('[data-testid="sku-moq"]')
                || (tiers.length ? tiers[0].qty : '')
                || '';

            // Sample
            const sampleText = txt('[data-testid="fortifiedSample"]');

            // Seller card — scroll puts it in DOM
            const sellerCard = $('[data-testid="seller-overview-card"]')
                || $('[class*="seller-overview-card"]')
                || $('[class*="company-info"]');
            const sellerCardText = sellerCard ? (sellerCard.innerText||'') : '';

            const supplierName = ld.brand?.name
                || txt('[data-testid="seller-overview-card-company-link"]')
                || txt('[data-testid="seller-overview-card-header"] a')
                || (() => { const a = $('a[href*=".en.alibaba.com"]'); return a ? (a.innerText||'').trim() : ''; })()
                || '';

            const metricsText = txt('[data-testid="seller-overview-card-metrics"]')
                || txt('[data-testid="seller-overview-card-review"]')
                || '';
            const metaText = txt('[data-testid="seller-overview-card-meta"]') || '';

            // Logistics
            const deliveryText = txt('[data-testid="logistics-delivery-date"]');
            const shippingFee = txt('[data-testid="logistics-total-price"]');
            const shippingMethod = txt('[data-testid="logistics-shipping-method"] .logistics-method')
                || txt('[data-testid="logistics-shipping-method"]');

            // Store link
            const storeEl = $('[data-testid="seller-overview-card-logo-link"]')
                || $('a[href*=".en.alibaba.com"]');
            const storeHref = storeEl?.href || '';

            // Extract loginId for chat
            // Alibaba "Chat Now" button href looks like:
            //   https://www.alibaba.com/trade/chat?toAccount=cn123456&productId=...
            //   OR the seller store URL pattern: cn123456.en.alibaba.com
            let memberId = '';
            let chatHrefDebug = '';
            // Priority 1: look for actual "Chat Now" / "Contact Supplier" links
            const chatKeywords = ['chat','contact','message','enquir'];
            for(const a of $$('a[href]')) {
                const h = a.href || '';
                const label = (a.textContent||a.title||a.getAttribute('aria-label')||'').toLowerCase();
                if(chatKeywords.some(k=>label.includes(k)) || h.includes('/trade/chat') || h.includes('toAccount=')) {
                    chatHrefDebug = h;
                    const m = h.match(/[?&](?:toAccount|loginId|memberId|member_id)=([^&]+)/);
                    if(m) { memberId = m[1]; break; }
                }
            }
            // Priority 2: any link with those params
            if(!memberId) {
                for(const a of $$('a[href]')) {
                    const h = a.href || '';
                    const m = h.match(/[?&](?:toAccount|loginId|memberId|member_id)=([^&]+)/);
                    if(m) { memberId = m[1]; chatHrefDebug = h; break; }
                }
            }
            // Priority 3: store subdomain from seller link e.g. cn123456.en.alibaba.com
            if(!memberId) {
                for(const a of $$('a[href*=".en.alibaba.com"]')) {
                    const h = a.href || '';
                    const m = h.match(/https?:\/\/([^.]+)\.(?:m\.)?en\.alibaba\.com/);
                    if(m && m[1] !== 'www') { memberId = m[1]; chatHrefDebug = h; break; }
                }
            }
            // Priority 4: script tags for loginId / memberId / userId JSON fields
            if(!memberId) {
                try {
                    const scripts = $$('script:not([src])');
                    for(const s of scripts) {
                        const t = s.textContent || '';
                        const m = t.match(/"(?:loginId|memberId|member_id|userId|membrid)"\s*:\s*"([^"]+)"/);
                        if(m) { memberId = m[1]; break; }
                    }
                } catch(e){}
            }

            // Ranking — shown in 2 places; collect all, pick highest rank (lowest number)
            // Place 1: .detail-honorary-title span > <b>#1</b> " hot selling in ..."
            // Place 2: inline badge in product header (id-rounded id-bg-white span)
            const rankingCandidates = [];
            const rankKeywords = ['most popular in','hot selling in','best selling in'];
            const rankSels = [
                '.detail-honorary-title a',
                '[class*="honorary-title"] a',
                'a[href*="rankTypeId"]',
                'a[href*="rankCountryId"]',
                '.detail-honorary-title',
                '[class*="honorary-title"]',
            ];
            for(const sel of rankSels) {
                for(const el of $$(sel)) {
                    const t = (el.textContent||'').replace(/\s+/g,' ').trim();
                    if(rankKeywords.some(k=>t.includes(k)) && t.includes('#')) rankingCandidates.push(t);
                }
            }
            // Scan all <b>#N</b> tags and grab parent text — catches place 2
            for(const b of $$('b,strong')) {
                const bText = (b.textContent||'').trim();
                if(!/^#\d+$/.test(bText)) continue;
                const parent = b.closest('span,a,div,li');
                if(!parent) continue;
                const t = (parent.textContent||'').replace(/\s+/g,' ').trim();
                if(rankKeywords.some(k=>t.includes(k))) rankingCandidates.push(t);
            }
            // Pick candidate with lowest rank number (= highest rank)
            let rankingText = '';
            let bestRankNum = Infinity;
            for(const c of rankingCandidates) {
                const m = c.match(/#\s*(\d+)/);
                if(m && parseInt(m[1]) < bestRankNum) { bestRankNum = parseInt(m[1]); rankingText = c; }
            }

            // Trust badges
            const isVerified = /verified\s+supplier/i.test(sellerCardText);
            const isGold = /gold\s+supplier/i.test(sellerCardText);
            const hasTA = sellerCardText.includes('Trade Assurance')
                || document.body.innerText.includes('Trade Assurance');

            // Ready to ship / certifications from full body text
            const bodyText = document.body.innerText || '';
            const readyToShip = /ready\s+to\s+ship/i.test(bodyText) || /in\s+stock/i.test(bodyText);
            const certs = ['CE','RoHS','FCC','FDA','ISO 9001','ISO','REACH','UL','CCC','BIS']
                .filter(c => bodyText.includes(c));

            const ldPriceUsd = parseFloat(ldOffer.price||0) || 0;
            const ldSku = ld.sku || ld['@id'] || '';

            return {title, imgs, tiers, moqText, sampleText,
                    supplierName, metricsText, metaText, sellerCardText,
                    deliveryText, shippingFee, shippingMethod, storeHref,
                    rankingText, isVerified, isGold, hasTA,
                    readyToShip, certs, ldPriceUsd, ldSku, memberId, chatHrefDebug};
        }""")

        title = d["title"] or f"Product #{index + 1}"
        images: list[str] = d["imgs"]
        primary_image = images[0] if images else ""
        price_tiers_raw: list[dict] = d["tiers"]  # [{qty, price, raw}, ...]
        ld_price_usd: float = d["ldPriceUsd"]
        ld_sku: str = d["ldSku"]

        # Build price_tiers for display (keep raw field for UI)
        price_tiers = [{"raw": t["raw"]} for t in price_tiers_raw]

        # Parse primary price — tiers[].price is the isolated price string e.g. "₹203.76"
        primary_price_usd = ld_price_usd
        moq = 1
        price_range_min = None
        price_range_max = None

        if price_tiers_raw:
            first_price_str = price_tiers_raw[0]["price"]
            first_qty_str = price_tiers_raw[0]["qty"]
            last_price_str = price_tiers_raw[-1]["price"]

            # MOQ from first tier qty range "200 - 999 packs" → 200
            moq_m = re.search(r"([\d,]+)", first_qty_str)
            if moq_m:
                try: moq = max(1, int(moq_m.group(1).replace(",", "")))
                except Exception: pass

            def _to_usd(price_str):
                v = _parse_price(price_str)
                if v <= 0:
                    return 0.0
                return inr_to_usd(v) if "₹" in price_str else v

            first_usd = _to_usd(first_price_str) or ld_price_usd
            last_usd = _to_usd(last_price_str) or first_usd

            # Show the minimum (bulk) price as the unit price
            primary_price_usd = min(first_usd, last_usd) if first_usd > 0 and last_usd > 0 else (first_usd or last_usd or ld_price_usd)

            if first_usd > 0 and last_usd > 0 and first_usd != last_usd:
                price_range_min = min(first_usd, last_usd)
                price_range_max = max(first_usd, last_usd)

        # MOQ fallback from dedicated element
        if moq == 1 and d["moqText"]:
            moq_m2 = re.search(r"([\d,]+)", d["moqText"])
            if moq_m2:
                try: moq = max(1, int(moq_m2.group(1).replace(",", "")))
                except Exception: pass

        # Sample price
        sample_price_usd = 0.0
        sample_available = False
        if d["sampleText"]:
            raw_s = _parse_price(d["sampleText"])
            if raw_s > 0:
                sample_price_usd = inr_to_usd(raw_s) if ("₹" in d["sampleText"] or raw_s > 100) else raw_s
                sample_available = True

        # Supplier
        supplier_name = d["supplierName"] or "Alibaba Supplier"

        # Metrics from seller card text
        rating = 0.0; review_count = 0; reorder_rate = ""; response_time = ""; on_time_delivery_rate = ""
        mt = d["metricsText"] or d["sellerCardText"]
        if mt:
            rat_m = re.search(r"([\d.]+)\s*/\s*5", mt)
            if rat_m: rating = float(rat_m.group(1))
            rev_m = re.search(r"\((\d[\d,]*)\s*review", mt)
            if rev_m: review_count = int(rev_m.group(1).replace(",", ""))
            ror_m = re.search(r"Reorder rate[:\s]+(\d+%)", mt, re.IGNORECASE)
            if ror_m: reorder_rate = ror_m.group(1)
            resp_m = re.search(r"Response Time\s*[≤<]\s*(\S+)", mt, re.IGNORECASE)
            if resp_m: response_time = "< " + resp_m.group(1)
            otd_m = re.search(r"On-time delivery rate\s*[≥>]\s*(\d+%)", mt, re.IGNORECASE)
            if otd_m: on_time_delivery_rate = otd_m.group(1)

        # Years on platform
        years_on_platform = 0
        yrs_m = re.search(r"(\d+)\s*yr", d["metaText"] or d["sellerCardText"])
        if yrs_m:
            years_on_platform = int(yrs_m.group(1))

        # Location from meta text
        location = "China"
        meta_clean = re.sub(r"\d+\s*yrs?\s*on\s*Alibaba\.com", "", d["metaText"], flags=re.IGNORECASE).strip()
        if meta_clean and len(meta_clean) > 1:
            location = meta_clean
        country_code = "CN"
        for name, code in {"china":"CN","india":"IN","vietnam":"VN","bangladesh":"BD","turkey":"TR",
                           "united states":"US","taiwan":"TW","korea":"KR","japan":"JP",
                           "pakistan":"PK","indonesia":"ID","thailand":"TH"}.items():
            if name in location.lower(): country_code = code; break

        # Logistics
        delivery_text = d["deliveryText"]
        shipping_fee_text = d["shippingFee"]
        shipping_method = d["shippingMethod"]
        estimated_delivery_days = None
        if delivery_text:
            dates = re.findall(r"(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", delivery_text)
            if len(dates) >= 2:
                try:
                    from datetime import datetime as dt
                    month_map = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
                                 "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}
                    now = dt.now()
                    end_day = int(dates[-1][0]); end_month = month_map[dates[-1][1]]
                    end_year = now.year if end_month >= now.month else now.year + 1
                    estimated_delivery_days = max(1, (dt(end_year, end_month, end_day) - now).days)
                except Exception: pass
        if estimated_delivery_days is None:
            estimated_delivery_days = 14 if country_code == "CN" else 10
        shipping_methods = [shipping_method] if shipping_method else []

        # Trust badges — computed in JS from seller card text
        is_verified: bool = d["isVerified"]
        is_gold: bool = d["isGold"]
        trade_assurance: bool = d["hasTA"]

        # Certifications
        certifications: list[str] = d["certs"]

        # Ranking
        ranking_str = ""; rank_number = None
        if d["rankingText"]:
            txt_n = re.sub(r"\s+", " ", d["rankingText"]).strip()
            m = re.search(r"#\s*(\d+)\s+(most popular in|hot selling in|best selling in)\s+(.+)", txt_n, re.IGNORECASE)
            if m:
                rank_number = int(m.group(1))
                ranking_str = f"#{rank_number} {m.group(2)} {m.group(3).strip().rstrip('.')}"
            else:
                m2 = re.search(r"#\s*(\d+)", txt_n)
                if m2: rank_number = int(m2.group(1)); ranking_str = txt_n[:80]

        ready_to_ship: bool = d["readyToShip"]
        store_id = None
        if d["storeHref"]:
            sm = re.search(r"https?://([^.]+)\.m?\.?en\.alibaba\.com", d["storeHref"])
            if sm: store_id = sm.group(1)

        # Build chat URL — Alibaba deep-link opens chat panel
        member_id = d.get("memberId", "") or store_id or ""
        # Extract the numeric product/item ID from the URL (e.g. ...62048376792.html → 62048376792)
        item_id_m = re.search(r"(\d{8,})", url)
        item_id_val = item_id_m.group(1) if item_id_m else (ld_sku or "")
        logger.info(f"[{index}] chat debug: memberId={member_id!r} itemId={item_id_val!r} chatHref={d.get('chatHrefDebug','')!r} storeHref={d.get('storeHref','')!r}")
        # Chat URL: open product page with context encoded in the hash.
        # The Vendex extension reads the context to build a smart inquiry message.
        import urllib.parse as _ul
        _ctx = _ul.quote(json.dumps({
            "title": title[:120],
            "moq": moq,
            "ranking": ranking_str[:80] if ranking_str else "",
        }), safe="")
        chat_url = url + "#vendex-chat:" + _ctx

        desc_html = ""

        # ── Build product_properties ───────────────────────────────────────────
        product_properties = {
            "ranking": ranking_str,
            "rank_number": rank_number,
            "ready_to_ship": ready_to_ship,
            "price_tiers": price_tiers,
            "sample_price_usd": sample_price_usd,
            "sample_available": sample_available,
            "shipping_fee": shipping_fee_text,
            "estimated_delivery": delivery_text,
            "all_images": images,
            "reorder_rate": reorder_rate,
            "on_time_delivery_rate": on_time_delivery_rate,
            "location": location,
            "certifications": certifications,
            "years_on_platform": years_on_platform,
            "sku": ld_sku,
            "chat_url": chat_url,
        }

        # ── Build SupplierResult ───────────────────────────────────────────────
        result = SupplierResult(
            id=f"playwright_{uuid.uuid4().hex[:8]}",
            job_id=job_id,
            product_name=title,
            product_description=desc_html,
            product_category=ranking_str if ranking_str else None,
            product_image_url=primary_image,
            supplier_name=supplier_name,
            supplier_type=SupplierType.MANUFACTURER,
            company_name=supplier_name,
            country=location,
            country_code=country_code,
            verified=is_verified,
            gold_supplier=is_gold,
            trade_assurance=trade_assurance,
            years_on_platform=years_on_platform,
            unit_price_usd=primary_price_usd,
            unit_price_inr=usd_to_inr(primary_price_usd),
            original_currency="USD",
            original_price=primary_price_usd,
            price_range_min=price_range_min,
            price_range_max=price_range_max,
            moq=moq,
            moq_unit="pieces",
            shipping_methods=shipping_methods,
            total_price_inr=usd_to_inr(primary_price_usd * moq),
            estimated_delivery_days=estimated_delivery_days,
            sample_available=sample_available,
            sample_price_usd=sample_price_usd,
            sample_price_inr=usd_to_inr(sample_price_usd),
            rating=rating,
            review_count=review_count,
            response_rate=None,
            response_time=response_time or None,
            reorder_rate=reorder_rate or None,
            on_time_delivery_rate=on_time_delivery_rate or None,
            certifications=certifications,
            location=location,
            product_url=url,
            item_id=ld_sku or (url.split("/")[-1].split(".")[0] if url else "unknown"),
            store_id=store_id,
            match_score=max(0.0, 98.0 - (index * 0.5)),
            match_source="visual",
            product_properties=product_properties,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        # Guard: if the page returned no title AND no price AND no image, the page
        # was almost certainly still blocked (unusual traffic page has none of these).
        # Return None so the retry logic can re-attempt on a quiet tab.
        if not title and primary_price_usd == 0 and not primary_image:
            logger.warning(f"[{index}] Extracted empty product data (likely still CAPTCHA-blocked) — flagging for retry")
            if log_cb:
                await log_cb("search", f"[{index+1}] ⚠ Empty data — will retry")
            return None

        if log_cb:
            price_str = f"₹{usd_to_inr(primary_price_usd):,.0f}" if primary_price_usd else "no price"
            await log_cb("search", f"[{index+1}] ✓ {title[:50]}", {
                "supplier": supplier_name, "price": price_str,
                "country": country_code, "ranking": ranking_str or None,
            })
        return result

    except Exception as e:
        logger.warning(f"[{index}] Failed to extract product at {url}: {e}")
        if log_cb:
            await log_cb("search", f"[{index+1}] ✗ Failed: {str(e)[:80]}")
        return None


_stealth = Stealth(
    navigator_languages_override=("en-US", "en"),
    navigator_vendor_override="Google Inc.",
    navigator_user_agent_override=(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    webgl_vendor_override="Intel Inc.",
    webgl_renderer_override="Intel Iris OpenGL Engine",
    navigator_platform_override="MacIntel",
    sec_ch_ua_override='"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
)

_USD_COOKIES = [
    {"name": "intl_locale_currency_code", "value": "USD", "domain": ".alibaba.com", "path": "/"},
    {"name": "INTL_LOCALE_CURRENCY_CODE", "value": "USD", "domain": ".alibaba.com", "path": "/"},
]

_LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-infobars",
    "--window-position=0,0",
    "--window-size=1280,800",
]


async def _make_browser_context(p):
    """
    Launch Chromium and create a stealth context.
    Reuses a saved session file if it exists so Alibaba sees a returning user.
    """
    # Use real system Chrome if available — Alibaba detects Playwright's bundled Chromium.
    _CHROME_PATHS = [
        # Windows
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        # macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    _chrome_exe = next((p for p in _CHROME_PATHS if os.path.exists(p)), None)
    browser = await p.chromium.launch(
        headless=True,
        executable_path=_chrome_exe,
        args=_LAUNCH_ARGS,
    )

    storage_state = _SESSION_FILE if _is_session_valid() else None
    if storage_state:
        logger.info("Reusing valid Alibaba session from disk.")
    else:
        logger.info("No valid session found — starting fresh browser session.")

    # Detect OS for user-agent and viewport
    _is_windows = os.name == "nt"
    _ua = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ) if _is_windows else (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )
    _viewport = {"width": 1920, "height": 1080} if _is_windows else {"width": 1280, "height": 800}

    context = await browser.new_context(
        user_agent=_ua,
        viewport=_viewport,
        locale="en-US",
        timezone_id="Asia/Kolkata",
        color_scheme="light",
        storage_state=storage_state,
    )

    # Apply playwright-stealth evasions to every page in this context
    await _stealth.apply_stealth_async(context)

    # Set USD currency cookies
    await context.add_cookies(_USD_COOKIES)

    return browser, context


async def _save_session(context):
    """Persist cookies/localStorage so the next run looks like a returning session."""
    try:
        await context.storage_state(path=_SESSION_FILE)
        logger.info(f"Session saved → {_SESSION_FILE}")
    except Exception as e:
        logger.warning(f"Could not save session: {e}")


async def _solve_slider_captcha(page) -> bool:
    """
    Detect and solve Alibaba / Geetest / nc-webid slider CAPTCHAs using
    realistic human-like mouse movement with slight arc and jitter.
    Returns True if a slider was found and slid.
    """
    # The CAPTCHA slider is INSIDE an iframe (insights.alibaba.com punish endpoint).
    # We must find the right frame and run selectors inside it.
    # page.mouse coordinates are in the main page coordinate space, which
    # correctly maps to iframe content when the browser renders it.

    slider_selectors = [
        # Alibaba nc-webid (most common — rendered inside the baxia iframe)
        "#nc_1_n1z",
        ".btn_slide",
        "[id*='nc_1_n1z']",
        "[id*='nc_'] .btn_slide",
        "[class*='nc-lang-cnt'] .btn_slide",
        "[class*='nc-lang-cnt'] button",
        # Geetest v3/v4
        ".geetest_slider_button",
        ".geetest_drag_thumb",
        # secsdk
        ".secsdk-captcha-drag-icon",
        ".secsdk_captcha_drag-icon",
        "[class*='secsdk'] [class*='drag']",
        # Generic slider patterns
        "[class*='slider-btn']",
        "[class*='slider_btn']",
        "[class*='drag-thumb']",
        "[class*='slide-btn']",
        "[class*='drag-btn']",
    ]

    track_selectors = [
        "#nc_1_n1t",
        ".nc-lang-cnt",
        "[class*='nc-lang-cnt']",
        ".geetest_track",
        ".geetest_slider_track",
        "[class*='slider-track']",
        "[class*='drag-track']",
    ]

    # Collect all frames to check — main page + all iframes
    frames_to_check = [page.main_frame] + list(page.frames)
    # Deduplicate while preserving order
    seen_frame_urls: set[str] = set()
    unique_frames = []
    for f in frames_to_check:
        key = f.url
        if key not in seen_frame_urls:
            seen_frame_urls.add(key)
            unique_frames.append(f)

    logger.info(f"Checking {len(unique_frames)} frames for slider: {[f.url[:60] for f in unique_frames]}")

    for frame in unique_frames:
        for sel in slider_selectors:
            try:
                btn = frame.locator(sel).first
                if await btn.count() == 0:
                    continue

                box = await btn.bounding_box()
                if not box or box["width"] < 5:
                    continue

                logger.info(f"Slider found in frame {frame.url[:80]!r} → {sel} at {box}")

                # Debug: log the nc-webid wrapper state
                try:
                    nc_info = await frame.evaluate("""() => {
                        const w = document.querySelector('#nc_1_wrapper, [id*="nc_1"]');
                        if (!w) return null;
                        const r = w.getBoundingClientRect();
                        const btn = w.querySelector('#nc_1_n1z, .btn_slide');
                        const track = w.querySelector('#nc_1_n1t, .nc-lang-cnt');
                        return {
                            wrapperRect: {x:r.x,y:r.y,w:r.width,h:r.height},
                            btnRect: btn ? btn.getBoundingClientRect() : null,
                            trackRect: track ? track.getBoundingClientRect() : null,
                            scrollY: window.scrollY,
                            devicePixelRatio: window.devicePixelRatio,
                        };
                    }""")
                    if nc_info:
                        logger.info(f"nc-webid debug: {nc_info}")
                except Exception:
                    pass

                # Compute drag end position using JS inside the frame (most reliable).
                # We want: button left-edge ending at (track_right - btn_width).
                # Use getBoundingClientRect() inside frame → frame-local coords,
                # then add the iframe's page offset to get page coords.
                track_end_x = None
                try:
                    iframe_offset_x = box["x"] - (await frame.evaluate(
                        "() => { const b = document.querySelector('#nc_1_n1z, .btn_slide'); return b ? b.getBoundingClientRect().x : 0; }"
                    ))
                    track_info = await frame.evaluate("""() => {
                        const track = document.querySelector('#nc_1_n1t');
                        if (track) {
                            const r = track.getBoundingClientRect();
                            return {x: r.x, right: r.right, width: r.width};
                        }
                        const wrap = document.querySelector('#nc_1_wrapper, [id*="nc_1_wrapper"]');
                        if (wrap) {
                            const r = wrap.getBoundingClientRect();
                            return {x: r.x, right: r.right, width: r.width};
                        }
                        return null;
                    }""")
                    if track_info:
                        # track_info.right is frame-local; add iframe page offset for page coords
                        track_end_x = track_info["right"] + iframe_offset_x - box["width"]
                        logger.info(f"Track end_x: {track_end_x:.0f} (frame-local right={track_info['right']:.0f}, iframe_offset={iframe_offset_x:.0f})")
                except Exception as te:
                    logger.warning(f"Could not compute track_end_x via JS: {te}")

                if track_end_x is None:
                    # Fallback: use bounding_box of track selector
                    for tsel in track_selectors:
                        try:
                            t = frame.locator(tsel).first
                            if await t.count() > 0:
                                tbox = await t.bounding_box()
                                if tbox and tbox["width"] > 100:
                                    track_end_x = tbox["x"] + tbox["width"] - box["width"]
                                    logger.info(f"Track end_x fallback: {track_end_x:.0f}")
                                    break
                        except Exception:
                            continue
                if track_end_x is None:
                    track_end_x = box["x"] + 260  # last resort

                # Re-check slider is still there before we start dragging
                try:
                    if await frame.locator(sel).count() == 0:
                        logger.info("Slider gone before drag — CAPTCHA already solved.")
                        return True
                except Exception:
                    return True  # Frame gone = solved

                # Drag using page.mouse with exact page coordinates.
                # start: left edge of button + small grab offset
                # end: right edge of track minus button width (button fully at end)
                start_x = box["x"] + random.uniform(4, 10)
                start_y = box["y"] + box["height"] / 2 + random.uniform(-2, 2)
                end_x = track_end_x - random.uniform(1, 3)
                end_y = start_y + random.uniform(-1, 1)

                # Move naturally to near-left of button first, then onto it
                await page.mouse.move(
                    start_x - random.uniform(40, 80),
                    start_y + random.uniform(-15, 15),
                )
                await asyncio.sleep(random.uniform(0.2, 0.35))
                await page.mouse.move(start_x, start_y)
                await asyncio.sleep(random.uniform(0.1, 0.18))

                await page.mouse.down()
                await asyncio.sleep(random.uniform(0.08, 0.15))

                # Fast flick: 20 steps × 6ms = ~120ms, accelerating the whole way
                # Overshoot well past end_x so the button hits the wall
                overshoot_x = end_x + random.uniform(30, 50)
                steps = 20
                for i in range(steps):
                    t = (i + 1) / steps
                    eased = t * t  # ease-in: accelerate throughout
                    x = start_x + (overshoot_x - start_x) * eased + random.uniform(-0.3, 0.3)
                    y = start_y + random.uniform(-0.5, 0.5)
                    await page.mouse.move(x, y)
                    await asyncio.sleep(0.005 + random.uniform(0, 0.002))

                await page.mouse.up()

                logger.info(f"Drag complete: ({start_x:.0f},{start_y:.0f}) → ({end_x:.0f},{end_y:.0f})")

                # Brief pause for server to start processing trajectory
                await asyncio.sleep(0.5)

                # Check if slider is gone — that's the real success signal.
                # We return True to let the outer _check_and_handle_captcha
                # poll for the dialog dismissal (it has up to 5s to clear).
                try:
                    still_present = await frame.locator(sel).count()
                    if still_present == 0:
                        logger.info("Slider gone — CAPTCHA solved.")
                        return True
                except Exception as check_err:
                    err_msg = str(check_err).lower()
                    if "detached" in err_msg or "closed" in err_msg:
                        logger.info("Frame detached after drag — CAPTCHA solved (iframe dismissed).")
                        return True
                    logger.warning(f"Post-drag check error: {check_err}")

                # Drag was attempted — let outer loop re-verify with timeout
                return True

            except Exception as e:
                err_msg = str(e).lower()
                if "detached" in err_msg or "closed" in err_msg:
                    logger.info(f"Frame detached during drag — CAPTCHA likely solved.")
                    return True
                logger.warning(f"Slider solve failed for {sel} in {frame.url[:60]}: {e}")
                continue

    logger.warning("No slider button found in any frame.")
    return False


async def _check_and_handle_captcha(page, context="page") -> bool:
    """
    Check for any CAPTCHA or 'unusual traffic' page and attempt to handle it.
    Handles both inline dialog CAPTCHAs and full-page security challenges.
    Returns True if the page is clean / was resolved.
    """
    await asyncio.sleep(0.3)

    # ── Full-page CAPTCHA check ────────────────────────────────────────────────
    # Alibaba's full-page security page has a distinct URL pattern and almost no
    # other content — just a slider on a near-empty page.
    try:
        current_url = page.url
        if any(s in current_url for s in ("baxia.alibaba.com", "sec.alibaba.com", "passport.alibaba.com/security")):
            logger.warning(f"Full-page CAPTCHA detected via URL ({context}): {current_url}")
            # Try the slider — retry up to 3 times on full-page CAPTCHAs
            for attempt in range(3):
                solved = await _solve_slider_captcha(page)
                if solved:
                    await asyncio.sleep(2.5)
                    # If the URL changed away from the security page, we're through
                    if not any(s in page.url for s in ("baxia", "sec.alibaba", "passport.alibaba.com/security")):
                        logger.info("Full-page CAPTCHA resolved — back on Alibaba.")
                        return True
                    logger.warning(f"Still on CAPTCHA page after attempt {attempt+1}, retrying...")
                    await asyncio.sleep(random.uniform(1.5, 3.0))
            logger.error("Could not solve full-page CAPTCHA after 3 attempts.")
            return False
    except Exception:
        pass

    # ── Inline / dialog CAPTCHA check ─────────────────────────────────────────
    unusual_selectors = [
        "body:has-text('unusual traffic')",
        "body:has-text('verify you are human')",
        "body:has-text('security check')",
        "body:has-text('Please slide')",
        "body:has-text('Slide to verify')",
        ".geetest_panel",
        "#nc_1_wrapper",
        "[class*='nc-lang-cnt']",
        ".baxia-dialog",
        "[class*='captcha']",
        "[id*='captcha']",
    ]

    for sel in unusual_selectors:
        try:
            if await page.locator(sel).count() == 0:
                continue

            logger.info(f"Inline CAPTCHA detected ({context}): {sel}")

            # Wait for the CAPTCHA slider to render
            await asyncio.sleep(1.5)

            # Try up to 2 times — if the drag is correct it should work on first try
            for attempt in range(2):
                solved = await _solve_slider_captcha(page)
                if not solved:
                    # No slider found yet — wait briefly and check if CAPTCHA disappeared anyway
                    logger.warning(f"No slider found on attempt {attempt + 1} — re-checking...")
                    await asyncio.sleep(1.5)

                # After drag (or if no slider), wait up to 5s for the dialog to dismiss.
                # The outer .baxia-dialog container stays in the DOM for a moment while the
                # page processes the CAPTCHA validation and navigates/reloads.
                dismissed = False
                for _ in range(10):
                    await asyncio.sleep(0.5)
                    try:
                        still_there = await page.locator(sel).count()
                    except Exception:
                        still_there = 0  # page navigated away = solved
                    if still_there == 0:
                        dismissed = True
                        break

                if dismissed:
                    logger.info(f"Inline CAPTCHA resolved on attempt {attempt + 1}.")
                    return True

                logger.warning(f"Inline CAPTCHA still present after attempt {attempt + 1}, retrying...")
                await asyncio.sleep(random.uniform(1.0, 1.5))

            logger.warning(f"Could not solve inline CAPTCHA after 2 attempts ({sel}) — proceeding anyway.")
            return False
        except Exception:
            continue

    return True  # No CAPTCHA found — page is clean


async def search_alibaba_with_playwright(image_path: str, job_id: str, log_cb=None) -> list[SupplierResult]:
    """
    Search Alibaba by image (Lens search) and extract supplier data.

    Anti-detection approach:
      - Stealth JS injected via add_init_script (before any page scripts run)
      - Realistic Chrome user-agent with proper window size
      - Human-like mouse movement for slider CAPTCHAs
      - USD currency set via cookie + URL param + JSON-LD fallback
    """
    logger.info(f"Starting Playwright Alibaba Lens automation for image: {image_path}")
    results = []

    async with async_playwright() as p:
        browser, context = await _make_browser_context(p)
        page = await context.new_page()

        try:
            # ── Navigate to Alibaba ───────────────────────────────────────────
            # Block only third-party tracking/ad requests — NOT Alibaba's own assets
            # (blocking alibaba images breaks the CAPTCHA and lens upload UI)
            _BLOCKED_DOMAINS = (
                "google-analytics.com", "googletagmanager.com", "doubleclick.net",
                "criteo.com", "facebook.com", "twitter.com", "linkedin.com",
                "hotjar.com", "segment.io", "amplitude.com", "mixpanel.com",
            )
            async def _block_trackers(route):
                url = route.request.url
                if any(d in url for d in _BLOCKED_DOMAINS):
                    await route.abort()
                else:
                    await route.continue_()
            await page.route("**/*", _block_trackers)
            logger.info("Navigating to Alibaba.com...")
            await page.goto(
                "https://www.alibaba.com/",
                timeout=45000,
                wait_until="domcontentloaded"
            )

            # Dismiss popups instantly via JS, then handle CAPTCHA once
            try:
                await page.evaluate("""() => {
                    ['icbu-marketing-popup-container','icbu-marketing-pc-first-order-popup']
                        .forEach(id => { const el = document.getElementById(id); if(el) el.remove(); });
                }""")
            except Exception:
                pass
            await page.keyboard.press("Escape")

            # Single CAPTCHA check — retry up to 3 times if needed
            for _hp_attempt in range(3):
                clean = await _check_and_handle_captcha(page, f"homepage-{_hp_attempt}")
                if clean:
                    break
                await asyncio.sleep(1.5)
            else:
                logger.error("Homepage CAPTCHA could not be resolved — aborting.")
                return results

            # ── Upload image via Alibaba Lens ─────────────────────────────────
            camera_selectors = [
                # Exact Alibaba selector (confirmed working)
                "#header_root > div.header-and-searchbar.products > "
                "div.content-container > div > div > div > "
                "div.theme-wrapper.pro-theme.multi-line-enabled > div > "
                "div.fullscreen-tab-action-full-screen > "
                "div.fullscreen-tab-action-full-screen-left > div > div > div",
                "[class*='camera-icon']",
                "[class*='image-search-btn']",
                "button[aria-label*='image']",
                "button[aria-label*='camera']",
                "[class*='image-upload'] button",
            ]
            upload_selectors = [
                "#header_root > div.header-and-searchbar.products > "
                "div.content-container > div > div > div > "
                "div.theme-wrapper.pro-theme.multi-line-enabled > div > "
                "div.home-search-panel > div > div > div > div > "
                "div.image-upload-body > div > div > span.iup-upload-btn",
                "[class*='upload-btn']",
                "[class*='uploadBtn']",
                "span[class*='upload']",
                "[class*='image-upload-body'] span",
            ]

            upload_done = False
            for cam_sel in camera_selectors:
                try:
                    loc = page.locator(cam_sel).first
                    if await loc.count() == 0:
                        continue
                    # Human-like: move to camera button before clicking
                    box = await loc.bounding_box()
                    if box:
                        await page.mouse.move(
                            box["x"] + box["width"] / 2 + random.uniform(-3, 3),
                            box["y"] + box["height"] / 2 + random.uniform(-2, 2),
                        )
                        await asyncio.sleep(random.uniform(0.1, 0.3))
                    await loc.click(timeout=8000)
                    await asyncio.sleep(random.uniform(0.8, 1.4))

                    # Solve CAPTCHA if it appeared after clicking camera.
                    await _check_and_handle_captcha(page, "post-camera-click")

                    # After CAPTCHA the panel may have closed — re-click camera to reopen it
                    panel_open = False
                    for up_sel in upload_selectors:
                        try:
                            if await page.locator(up_sel).first.count() > 0:
                                panel_open = True
                                break
                        except Exception:
                            pass
                    if not panel_open:
                        logger.info("Image panel closed after CAPTCHA — re-clicking camera button")
                        try:
                            await loc.click(timeout=8000)
                            await asyncio.sleep(1.0)
                        except Exception:
                            pass

                    for up_sel in upload_selectors:
                        try:
                            up_loc = page.locator(up_sel).first
                            if await up_loc.count() == 0:
                                continue
                            async with page.expect_file_chooser() as fc_info:
                                await up_loc.click(timeout=8000)
                            fc = await fc_info.value
                            await fc.set_files(image_path)
                            logger.info("Image uploaded via file chooser.")
                            upload_done = True
                            break
                        except Exception:
                            continue
                    if upload_done:
                        break
                except Exception:
                    continue

            if not upload_done:
                logger.warning("Trying direct file input injection.")
                try:
                    await page.locator('input[type="file"]').first.set_input_files(image_path)
                    upload_done = True
                except Exception as e:
                    logger.error(f"Direct file input also failed: {e}")

            # ── Wait for search results ───────────────────────────────────────
            await page.wait_for_load_state("domcontentloaded", timeout=60000)

            # Check for CAPTCHA after image upload triggers a navigation
            await _check_and_handle_captcha(page, "after-upload")

            result_sel = (
                ".seb-item, .seb-layout-search-item, .result-item, "
                ".element-item, .product-item, .m-gallery-product-item-v2, "
                ".m-gallery-product-item-wrap, .J-img-search-item, "
                ".gallery-card, div[data-content='productItem'], "
                "[class*='search-item'], [class*='product-card']"
            )
            try:
                await page.wait_for_selector(result_sel, timeout=20000)
            except Exception:
                logger.warning("Result grid timeout — collecting any visible links.")

            # Check for CAPTCHA after results page loads
            await _check_and_handle_captcha(page, "results-page")

            try:
                items = await page.locator(result_sel).all()
            except Exception as e:
                logger.error(f"Page closed before collecting results: {e}")
                items = []
            logger.info(f"Found {len(items)} result items.")

            # ── Collect product URLs (up to 20) ──────────────────────────────
            urls: list[str] = []
            seen_urls: set[str] = set()

            def _add_url(href: str) -> bool:
                if not href:
                    return False
                full = "https:" + href if href.startswith("//") else href
                # Deduplicate by stripping query string for comparison
                key = full.split("?")[0]
                if key in seen_urls or "alibaba.com" not in full:
                    return False
                seen_urls.add(key)
                urls.append(full)
                return True

            for item in items[:40]:
                if len(urls) >= 20:
                    break
                try:
                    href = await item.locator("a").first.get_attribute("href")
                    _add_url(href or "")
                except Exception:
                    pass

            # Fallback: scan all product-detail / offer-detail links
            if len(urls) < 10:
                try:
                    all_links = await page.locator(
                        "a[href*='/product-detail/'], a[href*='/offer-detail/']"
                    ).all()
                    for link in all_links[:40]:
                        if len(urls) >= 20:
                            break
                        href = await link.get_attribute("href") or ""
                        _add_url(href)
                except Exception:
                    pass

            # Cap at 20 products
            urls = urls[:20]
            logger.info(f"Processing {len(urls)} product pages in parallel...")
            if log_cb:
                await log_cb("search", f"Found {len(urls)} product listings — scraping pages in parallel")

            # ── Parallel extraction using multiple browser tabs ────────────────
            # Reduced to 2 tabs to avoid triggering Alibaba's mass-scraping CAPTCHAs.
            # This makes the search more stable and less likely to get blocked.
            CONCURRENCY = 2

            async def _scrape_tab(idx: int, product_url: str) -> SupplierResult | None:
                tab = await context.new_page()
                try:
                    return await _extract_product_data(tab, product_url, idx, job_id, log_cb)
                except Exception as e:
                    logger.warning(f"[{idx}] Tab scrape error: {e}")
                    return None
                finally:
                    try:
                        await tab.close()
                    except Exception:
                        pass

            sem = asyncio.Semaphore(CONCURRENCY)

            async def _bounded_tab(idx: int, product_url: str) -> SupplierResult | None:
                async with sem:
                    return await _scrape_tab(idx, product_url)

            raw_results = await asyncio.gather(
                *[_bounded_tab(i, u) for i, u in enumerate(urls)],
                return_exceptions=True,
            )

            # Collect successes and track which indices failed (None or exception)
            failed_items: list[tuple[int, str]] = []
            for i, r in enumerate(raw_results):
                if isinstance(r, SupplierResult):
                    results.append(r)
                else:
                    failed_items.append((i, urls[i]))

            # ── Retry failed products sequentially ────────────────────────────
            # The "unusual traffic" CAPTCHA fires when many tabs hit Alibaba at once.
            # Retrying one-at-a-time after a short cooldown resolves it for most cases.
            if failed_items:
                logger.info(f"{len(failed_items)} products failed first pass — retrying sequentially after cooldown...")
                if log_cb:
                    await log_cb("search", f"⟳ Retrying {len(failed_items)} blocked products one-by-one...")
                await asyncio.sleep(4)  # brief cooldown before retry burst

                for idx, product_url in failed_items:
                    tab = await context.new_page()
                    try:
                        retry_result = await _extract_product_data(tab, product_url, idx, job_id, log_cb)
                        if isinstance(retry_result, SupplierResult):
                            results.append(retry_result)
                            logger.info(f"[{idx}] Retry succeeded: {retry_result.product_name[:50]}")
                        else:
                            logger.warning(f"[{idx}] Retry also failed for {product_url}")
                    except Exception as e:
                        logger.warning(f"[{idx}] Retry exception: {e}")
                    finally:
                        try:
                            await tab.close()
                        except Exception:
                            pass
                    # Small delay between sequential retries to avoid triggering rate-limiting again
                    await asyncio.sleep(2)

            logger.info(f"Successfully extracted {len(results)} products.")
            await _save_session(context)

        except Exception as e:
            logger.error(f"Playwright automation failed: {e}")
        finally:
            await browser.close()

    return results


async def scrape_product_url(product_url: str, job_id: str) -> list[SupplierResult]:
    """
    Directly scrape a single Alibaba product URL — no image search needed.
    Used when the pipeline receives a direct product link from the CSV.
    """
    logger.info(f"Direct product scrape: {product_url}")
    results = []

    async with async_playwright() as p:
        browser, context = await _make_browser_context(p)
        page = await context.new_page()
        try:
            result = await _extract_product_data(page, product_url, 0, job_id)
            if result:
                results.append(result)
                logger.info(f"Successfully scraped product: {result.product_name}")
            else:
                logger.warning(f"No data extracted from {product_url}")

            # Check for CAPTCHA after page load
            await _check_and_handle_captcha(page, "direct-product")
            await _save_session(context)

        except Exception as e:
            logger.error(f"Direct product scrape failed: {e}")
        finally:
            await browser.close()

    return results
