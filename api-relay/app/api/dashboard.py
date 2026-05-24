from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.core.auth import (
    hash_password,
    verify_password,
    generate_api_key,
    hash_api_key,
)
from app.models import User, ApiKey, UsageLog, Pricing

router = APIRouter(prefix="/api")
SESSIONS: dict[str, int] = {}  # 简易 session token → user_id


def create_session_token() -> str:
    import secrets
    return secrets.token_hex(32)


async def get_current_user(request: Request, session: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get("session")
    if not token or token not in SESSIONS:
        raise HTTPException(status_code=401, detail="Not logged in")
    user_id = SESSIONS[token]
    result = await session.execute(select(User).where(User.id == user_id, User.is_active == True))  # noqa: E712
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# --- Auth ---

@router.post("/auth/register")
async def register(request: Request, session: AsyncSession = Depends(get_db)):
    body = await request.json()
    email = body.get("email", "").strip()
    password = body.get("password", "")

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password min 6 chars")

    result = await session.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(email=email, password_hash=hash_password(password), balance=0.0)
    session.add(user)
    await session.commit()
    await session.refresh(user)

    token = create_session_token()
    SESSIONS[token] = user.id

    resp = JSONResponse({"ok": True, "email": user.email, "balance": user.balance})
    resp.set_cookie("session", token, httponly=True)
    return resp


@router.post("/auth/login")
async def login(request: Request, session: AsyncSession = Depends(get_db)):
    body = await request.json()
    email = body.get("email", "").strip()
    password = body.get("password", "")

    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account banned")

    token = create_session_token()
    SESSIONS[token] = user.id

    resp = JSONResponse({"ok": True, "email": user.email, "balance": user.balance})
    resp.set_cookie("session", token, httponly=True)
    return resp


@router.post("/auth/logout")
async def logout(request: Request):
    token = request.cookies.get("session")
    if token:
        SESSIONS.pop(token, None)
    return {"ok": True}


# --- User ---

@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "email": user.email,
        "balance": user.balance,
        "created_at": str(user.created_at),
    }


# --- API Keys ---

@router.get("/keys")
async def list_keys(
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await session.execute(
        select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.is_active == True)  # noqa: E712
    )
    keys = result.scalars().all()
    return [
        {"id": k.id, "name": k.name, "key_prefix": k.key_prefix, "created_at": str(k.created_at)}
        for k in keys
    ]


@router.post("/keys")
async def create_key(
    request: Request,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    body = await request.json()
    name = body.get("name", "default")

    full_key = generate_api_key()
    key_hash = hash_api_key(full_key)

    api_key = ApiKey(
        user_id=user.id,
        key_hash=key_hash,
        key_prefix=full_key[:12],
        name=name,
    )
    session.add(api_key)
    await session.commit()

    return {"id": api_key.id, "name": name, "key": full_key, "key_prefix": full_key[:12]}


@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: int,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await session.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id)
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="Key not found")

    key.is_active = False
    await session.commit()
    return {"ok": True}


# --- Usage ---

@router.get("/usage")
async def get_usage(
    days: int = 7,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    since = datetime.utcnow() - timedelta(days=days)
    result = await session.execute(
        select(UsageLog).where(UsageLog.user_id == user.id, UsageLog.created_at >= since)
    )
    logs = result.scalars().all()

    total_cost = sum(l.cost for l in logs)
    total_calls = len(logs)

    return {
        "days": days,
        "total_calls": total_calls,
        "total_cost": round(total_cost, 6),
        "by_model": _group_by_model(logs),
        "by_day": _group_by_day(logs),
    }


@router.get("/logs")
async def get_logs(
    page: int = 1,
    model: str = "",
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    per_page = 20
    query = select(UsageLog).where(UsageLog.user_id == user.id)
    if model:
        query = query.where(UsageLog.alias_model == model)
    query = query.order_by(UsageLog.created_at.desc()).offset((page - 1) * per_page).limit(per_page)

    result = await session.execute(query)
    logs = result.scalars().all()

    return [
        {
            "time": str(l.created_at),
            "model": l.alias_model,
            "tokens": l.tokens_in + l.tokens_out,
            "cost": l.cost,
            "status": l.status,
        }
        for l in logs
    ]


@router.get("/pricing")
async def get_pricing(session: AsyncSession = Depends(get_db)):
    result = await session.execute(select(Pricing))
    prices = result.scalars().all()
    return [
        {"model": p.alias_model, "input_price_per_1k": p.price_per_1k_input, "output_price_per_1k": p.price_per_1k_output}
        for p in prices
    ]


# --- helpers ---

def _group_by_model(logs):
    groups: dict[str, dict] = {}
    for log in logs:
        if log.alias_model not in groups:
            groups[log.alias_model] = {"model": log.alias_model, "calls": 0, "total_tokens": 0, "total_cost": 0.0}
        g = groups[log.alias_model]
        g["calls"] += 1
        g["total_tokens"] += log.tokens_in + log.tokens_out
        g["total_cost"] += log.cost
    for g in groups.values():
        g["total_cost"] = round(g["total_cost"], 6)
    return list(groups.values())


def _group_by_day(logs):
    groups: dict[str, dict] = {}
    for log in logs:
        day = str(log.created_at.date())
        if day not in groups:
            groups[day] = {"date": day, "calls": 0, "total_cost": 0.0}
        groups[day]["calls"] += 1
        groups[day]["total_cost"] += log.cost
    for g in groups.values():
        g["total_cost"] = round(g["total_cost"], 6)
    return sorted(groups.values(), key=lambda x: x["date"])
