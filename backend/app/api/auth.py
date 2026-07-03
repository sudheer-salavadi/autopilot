from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, _get_or_create_dev_user
from app.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services.auth import (
    MAX_PASSWORD_BYTES,
    MIN_PASSWORD_LENGTH,
    create_session_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        key="ap_session",
        value=create_session_token(str(user.id)),
        httponly=True,
        samesite="lax",
        secure=settings.HTTPS_COOKIES,
        max_age=settings.JWT_EXPIRE_SECONDS,
    )


def _user_json(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "name": user.name}


class Credentials(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class SignupRequest(Credentials):
    name: str = ""

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        if len(v.encode()) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
        return v


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignupRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    if settings.DISABLE_SIGNUP:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Signups are disabled on this instance (DISABLE_SIGNUP=true). "
            "Ask the person running it to create your account.",
        )

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    user = User(
        email=body.email,
        name=body.name.strip() or body.email.split("@")[0],
        password_hash=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    _set_session_cookie(response, user)
    return _user_json(user)


@router.post("/login")
async def login(
    body: Credentials,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # verify_password burns a bcrypt check even when the user doesn't exist
    # or has no password, so response timing doesn't leak which emails exist.
    if not verify_password(body.password, user.password_hash if user else None):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    _set_session_cookie(response, user)
    return _user_json(user)


@router.get("/login")
async def login_redirect(db: AsyncSession = Depends(get_db)):
    """Browser entry point (used by the landing page's CTA).

    SKIP_AUTH=true: create/reuse the shared dev user, set the session cookie,
    and go straight to the dashboard — the zero-config evaluation path.
    Otherwise: send the browser to the frontend's login page.
    """
    if settings.SKIP_AUTH:
        user = await _get_or_create_dev_user(db)
        redirect = RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard")
        _set_session_cookie(redirect, user)
        return redirect

    return RedirectResponse(url=f"{settings.FRONTEND_URL}/login")


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return _user_json(current_user)


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
    return _user_json(current_user)


@router.get("/logout")
async def logout_get():
    response = RedirectResponse(url=f"{settings.FRONTEND_URL}/", status_code=302)
    response.delete_cookie("ap_session")
    return response


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("ap_session")
    return {"ok": True}
