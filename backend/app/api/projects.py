import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project_member, require_project_owner
from app.db.session import get_db
from app.models.project import MemberRole, Project, ProjectMember
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == current_user.id)
        .order_by(Project.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    slug = _slugify(body.slug or body.name)
    existing = await db.execute(select(Project).where(Project.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already taken")

    project = Project(name=body.name, slug=slug, owner_id=current_user.id)
    db.add(project)
    await db.flush()

    membership = ProjectMember(
        project_id=project.id, user_id=current_user.id, role=MemberRole.owner
    )
    db.add(membership)
    await db.flush()
    return project


@router.get("/{slug}", response_model=ProjectOut)
async def get_project(deps=Depends(require_project_member)):
    project, _, __ = deps
    return project


@router.put("/{slug}", response_model=ProjectOut)
async def update_project(
    body: ProjectUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, __ = deps
    if body.name is not None:
        project.name = body.name
    db.add(project)
    return project


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, __ = deps
    await db.delete(project)
