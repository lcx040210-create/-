from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import User, Pricing, Transaction


async def check_balance(user: User, required: float) -> bool:
    return user.balance >= required


async def calculate_cost(
    session: AsyncSession, alias_model: str, tokens_in: int, tokens_out: int
) -> float:
    result = await session.execute(
        select(Pricing).where(Pricing.alias_model == alias_model)
    )
    pricing = result.scalar_one_or_none()
    if not pricing:
        return 0.0
    cost_in = (tokens_in / 1000.0) * pricing.price_per_1k_input
    cost_out = (tokens_out / 1000.0) * pricing.price_per_1k_output
    return round(cost_in + cost_out, 10)


async def deduct_balance(
    session: AsyncSession, user: User, amount: float, note: str = ""
) -> float:
    if amount <= 0:
        return user.balance

    # Lock user row for atomic balance check + deduction
    result = await session.execute(
        select(User).where(User.id == user.id).with_for_update()
    )
    locked_user = result.scalar_one()

    if locked_user.balance < amount:
        raise ValueError("Insufficient balance")

    locked_user.balance -= amount
    new_balance = locked_user.balance

    txn = Transaction(
        user_id=user.id,
        amount=-amount,
        type="consumption",
        balance_after=new_balance,
        note=note,
    )
    session.add(txn)
    await session.commit()
    return new_balance
