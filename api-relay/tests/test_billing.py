import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.billing import check_balance, calculate_cost, deduct_balance
from app.core.auth import hash_password
from app.models import User, Pricing


@pytest.mark.asyncio
async def test_check_balance_sufficient(db_session: AsyncSession):
    user = User(email="test@test.com", password_hash="hash", balance=10.0)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    assert await check_balance(user, 5.0) is True


@pytest.mark.asyncio
async def test_check_balance_insufficient(db_session: AsyncSession):
    user = User(email="test2@test.com", password_hash="hash", balance=1.0)
    db_session.add(user)
    await db_session.commit()
    result = await check_balance(user, 5.0)
    assert result is False


@pytest.mark.asyncio
async def test_calculate_cost(db_session: AsyncSession):
    pricing = Pricing(alias_model="gpt-5.5", price_per_1k_input=0.045, price_per_1k_output=0.18)
    db_session.add(pricing)
    await db_session.commit()
    cost = await calculate_cost(db_session, "gpt-5.5", tokens_in=500, tokens_out=200)
    # input: 500/1000 * 0.045 = 0.0225
    # output: 200/1000 * 0.18 = 0.036
    # total: 0.0585
    assert round(cost, 6) == 0.0585


@pytest.mark.asyncio
async def test_calculate_cost_missing_pricing(db_session: AsyncSession):
    cost = await calculate_cost(db_session, "nonexistent", 100, 50)
    assert cost == 0.0


@pytest.mark.asyncio
async def test_deduct_balance(db_session: AsyncSession):
    user = User(email="test3@test.com", password_hash="hash", balance=10.0)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    new_balance = await deduct_balance(db_session, user, 3.5, "gpt-5.5")
    assert new_balance == 6.5
    await db_session.refresh(user)
    assert user.balance == 6.5

    from app.models import Transaction
    from sqlalchemy import select
    result = await db_session.execute(select(Transaction).where(Transaction.user_id == user.id))
    txn = result.scalar_one_or_none()
    assert txn is not None
    assert txn.amount == -3.5
    assert txn.type == "consumption"
    assert txn.balance_after == 6.5
