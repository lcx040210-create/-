# models.py
from pydantic import BaseModel, Field


class PlayerCreate(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    email: str | None = Field(default=None, max_length=100)


class ScoreCreate(BaseModel):
    player_id: int
    win_index: int
    score: int


class FeeCreate(BaseModel):
    player_id: int
    amount: float
