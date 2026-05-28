import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from config import load_config
from models.database import init_db, get_db
from exchange.binance_adapter import BinanceAdapter
from exchange.bittap_adapter import BittapAdapter
from engine.volume_engine import VolumeEngine
from web.routes import setup_routes
from web.ws import ws_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


async def build_adapters() -> dict:
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM exchange_config WHERE enabled = 1")
    await db.close()

    adapters = {}
    for row in rows:
        r = dict(row)
        if not r["api_key"] or not r["api_secret"]:
            continue
        if r["name"] == "binance":
            adapters["binance"] = BinanceAdapter(r["api_key"], r["api_secret"])
        elif r["name"] == "bittap":
            adapters["bittap"] = BittapAdapter(r["api_key"], r["api_secret"])
    return adapters


engine: VolumeEngine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    await init_db()
    config = load_config()
    adapters = await build_adapters()

    if not adapters:
        logger.warning("No exchange adapters configured. Set API keys in /settings")

    engine = VolumeEngine(config, adapters)
    asyncio.create_task(ws_manager.push_loop())
    logger.info("Volume engine ready")
    yield
    if engine:
        await engine.stop()


app = FastAPI(lifespan=lifespan)
setup_routes(app, engine)


if __name__ == "__main__":
    import uvicorn
    config = load_config()
    uvicorn.run(app, host=config.web.host, port=config.web.port)
