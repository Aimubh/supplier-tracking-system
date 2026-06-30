import os
import base64
import json
import cv2
import numpy as np
import asyncio
import httpx
from typing import List
from models.schemas import BaseModel
from utils.logger import get_logger

logger = get_logger(__name__)

FRAME_OUTPUT_DIR = os.getenv("FRAME_OUTPUT_DIR", "./frames")
_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# How many CV2-scored candidate frames we send to Gemini for validation.
# More candidates = better chance of finding a clean product shot,
# but each extra image adds ~10KB to the Gemini request.
_CANDIDATE_COUNT = 4


class FrameResult(BaseModel):
    path: str
    score: float
    frame_index: int
    timestamp_seconds: float


# ── CV2 scoring (unchanged) ───────────────────────────────────────────────────

def _score_frame(frame: np.ndarray) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    laplacian_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    sharpness = min(laplacian_score / 500.0, 1.0)

    mean_brightness = gray.mean()
    brightness = 1.0 - abs(mean_brightness - 135) / 135.0
    brightness = max(0.0, brightness)

    h, w = frame.shape[:2]
    center = frame[h // 4:3 * h // 4, w // 4:3 * w // 4]
    center_contrast = cv2.Laplacian(
        cv2.cvtColor(center, cv2.COLOR_BGR2GRAY), cv2.CV_64F
    ).var()
    center_score = min(center_contrast / 300.0, 1.0)

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1].mean() / 255.0

    top_region = gray[:int(h * 0.15), :]
    edge_density = cv2.Canny(top_region, 100, 200).mean() / 255.0
    text_penalty = max(0.0, 1.0 - edge_density * 5)

    return (
        0.35 * sharpness
        + 0.20 * brightness
        + 0.20 * center_score
        + 0.10 * saturation
        + 0.15 * text_penalty
    )


def _extract_candidates_sync(video_path: str, job_id: str, top_n: int) -> List[FrameResult]:
    """Extract the top-N CV2-scored frames and save them to disk."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    start_frame = int(total_frames * 0.1)
    end_frame = int(total_frames * 0.9)
    step = max(int(fps * 0.5), 1)

    samples = list(range(start_frame, end_frame, step))
    if len(samples) > 120:
        samples = samples[:120]

    scored = []
    for frame_idx in samples:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue
        scored.append((_score_frame(frame), frame_idx, frame))

    cap.release()
    scored.sort(key=lambda x: x[0], reverse=True)

    output_dir = os.path.join(FRAME_OUTPUT_DIR, job_id)
    os.makedirs(output_dir, exist_ok=True)

    results = []
    for rank, (score, frame_idx, frame) in enumerate(scored[:top_n]):
        path = os.path.join(output_dir, f"candidate_{rank}.jpg")
        cv2.imwrite(path, frame)
        results.append(FrameResult(
            path=path,
            score=score,
            frame_index=frame_idx,
            timestamp_seconds=frame_idx / fps,
        ))
    return results


# ── Gemini Vision validation ──────────────────────────────────────────────────

def _encode_image(path: str) -> str:
    """Return a base64-encoded JPEG string for the Gemini API."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


async def _pick_best_frame_with_gemini(candidates: List[FrameResult]) -> tuple[int, str]:
    """
    Two-step Gemini Vision analysis:
      1. Gemini reads ALL frames at once and first identifies what the product is
         (it can read brand/product text directly from the images).
      2. Then picks the frame where the MOST of that product body is visible.

    Key rule: text overlays are acceptable — only penalise if the text physically
    covers the product. What matters is how much of the product is in frame.

    Returns the index into `candidates` of the best frame.
    Falls back to 0 (highest CV2 score) if the API is unavailable or fails.
    """
    if not _GEMINI_API_KEY:
        logger.info("GEMINI_API_KEY not set — skipping AI frame validation, using top CV2 frame.")
        return 0, ""

    # Build the multipart content: images first, then the analysis prompt
    parts = []
    for i, frame in enumerate(candidates):
        parts.append({"text": f"Image {i + 1}:"})
        parts.append({
            "inline_data": {
                "mime_type": "image/jpeg",
                "data": _encode_image(frame.path),
            }
        })

    parts.append({
        "text": (
            f"You are analysing {len(candidates)} frames extracted from a short product marketing reel/video.\n\n"
            "STEP 1 — Identify the product being sold:\n"
            "Scan ALL images and read any text/brand names visible in them. "
            "Determine what manufactured physical product is being marketed — "
            "the item a buyer would source on Alibaba. "
            "Ignore food, powder, ingredients, or raw materials being demonstrated ON the product. "
            "Ignore human hands and text captions unless they name the product.\n\n"
            "STEP 2 — Pick the best frame for reverse image search:\n"
            "Choose the single image where the product you identified in Step 1:\n"
            "  • Has the MOST of its body visible and in-frame (not cut off at edges)\n"
            "  • Shows its full shape and form factor most clearly\n"
            "  • Is most visually distinct from the background\n"
            "  • Takes up the largest proportion of the frame\n\n"
            "IMPORTANT: caption/subtitle text overlays on screen are completely fine — "
            "do NOT penalise a frame for having text on screen. "
            "Only penalise if text physically blocks and hides the product body itself.\n\n"
            "Reply with ONLY a JSON object in this exact format and nothing else:\n"
            '{"product": "<name the product in 3-6 words>", "best": <1-based index>, "reason": "<one sentence: why this frame shows the most of the product>"}'
        )
    })

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"maxOutputTokens": 150, "temperature": 0.0},
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite:generateContent?key={_GEMINI_API_KEY}",
                headers={"Content-Type": "application/json"},
                json=payload,
            )
        if resp.status_code != 200:
            logger.warning(f"Gemini frame-pick API error {resp.status_code}: {resp.text} — using top CV2 frame.")
            return 0, ""

        raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        # Strip markdown code fences if Gemini wraps in ```json ... ```
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        result = json.loads(raw)
        best_idx = int(result["best"]) - 1  # convert 1-based → 0-based
        best_idx = max(0, min(best_idx, len(candidates) - 1))
        product_name = result.get("product", "")
        logger.info(
            f"Gemini identified product: '{product_name}' — "
            f"picked frame {best_idx + 1}/{len(candidates)}: {result.get('reason', '')}"
        )
        return best_idx, product_name

    except Exception as e:
        logger.warning(f"Gemini frame validation failed ({e}) — falling back to top CV2 frame.")
        return 0, ""


# ── Public API ────────────────────────────────────────────────────────────────

async def extract_best_frames(
    video_path: str, job_id: str, top_n: int = 3
) -> tuple[List[FrameResult], str]:
    """
    1. Extract _CANDIDATE_COUNT frames scored by CV2 sharpness/brightness.
    2. Ask Gemini Vision to identify the product and pick the frame where
       the most of its body is visible.
    3. Rename the winner to frame_0.jpg and return it first in the list.

    Returns (frames, detected_product_name).
    detected_product_name is Gemini's identification of the product (e.g. "Slap Chop food chopper").
    It's an empty string if Gemini wasn't available or failed.
    """
    # Step 1 — fast CV2 pass (run in thread so it doesn't block the event loop)
    candidates = await asyncio.to_thread(
        _extract_candidates_sync, video_path, job_id, _CANDIDATE_COUNT
    )
    if not candidates:
        return [], ""

    # Step 2 — Gemini Vision validation
    best_idx, detected_product = await _pick_best_frame_with_gemini(candidates)

    # Step 3 — reorder so the Gemini-validated frame comes first
    ordered = [candidates[best_idx]] + [c for i, c in enumerate(candidates) if i != best_idx]

    # Rename the winner so downstream code can always use frame_0.jpg
    output_dir = os.path.join(FRAME_OUTPUT_DIR, job_id)
    winner_path = os.path.join(output_dir, "frame_0.jpg")
    if ordered[0].path != winner_path:
        import shutil
        shutil.copy2(ordered[0].path, winner_path)
        ordered[0] = FrameResult(
            path=winner_path,
            score=ordered[0].score,
            frame_index=ordered[0].frame_index,
            timestamp_seconds=ordered[0].timestamp_seconds,
        )

    # Return only up to top_n frames (caller still gets what it expects)
    return ordered[:top_n], detected_product
