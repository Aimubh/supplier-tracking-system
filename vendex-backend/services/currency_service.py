import httpx
import time
from typing import Tuple
from utils.logger import get_logger

logger = get_logger(__name__)

_cache = {} 
TTL = 3600

async def convert_to_inr(amount: float, from_currency: str) -> Tuple[float, float]:
    from_currency = from_currency.upper()
    if from_currency == "INR":
        return amount, 1.0
        
    cache_key = f"{from_currency}_INR"
    now = time.time()
    
    if cache_key in _cache:
        rate, expires_at = _cache[cache_key]
        if now < expires_at:
            return round(amount * rate, 2), rate
            
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"https://api.frankfurter.dev/v1/latest?base={from_currency}&symbols=INR")
            if resp.status_code == 200:
                data = resp.json()
                rate = data["rates"]["INR"]
                _cache[cache_key] = (rate, now + TTL)
                return round(amount * rate, 2), rate
            else:
                logger.warning(f"Frankfurter API error for {from_currency}: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failed to fetch exchange rate for {from_currency}: {str(e)}")
        
    fallbacks = {"USD": 83.5, "CNY": 11.5, "EUR": 90.0, "GBP": 105.0, "AED": 22.7}
    fallback_rate = fallbacks.get(from_currency, 83.5)
    return round(amount * fallback_rate, 2), fallback_rate

async def estimate_shipping_cost_inr(
    origin_country_code: str,
    shipping_method: str = "Standard",
    weight_kg: float = 0.5
) -> Tuple[float, int]:
    
    code = origin_country_code.upper()
    method = shipping_method.lower() if shipping_method else "standard"
    
    rates = {
        "CN": {"express": (1200, 8), "standard": (400, 18), "economy": (150, 35)},
        "IN": {"express": (200, 2), "standard": (100, 5), "economy": (50, 8)},
        "US": {"express": (3500, 10), "standard": (1800, 22), "economy": (900, 40)},
        "EU": {"express": (2800, 12), "standard": (1400, 25), "economy": (700, 42)},
        "DEFAULT": {"express": (2000, 20), "standard": (1000, 35), "economy": (500, 50)}
    }
    
    country_rates = rates.get(code, rates["DEFAULT"])
    
    if "express" in method:
        rate_key = "express"
    elif "economy" in method or "sea" in method:
        rate_key = "economy"
    else:
        rate_key = "standard"
        
    cost, days = country_rates[rate_key]
    return float(cost), days
