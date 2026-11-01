import time
import uuid
from collections import defaultdict
from typing import Optional
from fastapi import Request, HTTPException

def get_visitor_session_id(request: Request) -> str:
    """Retrieves or validates anonymous visitor session UUID from header or cookie."""
    header_val = request.headers.get("X-Visitor-Session-Id") or request.cookies.get("sunsync_session_id")
    if header_val:
        try:
            uuid.UUID(str(header_val))
            return str(header_val)
        except (ValueError, TypeError):
            pass
    # Deterministic fallback per IP if no header sent
    client_ip = request.client.host if request.client else "127.0.0.1"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"ip:{client_ip}"))

class RateLimiter:
    """Sliding-window in-memory rate limiter per client/session.
    
    Serverless Multi-Instance Architecture Note:
    This rate limiter operates in process memory. On serverless runtimes (such as Vercel
    lambda functions), each worker instance maintains its own memory space. This provides
    low-latency (<0.1ms) abuse mitigation per worker without external network dependencies.
    For globally coordinated rate limiting across all concurrent serverless instances,
    an external distributed KV store (e.g., Upstash Redis) or Supabase table can be wired,
    though each remote lookup introduces a 15-40ms latency overhead per HTTP request.
    """
    def __init__(self, max_requests: int = 60, window_seconds: float = 60.0):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests = defaultdict(list)

    def check(self, key: str):
        now = time.time()
        window_start = now - self.window_seconds
        # Clean expired timestamps
        active = [t for t in self._requests[key] if t > window_start]
        if len(active) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: maximum {self.max_requests} requests per minute."
            )
        active.append(now)
        self._requests[key] = active

rate_limiter = RateLimiter(max_requests=60, window_seconds=60.0)
