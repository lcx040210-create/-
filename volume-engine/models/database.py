import aiosqlite
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "volume.db"


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    from models.schema import SCHEMA_SQL

    db = await get_db()
    await db.executescript(SCHEMA_SQL)
    await db.commit()
    await db.close()
