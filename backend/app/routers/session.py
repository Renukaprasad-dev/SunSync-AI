from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import AnonymousPrincipal, issue_token, optional_principal, require_principal, require_signing_secret
from app.core.config import settings
from app.core.db import DatabaseMigrationRequired, DatabaseUnavailable, SiteCreationLimitReached, repo
from app.core.security import RateLimiter

router = APIRouter(prefix="/auth", tags=["Anonymous Sessions"])
issuance_limiter = RateLimiter(max_requests=settings.SESSION_ISSUANCE_MAX_REQUESTS, window_seconds=60.0)


def _site_owned_by(site_id: str, subject: str) -> bool:
    site = repo.get_site(site_id)
    return bool(site and site.get("id") == site_id and site.get("owner_session_id") == subject)


def _response(subject: str, site_id: str) -> dict:
    token, expires_at = issue_token(subject, site_id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at,
        "site_id": site_id,
    }


@router.post("/session")
def create_or_renew_session(request: Request, principal: AnonymousPrincipal | None = Depends(optional_principal)):
    require_signing_secret()
    if principal is not None:
        if not _site_owned_by(principal.site_id, principal.subject):
            raise HTTPException(status_code=401, detail="Invalid or expired anonymous session.")
        try:
            touched = repo.touch_owned_site(principal.site_id, principal.subject)
        except DatabaseUnavailable:
            raise HTTPException(status_code=503, detail="Database service is currently unreachable. Please try again later.")
        except Exception:
            raise HTTPException(status_code=503, detail="Could not renew the anonymous session.")
        if not touched:
            raise HTTPException(status_code=401, detail="Invalid or expired anonymous session.")
        return _response(principal.subject, principal.site_id)

    client_ip = request.client.host if request.client else "unknown"
    issuance_limiter.check(f"session:{client_ip}")
    subject = str(uuid.uuid4())
    try:
        site_id = repo.clone_demo_site_for_visitor(visitor_id=subject)
    except SiteCreationLimitReached:
        raise HTTPException(status_code=429, detail="Session site limit reached. Delete an existing site before creating a new one.")
    except DatabaseMigrationRequired as dbe:
        raise HTTPException(
            status_code=503,
            detail=f"Database migration required: RPC '{dbe.rpc_name}' is missing ({dbe.migration_hint})."
        )
    except DatabaseUnavailable:
        raise HTTPException(status_code=503, detail="Database service is currently unreachable. Please try again later.")
    except Exception:
        raise HTTPException(status_code=503, detail="Could not initialize an anonymous workspace.")
    if not _site_owned_by(site_id, subject):
        raise HTTPException(status_code=503, detail="Could not initialize an anonymous workspace.")
    return _response(subject, site_id)


@router.get("/session")
def inspect_session(principal: AnonymousPrincipal = Depends(require_principal)):
    if not _site_owned_by(principal.site_id, principal.subject):
        raise HTTPException(status_code=401, detail="Invalid or expired anonymous session.")
    return {"site_id": principal.site_id, "expires_at": principal.expires_at}
