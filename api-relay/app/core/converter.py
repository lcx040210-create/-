STOP_REASON_MAP = {"stop": "end_turn", "length": "max_tokens", "tool_calls": "tool_use"}


def anthropic_to_openai(anthropic_request: dict, upstream_model: str) -> dict:
    messages = []
    system_text = anthropic_request.get("system", "")
    if system_text:
        messages.append({"role": "system", "content": system_text})
    for msg in anthropic_request.get("messages", []):
        content = msg.get("content", "")
        if isinstance(content, list):
            text_parts = [b["text"] for b in content if b.get("type") == "text"]
            content = text_parts[0] if text_parts else ""
        messages.append({"role": msg["role"], "content": content})
    openai_req = {"model": upstream_model, "messages": messages}
    if "max_tokens" in anthropic_request:
        openai_req["max_tokens"] = anthropic_request["max_tokens"]
    if "temperature" in anthropic_request:
        openai_req["temperature"] = anthropic_request["temperature"]
    if "top_p" in anthropic_request:
        openai_req["top_p"] = anthropic_request["top_p"]
    if "stop_sequences" in anthropic_request:
        openai_req["stop"] = anthropic_request["stop_sequences"]
    return openai_req


def openai_to_anthropic(openai_response: dict, alias_model: str) -> dict:
    choice = openai_response.get("choices", [{}])[0]
    message = choice.get("message", {})
    usage = openai_response.get("usage", {})
    finish_reason = choice.get("finish_reason", "stop")
    stop_reason = STOP_REASON_MAP.get(finish_reason, "end_turn")
    return {
        "id": openai_response.get("id", ""),
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": message.get("content", "")}],
        "model": alias_model,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }
