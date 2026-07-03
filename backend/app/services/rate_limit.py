"""In-memory sliding-window rate limiting for the auth endpoints.

Deliberately process-local: the default deployment is a single uvicorn
process (docker-compose), so a shared store would be dead weight. If you
scale the backend horizontally, each process enforces its own window —
the effective limit is multiplied by the process count, which still bounds
brute force meaningfully. Swap in a Redis-backed limiter only when that
stops being true.

Failed attempts count against the window; successes reset it, so a user
who mistypes a few times then logs in isn't left near the limit.
"""
import time
from collections import deque
from dataclasses import dataclass, field
from threading import Lock

from fastapi import HTTPException, Request, status


def client_ip(request: Request) -> str:
    """Client IP, honoring X-Forwarded-For when a reverse proxy sets it.

    Note: XFF is client-controllable when the backend is exposed directly;
    the per-email keys below don't depend on it, so spoofing only weakens
    the coarse per-IP ceiling, not the per-account lockout.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@dataclass
class SlidingWindowLimiter:
    max_attempts: int
    window_seconds: float
    _hits: dict[str, deque] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)

    def _prune(self, q: deque, now: float) -> None:
        cutoff = now - self.window_seconds
        while q and q[0] < cutoff:
            q.popleft()

    def is_blocked(self, key: str) -> float:
        """Seconds until the oldest attempt expires (0.0 = not blocked)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return 0.0
            self._prune(q, now)
            if len(q) >= self.max_attempts:
                return max(q[0] + self.window_seconds - now, 1.0)
            return 0.0

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            self._prune(q, now)
            q.append(now)
            # Bound total memory: drop empty/old keys opportunistically
            if len(self._hits) > 10_000:
                for k in [k for k, v in self._hits.items() if not v][:1000]:
                    del self._hits[k]

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


# Per-account login lockout: 10 failed attempts / 15 minutes
login_by_account = SlidingWindowLimiter(max_attempts=10, window_seconds=15 * 60)
# Coarse per-IP ceiling across all accounts: 30 failures / 15 minutes
login_by_ip = SlidingWindowLimiter(max_attempts=30, window_seconds=15 * 60)
# Signup flood control: 10 new accounts / hour / IP
signup_by_ip = SlidingWindowLimiter(max_attempts=10, window_seconds=60 * 60)


def enforce(*checks: tuple[SlidingWindowLimiter, str]) -> None:
    """Raise 429 (with Retry-After) if any (limiter, key) pair is exhausted."""
    for limiter, key in checks:
        retry_after = limiter.is_blocked(key)
        if retry_after:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts — try again later",
                headers={"Retry-After": str(int(retry_after))},
            )
