"""Self-contained email/password auth — drop the WorkOS identity column.

Auth is now fully in-app (bcrypt password + JWT session cookie), so users
are identified by email instead of a WorkOS user id:
- users.workos_user_id is dropped
- users.email becomes unique (it's the login identifier now)
- users.password_hash is added (nullable — the SKIP_AUTH dev user has none)

Existing users created through WorkOS keep their row (projects and
memberships untouched) but have no password yet — and signing up again with
the same email is blocked by the new unique constraint. The operator sets a
password on the existing row instead:
  docker compose exec backend python -c \
    "import bcrypt; print(bcrypt.hashpw(b'newpassword', bcrypt.gensalt()).decode())"
  UPDATE users SET password_hash='<hash>' WHERE email='<email>';

Revision ID: 0021
Revises: 0020
"""
import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(), nullable=True))
    op.drop_column("users", "workos_user_id")
    # Login identifier now — must be unique. Pre-existing duplicate emails
    # (possible only if the same person authed via WorkOS with two WorkOS
    # accounts sharing an email) must be merged manually before upgrading.
    op.create_unique_constraint("uq_users_email", "users", ["email"])
    op.create_index("ix_users_email", "users", ["email"])


def downgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_column("users", "password_hash")
    op.add_column(
        "users",
        sa.Column("workos_user_id", sa.String(), nullable=True, unique=True),
    )
