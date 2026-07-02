import uuid

from pydantic import BaseModel, field_validator, model_validator


class ScoringConfigOut(BaseModel):
    project_id: uuid.UUID
    weight_revenue: float
    weight_frequency: float
    weight_ux: float
    max_revenue_usd: float
    max_frequency_count: int
    cross_channel: bool
    simulate_stripe: bool
    simulate_sentry: bool
    simulate_fullstory: bool
    simulate_zendesk: bool
    # Pluggable scoring — a custom scoring plugin URL that overrides the
    # internal revenue/frequency/ux formula (see app.services.evaluator).
    scoring_webhook_url: str | None = None
    has_scoring_webhook_secret: bool = False

    model_config = {"from_attributes": True}


class ScoringConfigUpdate(BaseModel):
    weight_revenue: float | None = None
    weight_frequency: float | None = None
    weight_ux: float | None = None
    max_revenue_usd: float | None = None
    max_frequency_count: int | None = None
    cross_channel: bool | None = None
    # Empty string clears the webhook (disables the scoring override)
    scoring_webhook_url: str | None = None
    scoring_webhook_secret: str | None = None

    @field_validator("weight_revenue", "weight_frequency", "weight_ux", mode="before")
    @classmethod
    def weight_must_be_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Weight must be greater than 0")
        return v

    @field_validator("scoring_webhook_url", "scoring_webhook_secret")
    @classmethod
    def blank_string_means_clear(cls, v: str | None) -> str | None:
        return v or None

    @model_validator(mode="after")
    def weights_must_sum_to_one(self):
        weights = [self.weight_revenue, self.weight_frequency, self.weight_ux]
        provided = [w for w in weights if w is not None]
        if len(provided) == 3:
            total = sum(provided)
            if abs(total - 1.0) > 0.01:
                raise ValueError(
                    f"Weights must sum to 1.0 (±0.01), got {total:.4f}"
                )
        return self
