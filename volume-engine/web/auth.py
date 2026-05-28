import bcrypt
import secrets
from fastapi import Request, HTTPException

SESSION_TOKEN = None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_session() -> str:
    global SESSION_TOKEN
    SESSION_TOKEN = secrets.token_hex(32)
    return SESSION_TOKEN


def get_session(request: Request) -> str | None:
    return request.cookies.get("session")


def require_auth(request: Request):
    if not SESSION_TOKEN or get_session(request) != SESSION_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
