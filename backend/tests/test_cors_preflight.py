import pytest
from fastapi.testclient import TestClient
from app.main import app, build_allowed_origins

client = TestClient(app)

ENDPOINTS_TO_TEST = [
    ("POST", "/optimize", "content-type,authorization"),
    ("POST", "/scenarios/simulate", "content-type,authorization"),
    ("GET", "/forecast", "authorization"),
    ("GET", "/runs", "authorization"),
    ("GET", "/runs/20000000-0000-0000-0000-000000000001", "authorization"),
    ("POST", "/billing/reality-check", "content-type,authorization"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001/config", "authorization"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001/config", "content-type,authorization,if-match"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001", "authorization"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001", "content-type,authorization"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001/machines", "authorization"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001/machines", "content-type,authorization"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001/tariff", "authorization"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001/tariff", "content-type,authorization"),
    ("GET", "/health", "authorization"),
]

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

UNTRUSTED_ORIGINS = [
    "https://evil-hacker.com",
    "http://attacker.local:8080",
]

@pytest.mark.parametrize("method,path,headers", ENDPOINTS_TO_TEST)
@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_cors_preflight_allowed_origins(method, path, headers, origin):
    response = client.options(
        path,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": headers,
        }
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "access-control-allow-methods" in response.headers
    assert response.headers.get("access-control-allow-credentials") is None
    assert "authorization" in response.headers.get("access-control-allow-headers", "")

@pytest.mark.parametrize("method,path,headers", ENDPOINTS_TO_TEST)
@pytest.mark.parametrize("untrusted_origin", UNTRUSTED_ORIGINS)
def test_cors_preflight_untrusted_origins_rejected(method, path, headers, untrusted_origin):
    response = client.options(
        path,
        headers={
            "Origin": untrusted_origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": headers,
        }
    )
    # Untrusted origin must NOT receive access-control-allow-origin matching untrusted origin
    allow_origin = response.headers.get("access-control-allow-origin")
    assert allow_origin != untrusted_origin

def test_cors_headers_present_on_error_responses(monkeypatch):
    allowed_origin = "http://localhost:3000"
    untrusted_origin = "https://evil-hacker.com"

    # 1. Test 404 Not Found
    resp_404_allowed = client.get("/nonexistent_route_12345", headers={"Origin": allowed_origin})
    assert resp_404_allowed.status_code == 404
    assert resp_404_allowed.headers.get("access-control-allow-origin") == allowed_origin

    resp_404_untrusted = client.get("/nonexistent_route_12345", headers={"Origin": untrusted_origin})
    assert resp_404_untrusted.headers.get("access-control-allow-origin") != untrusted_origin

    # 2. Test 422 Unprocessable Entity
    resp_422_allowed = client.post(
        "/optimize",
        headers={"Origin": allowed_origin},
        json={"p_max_grid_kw": "invalid_not_a_float"}
    )
    assert resp_422_allowed.status_code == 422
    assert resp_422_allowed.headers.get("access-control-allow-origin") == allowed_origin

    resp_422_untrusted = client.post(
        "/optimize",
        headers={"Origin": untrusted_origin},
        json={"p_max_grid_kw": "invalid_not_a_float"}
    )
    assert resp_422_untrusted.headers.get("access-control-allow-origin") != untrusted_origin

    # 3. Test 413 Payload Too Large
    large_payload = b"x" * 1_048_580
    resp_413_allowed = client.post(
        "/optimize",
        headers={"Origin": allowed_origin},
        content=large_payload
    )
    assert resp_413_allowed.status_code == 413
    assert resp_413_allowed.headers.get("access-control-allow-origin") == allowed_origin

    resp_413_untrusted = client.post(
        "/optimize",
        headers={"Origin": untrusted_origin},
        content=large_payload
    )
    assert resp_413_untrusted.headers.get("access-control-allow-origin") != untrusted_origin

    # 4. Test 429 Rate Limit Exceeded
    from app.core.security import rate_limiter
    import time
    rate_limiter._requests["opt:testclient"] = [time.time()] * 65

    resp_429_allowed = client.post(
        "/optimize",
        headers={"Origin": allowed_origin},
        json={"scenario": "sunny"}
    )
    assert resp_429_allowed.status_code == 429
    assert resp_429_allowed.headers.get("access-control-allow-origin") == allowed_origin

    resp_429_untrusted = client.post(
        "/optimize",
        headers={"Origin": untrusted_origin},
        json={"scenario": "sunny"}
    )
    assert resp_429_untrusted.headers.get("access-control-allow-origin") != untrusted_origin

    # 5. Test 500 Internal Server Error (Unhandled Exception)
    from app.routers import optimize
    def crash_solver(*args, **kwargs):
        raise RuntimeError("Simulated unhandled solver crash")
    
    monkeypatch.setattr(optimize.scheduler_service, "run_optimization", crash_solver)
    rate_limiter._requests.pop("opt:testclient", None)

    fresh_500_uuid = "b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e"
    resp_500_allowed = client.post(
        "/optimize",
        headers={"Origin": allowed_origin},
        json={"scenario": "sunny"}
    )
    assert resp_500_allowed.status_code == 500
    assert resp_500_allowed.headers.get("access-control-allow-origin") == allowed_origin

    resp_500_untrusted = client.post(
        "/optimize",
        headers={"Origin": untrusted_origin},
        json={"scenario": "sunny"}
    )
    assert resp_500_untrusted.headers.get("access-control-allow-origin") != untrusted_origin


def test_build_allowed_origins_existing_only():
    # In Vercel mode, returns exactly the base origins
    res_vercel = build_allowed_origins(
        allowed_origins_raw="https://sunsync-frontend.vercel.app",
        preview_allowed_origins_raw="",
        is_vercel=True,
    )
    assert res_vercel == ["https://sunsync-frontend.vercel.app"]

    # In local development mode, includes local dev origins
    res_local = build_allowed_origins(
        allowed_origins_raw="http://localhost:3000",
        preview_allowed_origins_raw="",
        is_vercel=False,
    )
    assert "http://localhost:3000" in res_local
    assert "http://127.0.0.1:3000" in res_local
    assert "http://[::1]:3000" in res_local


def test_build_allowed_origins_additional_preview_origins():
    # Merges base and preview origins
    res = build_allowed_origins(
        allowed_origins_raw="https://sunsync-frontend.vercel.app",
        preview_allowed_origins_raw="https://sunsync-frontend-git-phase-3-user.vercel.app, https://preview-alt.vercel.app",
        is_vercel=True,
    )
    assert res == [
        "https://sunsync-frontend.vercel.app",
        "https://sunsync-frontend-git-phase-3-user.vercel.app",
        "https://preview-alt.vercel.app",
    ]


def test_build_allowed_origins_deduplication():
    # Deduplicates origins across base and preview without altering order
    res = build_allowed_origins(
        allowed_origins_raw="https://sunsync-frontend.vercel.app, https://sunsync-frontend.vercel.app",
        preview_allowed_origins_raw="https://sunsync-frontend.vercel.app, https://preview.vercel.app, https://preview.vercel.app",
        is_vercel=True,
    )
    assert res == [
        "https://sunsync-frontend.vercel.app",
        "https://preview.vercel.app",
    ]


def test_build_allowed_origins_empty_and_whitespace():
    # Handles empty strings, None, and whitespace-only items cleanly
    res_empty_preview = build_allowed_origins(
        allowed_origins_raw="https://sunsync-frontend.vercel.app",
        preview_allowed_origins_raw="   ,  ,  ",
        is_vercel=True,
    )
    assert res_empty_preview == ["https://sunsync-frontend.vercel.app"]

    res_none_preview = build_allowed_origins(
        allowed_origins_raw="https://sunsync-frontend.vercel.app",
        preview_allowed_origins_raw=None,
        is_vercel=True,
    )
    assert res_none_preview == ["https://sunsync-frontend.vercel.app"]


def test_build_allowed_origins_wildcard_rejection():
    # Wildcards must be strictly rejected
    with pytest.raises(RuntimeError, match="wildcard CORS"):
        build_allowed_origins(allowed_origins_raw="*", is_vercel=True)

    with pytest.raises(RuntimeError, match="wildcard CORS"):
        build_allowed_origins(
            allowed_origins_raw="https://sunsync-frontend.vercel.app",
            preview_allowed_origins_raw="*",
            is_vercel=True,
        )

    with pytest.raises(RuntimeError, match="wildcard CORS"):
        build_allowed_origins(
            allowed_origins_raw="https://sunsync-frontend.vercel.app",
            preview_allowed_origins_raw="https://*.vercel.app",
            is_vercel=True,
        )


def test_build_allowed_origins_vercel_requires_base_allowed_origins():
    # In Vercel runtime, base ALLOWED_ORIGINS cannot be empty
    with pytest.raises(RuntimeError, match="Set ALLOWED_ORIGINS to explicit frontend origins in Vercel"):
        build_allowed_origins(allowed_origins_raw="", is_vercel=True)

    with pytest.raises(RuntimeError, match="Set ALLOWED_ORIGINS to explicit frontend origins in Vercel"):
        build_allowed_origins(allowed_origins_raw="   ", is_vercel=True)


def test_cors_preflight_with_preview_allowed_origins():
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from app.main import CORS_ALLOW_HEADERS

    test_app = FastAPI()
    test_origins = build_allowed_origins(
        allowed_origins_raw="https://sunsync-frontend.vercel.app",
        preview_allowed_origins_raw="https://sunsync-frontend-git-phase-3-preview.vercel.app",
        is_vercel=True,
    )

    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=test_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=CORS_ALLOW_HEADERS,
    )

    @test_app.get("/test-endpoint")
    def sample():
        return {"ok": True}

    test_client = TestClient(test_app)

    # 1. Base origin preflight
    resp_base = test_client.options(
        "/test-endpoint",
        headers={
            "Origin": "https://sunsync-frontend.vercel.app",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp_base.status_code == 200
    assert resp_base.headers.get("access-control-allow-origin") == "https://sunsync-frontend.vercel.app"

    # 2. Preview origin preflight
    resp_preview = test_client.options(
        "/test-endpoint",
        headers={
            "Origin": "https://sunsync-frontend-git-phase-3-preview.vercel.app",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp_preview.status_code == 200
    assert resp_preview.headers.get("access-control-allow-origin") == "https://sunsync-frontend-git-phase-3-preview.vercel.app"

    # 3. Untrusted origin rejected
    resp_untrusted = test_client.options(
        "/test-endpoint",
        headers={
            "Origin": "https://attacker.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp_untrusted.headers.get("access-control-allow-origin") != "https://attacker.com"
