from fastapi import Cookie, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.models.project import MemberRole, Project, ProjectMember
from app.models.user import User
from app.services.auth import verify_session_token

_DEV_USER_EMAIL = "dev@localhost"


async def _get_or_create_dev_user(db: AsyncSession) -> User:
    """The shared no-password user every request runs as when SKIP_AUTH=true."""
    result = await db.execute(select(User).where(User.email == _DEV_USER_EMAIL))
    user = result.scalar_one_or_none()
    if not user:
        user = User(email=_DEV_USER_EMAIL, name="Dev User", password_hash=None)
        db.add(user)
        await db.flush()
    return user


async def get_current_user(
    ap_session: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if settings.SKIP_AUTH:
        return await _get_or_create_dev_user(db)

    if not ap_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = verify_session_token(ap_session)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


async def get_project_by_slug(
    slug: str = Path(...),
    db: AsyncSession = Depends(get_db),
) -> Project:
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def require_project_member(
    project: Project = Depends(get_project_by_slug),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> tuple[Project, User, ProjectMember]:
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == current_user.id,
        )
    )
    membership = result.scalar_one_or_none()

    if not membership:
        if settings.SKIP_AUTH:
            membership = ProjectMember(
                project_id=project.id,
                user_id=current_user.id,
                role=MemberRole.owner,
            )
            db.add(membership)
            await db.flush()
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a project member")

    return project, current_user, membership


async def require_project_owner(
    deps: tuple = Depends(require_project_member),
) -> tuple[Project, User, ProjectMember]:
    project, user, membership = deps
    if membership.role != MemberRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required")
    return project, user, membership
