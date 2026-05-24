from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import ModelRoute


async def get_route(session: AsyncSession, alias_model: str) -> ModelRoute | None:
    result = await session.execute(
        select(ModelRoute).where(
            ModelRoute.alias_model == alias_model,
            ModelRoute.is_active == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def get_all_alias_models(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(ModelRoute.alias_model).where(ModelRoute.is_active == True)  # noqa: E712
    )
    return list(result.scalars().all())
