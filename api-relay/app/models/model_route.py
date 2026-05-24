from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ModelRoute(Base):
    __tablename__ = "model_routes"

    alias_model: Mapped[str] = mapped_column(String(50), primary_key=True)
    upstream_provider: Mapped[str] = mapped_column(String(50), nullable=False)
    upstream_model: Mapped[str] = mapped_column(String(50), nullable=False)
    api_format: Mapped[str] = mapped_column(String(20), nullable=False)  # "openai" or "anthropic"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
