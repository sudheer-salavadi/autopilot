from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Valid Fernet key (32 zero-bytes, base64url-encoded) — dev only, not cryptographically safe
_DEV_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
_DEV_SESSION_KEY = "dev-insecure-session-secret-do-not-use-in-production-00000"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    DATABASE_URL: str

    # Skip authentication — dev/evaluation only, never in production.
    # Every request runs as a shared local "Dev User".
    SKIP_AUTH: bool = False

    # Block new account registration (e.g. once your team has signed up on a
    # deployed instance). Existing accounts keep working.
    DISABLE_SIGNUP: bool = False

    # Session & encryption — required when SKIP_AUTH=false; insecure defaults for dev
    SESSION_SECRET_KEY: str = _DEV_SESSION_KEY
    ENCRYPTION_KEY: str = _DEV_ENCRYPTION_KEY

    # AI — bring your own model. AI_BASE_URL points at ANY OpenAI-compatible
    # endpoint (LM Studio, Ollama, vLLM, OpenRouter, ...) and takes priority
    # over OPENAI_API_KEY, which remains the zero-config default so the app
    # runs out of the box without picking a local model first.
    AI_BASE_URL: str = ""          # e.g. http://host.docker.internal:11434/v1 (Ollama)
    AI_API_KEY: str = ""           # most local servers ignore this — any non-empty string works
    AI_MODEL: str = ""             # model name as served by AI_BASE_URL, e.g. "llama3.1" or "qwen2.5-coder"
    AI_TIMEOUT: int = 300          # seconds — local models are slow
    AI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    # Must match the embedding model's output dimension. Changing this after
    # the DB is migrated requires a new migration (see docs/platform-vision.md).
    AI_EMBEDDING_DIMS: int = 1536
    OPENAI_API_KEY: str = ""

    # Deprecated aliases — still honored if AI_BASE_URL/AI_MODEL aren't set,
    # so existing .env files with LM_STUDIO_* keep working unchanged.
    LM_STUDIO_URL: str = ""
    LM_STUDIO_MODEL: str = ""
    LM_STUDIO_TIMEOUT: int = 300

    # Gemini fallback (used only when the primary AI_BASE_URL/OpenAI call fails)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"

    # URLs
    FRONTEND_URL: str = "http://localhost:3000"

    # GitHub App (optional — PAT-based fallback still works without these)
    GITHUB_APP_ID: str = ""
    GITHUB_APP_PRIVATE_KEY: str = ""   # full PEM, \n-escaped in .env
    GITHUB_APP_WEBHOOK_SECRET: str = ""
    GITHUB_APP_SLUG: str = ""          # for install URL: github.com/apps/{slug}/installations/new

    # JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_SECONDS: int = 60 * 60 * 24 * 7  # 7 days

    # Set True in production (HTTPS). Controls the Secure flag on ap_session cookie.
    HTTPS_COOKIES: bool = False

    @model_validator(mode="after")
    def check_auth_config(self) -> "Settings":
        if not self.SKIP_AUTH:
            if self.SESSION_SECRET_KEY == _DEV_SESSION_KEY:
                raise ValueError(
                    "SESSION_SECRET_KEY must be set to a secure value. "
                    "Generate one with: openssl rand -hex 32"
                )
            if self.ENCRYPTION_KEY == _DEV_ENCRYPTION_KEY:
                raise ValueError(
                    "ENCRYPTION_KEY must be set to a secure value. "
                    "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
                )
        return self


settings = Settings()
