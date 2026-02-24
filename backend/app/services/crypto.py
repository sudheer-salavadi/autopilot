from cryptography.fernet import Fernet, MultiFernet
from sqlalchemy import String, TypeDecorator

from app.config import settings

# Support key rotation: pass comma-separated keys, first is primary
_keys = [k.strip() for k in settings.ENCRYPTION_KEY.split(",") if k.strip()]
_fernet = MultiFernet([Fernet(k) for k in _keys])


class EncryptedString(TypeDecorator):
    """SQLAlchemy TypeDecorator that transparently Fernet-encrypts string columns."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        return _fernet.encrypt(value.encode()).decode()

    def process_result_value(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        return _fernet.decrypt(value.encode()).decode()
