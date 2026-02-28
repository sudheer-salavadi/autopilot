"""GitHub API service — creates, reopens, and closes issues on behalf of projects."""
from __future__ import annotations

import textwrap
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from app.models.cluster import Cluster

_GITHUB_API = "https://api.github.com"
_TIMEOUT = 15.0


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


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
        f"[View full cluster →]({frontend_url}/projects/{project_slug}/clusters/{cluster.id})",
    ]

    return "\n".join(lines)


async def create_issue(
    token: str,
    repo: str,
    title: str,
    body: str,
    labels: list[str] | None = None,
) -> dict:
    """Create a GitHub issue. Returns the API response dict (includes number, html_url)."""
    payload: dict = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_GITHUB_API}/repos/{repo}/issues",
            headers=_headers(token),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def reopen_issue(
    token: str,
    repo: str,
    issue_number: int,
    comment: str,
) -> None:
    """Reopen a closed GitHub issue and post a regression comment."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # Reopen
        await client.patch(
            f"{_GITHUB_API}/repos/{repo}/issues/{issue_number}",
            headers=_headers(token),
            json={"state": "open"},
        )
        # Comment
        await client.post(
            f"{_GITHUB_API}/repos/{repo}/issues/{issue_number}/comments",
            headers=_headers(token),
            json={"body": comment},
        )


async def close_issue(token: str, repo: str, issue_number: int) -> None:
    """Close a GitHub issue (called when cluster is resolved)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        await client.patch(
            f"{_GITHUB_API}/repos/{repo}/issues/{issue_number}",
            headers=_headers(token),
            json={"state": "closed"},
        )


async def verify_token(token: str, repo: str) -> tuple[bool, str]:
    """Check that the token can read the repo. Returns (ok, message)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_GITHUB_API}/repos/{repo}",
            headers=_headers(token),
        )
        if resp.status_code == 200:
            data = resp.json()
            perms = data.get("permissions", {})
            if not perms.get("push") and not perms.get("admin"):
                return False, "Token can read the repo but lacks write (issues) permission"
            return True, f"Connected to {data['full_name']}"
        if resp.status_code == 401:
            return False, "Invalid token"
        if resp.status_code == 404:
            return False, "Repo not found or token lacks access"
        return False, f"GitHub returned {resp.status_code}"
