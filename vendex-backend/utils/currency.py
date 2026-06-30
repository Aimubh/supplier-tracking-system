"""
Live USD → INR conversion via forex-python.
Caches the rate for 1 hour to avoid hammering the API on every scrape.
Falls back to 84.0 if the live rate can't be fetched.
"""

import time
from utils.logger import get_logger

logger = get_logger(__name__)

_FALLBACK_RATE = 84.0
_cached_rate: float = _FALLBACK_RATE
_cache_ts: float = 0.0
_CACHE_TTL = 3600  # seconds


def get_usd_to_inr() -> float:
    """Return live USD→INR rate, refreshing at most once per hour."""
    global _cached_rate, _cache_ts
    now = time.time()
    if now - _cache_ts < _CACHE_TTL:
        return _cached_rate
    try:
        from forex_python.converter import CurrencyRates
        cr = CurrencyRates()
        rate = cr.get_rate("USD", "INR")
        if rate and rate > 0:
            _cached_rate = float(rate)
            _cache_ts = now
            logger.info(f"Live USD→INR rate fetched: {_cached_rate:.4f}")
    except Exception as e:
        logger.warning(f"Could not fetch live USD→INR rate ({e}), using cached {_cached_rate:.4f}")
        # Still update timestamp so we don't hammer the API on every call after a failure
        _cache_ts = now
    return _cached_rate


def usd_to_inr(amount_usd: float) -> float:
    """Convert a USD amount to INR using the live (cached) rate."""
    return round(amount_usd * get_usd_to_inr(), 2)


def inr_to_usd(amount_inr: float) -> float:
    """Convert an INR amount to USD using the live (cached) rate."""
    rate = get_usd_to_inr()
    return round(amount_inr / rate, 2) if rate else 0.0
