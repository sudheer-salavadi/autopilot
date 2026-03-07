"""GitHub API service — creates, reopens, and closes issues on behalf of projects.

Supports two auth modes:
  - GitHub App (preferred): uses RS256 JWT to obtain short-lived installation tokens
  - Legacy PAT: token passed directly (kept for backward-compat during migration)
"""
from __future__ import annotations

import time
import textwrap
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from app.models.cluster import Cluster

_GITHUB_API = "https://api.github.com"
_TIMEOUT = 15.0

# In-process cache: installation_id → (token, expires_at_unix)
_token_cache: dict[int, tuple[str, float]] = {}


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _normalize_pem(raw: str) -> str:
    """Normalize a PEM private key from env var storage.

    Accepts two formats:
    - Base64-encoded PEM (single line, no spaces) — preferred for env vars
    - Raw PEM with real or escaped newlines
    """
    import base64, re
    key = raw.strip().strip('"').strip("'").strip()

    # If it looks like base64 (no "-----" header, no whitespace), decode it
    if "-----" not in key:
        try:
            key = base64.b64decode(key).decode("utf-8")
        except Exception:
            pass

    # Replace escaped newlines and normalize line endings
    key = key.replace("\\n", "\n").replace("\\r", "")
    key = key.replace("\r\n", "\n").replace("\r", "\n")
    # Ensure header and footer are on their own lines
    key = re.sub(r"(-----BEGIN [^-]+-----)\s*", r"\1\n", key)
    key = re.sub(r"\s*(-----END [^-]+-----)", r"\n\1", key)
    return key.strip()


def _generate_app_jwt() -> str:
    """Generate a short-lived RS256 JWT for app-level GitHub API calls."""
    from jose import jwt as jose_jwt
    from app.config import settings

    private_key = _normalize_pem(settings.GITHUB_APP_PRIVATE_KEY)

    now = int(time.time())
    return jose_jwt.encode(
        {"iat": now - 60, "exp": now + 600, "iss": settings.GITHUB_APP_ID},
        private_key,
        algorithm="RS256",
    )


async def get_installation_token(installation_id: int) -> str:
    """Return a cached installation access token, refreshing if < 60 s from expiry."""
    cached = _token_cache.get(installation_id)
    if cached:
        token, expires_at = cached
        if time.time() < expires_at - 60:
            return token

    app_jwt = _generate_app_jwt()
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_GITHUB_API}/app/installations/{installation_id}/access_tokens",
            headers=_headers(app_jwt),
        )
        resp.raise_for_status()
        data = resp.json()

    token = data["token"]
    # expires_at is ISO 8601; parse to unix timestamp
    expires_at_str = data.get("expires_at", "")
    try:
        from datetime import datetime
        expires_at = datetime.fromisoformat(
            expires_at_str.replace("Z", "+00:00")
        ).timestamp()
    except Exception:
        expires_at = time.time() + 3600  # fallback: 1 hour

    _token_cache[installation_id] = (token, expires_at)
    return token


async def get_accessible_repos(installation_id: int) -> list[dict]:
    """List repos accessible to this installation."""
    token = await get_installation_token(installation_id)
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_GITHUB_API}/installation/repositories",
            headers=_headers(token),
            params={"per_page": 100},
        )
        resp.raise_for_status()
        data = resp.json()
    return [
        {"full_name": r["full_name"], "private": r["private"]}
        for r in data.get("repositories", [])
    ]


def _time_ago(dt: datetime) -> str:
    diff = datetime.now(timezone.utc) - dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else datetime.now(timezone.utc) - dt
    days = diff.days
    hours = diff.seconds // 3600
    if days > 1:
        return f"{days} days ago"
    if days == 1:
        return "yesterday"
    if hours > 1:
        return f"{hours} hours ago"
    return "recently"


def build_issue_body(
    cluster: Cluster,
    project_slug: str,
    frontend_url: str,
    source_counts: dict[str, int] | None = None,
    is_regression: bool = False,
    parent_title: str | None = None,
    parent_issue_number: int | None = None,
    parent_issue_url: str | None = None,
) -> str:
    score = cluster.priority_score * 10  # 0–10 display scale

    lines: list[str] = []

    if is_regression:
        lines.append(
            f"> ⚠️ **Regression detected** — this issue was previously resolved."
        )
        if parent_issue_number and parent_issue_url:
            lines.append(
                f"> Original report: [#{parent_issue_number}]({parent_issue_url})"
                + (f" — _{parent_title}_" if parent_title else "")
            )
        lines.append("")

    lines += [
        "## Root Cause",
        cluster.root_cause,
        "",
        "## Signals",
    ]

    if source_counts:
        lines.append("| Source | Events |")
        lines.append("|--------|--------|")
        for src, cnt in sorted(source_counts.items()):
            lines.append(f"| {src.capitalize()} | {cnt} |")
    else:
        lines.append(f"- **Total events**: {cluster.event_count}")

    lines += [
        "",
        f"- **Affected users**: {cluster.affected_users}",
        f"- **First seen**: {_time_ago(cluster.first_seen)}",
        f"- **Last seen**: {_time_ago(cluster.last_seen)}",
        f"- **Priority score**: {score:.1f} / 10",
        f"  - Revenue: {cluster.revenue_score * 10:.1f} &nbsp; "
        f"Frequency: {cluster.frequency_score * 10:.1f} &nbsp; "
        f"UX Impact: {cluster.ux_score * 10:.1f}",
        "",
        "## Autopilot",
        f"[View full cluster →]({frontend_url}/projects/{project_slug}/issues?open={cluster.id})",
    ]

    return "\n".join(lines)


async def create_issue(
    repo: str,
    title: str,
    body: str,
    labels: list[str] | None = None,
    installation_id: int | None = None,
    token: str | None = None,
) -> dict:
    """Create a GitHub issue. Returns the API response dict (includes number, html_url)."""
    if installation_id is not None:
        auth_token = await get_installation_token(installation_id)
    elif token:
        auth_token = token
    else:
        raise ValueError("Either installation_id or token must be provided")

    payload: dict = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_GITHUB_API}/repos/{repo}/issues",
            headers=_headers(auth_token),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def reopen_issue(
    repo: str,
    issue_number: int,
    comment: str,
    installation_id: int | None = None,
    token: str | None = None,
) -> None:
    """Reopen a closed GitHub issue and post a regression comment."""
    if installation_id is not None:
        auth_token = await get_installation_token(installation_id)
    elif token:
        auth_token = token
    else:
        raise ValueError("Either installation_id or token must be provided")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        await client.patch(
            f"{_GITHUB_API}/repos/{repo}/issues/{issue_number}",
            headers=_headers(auth_token),
            json={"state": "open"},
        )
        await client.post(
            f"{_GITHUB_API}/repos/{repo}/issues/{issue_number}/comments",
            headers=_headers(auth_token),
            json={"body": comment},
        )


async def close_issue(
    repo: str,
    issue_number: int,
    installation_id: int | None = None,
    token: str | None = None,
) -> None:
    """Close a GitHub issue (called when cluster is resolved)."""
    if installation_id is not None:
        auth_token = await get_installation_token(installation_id)
    elif token:
        auth_token = token
    else:
        raise ValueError("Either installation_id or token must be provided")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        await client.patch(
            f"{_GITHUB_API}/repos/{repo}/issues/{issue_number}",
            headers=_headers(auth_token),
            json={"state": "closed"},
        )


async def verify_installation(installation_id: int, repo: str) -> tuple[bool, str]:
    """Check that the installation can access the repo. Returns (ok, message)."""
    try:
        auth_token = await get_installation_token(installation_id)
    except Exception as exc:
        return False, f"Could not obtain installation token: {exc}"

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_GITHUB_API}/repos/{repo}",
            headers=_headers(auth_token),
        )
        if resp.status_code == 200:
            data = resp.json()
            return True, f"Connected to {data['full_name']}"
        if resp.status_code == 401:
            return False, "Installation token is invalid"
        if resp.status_code == 404:
            return False, "Repo not found or installation lacks access"
        return False, f"GitHub returned {resp.status_code}"
