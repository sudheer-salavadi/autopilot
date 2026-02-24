from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, demo, events, integrations, members, projects, webhooks
from app.config import settings

app = FastAPI(title="Autopilot API", version="0.1.0")

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


@app.get("/health")
async def health():
    return {"status": "ok"}
