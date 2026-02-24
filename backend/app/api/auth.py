from fastapi import APIRouter, Depends, Response
from fastapi.responses import RedirectResponse

from app.api.deps import get_current_user
from app.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services.auth import create_session_token, get_or_create_user, workos_client

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/login")
async def login():
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
    workos_user = auth_response.user.model_dump()

    user = await get_or_create_user(db, workos_user)
    token = create_session_token(str(user.id))

    redirect = RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard")
    redirect.set_cookie(
        key="ap_session",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # set True in production (HTTPS)
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


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("ap_session")
    return {"ok": True}
