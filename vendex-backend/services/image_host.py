import os
import httpx
import base64
from utils.logger import get_logger

logger = get_logger(__name__)

IMGBB_API_KEY = os.getenv("IMGBB_API_KEY")
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_UPLOAD_PRESET = os.getenv("CLOUDINARY_UPLOAD_PRESET", "reelsource")


async def _upload_to_cloudinary(image_data: bytes) -> str:
    """Upload to Cloudinary unsigned upload. Publicly accessible to all."""
    if not CLOUDINARY_CLOUD_NAME:
        return ""
    try:
        b64 = base64.b64encode(image_data).decode("utf-8")
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/image/upload",
                data={"file": f"data:image/jpeg;base64,{b64}", "upload_preset": CLOUDINARY_UPLOAD_PRESET},
                timeout=20.0,
            )
            if resp.status_code == 200:
                url = resp.json().get("secure_url", "")
                logger.info(f"Cloudinary upload OK: {url}")
                return url
            logger.warning(f"Cloudinary upload failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Cloudinary upload exception: {e}")
    return ""


async def _upload_to_catbox(image_path: str) -> str:
    """Upload to catbox.moe — no API key needed, globally accessible."""
    try:
        async with httpx.AsyncClient() as client:
            with open(image_path, "rb") as f:
                resp = await client.post(
                    "https://catbox.moe/user/api.php",
                    data={"reqtype": "fileupload"},
                    files={"fileToUpload": ("frame.jpg", f, "image/jpeg")},
                    timeout=30.0,
                )
            if resp.status_code == 200 and resp.text.startswith("https://"):
                url = resp.text.strip()
                logger.info(f"Catbox upload OK: {url}")
                return url
            logger.warning(f"Catbox upload failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Catbox upload exception: {e}")
    return ""


async def _upload_to_uguu(image_path: str) -> str:
    """Upload to uguu.se — no API key needed, ephemeral public files."""
    try:
        async with httpx.AsyncClient() as client:
            with open(image_path, "rb") as f:
                resp = await client.post(
                    "https://uguu.se/upload.php",
                    files={"files[]": ("frame.jpg", f, "image/jpeg")},
                    timeout=20.0,
                )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("success") and data.get("files"):
                    url = data["files"][0].get("url")
                    logger.info(f"Uguu upload OK: {url}")
                    return url
            logger.warning(f"Uguu upload failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Uguu upload exception: {e}")
    return ""


async def _upload_to_imgbb(b64: str) -> str:
    """Upload to imgbb — note: ImgBB blocks some external API access."""
    if not IMGBB_API_KEY:
        return ""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.imgbb.com/1/upload",
                data={"key": IMGBB_API_KEY, "image": b64},
                timeout=15.0,
            )
            if resp.status_code == 200:
                return resp.json()["data"]["url"]
            logger.warning(f"ImgBB upload failed: {resp.status_code}")
    except Exception as e:
        logger.error(f"ImgBB upload exception: {e}")
    return ""


async def upload_frame_to_public_url(frame_path: str) -> str:
    """
    Upload an extracted frame to a publicly accessible CDN.
    Tries Cloudinary → Catbox → Uguu → ImgBB in order.
    """
    if not os.path.exists(frame_path):
        return ""

    with open(frame_path, "rb") as f:
        image_data = f.read()

    # 1. Cloudinary (predefined/unsigned)
    url = await _upload_to_cloudinary(image_data)
    if url: return url

    # 2. Catbox.moe (Public, common)
    url = await _upload_to_catbox(frame_path)
    if url: return url

    # 3. Uguu.se (Public, ephemeral)
    url = await _upload_to_uguu(frame_path)
    if url: return url

    # 4. ImgBB (Fallback, often blocked by external scrapers)
    b64 = base64.b64encode(image_data).decode("utf-8")
    url = await _upload_to_imgbb(b64)
    if url: return url

    # Last resort (Alibaba search won't work with data URIs, but UI will show the image)
    logger.warning("All image hosts failed — falling back to base64")
    return f"data:image/jpeg;base64,{b64}"
