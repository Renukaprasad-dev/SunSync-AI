from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import uuid

import jwt
from fastapi import Depends, HTTPException, Request

from app.core.config import settings

ISSUER = "sunsync-ai"
AUDIENCE = "sunsync-api"
ALGORITHM = "HS256"


@dataclass(frozen=True)
class AnonymousPrincipal:
    subject: str
    site_id: str
    expires_at: int


def validate_signing_secret(secret: str | None = None) -> tuple[bool, str]:
    target = settings.SESSION_SIGNING_SECRET if secret is None else secret
    if not target:
        return False, "SESSION_SIGNING_SECRET is not configured. Set a random 32+ byte secret in your environment (e.g. backend/.env)."
    if len(target.encode("utf-8")) < 32:
        return False, "SESSION_SIGNING_SECRET is too short (< 32 bytes). It must be at least 32 bytes for HS256 security."
    return True, "OK"


def require_signing_secret() -> str:
    secret = settings.SESSION_SIGNING_SECRET
    ok, reason = validate_signing_secret(secret)
    if not ok:
        raise HTTPException(status_code=503, detail=f"Anonymous sessions are not configured: {reason}")
    if settings.SESSION_TOKEN_TTL_SECONDS < 300 or settings.SESSION_TOKEN_TTL_SECONDS > 30 * 24 * 60 * 60:
        raise HTTPException(status_code=503, detail="Anonymous session lifetime is not configured safely.")
    return secret


def issue_token(subject: str, site_id: str) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    expires_at = int((now + timedelta(seconds=settings.SESSION_TOKEN_TTL_SECONDS)).timestamp())
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": str(uuid.UUID(subject)),
        "site_id": str(uuid.UUID(site_id)),
        "iat": int(now.timestamp()),
        "exp": expires_at,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(claims, require_signing_secret(), algorithm=ALGORITHM), expires_at


def verify_token(token: str) -> AnonymousPrincipal:
    secret = require_signing_secret()
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            audience=AUDIENCE,
            options={"require": ["iss", "aud", "sub", "site_id", "iat", "exp", "jti"]},
        )
        subject = str(uuid.UUID(claims["sub"]))
        site_id = str(uuid.UUID(claims["site_id"]))
        expires_at = int(claims["exp"])
        if not claims["jti"] or expires_at <= int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("invalid claims")
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired anonymous session.")
    return AnonymousPrincipal(subject=subject, site_id=site_id, expires_at=expires_at)


def optional_principal(request: Request) -> AnonymousPrincipal | None:
    authorization = request.headers.get("authorization")
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Invalid or expired anonymous session.")
    return verify_token(token.strip())


def require_principal(principal: AnonymousPrincipal | None = Depends(optional_principal)) -> AnonymousPrincipal:
    if principal is None:
        raise HTTPException(status_code=401, detail="Anonymous session required.")
    return principal
