import pytest
from fastapi import HTTPException
from app.core.security import RateLimiter, get_visitor_session_id

def test_rate_limiter_exceeded():
    limiter = RateLimiter(max_requests=5, window_seconds=60.0)
    key = "test_user_session"
    for _ in range(5):
        limiter.check(key)

    with pytest.raises(HTTPException) as exc_info:
        limiter.check(key)
    assert exc_info.value.status_code == 429
    assert "Rate limit exceeded" in str(exc_info.value.detail)

def test_rate_limiter_window_slide():
    limiter = RateLimiter(max_requests=2, window_seconds=0.1)
    key = "slide_user"
    limiter.check(key)
    limiter.check(key)

    import time
    time.sleep(0.15)
    # Should not raise after window expires
    limiter.check(key)

def test_visitor_session_uuid():
    class DummyRequest:
        def __init__(self, headers=None, client_host="192.168.1.1"):
            self.headers = headers or {}
            self.cookies = {}
            class Client:
                host = client_host
            self.client = Client()

    req_with_uuid = DummyRequest({"X-Visitor-Session-Id": "12345678-1234-5678-1234-567812345678"})
    assert get_visitor_session_id(req_with_uuid) == "12345678-1234-5678-1234-567812345678"

    req_fallback = DummyRequest({})
    assert len(get_visitor_session_id(req_fallback)) == 36 # Valid UUID format
