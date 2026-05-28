from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path

from web.auth import hash_password, verify_password, create_session, get_session, require_auth, SESSION_TOKEN
from web.ws import ws_manager
from config import load_config
from models.database import get_db

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


def setup_routes(app: FastAPI, engine):
    ws_manager.set_engine(engine)

    @app.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request):
        if not SESSION_TOKEN or get_session(request) != SESSION_TOKEN:
            return RedirectResponse("/login")
        status = engine.get_status()
        return templates.TemplateResponse("dashboard.html", {"request": request, "config": status["config"]})

    @app.get("/login", response_class=HTMLResponse)
    async def login_page(request: Request):
        return templates.TemplateResponse("login.html", {"request": request})

    @app.post("/login")
    async def login(request: Request, password: str = Form(...)):
        cfg = load_config()
        if cfg.web.password_hash:
            if verify_password(password, cfg.web.password_hash):
                token = create_session()
                resp = RedirectResponse("/", status_code=303)
                resp.set_cookie("session", token)
                return resp
        elif not cfg.web.password_hash and password:
            h = hash_password(password)
            cfg.web.password_hash = h
            token = create_session()
            resp = RedirectResponse("/", status_code=303)
            resp.set_cookie("session", token)
            import yaml
            config_path = Path(__file__).parent.parent / "config.yaml"
            with open(config_path) as f:
                data = yaml.safe_load(f) or {}
            data.setdefault("web", {})["password_hash"] = h
            with open(config_path, "w") as f:
                yaml.dump(data, f)
            return resp
        return templates.TemplateResponse("login.html", {"request": request, "error": "密码错误"})

    @app.get("/trades", response_class=HTMLResponse)
    async def trades_page(request: Request):
        if not SESSION_TOKEN or get_session(request) != SESSION_TOKEN:
            return RedirectResponse("/login")
        return templates.TemplateResponse("trades.html", {"request": request})

    @app.get("/settings", response_class=HTMLResponse)
    async def settings_page(request: Request):
        if not SESSION_TOKEN or get_session(request) != SESSION_TOKEN:
            return RedirectResponse("/login")
        return templates.TemplateResponse("settings.html", {"request": request})

    @app.get("/api/status")
    async def api_status(request: Request):
        require_auth(request)
        return engine.get_status()

    @app.post("/api/engine/{action}")
    async def engine_control(action: str, request: Request):
        require_auth(request)
        actions = {"start": engine.start, "pause": engine.pause, "stop": engine.stop, "resume": engine.resume}
        if action not in actions:
            raise HTTPException(400, "Unknown action")
        await actions[action]()
        return {"ok": True, "status": engine.state.status.value}

    @app.get("/api/trades")
    async def api_trades(page: int = Query(0), request: Request = None):
        db = await get_db()
        offset = page * 50
        rows = await db.execute_fetchall(
            "SELECT * FROM trades ORDER BY created_at DESC LIMIT 50 OFFSET ?", (offset,))
        await db.close()
        trades = [dict(r) for r in rows]
        return {"trades": trades, "page": page}

    @app.get("/api/exchanges")
    async def api_exchanges(request: Request):
        require_auth(request)
        db = await get_db()
        rows = await db.execute_fetchall("SELECT * FROM exchange_config")
        await db.close()
        return [dict(r) for r in rows]

    @app.put("/api/exchanges/{name}")
    async def update_exchange(name: str, data: dict, request: Request):
        require_auth(request)
        db = await get_db()
        for key, value in data.items():
            if key == "enabled":
                value = 1 if value else 0
            await db.execute(f"UPDATE exchange_config SET {key} = ? WHERE name = ?", (value, name))
        await db.commit()
        await db.close()
        return {"ok": True}

    @app.post("/api/exchanges/{name}/test")
    async def test_exchange(name: str, request: Request):
        require_auth(request)
        adapter = engine.adapters.get(name)
        if not adapter:
            return {"ok": False, "error": "Exchange not configured"}
        try:
            await adapter.fetch_ticker("BTC/USDT")
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws_manager.connect(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            ws_manager.disconnect(ws)
