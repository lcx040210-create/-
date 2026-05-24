import json
import time
from urllib.parse import urljoin

import httpx

from app.config import settings
from app.core.cleaner import ProxyCleaner
from app.core.converter import anthropic_to_openai, openai_to_anthropic

cleaner = ProxyCleaner()


def build_upstream_url(base_url: str, path: str) -> str:
    base = base_url.rstrip("/") + "/"
    return urljoin(base, path.lstrip("/"))


def extract_usage(response_body: dict) -> tuple[int, int]:
    usage = response_body.get("usage", {})
    tokens_in = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
    tokens_out = usage.get("completion_tokens") or usage.get("output_tokens") or 0
    return tokens_in, tokens_out


async def proxy_request(
    method: str,
    upstream_base: str,
    upstream_path: str,
    api_key: str,
    request_body: dict,
    alias_model: str,
    route,
) -> dict:
    url = build_upstream_url(upstream_base, upstream_path)
    if route.api_format == "anthropic":
        request_body = anthropic_to_openai(request_body, route.upstream_model)
    cleaned_body = cleaner.clean_request(request_body, route.upstream_model)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    start = time.time()
    async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
        response = await client.request(method, url, json=cleaned_body, headers=headers)
    duration_ms = int((time.time() - start) * 1000)
    response_body = response.json() if response.content else {}
    if response.status_code != 200:
        error_text = cleaner.clean_error(response_body, alias_model)
        return {
            "status": "error",
            "body": error_text,
            "tokens_in": 0,
            "tokens_out": 0,
            "duration_ms": duration_ms,
            "error_msg": str(response_body)[:500],
        }
    cleaned_response = cleaner.clean_response(response_body, alias_model)
    if route.api_format == "anthropic":
        cleaned_response = openai_to_anthropic(cleaned_response, alias_model)
    tokens_in, tokens_out = extract_usage(response_body)
    return {
        "status": "success",
        "body": cleaned_response,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "duration_ms": duration_ms,
    }


async def proxy_stream(
    upstream_base: str,
    upstream_path: str,
    api_key: str,
    request_body: dict,
    alias_model: str,
    route,
):
    url = build_upstream_url(upstream_base, upstream_path)
    if route.api_format == "anthropic":
        request_body = anthropic_to_openai(request_body, route.upstream_model)
    cleaned_body = cleaner.clean_request(request_body, route.upstream_model)
    cleaned_body["stream"] = True
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    accumulated_body_chunks = []
    start = time.time()
    async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
        async with client.stream("POST", url, json=cleaned_body, headers=headers) as response:
            if response.status_code != 200:
                error_body = await response.aread()
                try:
                    error_json = json.loads(error_body)
                except json.JSONDecodeError:
                    error_json = {"error": {"message": error_body.decode()[:500]}}
                yield cleaner.clean_error(error_json, alias_model)
                return
            async for line in response.aiter_lines():
                if not line:
                    continue
                if line.startswith("data: ") and "[DONE]" not in line:
                    accumulated_body_chunks.append(line)
                cleaned_line = cleaner.clean_sse_chunk(line + "\n", alias_model)
                yield cleaned_line.strip()
    tokens_in = 0
    tokens_out = 0
    for chunk in accumulated_body_chunks:
        try:
            payload_str = chunk[len("data: "):]
            data = json.loads(payload_str)
            if "usage" in data:
                usage = data["usage"]
                tokens_in = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
                tokens_out = usage.get("completion_tokens") or usage.get("output_tokens") or 0
                break
        except (json.JSONDecodeError, KeyError):
            continue
    duration_ms = int((time.time() - start) * 1000)
    yield (tokens_in, tokens_out, duration_ms)
