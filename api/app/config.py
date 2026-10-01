from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Simulator: empty string => mock mode
    simulator_url: str = ""
    poll_interval_seconds: float = 3.0

    database_url: str = "postgresql+psycopg://fuelops:fuelops@localhost:5432/fuelops"

    operator_token: str = "local-dev-token"

    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"

    cors_origins: str = ""

    @property
    def simulator_base(self) -> str:
        return self.simulator_url.rstrip("/")

    @property
    def is_mock(self) -> bool:
        return not self.simulator_base

    @property
    def cors_origin_list(self) -> list[str]:
        if not self.cors_origins:
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
