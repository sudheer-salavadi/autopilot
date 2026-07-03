"""Instance administration — user management for admins.

Instance roles (User.role: admin/member) are independent of per-project
roles (ProjectMember.role: owner/member). Admins manage accounts; they do
not implicitly see project data — project access still requires membership.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.project import Project, ProjectMember
from app.models.user import User, UserRole
from app.services.auth import (
    MAX_PASSWORD_BYTES,
    MIN_PASSWORD_LENGTH,
    hash_password,
)

router = APIRouter(
    prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)


def _validate_password(v: str) -> str:
    if len(v) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(v.encode()) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
    return v


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str = ""
    role: UserRole = UserRole.member

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class AdminUserUpdate(BaseModel):
    role: UserRole | None = None
    # Admin password reset — replaces the hash outright; there is no
    # email-based reset flow (that would require an SMTP dependency).
    new_password: str | None = None

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str | None) -> str | None:
        return _validate_password(v) if v is not None else None


def _user_row(user: User, owned_projects: int, memberships: int) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role.value,
        "has_password": user.password_hash is not None,
        "owned_projects": owned_projects,
        "memberships": memberships,
        "created_at": user.created_at.isoformat(),
    }


async def _counts(db: AsyncSession, user_id: uuid.UUID) -> tuple[int, int]:
    owned = await db.execute(
        select(func.count()).select_from(Project).where(Project.owner_id == user_id)
    )
    member = await db.execute(
        select(func.count()).select_from(ProjectMember).where(ProjectMember.user_id == user_id)
    )
    return owned.scalar_one(), member.scalar_one()


async def _count_login_capable_admins(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count()).select_from(User).where(
            User.role == UserRole.admin, User.password_hash.is_not(None)
        )
    )
    return result.scalar_one()


@router.get("/users")
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.created_at.asc()))
    users = result.scalars().all()
    rows = []
    for u in users:
        owned, member = await _counts(db, u.id)
        rows.append(_user_row(u, owned, member))
    return rows


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(body: AdminUserCreate, db: AsyncSession = Depends(get_db)):
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
        role=body.role,
    )
    db.add(user)
    await db.flush()
    return _user_row(user, 0, 0)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.role is not None and body.role != user.role:
        # Never leave the instance without a login-capable admin
        if (
            user.role == UserRole.admin
            and user.password_hash is not None
            and await _count_login_capable_admins(db) <= 1
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote the last admin — promote someone else first",
            )
        user.role = body.role

    if body.new_password is not None:
        user.password_hash = hash_password(body.new_password)

    db.add(user)
    owned, member = await _counts(db, user.id)
    return _user_row(user, owned, member)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself"
        )
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if (
        user.role == UserRole.admin
        and user.password_hash is not None
        and await _count_login_capable_admins(db) <= 1
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the last admin — promote someone else first",
        )

    owned, _ = await _counts(db, user.id)
    if owned:
        # projects.owner_id cascades — deleting this user would silently
        # delete their projects and every teammate's access to them.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User owns {owned} project(s) — delete those projects first "
            "(deleting the user would delete them for everyone)",
        )

    await db.delete(user)
