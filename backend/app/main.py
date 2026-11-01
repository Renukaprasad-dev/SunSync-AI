import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.db import repo
from app.routers import sites, optimize, scenarios, forecast

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

# Parse allowed origins
allowed_origins_list = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
if "*" not in allowed_origins_list and "http://localhost:3000" not in allowed_origins_list:
    allowed_origins_list.extend(["http://localhost:3000", "http://127.0.0.1:3000"])

has_wildcard = "*" in allowed_origins_list
allow_creds = not has_wildcard

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list if allowed_origins_list else ["http://localhost:3000"],
    allow_credentials=allow_creds,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def limit_request_size(request: Request, call_next):
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

@app.get("/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "intervals_per_day": settings.INTERVALS_PER_DAY,
        "interval_minutes": settings.INTERVAL_MINUTES,
        "storage_mode": repo.storage_mode,
        "durable": repo.is_durable,
        "supabase_configured": repo.is_supabase_enabled
    }

# Include routers
app.include_router(sites.router)
app.include_router(optimize.router)
app.include_router(scenarios.router)
app.include_router(forecast.router)
