from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    DATABASE_URL: str

    # WorkOS
    WORKOS_API_KEY: str
    WORKOS_CLIENT_ID: str

    # Session & encryption
    SESSION_SECRET_KEY: str
    ENCRYPTION_KEY: str

    # AI — OpenAI or LM Studio (OpenAI-compatible)
    OPENAI_API_KEY: str = ""
    LM_STUDIO_URL: str = ""        # e.g. http://host.docker.internal:1234/v1
    LM_STUDIO_MODEL: str = ""      # model identifier as shown in LM Studio
    LM_STUDIO_TIMEOUT: int = 300   # seconds — local models are slow

    # URLs
    FRONTEND_URL: str = "http://localhost:3000"
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: str = "http://localhost:8000/api/auth/callback"

    # GitHub App (optional — PAT-based fallback still works without these)
    GITHUB_APP_ID: str = ""
    GITHUB_APP_PRIVATE_KEY: str = ""   # full PEM, \n-escaped in .env
    GITHUB_APP_WEBHOOK_SECRET: str = ""
    GITHUB_APP_SLUG: str = ""          # for install URL: github.com/apps/{slug}/installations/new

    # JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_SECONDS: int = 60 * 60 * 24 * 7  # 7 days


settings = Settings()
