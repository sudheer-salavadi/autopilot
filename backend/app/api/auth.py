from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, _get_or_create_dev_user
from app.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services.auth import create_session_token, get_or_create_user, workos_client

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/login")
async def login(db: AsyncSession = Depends(get_db)):
    if settings.SKIP_AUTH:
        user = await _get_or_create_dev_user(db)
        token = create_session_token(str(user.id))
        redirect = RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard")
        redirect.set_cookie(
            key="ap_session",
            value=token,
            httponly=True,
            samesite="lax",
            secure=settings.HTTPS_COOKIES,
            max_age=settings.JWT_EXPIRE_SECONDS,
        )
        return redirect

    if not workos_client:
        raise HTTPException(
            status_code=503,
            detail="Authentication not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID, or set SKIP_AUTH=true for local development.",
        )

    url = workos_client.user_management.get_authorization_url(
        redirect_uri=settings.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
        provider="authkit",
    )
    return RedirectResponse(url=url)


@router.get("/callback")
async def callback(code: str, response: Response, db=Depends(get_db)):
    auth_response = workos_client.user_management.authenticate_with_code(
        code=code,
    )

    user = await get_or_create_user(db, auth_response.user)
    token = create_session_token(str(user.id))

    redirect = RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard")
    redirect.set_cookie(
        key="ap_session",
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.HTTPS_COOKIES,
        max_age=settings.JWT_EXPIRE_SECONDS,
    )
    return redirect


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
    }


class UserUpdate(BaseModel):
    name: str | None = None


@router.put("/me")
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    if body.name is not None:
        current_user.name = body.name.strip()
    db.add(current_user)
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
    }


@router.get("/logout")
async def logout_get():
    response = RedirectResponse(url=f"{settings.FRONTEND_URL}/", status_code=302)
    response.delete_cookie("ap_session")
    return response


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("ap_session")
    return {"ok": True}
