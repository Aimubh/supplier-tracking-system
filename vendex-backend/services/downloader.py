import os
import yt_dlp
import asyncio
import logging
import shutil
from typing import Dict, Any
from models.schemas import Platform
from utils.exceptions import DownloadError, LoginRequiredError
from utils.logger import get_logger

logger = get_logger(__name__)
logging.basicConfig(level=logging.DEBUG)

DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "./downloads")
INSTAGRAM_COOKIES_FILE = os.getenv("INSTAGRAM_COOKIES_FILE", "./instagram_cookies.txt")
COOKIES_FROM_BROWSER = os.getenv("COOKIES_FROM_BROWSER", "chrome")

# ── Locate FFmpeg ─────────────────────────────────────────────────────────────
# Resolved on FIRST USE, not at import. Only video/reel downloads need FFmpeg,
# but this module is imported by routers/process.py, so raising here took the
# whole service down — including the Alibaba/URL sourcing paths that never touch
# a video. Now a missing FFmpeg fails just the download that needs it.
#
# 1. Prefer the FFMPEG_LOCATION env var (set by start-windows.bat)
# 2. Fall back to shutil.which (PATH search)
FFMPEG_LOCATION = os.getenv("FFMPEG_LOCATION", "").strip()
_ffmpeg_path: str | None = None


def get_ffmpeg_path() -> str:
    """Absolute path to ffmpeg. Raises DownloadError if it isn't installed."""
    global _ffmpeg_path, FFMPEG_LOCATION
    if _ffmpeg_path:
        return _ffmpeg_path

    location = FFMPEG_LOCATION
    if location and os.path.isdir(location):
        path = os.path.join(location, "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
        if not os.path.isfile(path):
            raise DownloadError(
                f"FFmpeg not found at {path}. Video links need FFmpeg — install it "
                "or correct FFMPEG_LOCATION in vendex-backend/.env."
            )
    else:
        found = shutil.which("ffmpeg")
        if not found:
            raise DownloadError(
                "FFmpeg is not installed. Video/reel links need it; product URLs "
                "do not. Install it (winget install Gyan.FFmpeg) or set "
                "FFMPEG_LOCATION in vendex-backend/.env."
            )
        path = found
        location = os.path.dirname(found)

    # Absolute paths, and put the ffmpeg dir on PATH for subprocess calls.
    _ffmpeg_path = os.path.abspath(path)
    FFMPEG_LOCATION = os.path.abspath(location)
    os.environ["PATH"] = FFMPEG_LOCATION + os.pathsep + os.environ.get("PATH", "")
    logger.info(f"Using FFmpeg from: {_ffmpeg_path}")
    return _ffmpeg_path


def detect_platform(url: str) -> Platform:
    url_lower = url.lower()
    if 'instagram.com' in url_lower:
        return Platform.INSTAGRAM
    elif 'tiktok.com' in url_lower or 'vm.tiktok.com' in url_lower:
        return Platform.TIKTOK
    elif 'youtube.com' in url_lower or 'youtu.be' in url_lower:
        return Platform.YOUTUBE
    elif 'facebook.com' in url_lower or 'fb.watch' in url_lower:
        return Platform.FACEBOOK
    return Platform.OTHER


def _download_sync(url: str, job_id: str) -> Dict[str, Any]:
    output_path = f"{DOWNLOAD_DIR}/{job_id}/video.%(ext)s"
    os.makedirs(f"{DOWNLOAD_DIR}/{job_id}", exist_ok=True)

    ydl_opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': output_path,
        'socket_timeout': 30,
        'retries': 5,
        'quiet': False,
        'no_warnings': False,
        'verbose': True,
        'nocheckcertificate': True,
        'concurrent_fragment_downloads': 5,
        'ffmpeg_location': get_ffmpeg_path(),
        'progress_hooks': [lambda d: logger.info(d)],
    }

    platform = detect_platform(url)
    logger.info(f"[Job {job_id}] Platform detected: {platform.value}")

    if platform in (Platform.INSTAGRAM, Platform.TIKTOK, Platform.FACEBOOK):
        if INSTAGRAM_COOKIES_FILE and os.path.exists(INSTAGRAM_COOKIES_FILE):
            logger.info(f"[Job {job_id}] Using cookie file: {INSTAGRAM_COOKIES_FILE}")
            ydl_opts['cookiefile'] = INSTAGRAM_COOKIES_FILE
        else:
            logger.info(f"[Job {job_id}] No cookie file, trying browser: {COOKIES_FROM_BROWSER}")
            ydl_opts['cookiesfrombrowser'] = (COOKIES_FROM_BROWSER,)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            logger.info(f"[Job {job_id}] Starting yt-dlp extraction...")
            info = ydl.extract_info(url, download=True)
            video_path = ydl.prepare_filename(info)

            return {
                "video_path": video_path,
                "platform": platform,
                "title": info.get('title', 'Unknown'),
                "duration": info.get('duration', 0),
                "thumbnail_url": info.get('thumbnail', '')
            }
    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e).lower()
        logger.error(f"[Job {job_id}] Download failed: {str(e)}")
        if 'login' in error_msg or 'cookie' in error_msg or 'sign in' in error_msg or 'rate-limit' in error_msg or 'not available' in error_msg:
            raise LoginRequiredError(
                "Instagram requires authentication. "
                "Export your cookies by running: "
                "yt-dlp --cookies-from-browser chrome --cookies ./instagram_cookies.txt 'https://www.instagram.com' "
                "then set INSTAGRAM_COOKIES_FILE=./instagram_cookies.txt in backend/.env"
            )
        raise DownloadError(f"Failed to download video: {str(e)}")
    except Exception as e:
        logger.error(f"[Job {job_id}] Unexpected download error: {str(e)}")
        raise DownloadError(f"Unexpected error during download: {str(e)}")


async def download(url: str, job_id: str) -> Dict[str, Any]:
    return await asyncio.to_thread(_download_sync, url, job_id)
