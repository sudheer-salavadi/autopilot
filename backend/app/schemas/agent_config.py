import re

from pydantic import BaseModel, field_validator

_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")


class AgentProviderOut(BaseModel):
    provider: str
    name: str
    enabled: bool
    trigger_template: str
    is_custom_template: bool
    is_custom: bool
    setup_docs_url: str | None


class AgentProviderUpdate(BaseModel):
    enabled: bool | None = None
    trigger_template: str | None = None
    # True clears any custom trigger_template and reverts to the provider default
    # (built-in providers only — custom providers have no registry default)
    reset_template: bool = False


class AgentProviderCreate(BaseModel):
    provider: str
    name: str
    trigger_template: str
    setup_docs_url: str | None = None
    enabled: bool = True

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SLUG_RE.match(v):
            raise ValueError(
                "provider must be lowercase letters, numbers, and hyphens (max 32 chars)"
            )
        return v

    @field_validator("name", "trigger_template")
    @classmethod
    def validate_non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v.strip()


class AgentFixRequest(BaseModel):
    provider: str
