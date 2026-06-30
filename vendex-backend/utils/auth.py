from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os

security = HTTPBearer(auto_error=False)

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "rayanadmin")
VIEW_PASSWORD = os.getenv("VIEW_PASSWORD", "viewonly")

def get_auth_role(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    token = None
    if credentials:
        token = credentials.credentials
    
    # Fallback to query param for EventSource
    if not token or token == "null":
        token = request.query_params.get("token")
        
    if token == ADMIN_PASSWORD:
        return "admin"
    elif token == VIEW_PASSWORD:
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
