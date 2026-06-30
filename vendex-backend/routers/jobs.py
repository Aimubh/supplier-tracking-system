import json
import os
import re
import asyncio
import shutil
from fastapi import APIRouter, HTTPException, Request, Query, Depends
from utils.auth import require_admin, require_viewer
from fastapi.responses import StreamingResponse
from models.database import get_all_jobs, get_job, delete_job_with_suppliers

router = APIRouter()

_DOWNLOADS_DIR = os.getenv("DOWNLOAD_DIR", "./downloads")
_FRAMES_DIR = os.getenv("FRAME_OUTPUT_DIR", "./frames")

# Allowlist pattern: job IDs are always "job_" + hex characters only
_JOB_ID_RE = re.compile(r'^job_[a-f0-9]{8,32}$')

# Allowlist for the status filter
_VALID_STATUSES = {"pending", "running", "complete", "failed"}

def _validate_job_id(job_id: str) -> None:
    """Raise 400 if job_id contains characters that could cause path traversal."""
    if not _JOB_ID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format")

@router.get("/jobs")
async def read_jobs(
    status: str = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _viewer: str = Depends(require_viewer)
):
    if status is not None and status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(_VALID_STATUSES)}")
    jobs = await get_all_jobs(status, limit, offset)
    return jobs

@router.get("/jobs/{job_id}")
async def read_job(job_id: str, _viewer: str = Depends(require_viewer)):
    _validate_job_id(job_id)
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.get("/jobs/{job_id}/stream")
async def job_stream(job_id: str, request: Request, _viewer: str = Depends(require_viewer)):
    _validate_job_id(job_id)
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    async def event_generator():
        last_status = None
        last_log_count = 0
        while True:
            if await request.is_disconnected():
                break
                
            job_data = await get_job(job_id)
            if not job_data:
                break
            
            # Check for ANY changes (status or new logs)
            current_log_count = len(job_data.get("detailedLogs", []))
            if job_data["status"] != last_status or current_log_count != last_log_count:
                last_status = job_data["status"]
                last_log_count = current_log_count
                yield f"data: {json.dumps(job_data)}\n\n"
                
            if job_data["status"] in ("complete", "failed"):
                break
                
            yield "event: ping\ndata: {}\n\n"
            await asyncio.sleep(1.5)
            
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
    )

@router.delete("/jobs/{job_id}")
async def delete_job_endpoint(job_id: str, _admin: str = Depends(require_admin)):
    _validate_job_id(job_id)
    await delete_job_with_suppliers(job_id)
    shutil.rmtree(os.path.join(_DOWNLOADS_DIR, job_id), ignore_errors=True)
    shutil.rmtree(os.path.join(_FRAMES_DIR, job_id), ignore_errors=True)
    return {"message": "Job deleted"}
