import json
import re

ALLOWED_HEADERS = {"content-type", "date", "x-request-id", "cache-control"}

# Common upstream provider identifiers to strip from error messages
_UPSTREAM_PATTERNS = re.compile(
    r"\b(?:deepseek|openai|anthropic|claude|gpt|azure|bedrock|vertex)\b",
    re.IGNORECASE,
)


class ProxyCleaner:
    def clean_request(self, body: dict, upstream_model: str) -> dict:
        body = body.copy()
        body["model"] = upstream_model
        body.pop("unknown_param", None)
        return body

    def clean_response(self, body: dict, alias_model: str) -> dict:
        body = body.copy()
        body["model"] = alias_model
        return body

    def clean_headers(self, headers: dict) -> dict:
        return {k: v for k, v in headers.items() if k.lower() in ALLOWED_HEADERS}

    def clean_error(self, upstream_body: dict, alias_model: str) -> str:
        original_msg = ""
        if isinstance(upstream_body, dict):
            err = upstream_body.get("error", {})
            if isinstance(err, dict):
                original_msg = err.get("message", "")
        # Strip upstream provider identifiers from the original message
        safe_msg = _UPSTREAM_PATTERNS.sub("<provider>", original_msg[:200])
        return json.dumps(
            {
                "error": {
                    "message": f"Request failed for model '{alias_model}': {safe_msg}",
                    "type": "api_error",
                }
            }
        )

    def clean_sse_chunk(self, chunk: str, alias_model: str) -> str:
        if not chunk.startswith("data: ") or "[DONE]" in chunk:
            return chunk
        prefix = "data: "
        payload = chunk[len(prefix) :].strip()
        try:
            data = json.loads(payload)
            if "model" not in data:
                return chunk
            data["model"] = alias_model
            return prefix + json.dumps(data, separators=(",", ":")) + "\n\n"
        except json.JSONDecodeError:
            return chunk
