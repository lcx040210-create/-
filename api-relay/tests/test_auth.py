import pytest
from app.core.auth import hash_password, verify_password, generate_api_key, hash_api_key


def test_hash_and_verify_password():
    plain = "my-password-123"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed) is True
    assert verify_password("wrong", hashed) is False


def test_generate_api_key_format():
    key = generate_api_key()
    assert key.startswith("sk-")
    assert len(key) == 51  # "sk-" + 48 chars


def test_hash_api_key_consistency():
    key = "sk-abc123def456"
    h1 = hash_api_key(key)
    h2 = hash_api_key(key)
    assert h1 == h2
    assert h1 != key
    assert len(h1) == 64  # SHA256 hex digest
