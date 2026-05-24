from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import hash_password
from app.models import User, ModelRoute, Pricing


async def seed_db(session: AsyncSession):
    # 管理员账户
    result = await session.execute(select(User).where(User.email == settings.admin_email))
    if not result.scalar_one_or_none():
        session.add(User(
            email=settings.admin_email,
            password_hash=hash_password(settings.admin_password),
            balance=0.0,
            is_active=True,
        ))

    # 模型路由
    routes = [
        ("gpt-4o",         "deepseek", "deepseek-chat",    "openai"),
        ("gpt-4-turbo",    "deepseek", "deepseek-chat",    "openai"),
        ("gpt-5.5",        "deepseek", "deepseek-v4-pro",  "openai"),
        ("claude-sonnet-4-6", "deepseek", "deepseek-chat", "anthropic"),
        ("claude-opus-4-7",   "deepseek", "deepseek-v4-pro", "anthropic"),
    ]
    for alias, provider, upstream, fmt in routes:
        result = await session.execute(select(ModelRoute).where(ModelRoute.alias_model == alias))
        if not result.scalar_one_or_none():
            session.add(ModelRoute(
                alias_model=alias,
                upstream_provider=provider,
                upstream_model=upstream,
                api_format=fmt,
                is_active=True,
            ))

    # 定价
    prices = [
        ("gpt-4o",              0.015, 0.060),
        ("gpt-4-turbo",         0.025, 0.100),
        ("gpt-5.5",             0.045, 0.180),
        ("claude-sonnet-4-6",   0.020, 0.080),
        ("claude-opus-4-7",     0.060, 0.240),
    ]
    for model, inp, out in prices:
        result = await session.execute(select(Pricing).where(Pricing.alias_model == model))
        if not result.scalar_one_or_none():
            session.add(Pricing(
                alias_model=model,
                price_per_1k_input=inp,
                price_per_1k_output=out,
            ))

    await session.commit()

    # 验证
    result = await session.execute(select(ModelRoute))
    routes = result.scalars().all()
    print(f"Seeded {len(routes)} model routes")

    result = await session.execute(select(Pricing))
    prices = result.scalars().all()
    print(f"Seeded {len(prices)} pricing entries")
