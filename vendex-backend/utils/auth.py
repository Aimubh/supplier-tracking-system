from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
import os

# This module is imported by the routers before anything else loads the backend
# .env, so reading the passwords at import time silently ignored them and fell
# back to the hardcoded defaults below. Load the .env here, and read the values
# per request so a restart isn't needed to pick up a change.
load_dotenv()

security = HTTPBearer(auto_error=False)

# Defaults are a last resort — set ADMIN_PASSWORD / VIEW_PASSWORD in
# vendex-backend/.env. Anyone who can reach this service knows the defaults.
DEFAULT_ADMIN_PASSWORD = "rayanadmin"
DEFAULT_VIEW_PASSWORD = "viewonly"

def get_auth_role(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    token = None
    if credentials:
        token = credentials.credentials

    # Fallback to query param for EventSource
    if not token or token == "null":
        token = request.query_params.get("token")

    admin_password = os.getenv("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD)
    view_password = os.getenv("VIEW_PASSWORD", DEFAULT_VIEW_PASSWORD)

    if token == admin_password:
        return "admin"
    elif token == view_password:
        return "viewer"
    else:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication password",
            headers={"WWW-Authenticate": "Bearer"},
        )

def require_admin(role: str = Depends(get_auth_role)):
    if role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required for this operation"
        )
    return role

def require_viewer(role: str = Depends(get_auth_role)):
    # Both admin and viewer can access
    return role
