import json
from app.core.cleaner import ProxyCleaner


cleaner = ProxyCleaner()


def test_clean_request_replaces_model():
    body = {"model": "gpt-5.5", "messages": [{"role": "user", "content": "hi"}]}
    upstream = "deepseek-v4-pro"
    cleaned = cleaner.clean_request(body, upstream)
    assert cleaned["model"] == "deepseek-v4-pro"
    assert cleaned["messages"] == body["messages"]


def test_clean_request_drops_unsupported():
    body = {"model": "gpt-5.5", "unknown_param": "x", "messages": []}
    cleaned = cleaner.clean_request(body, "deepseek-v4-pro")
    assert "unknown_param" not in cleaned


def test_clean_response_replaces_model():
    body = {
        "id": "chat-123",
        "model": "deepseek-v4-pro",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "hi"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    cleaned = cleaner.clean_response(body, "gpt-5.5")
    assert cleaned["model"] == "gpt-5.5"
    assert cleaned["choices"][0]["message"]["content"] == "hi"


def test_clean_response_preserves_usage():
    body = {"model": "deepseek-v4-pro", "choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
    cleaned = cleaner.clean_response(body, "gpt-5.5")
    assert cleaned["usage"]["total_tokens"] == 15


def test_clean_headers_whitelist():
    upstream_headers = {
        "content-type": "application/json",
        "date": "today",
        "x-request-id": "123",
        "x-deepseek-trace-id": "secret",
        "server": "DeepSeek",
        "cf-ray": "1a2b3c",
    }
    cleaned = cleaner.clean_headers(upstream_headers)
    assert "content-type" in cleaned
    assert "date" in cleaned
    assert "x-request-id" in cleaned
    assert "x-deepseek-trace-id" not in cleaned
    assert "server" not in cleaned
    assert "cf-ray" not in cleaned


def test_clean_error_rewrites_format():
    upstream_error = {"error": {"message": "deepseek api key invalid", "type": "auth_error", "code": "invalid_api_key"}}
    cleaned = cleaner.clean_error(upstream_error, "gpt-5.5")
    error_json = json.loads(cleaned)
    assert "error" in error_json
    assert "message" in error_json["error"]
    assert "deepseek" not in error_json["error"]["message"].lower()


def test_clean_sse_chunk_model_field():
    chunk = 'data: {"id":"1","model":"deepseek-v4-pro","choices":[{"delta":{"content":"hi"}}]}\n\n'
    cleaned = cleaner.clean_sse_chunk(chunk, "gpt-5.5")
    assert "deepseek-v4-pro" not in cleaned
    assert "gpt-5.5" in cleaned


def test_clean_sse_chunk_done():
    chunk = "data: [DONE]\n\n"
    cleaned = cleaner.clean_sse_chunk(chunk, "gpt-5.5")
    assert cleaned == chunk


def test_clean_sse_chunk_non_model():
    chunk = 'data: {"id":"1","choices":[{"delta":{"content":"hello"}}]}\n\n'
    cleaned = cleaner.clean_sse_chunk(chunk, "gpt-5.5")
    assert cleaned == chunk
