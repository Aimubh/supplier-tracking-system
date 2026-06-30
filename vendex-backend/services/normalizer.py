from datetime import datetime, timezone
from models.schemas import SupplierResult
from services.visual_search import VisualSearchResult
from typing import Optional, Any

def normalize_supplier_result(
    search_item: Any,
    sku_detail: Optional[Any],
    _package_detail: Optional[Any],
    visual_result: VisualSearchResult,
    inr_rate: float,
    shipping_cost_inr: float,
    delivery_days: Optional[int],
    job_id: str,
    item_detail: Optional[dict] = None
) -> SupplierResult:
    
    from utils.scoring import calculate_match_score
    from services.supplier_classifier import classify_supplier

    def _abs_url(u: str) -> str:
        # Alibaba returns protocol-relative URLs ("//www..."); make them absolute
        # so links and images work in the browser.
        u = (u or "").strip()
        if u.startswith("//"):
            return "https:" + u
        return u
    
    # Base info from search or sku
    company_name = getattr(sku_detail, 'company_name', getattr(search_item, 'supplier_name', 'Unknown'))
    business_type = getattr(sku_detail, 'business_type', 'Supplier')
    certs = getattr(sku_detail, 'certifications', [])
    categories = getattr(sku_detail, 'product_categories_count', 1)
    
    # Extract rich information from item_detail
    item = item_detail.get("item", {}) if item_detail else {}
    company = item_detail.get("company", {}) if item_detail else {}
    sku_def = item.get("sku", {}).get("def", {})
    
    if company.get("companyName"):
        company_name = company.get("companyName")
    if company.get("companyType"):
        business_type = company.get("companyType")

    supplier_type = classify_supplier(business_type, company_name, certs, categories)
    
    title = item.get("title", getattr(sku_detail, 'title', getattr(search_item, 'title', '')))
    
    # Extract MOQ
    moq = 1
    moq_unit = "pieces"
    q_mod = sku_def.get("quantityModule", {})
    if q_mod:
        moq = q_mod.get("minOrder", {}).get("quantity", 1)
        moq_unit = sku_def.get("unitModule", {}).get("single", "piece")
    else:
        moq = getattr(sku_detail, 'moq', getattr(search_item, 'moq', 1))

    verified = q_mod.get("verified", getattr(sku_detail, 'verified', False))
    gold = getattr(sku_detail, 'gold_supplier', False)
    trade_assurance = getattr(sku_detail, 'trade_assurance', False)
    years = getattr(sku_detail, 'years_on_platform', None)  # None = not provided by API

    # Extract Properties Early to find Country
    props = {}
    pli = item.get("properties", {}).get("list", [])
    for p in pli:
        name = p.get("name", "").replace(":", "").strip()
        if name: props[name] = p.get("value")
    
    sku_props = item.get("sku", {}).get("props", [])
    for sp in sku_props:
        name = sp.get("name", "").strip()
        values = [v.get("name") for v in sp.get("values", [])]
        if name and values:
            props[name] = ", ".join(values)

    # CORRECT COUNTRY DETECTION
    # The 'settings.country' is where the user is searching FROM (often US).
    # We need the seller's HOME country.
    origin = props.get("Place of Origin", "").lower()
    company_name_lower = company_name.lower()
    
    # Common Chinese industrial hubs often in the company name
    china_hubs = [
        "zhejiang", "guangdong", "fujian", "jiangsu", "dongguan", "shenzhen", 
        "shaoxing", "ningbo", "hangzhou", "guangzhou", "quanzhou", "yantai",
        "qingdao", "shihai", "foshan", "shamen", "tianjin", "shanghai", "yiwu"
    ]
    
    is_china = "china" in origin or any(hub in origin for hub in china_hubs) or \
               "china" in company_name_lower or any(hub in company_name_lower for hub in china_hubs)

    if is_china:
        country_code = "CN"
        country_name = "China"
    elif "india" in origin or "india" in company_name_lower:
        country_code = "IN"
        country_name = "India"
    elif "vietnam" in origin or "vietnam" in company_name_lower:
        country_code = "VN"
        country_name = "Vietnam"
    else:
        # Fallback to search_item country (empty if none provided by API)
        country_name = getattr(search_item, 'country', '')
        country_code = "CN" if country_name == "China" else ""

    # Extract rating from search item (averageStarRate field from image search results)
    rating = 0.0
    raw_rating = getattr(search_item, 'rating', None)
    if raw_rating is not None:
        try:
            rating = float(raw_rating)
        except (ValueError, TypeError):
            rating = 0.0

    # Extract Pricing
    price_min = 0.0
    price_max = 0.0
    price_mod = sku_def.get("priceModule", {})
    if price_mod:
        # First try structured priceList
        p_list = price_mod.get("priceList", [])
        if p_list:
            prices = [p.get("price", 0) for p in p_list if p.get("price") is not None]
            if prices:
                price_min = float(min(prices))
                price_max = float(max(prices))
        # Fall back to parsing priceFormatted string e.g. "$1.99-2.30" or "$11.90"
        if price_min == 0:
            price_str = price_mod.get("priceFormatted", "")
            price_str_clean = price_str.replace("$", "").replace(",", "").strip()
            if price_str_clean:
                if "-" in price_str_clean:
                    parts = price_str_clean.split("-")
                    try:
                        price_min = float(parts[0].strip())
                        price_max = float(parts[1].strip())
                    except (ValueError, IndexError):
                        pass
                else:
                    try:
                        price_min = price_max = float(price_str_clean)
                    except ValueError:
                        pass
    # Final fallback to search_item parsed values
    if price_min == 0:
        price_min = float(getattr(search_item, 'price_min', 0) or 0)
        price_max = float(getattr(search_item, 'price_max', price_min) or price_min)

    currency = price_mod.get("currencyCode", getattr(sku_detail, 'currency', getattr(search_item, 'currency', 'USD')))
    if currency == "$": currency = "USD"

    price_inr = price_min * inr_rate
    # DataHub quotes in USD; expose the USD figure too so the FOB ($/piece) field
    # downstream can fill. If the source currency is USD, price_min IS the USD price.
    price_usd = price_min if currency == "USD" else (price_inr / inr_rate if inr_rate else 0.0)

    # Match Score
    filled_fields = 10
    if sku_detail: filled_fields += 5
    if item_detail: filled_fields += 15
    
    match_score = calculate_match_score(
        visual_result.keywords, title,
        verified, gold, trade_assurance, years,
        visual_result.confidence, filled_fields, 30
    )

    return SupplierResult(
        id=f"sup_{item.get('itemId', getattr(search_item, 'item_id', 'mock'))}",
        job_id=job_id,
        product_name=title,
        product_description=item.get("description", {}).get("html", ""),
        product_image_url=_abs_url(item.get("images", [getattr(search_item, 'image_url', '')])[0]),
        supplier_name=company_name,
        supplier_type=supplier_type,
        company_name=company_name,
        country=country_name,
        country_code=country_code,
        verified=verified,
        gold_supplier=gold,
        trade_assurance=trade_assurance,
        years_on_platform=years,
        unit_price_usd=price_usd,
        unit_price_inr=price_inr,
        original_currency=currency,
        original_price=price_min,
        price_range_min=price_min,
        price_range_max=price_max,
        moq=int(moq) if str(moq).isdigit() else 1,
        moq_unit=moq_unit,
        total_price_inr=(price_inr * moq) + shipping_cost_inr,
        estimated_shipping_cost_inr=shipping_cost_inr,
        estimated_delivery_days=delivery_days,
        rating=rating,
        product_url=_abs_url(item.get("itemUrl", getattr(search_item, 'product_url', ''))),
        item_id=str(item.get("itemId", getattr(search_item, 'item_id', ''))),
        match_score=match_score,
        match_source="visual",
        created_at=datetime.now(timezone.utc).isoformat(),
        product_properties=props,
        raw_api_response=item_detail
    )
