import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.router import get_route
from app.models import ModelRoute


@pytest.mark.asyncio
async def test_get_route_hit(db_session: AsyncSession):
    route = ModelRoute(
        alias_model="gpt-5.5",
        upstream_provider="deepseek",
        upstream_model="deepseek-v4-pro",
        api_format="openai",
        is_active=True,
    )
    db_session.add(route)
    await db_session.commit()
    result = await get_route(db_session, "gpt-5.5")
    assert result is not None
    assert result.alias_model == "gpt-5.5"
    assert result.upstream_model == "deepseek-v4-pro"
    assert result.api_format == "openai"


@pytest.mark.asyncio
async def test_get_route_miss(db_session: AsyncSession):
    result = await get_route(db_session, "nonexistent-model")
    assert result is None


@pytest.mark.asyncio
async def test_get_route_inactive(db_session: AsyncSession):
    route = ModelRoute(alias_model="gpt-old", upstream_provider="deepseek", upstream_model="deepseek-old", api_format="openai", is_active=False)
    db_session.add(route)
    await db_session.commit()
    result = await get_route(db_session, "gpt-old")
    assert result is None


@pytest.mark.asyncio
async def test_get_all_models(db_session: AsyncSession):
    from app.core.router import get_all_alias_models
    db_session.add(ModelRoute(alias_model="a", upstream_provider="x", upstream_model="xa", api_format="openai", is_active=True))
    db_session.add(ModelRoute(alias_model="b", upstream_provider="x", upstream_model="xb", api_format="openai", is_active=True))
    db_session.add(ModelRoute(alias_model="c", upstream_provider="x", upstream_model="xc", api_format="openai", is_active=False))
    await db_session.commit()
    models = await get_all_alias_models(db_session)
    assert set(models) == {"a", "b"}
