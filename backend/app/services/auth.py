from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from workos import WorkOSClient

from app.config import settings
from app.models.user import User

workos_client = WorkOSClient(api_key=settings.WORKOS_API_KEY, client_id=settings.WORKOS_CLIENT_ID)


def create_session_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=settings.JWT_EXPIRE_SECONDS)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        settings.SESSION_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def verify_session_token(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token, settings.SESSION_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload.get("sub")
    except JWTError:
        return None


async def get_or_create_user(db: AsyncSession, workos_user: dict) -> User:
    result = await db.execute(
        select(User).where(User.workos_user_id == workos_user["id"])
    )
    user = result.scalar_one_or_none()
    if user:
        return user

    user = User(
        workos_user_id=workos_user["id"],
        email=workos_user.get("email", ""),
        name=f"{workos_user.get('first_name', '')} {workos_user.get('last_name', '')}".strip(),
    )
    db.add(user)
    await db.flush()
    return user
