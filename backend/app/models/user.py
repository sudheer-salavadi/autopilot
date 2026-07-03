import enum
import uuid

from sqlalchemy import Enum, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class UserRole(str, enum.Enum):
    """Instance-level role, distinct from per-project MemberRole.

    admin  — manages the instance: users, roles, password resets. The first
             account created on an instance is bootstrapped as admin.
    member — everything else: can create projects and use the product; sees
             only projects they own or were invited to.
    """

    admin = "admin"
    member = "member"


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    # bcrypt hash. Nullable: the SKIP_AUTH dev user has no password and can
    # never log in through the password endpoint.
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole), nullable=False, default=UserRole.member, server_default="member"
    )

    # Relationships
    owned_projects: Mapped[list["Project"]] = relationship(  # noqa: F821
        "Project", back_populates="owner", foreign_keys="Project.owner_id"
    )
    memberships: Mapped[list["ProjectMember"]] = relationship(  # noqa: F821
        "ProjectMember", back_populates="user"
    )
