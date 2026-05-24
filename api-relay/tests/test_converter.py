from app.core.converter import anthropic_to_openai, openai_to_anthropic


def test_anthropic_to_openai_basic():
    anthropic_req = {
        "model": "claude-opus-4-7",
        "system": "You are helpful.",
        "messages": [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}],
        "max_tokens": 1024,
        "temperature": 0.7,
    }
    openai_req = anthropic_to_openai(anthropic_req, "deepseek-v4-pro")
    assert openai_req["model"] == "deepseek-v4-pro"
    assert openai_req["messages"][0]["role"] == "system"
    assert openai_req["messages"][0]["content"] == "You are helpful."
    assert openai_req["messages"][1]["role"] == "user"
    assert openai_req["messages"][1]["content"] == "Hello"
    assert openai_req["max_tokens"] == 1024
    assert openai_req["temperature"] == 0.7


def test_anthropic_to_openai_no_system():
    anthropic_req = {
        "model": "claude-sonnet-4-6",
        "messages": [{"role": "user", "content": [{"type": "text", "text": "Hi"}]}],
        "max_tokens": 512,
    }
    openai_req = anthropic_to_openai(anthropic_req, "deepseek-chat")
    assert openai_req["messages"][0]["role"] == "user"


def test_anthropic_to_openai_multi_content_block():
    anthropic_req = {
        "model": "claude-opus-4-7",
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "First"},
            {"type": "text", "text": "Second"},
        ]}],
        "max_tokens": 1024,
    }
    openai_req = anthropic_to_openai(anthropic_req, "deepseek-v4-pro")
    assert openai_req["messages"][0]["content"] == "First"


def test_openai_to_anthropic_basic():
    openai_resp = {
        "id": "chat-123",
        "object": "chat.completion",
        "model": "deepseek-v4-pro",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello! How can I help?"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
    }
    anthropic_resp = openai_to_anthropic(openai_resp, "claude-opus-4-7")
    assert anthropic_resp["id"] == "chat-123"
    assert anthropic_resp["model"] == "claude-opus-4-7"
    assert anthropic_resp["type"] == "message"
    assert anthropic_resp["role"] == "assistant"
    assert anthropic_resp["content"][0]["type"] == "text"
    assert anthropic_resp["content"][0]["text"] == "Hello! How can I help?"
    assert anthropic_resp["stop_reason"] == "end_turn"
    assert anthropic_resp["usage"]["input_tokens"] == 10
    assert anthropic_resp["usage"]["output_tokens"] == 8


def test_openai_to_anthropic_finish_reason_length():
    openai_resp = {"id": "chat-456", "choices": [{"index": 0, "message": {"content": "12345678901234567890"}, "finish_reason": "length"}], "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
    anthropic_resp = openai_to_anthropic(openai_resp, "claude-opus-4-7")
    assert anthropic_resp["stop_reason"] == "max_tokens"


def test_openai_to_anthropic_finish_reason_default():
    openai_resp = {"id": "chat-789", "choices": [{"index": 0, "message": {"content": "test"}, "finish_reason": "content_filter"}], "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
    anthropic_resp = openai_to_anthropic(openai_resp, "claude-opus-4-7")
    assert anthropic_resp["stop_reason"] == "end_turn"
