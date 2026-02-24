import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.project import MemberRole


class ProjectCreate(BaseModel):
    name: str
    slug: str


class ProjectUpdate(BaseModel):
    name: str | None = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    owner_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class MemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: MemberRole
    created_at: datetime
    email: str = ""
    name: str = ""

    model_config = {"from_attributes": True}


class MemberInvite(BaseModel):
    email: str
    role: MemberRole = MemberRole.member
