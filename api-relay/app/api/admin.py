from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import User, ModelRoute, Pricing, UsageLog, Transaction

router = APIRouter(prefix="/admin")
ADMIN_SESSIONS: dict[str, bool] = {}


async def get_admin(request: Request) -> bool:
    token = request.cookies.get("admin_session")
    if not token or token not in ADMIN_SESSIONS:
        raise HTTPException(status_code=401, detail="Admin login required")
    return True


@router.post("/login")
async def admin_login(request: Request):
    body = await request.json()
    email = body.get("email", "")
    password = body.get("password", "")
    if email != settings.admin_email or password != settings.admin_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    import secrets
    token = secrets.token_hex(32)
    ADMIN_SESSIONS[token] = True
    resp = JSONResponse({"ok": True})
    resp.set_cookie("admin_session", token, httponly=True)
    return resp


@router.get("/users")
async def list_users(
    _: bool = Depends(get_admin),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(select(User).order_by(User.created_at.desc()).limit(100))
    users = result.scalars().all()
    return [
        {"id": u.id, "email": u.email, "balance": u.balance, "is_active": u.is_active, "created_at": str(u.created_at)}
        for u in users
    ]


@router.post("/users/{user_id}/topup")
async def topup_user(
    user_id: int,
    request: Request,
    _: bool = Depends(get_admin),
    session: AsyncSession = Depends(get_db),
):
    body = await request.json()
    amount = float(body.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.balance += amount
    txn = Transaction(user_id=user.id, amount=amount, type="topup", balance_after=user.balance, note="Admin topup")
    session.add(txn)
    await session.commit()

    return {"ok": True, "new_balance": user.balance}


@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: int,
    _: bool = Depends(get_admin),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = not user.is_active
    await session.commit()
    return {"ok": True, "is_active": user.is_active}


@router.get("/routes")
async def list_routes(
    _: bool = Depends(get_admin),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(select(ModelRoute))
    routes = result.scalars().all()
    return [
        {"alias": r.alias_model, "upstream_provider": r.upstream_provider, "upstream_model": r.upstream_model, "api_format": r.api_format, "is_active": r.is_active}
        for r in routes
    ]


@router.put("/routes/{alias_model}")
async def update_route(
    alias_model: str,
    request: Request,
    _: bool = Depends(get_admin),
    session: AsyncSession = Depends(get_db),
):
    body = await request.json()
    result = await session.execute(select(ModelRoute).where(ModelRoute.alias_model == alias_model))
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    if "upstream_provider" in body:
        route.upstream_provider = body["upstream_provider"]
    if "upstream_model" in body:
        route.upstream_model = body["upstream_model"]
    if "api_format" in body:
        route.api_format = body["api_format"]
    if "is_active" in body:
        route.is_active = body["is_active"]

    await session.commit()
    return {"ok": True}


@router.put("/pricing/{alias_model}")
async def update_pricing(
    alias_model: str,
    request: Request,
    _: bool = Depends(get_admin),
    session: AsyncSession = Depends(get_db),
):
    body = await request.json()
    result = await session.execute(select(Pricing).where(Pricing.alias_model == alias_model))
    pricing = result.scalar_one_or_none()
    if not pricing:
        raise HTTPException(status_code=404, detail="Pricing not found")

    if "price_per_1k_input" in body:
        pricing.price_per_1k_input = body["price_per_1k_input"]
    if "price_per_1k_output" in body:
        pricing.price_per_1k_output = body["price_per_1k_output"]

    await session.commit()
    return {"ok": True}


@router.get("/stats")
async def get_stats(
    _: bool = Depends(get_admin),
    session: AsyncSession = Depends(get_db),
):
    # 用户总数
    result = await session.execute(select(func.count(User.id)))
    total_users = result.scalar()

    # 今日调用
    today = datetime.now(timezone.utc).date()
    result = await session.execute(
        select(func.count(UsageLog.id)).where(func.date(UsageLog.created_at) == str(today))
    )
    today_calls = result.scalar() or 0

    # 总充值
    result = await session.execute(
        select(func.sum(Transaction.amount)).where(Transaction.type == "topup")
    )
    total_topup = result.scalar() or 0.0

    return {
        "total_users": total_users,
        "today_calls": today_calls,
        "total_topup": round(float(total_topup), 2),
    }
