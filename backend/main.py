import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import auth, chat, clusters, dashboard, demo, events, github_config, integrations, members, projects, scoring_config, webhooks
from app.config import settings
from app.db.session import AsyncSessionLocal
from app.services.demo import simulate_active_projects
from app.services.evaluator import evaluate_all_projects
from app.services.outbox import cleanup_old_jobs, process_next_job

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def background_outbox_worker():
        """Fast-path outbox poller: drains evaluation_jobs as quickly as possible.

        When the queue is empty the loop backs off to a 5-second sleep so it
        doesn't busy-wait.  Each processed job triggers exactly one call to
        evaluate_project.  Cleanup of old done/failed jobs runs every 200 jobs.
        """
        cleanup_counter = 0
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    processed = await process_next_job(db)
            except Exception:
                processed = False

            if not processed:
                await asyncio.sleep(5)
                continue

            cleanup_counter += 1
            if cleanup_counter >= 200:
                cleanup_counter = 0
                try:
                    async with AsyncSessionLocal() as db:
                        await cleanup_old_jobs(db)
                except Exception:
                    pass

    async def background_evaluator():
        """Safety-net: catch any events that slipped through the outbox (e.g.
        jobs lost during a crash window before the outbox was introduced, or
        events inserted without going through a webhook handler)."""
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    await evaluate_all_projects(db)
            except Exception:
                pass
            await asyncio.sleep(120)

    async def background_simulator():
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    await simulate_active_projects(db)
            except Exception:
                pass
            await asyncio.sleep(3)

    async def background_mcp_puller():
        """Auto-sync Stripe MCP and generic MCP server integrations every 5 minutes."""
        from datetime import datetime, timezone

        from sqlalchemy import and_, select

        from app.models.integration import Integration, IntegrationType
        from app.services.mcp_client import pull_mcp_server
        from app.services.outbox import enqueue_evaluation
        from app.services.stripe_pull import pull_stripe_events

        while True:
            await asyncio.sleep(300)  # wait first, then pull
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(Integration).where(
                            and_(
                                Integration.type.in_(
                                    [IntegrationType.stripe, IntegrationType.mcp_server]
                                ),
                                Integration.is_active == True,  # noqa: E712
                            )
                        )
                    )
                    integrations_list = result.scalars().all()
                    any_pulled = False
                    now = datetime.now(timezone.utc)

                    for integration in integrations_list:
                        cfg = integration.config or {}

                        if integration.type == IntegrationType.stripe:
                            if cfg.get("mode") != "mcp":
                                continue
                            if not integration.webhook_secret:
                                continue
                            try:
                                pulled = await pull_stripe_events(
                                    api_key=integration.webhook_secret,
                                    project_id=integration.project_id,
                                    integration_id=integration.id,
                                    db=db,
                                )
                                if pulled > 0:
                                    await enqueue_evaluation(integration.project_id, db)
                                    any_pulled = True
                                updated_config = dict(cfg)
                                updated_config["last_mcp_sync"] = now.isoformat()
                                integration.config = updated_config
                                db.add(integration)
                            except Exception:
                                pass

                        elif integration.type == IntegrationType.mcp_server:
                            server_url = cfg.get("server_url")
                            selected_tools = cfg.get("selected_tools") or []
                            if not server_url or not selected_tools:
                                continue

                            # Respect per-integration polling interval
                            interval = cfg.get("polling_interval_seconds", 300)
                            last_sync = cfg.get("last_mcp_sync")
                            if last_sync:
                                last_sync_dt = datetime.fromisoformat(last_sync)
                                if (now - last_sync_dt).total_seconds() < interval:
                                    continue

                            try:
                                pulled = await pull_mcp_server(
                                    server_url=server_url,
                                    selected_tools=selected_tools,
                                    project_id=integration.project_id,
                                    integration_id=integration.id,
                                    db=db,
                                    auth_type=cfg.get("auth_type", "none"),
                                    auth_value=integration.webhook_secret or None,
                                    auth_header_name=cfg.get("auth_header_name"),
                                )
                                if pulled > 0:
                                    await enqueue_evaluation(integration.project_id, db)
                                    any_pulled = True
                                updated_config = dict(cfg)
                                updated_config["last_mcp_sync"] = now.isoformat()
                                integration.config = updated_config
                                db.add(integration)
                            except Exception:
                                pass

                    if any_pulled or integrations_list:
                        await db.commit()
            except Exception:
                pass

    outbox_task    = asyncio.create_task(background_outbox_worker())
    evaluator_task = asyncio.create_task(background_evaluator())
    simulator_task = asyncio.create_task(background_simulator())
    mcp_puller_task = asyncio.create_task(background_mcp_puller())
    yield
    for task in (outbox_task, evaluator_task, simulator_task, mcp_puller_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    from app.services.demo import _get_ph
    ph = _get_ph()
    if ph:
        ph.flush()


app = FastAPI(title="Autopilot API", version="0.1.0", lifespan=lifespan)

# CORS — exact origin required for cookie-based cross-origin auth
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(members.router)
app.include_router(integrations.router)
app.include_router(events.router)
app.include_router(webhooks.router)
app.include_router(demo.router)
app.include_router(clusters.router)
app.include_router(scoring_config.router)
app.include_router(github_config.router)
app.include_router(dashboard.router)
app.include_router(chat.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all for non-HTTP exceptions.
    Without this, unhandled exceptions escape CORSMiddleware and reach
    Starlette's ServerErrorMiddleware, which returns a plain 500 with NO
    CORS headers — the browser then reports a CORS error instead of the
    real 500.  Registering a handler here keeps the response inside the
    ExceptionMiddleware → CORSMiddleware chain, so CORS headers are added.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
async def health():
    return {"status": "ok"}
