from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from app.db import async_session
    from app.seed import seed_db
    async with async_session() as session:
        await seed_db(session)
    yield


app = FastAPI(title="AI Relay", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}
