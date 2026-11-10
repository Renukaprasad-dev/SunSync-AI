import logging
import os
from typing import List, Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.auth import validate_signing_secret
from app.core.config import settings
from app.core.db import repo
from app.routers import sites, optimize, scenarios, forecast, billing, session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sunsync.api")

# Startup configuration validation
_secret_ok, _secret_msg = validate_signing_secret()
if not _secret_ok:
    logger.warning(f"Session security warning: {_secret_msg}")

app = FastAPI(
    title="SunSync AI API",
    description="AI-powered, solar-aware machine scheduling decision support system for industrial energy optimization.",
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc"
)

def build_allowed_origins(
    allowed_origins_raw: Optional[str] = None,
    preview_allowed_origins_raw: Optional[str] = None,
    is_vercel: Optional[bool] = None,
) -> List[str]:
    """Parse, merge, validate, and deduplicate explicit CORS allowed origins.

    - allowed_origins_raw: base origins string (defaults to settings.ALLOWED_ORIGINS).
    - preview_allowed_origins_raw: optional preview origins string (defaults to settings.PREVIEW_ALLOWED_ORIGINS).
    - is_vercel: whether running in Vercel runtime (defaults to bool(os.environ.get("VERCEL"))).
    """
    if allowed_origins_raw is None:
        allowed_origins_raw = settings.ALLOWED_ORIGINS
    if preview_allowed_origins_raw is None:
        preview_allowed_origins_raw = getattr(settings, "PREVIEW_ALLOWED_ORIGINS", "")
    if is_vercel is None:
        is_vercel = bool(os.environ.get("VERCEL"))

    # Parse base origins
    base_origins: List[str] = [
        o.strip() for o in (allowed_origins_raw or "").split(",") if o.strip()
    ]

    # Parse preview origins
    preview_origins: List[str] = [
        o.strip() for o in (preview_allowed_origins_raw or "").split(",") if o.strip()
    ]

    # Enforce strict prohibition on wildcard origins (both '*' and wildcard subdomains)
    all_raw_origins = base_origins + preview_origins
    for origin in all_raw_origins:
        if "*" in origin:
            raise RuntimeError(
                f"CORS origins must list explicit frontend origins; wildcard CORS ('{origin}') is unsupported."
            )

    # In Vercel runtime, base ALLOWED_ORIGINS must be set
    if is_vercel:
        check_val = os.environ.get("ALLOWED_ORIGINS") if allowed_origins_raw is None else allowed_origins_raw
        if not (check_val and check_val.strip()):
            raise RuntimeError("Set ALLOWED_ORIGINS to explicit frontend origins in Vercel.")

    # Merge while preserving order and eliminating duplicates
    merged_origins: List[str] = []
    for origin in all_raw_origins:
        if origin not in merged_origins:
            merged_origins.append(origin)

    # Local development fallbacks when not running in Vercel
    if not is_vercel:
        dev_origins = ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]
        for dev_origin in dev_origins:
            if dev_origin not in merged_origins:
                merged_origins.append(dev_origin)

    return merged_origins


# 1. Parse and build allowed origins list (guaranteeing local dev origins)
allowed_origins_list: List[str] = build_allowed_origins()

# 2. Add Payload Size Limiting Middleware (Inner middleware)
class LimitRequestSizeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > 1_048_576:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Payload Too Large: maximum allowed request body size is 1 MB."}
                    )
            except ValueError:
                pass
        return await call_next(request)

app.add_middleware(LimitRequestSizeMiddleware)

# Explicit custom headers used by frontend client
CORS_ALLOW_HEADERS = [
    "Content-Type",
  "Authorization",
    "If-Match",
    "Authorization",
    "Accept",
    "Origin",
    "User-Agent",
    "*"
]

# 3. Add CORSMiddleware LAST so it wraps outermost (ensuring 4xx/5xx/413 carry CORS headers)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list if allowed_origins_list else ["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
    allow_headers=CORS_ALLOW_HEADERS,
    expose_headers=["*"],
    max_age=600,
)

# 4. Global Exception Handlers to guarantee CORS headers on uncaught errors
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None)
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled server error on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"}
    )

@app.get("/health", tags=["Health"])
def health_check():
    mode = repo.storage_mode
    warning = (
        "Serverless ephemeral memory mode: changes may reset at any time across serverless instances. "
        "Configure Supabase (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) for persistent multi-user deployment."
        if mode == "memory"
        else None
    )
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "intervals_per_day": settings.INTERVALS_PER_DAY,
        "interval_minutes": settings.INTERVAL_MINUTES,
        "storage_mode": mode,
        "durable": repo.is_durable,
        "supabase_configured": repo.is_supabase_enabled,
        "warning": warning,
    }

# Include routers
app.include_router(sites.router)
app.include_router(session.router)
app.include_router(optimize.router)
app.include_router(scenarios.router)
app.include_router(forecast.router)
app.include_router(billing.router)
