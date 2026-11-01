import logging
from typing import List
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.db import repo
from app.routers import sites, optimize, scenarios, forecast, billing

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sunsync.api")

app = FastAPI(
    title="SunSync AI API",
    description="AI-powered, solar-aware machine scheduling decision support system for industrial energy optimization.",
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc"
)

# 1. Parse and build allowed origins list (guaranteeing local dev origins)
allowed_origins_list: List[str] = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
for dev_origin in ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]:
    if dev_origin not in allowed_origins_list and "*" not in allowed_origins_list:
        allowed_origins_list.append(dev_origin)

has_wildcard = "*" in allowed_origins_list
allow_creds = not has_wildcard

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

# 3. Add CORSMiddleware LAST so it wraps outermost (ensuring 4xx/5xx/413 carry CORS headers)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list if allowed_origins_list else ["http://localhost:3000"],
    allow_credentials=allow_creds,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
    allow_headers=["*"],
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
app.include_router(optimize.router)
app.include_router(scenarios.router)
app.include_router(forecast.router)
app.include_router(billing.router)
