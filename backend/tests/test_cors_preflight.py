import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

ENDPOINTS_TO_TEST = [
    ("POST", "/optimize", "content-type,x-visitor-session-id"),
    ("POST", "/scenarios/simulate", "content-type,x-visitor-session-id"),
    ("GET", "/forecast", "content-type,x-visitor-session-id"),
    ("GET", "/runs", "x-visitor-session-id"),
    ("GET", "/runs/20000000-0000-0000-0000-000000000001", "x-visitor-session-id"),
    ("POST", "/billing/reality-check", "content-type,x-visitor-session-id"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001/config", "x-visitor-session-id"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001/config", "content-type,x-visitor-session-id,if-match"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001", "x-visitor-session-id"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001", "content-type,x-visitor-session-id"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001/machines", "x-visitor-session-id"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001/machines", "content-type,x-visitor-session-id"),
    ("GET", "/sites/00000000-0000-0000-0000-000000000001/tariff", "x-visitor-session-id"),
    ("PUT", "/sites/00000000-0000-0000-0000-000000000001/tariff", "content-type,x-visitor-session-id"),
    ("GET", "/health", "x-visitor-session-id"),
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
    assert response.headers.get("access-control-allow-credentials") == "true"

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

def test_cors_headers_present_on_error_responses():
    # 1. Test 404 response carries CORS headers
    resp_404 = client.get(
        "/nonexistent_route_12345",
        headers={"Origin": "http://localhost:3000"}
    )
    assert resp_404.status_code == 404
    assert resp_404.headers.get("access-control-allow-origin") == "http://localhost:3000"

    # 2. Test 422 Unprocessable Entity carries CORS headers
    resp_422 = client.post(
        "/optimize",
        headers={"Origin": "http://localhost:3000"},
        json={"p_max_grid_kw": "invalid_not_a_float"}
    )
    assert resp_422.status_code == 422
    assert resp_422.headers.get("access-control-allow-origin") == "http://localhost:3000"

    # 3. Test 413 Payload Too Large carries CORS headers
    large_payload = b"x" * 1_048_580
    resp_413 = client.post(
        "/optimize",
        headers={"Origin": "http://localhost:3000"},
        content=large_payload
    )
    assert resp_413.status_code == 413
    assert resp_413.headers.get("access-control-allow-origin") == "http://localhost:3000"
