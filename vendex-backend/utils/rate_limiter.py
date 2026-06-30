from asyncio_throttle import Throttler
import os
from dotenv import load_dotenv

load_dotenv()

ALIBABA_RATE_LIMIT = int(os.getenv("RATE_LIMIT_ALIBABA_PER_MIN", "25"))
SERPAPI_RATE_LIMIT = int(os.getenv("RATE_LIMIT_SERPAPI_PER_MIN", "5"))

alibaba_throttler = Throttler(rate_limit=ALIBABA_RATE_LIMIT, period=60.0)
serpapi_throttler = Throttler(rate_limit=SERPAPI_RATE_LIMIT, period=60.0)
