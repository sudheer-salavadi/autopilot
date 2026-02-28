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

    model_config = {"from_attributes": True}


class ScoringConfigUpdate(BaseModel):
    weight_revenue: float | None = None
    weight_frequency: float | None = None
    weight_ux: float | None = None
    max_revenue_usd: float | None = None
    max_frequency_count: int | None = None
    cross_channel: bool | None = None

    @field_validator("weight_revenue", "weight_frequency", "weight_ux", mode="before")
    @classmethod
    def weight_must_be_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Weight must be greater than 0")
        return v

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
