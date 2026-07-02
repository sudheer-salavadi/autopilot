from pydantic import BaseModel


class AgentProviderOut(BaseModel):
    provider: str
    name: str
    enabled: bool
    trigger_template: str
    is_custom_template: bool
    setup_docs_url: str


class AgentProviderUpdate(BaseModel):
    enabled: bool | None = None
    trigger_template: str | None = None
    # True clears any custom trigger_template and reverts to the provider default
    reset_template: bool = False


class AgentFixRequest(BaseModel):
    provider: str
