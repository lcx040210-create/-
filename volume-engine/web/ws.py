import asyncio
import json
from fastapi import WebSocket


class WSManager:
    def __init__(self):
        self._connections: list[WebSocket] = []
        self._engine = None

    def set_engine(self, engine):
        self._engine = engine

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, data: dict):
        msg = json.dumps(data)
        dead = []
        for ws in self._connections:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def push_loop(self):
        while True:
            if self._engine and self._connections:
                status = self._engine.get_status()
                await self.broadcast(status)
            await asyncio.sleep(1)


ws_manager = WSManager()
