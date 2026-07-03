import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project_member, require_project_owner
from app.db.session import get_db
from app.models.project import ProjectMember
from app.models.user import User
from app.schemas.project import MemberInvite, MemberOut

router = APIRouter(prefix="/api/projects/{slug}/members", tags=["members"])


@router.get("", response_model=list[MemberOut])
async def list_members(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, __ = deps
    result = await db.execute(
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id)
    )
    rows = result.all()
    return [
        MemberOut(
            id=m.id,
            user_id=m.user_id,
            role=m.role,
            created_at=m.created_at,
            email=u.email,
            name=u.name,
        )
        for m, u in rows
    ]


@router.post("", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def invite_member(
    body: MemberInvite,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, __ = deps

    user_result = await db.execute(
        select(User).where(User.email == body.email.strip().lower())
    )
    invited_user = user_result.scalar_one_or_none()
    if not invited_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found — they must sign up first",
        )

    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == invited_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already a member")

    membership = ProjectMember(
        project_id=project.id, user_id=invited_user.id, role=body.role
    )
    db.add(membership)
    await db.flush()
    return MemberOut(
        id=membership.id,
        user_id=membership.user_id,
        role=membership.role,
        created_at=membership.created_at,
        email=invited_user.email,
        name=invited_user.name,
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: uuid.UUID,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, current_user, _ = deps
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove yourself"
        )

    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    await db.delete(membership)
