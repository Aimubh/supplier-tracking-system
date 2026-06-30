from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import httpx

def auto_retry(max_attempts=3):
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.TimeoutException)),
        reraise=True
    )
