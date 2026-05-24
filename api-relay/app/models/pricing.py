from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Pricing(Base):
    __tablename__ = "pricing"

    alias_model: Mapped[str] = mapped_column(String(50), primary_key=True)
    price_per_1k_input: Mapped[float] = mapped_column(nullable=False, default=0.0)
    price_per_1k_output: Mapped[float] = mapped_column(nullable=False, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
