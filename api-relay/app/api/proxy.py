import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.dependencies import get_current_user_from_api_key, get_api_key_id
from app.core.router import get_route, get_all_alias_models
from app.core.billing import calculate_cost, deduct_balance
from app.core.proxy import proxy_request, proxy_stream
from app.models import User, UsageLog

router = APIRouter()


@router.get("/v1/models")
async def list_models(session: AsyncSession = Depends(get_db)):
    models = await get_all_alias_models(session)
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "owned_by": "ai-relay"} for m in models],
    }


@router.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user_from_api_key),
    api_key_id: int = Depends(get_api_key_id),
):
    body = await request.json()
    alias_model = body.get("model", "")
    if not alias_model:
        raise HTTPException(status_code=400, detail="model field is required")

    route = await get_route(session, alias_model)
    if not route:
        raise HTTPException(status_code=404, detail=f"Model '{alias_model}' not found")

    if route.api_format != "openai":
        raise HTTPException(status_code=400, detail=f"Model '{alias_model}' uses Anthropic format. Use /v1/messages instead.")

    if user.balance <= 0:
        raise HTTPException(status_code=402, detail="Insufficient balance")

    is_stream = body.get("stream", False)
    upstream_key = _get_upstream_key(route.upstream_provider)
    upstream_base = _get_upstream_base(route.upstream_provider)
    upstream_path = "/v1/chat/completions"
    if not upstream_key:
        raise HTTPException(status_code=500, detail=f"Upstream provider '{route.upstream_provider}' not configured")

    if is_stream:
        async def event_generator():
            last_usage = {"tokens_in": 0, "tokens_out": 0, "duration_ms": 0}
            async for chunk in proxy_stream(
                upstream_base=upstream_base, upstream_path=upstream_path,
                api_key=upstream_key, request_body=body, alias_model=alias_model, route=route,
            ):
                if isinstance(chunk, tuple):
                    last_usage["tokens_in"] = chunk[0]
                    last_usage["tokens_out"] = chunk[1]
                    last_usage["duration_ms"] = chunk[2]
                else:
                    yield chunk if isinstance(chunk, bytes) else chunk.encode() if isinstance(chunk, str) else chunk

            cost = await calculate_cost(session, alias_model, last_usage["tokens_in"], last_usage["tokens_out"])
            await deduct_balance(session, user, cost, f"stream: {alias_model}")
            log = UsageLog(
                user_id=user.id, api_key_id=api_key_id,
                alias_model=alias_model, upstream_model=route.upstream_model,
                tokens_in=last_usage["tokens_in"], tokens_out=last_usage["tokens_out"],
                cost=cost, duration_ms=last_usage["duration_ms"], status="success",
            )
            session.add(log)
            await session.commit()

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    result = await proxy_request(
        method="POST", upstream_base=upstream_base, upstream_path=upstream_path,
        api_key=upstream_key, request_body=body, alias_model=alias_model, route=route,
    )

    if result["status"] == "error":
        log = UsageLog(
            user_id=user.id, api_key_id=api_key_id,
            alias_model=alias_model, upstream_model=route.upstream_model,
            tokens_in=0, tokens_out=0, cost=0, duration_ms=result["duration_ms"],
            status="error", error_msg=result.get("error_msg", ""),
        )
        session.add(log)
        await session.commit()
        raise HTTPException(status_code=502, detail=result["body"])

    cost = await calculate_cost(session, alias_model, result["tokens_in"], result["tokens_out"])
    try:
        await deduct_balance(session, user, cost, f"chat: {alias_model}")
    except ValueError:
        raise HTTPException(status_code=402, detail="Insufficient balance")
    log = UsageLog(
        user_id=user.id, api_key_id=api_key_id,
        alias_model=alias_model, upstream_model=route.upstream_model,
        tokens_in=result["tokens_in"], tokens_out=result["tokens_out"],
        cost=cost, duration_ms=result["duration_ms"], status="success",
    )
    session.add(log)
    await session.commit()
    return result["body"]


@router.post("/v1/messages")
async def messages_endpoint(
    request: Request,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user_from_api_key),
    api_key_id: int = Depends(get_api_key_id),
):
    body = await request.json()
    alias_model = body.get("model", "")
    route = await get_route(session, alias_model)
    if not route:
        raise HTTPException(status_code=404, detail=f"Model '{alias_model}' not found")

    if user.balance <= 0:
        raise HTTPException(status_code=402, detail="Insufficient balance")

    upstream_key = _get_upstream_key(route.upstream_provider)
    upstream_base = _get_upstream_base(route.upstream_provider)
    if not upstream_key:
        raise HTTPException(status_code=500, detail=f"Upstream provider '{route.upstream_provider}' not configured")

    result = await proxy_request(
        method="POST", upstream_base=upstream_base, upstream_path="/v1/chat/completions",
        api_key=upstream_key, request_body=body, alias_model=alias_model, route=route,
    )

    if result["status"] == "error":
        log = UsageLog(user_id=user.id, api_key_id=api_key_id, alias_model=alias_model,
                       upstream_model=route.upstream_model, tokens_in=0, tokens_out=0, cost=0,
                       duration_ms=result["duration_ms"], status="error", error_msg=result.get("error_msg", ""))
        session.add(log)
        await session.commit()
        raise HTTPException(status_code=502, detail=result["body"])

    cost = await calculate_cost(session, alias_model, result["tokens_in"], result["tokens_out"])
    try:
        await deduct_balance(session, user, cost, f"message: {alias_model}")
    except ValueError:
        raise HTTPException(status_code=402, detail="Insufficient balance")
    log = UsageLog(user_id=user.id, api_key_id=api_key_id, alias_model=alias_model,
                   upstream_model=route.upstream_model, tokens_in=result["tokens_in"],
                   tokens_out=result["tokens_out"], cost=cost, duration_ms=result["duration_ms"], status="success")
    session.add(log)
    await session.commit()
    return result["body"]


def _get_upstream_key(provider: str) -> str:
    keys = {"deepseek": settings.deepseek_api_key}
    return keys.get(provider, "")


def _get_upstream_base(provider: str) -> str:
    bases = {"deepseek": settings.deepseek_base_url}
    return bases.get(provider, "")
