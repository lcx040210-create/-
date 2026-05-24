from app.core.proxy import extract_usage, build_upstream_url


def test_build_upstream_url_deepseek():
    url = build_upstream_url("https://api.deepseek.com", "/v1/chat/completions")
    assert url == "https://api.deepseek.com/v1/chat/completions"


def test_build_upstream_url_trailing_slash():
    url = build_upstream_url("https://api.deepseek.com/", "/v1/chat/completions")
    assert url == "https://api.deepseek.com/v1/chat/completions"


def test_extract_usage_normal():
    response_body = {"usage": {"prompt_tokens": 50, "completion_tokens": 30, "total_tokens": 80}}
    tokens_in, tokens_out = extract_usage(response_body)
    assert tokens_in == 50
    assert tokens_out == 30


def test_extract_usage_anthropic():
    response_body = {"usage": {"input_tokens": 40, "output_tokens": 20}}
    tokens_in, tokens_out = extract_usage(response_body)
    assert tokens_in == 40
    assert tokens_out == 20


def test_extract_usage_missing():
    tokens_in, tokens_out = extract_usage({})
    assert tokens_in == 0
    assert tokens_out == 0
