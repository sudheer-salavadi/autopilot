import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import auth, clusters, demo, events, integrations, members, projects, scoring_config, webhooks
from app.config import settings
from app.db.session import AsyncSessionLocal
from app.services.evaluator import evaluate_all_projects

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def background_evaluator():
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    await evaluate_all_projects(db)
            except Exception:
                pass
            await asyncio.sleep(120)

    task = asyncio.create_task(background_evaluator())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


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
