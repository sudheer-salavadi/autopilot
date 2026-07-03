"""Instance-level user roles (admin / member).

Adds users.role. Backfill: the earliest-created user becomes admin — on an
existing install that's whoever set the instance up, which matches the
bootstrap rule for fresh installs (first account created becomes admin).
Everyone else stays a member. Project-level MemberRole is unchanged and
independent of this.

Revision ID: 0022
Revises: 0021
"""
import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    userrole = sa.Enum("admin", "member", name="userrole")
    userrole.create(op.get_bind())
    op.add_column(
        "users",
        sa.Column("role", userrole, nullable=False, server_default="member"),
    )
    # The earliest account is the person who set the instance up
    op.execute(
        """
        UPDATE users SET role = 'admin'
         WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
        """
    )


def downgrade() -> None:
    op.drop_column("users", "role")
    sa.Enum(name="userrole").drop(op.get_bind())
