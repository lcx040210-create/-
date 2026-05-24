import hashlib
import secrets
import string

import bcrypt

ALPHABET = string.ascii_letters + string.digits
KEY_LENGTH = 48


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a bcrypt hash."""
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def generate_api_key() -> str:
    """Generate an API key with sk- prefix and 48 random characters."""
    raw = "".join(secrets.choice(ALPHABET) for _ in range(KEY_LENGTH))
    return f"sk-{raw}"


def hash_api_key(key: str) -> str:
    """Hash an API key using SHA256 for storage."""
    return hashlib.sha256(key.encode()).hexdigest()
