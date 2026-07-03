"""Self-contained authentication — no external identity provider.

Email + password with bcrypt hashing, and a signed JWT session cookie
(`ap_session`). This is deliberately boring: for a self-hosted open-source
product the auth system should have zero third-party dependencies, zero
callback URLs, and nothing to configure beyond SESSION_SECRET_KEY.

bcrypt notes:
- cost factor uses the library default (currently 12), fine for a
  self-hosted login endpoint
- bcrypt only reads the first 72 bytes of a password; signup enforces the
  limit instead of silently truncating
"""
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings

# Verified against when a login email doesn't exist, so the endpoint takes
# the same time whether the user exists or not (no account enumeration by
# timing). Generated once at import.
_DUMMY_HASH = bcrypt.hashpw(b"autopilot-dummy-password", bcrypt.gensalt())

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt reads only the first 72 bytes


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-shape verification: users without a password (e.g. the
    SKIP_AUTH dev user) and unknown emails both burn a real bcrypt check."""
    target = password_hash.encode() if password_hash else _DUMMY_HASH
    ok = bcrypt.checkpw(password.encode(), target)
    return ok and password_hash is not None


def create_session_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=settings.JWT_EXPIRE_SECONDS)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        settings.SESSION_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def verify_session_token(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token, settings.SESSION_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload.get("sub")
    except JWTError:
        return None
