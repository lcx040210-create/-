# main.py
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

import db
import models


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Saul Goodman", lifespan=lifespan)


@app.middleware("http")
async def add_no_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/players")
def create_player(payload: models.PlayerCreate):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="username required")
    conn = db.get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO players (username, email, created_at) VALUES (?, ?, ?)",
            (username, payload.email, int(time.time())),
        )
        conn.commit()
        player_id = cur.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="username taken")
    finally:
        conn.close()
    return {"player_id": player_id}


@app.post("/api/scores")
def submit_score(payload: models.ScoreCreate):
    conn = db.get_conn()
    try:
        conn.execute(
            "INSERT INTO scores (player_id, win_index, score, created_at) VALUES (?, ?, ?, ?)",
            (payload.player_id, payload.win_index, payload.score, int(time.time())),
        )
        conn.commit()
        best = conn.execute(
            "SELECT MAX(win_index) FROM scores WHERE player_id = ?",
            (payload.player_id,),
        ).fetchone()[0]
        total = conn.execute(
            "SELECT COUNT(DISTINCT player_id) FROM scores"
        ).fetchone()[0]
        higher = conn.execute(
            "SELECT COUNT(*) FROM ("
            "  SELECT player_id, MAX(win_index) AS b FROM scores GROUP BY player_id"
            ") WHERE b > ?",
            (best,),
        ).fetchone()[0]
    finally:
        conn.close()
    return {"rank": higher + 1, "total_players": total}


@app.get("/api/leaderboard")
def leaderboard():
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT p.username, MAX(s.win_index) AS best "
        "FROM scores s JOIN players p ON p.id = s.player_id "
        "GROUP BY s.player_id ORDER BY best DESC LIMIT 50"
    ).fetchall()
    conn.close()
    players = [
        {"rank": i, "username": r["username"], "win_index": r["best"]}
        for i, r in enumerate(rows, 1)
    ]
    return {"players": players}


DAILY_POOL = 10_000_000
REWARD_SHARES = [0.30, 0.20, 0.14, 0.10, 0.08, 0.06, 0.05, 0.04, 0.02, 0.01]


def _day_start_ts() -> int:
    now = time.localtime()
    return int(time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, 0, 0, 0)))


@app.get("/api/rewards")
def rewards():
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT p.username, MAX(s.win_index) AS best "
        "FROM scores s JOIN players p ON p.id = s.player_id "
        "WHERE s.created_at >= ? "
        "GROUP BY s.player_id ORDER BY best DESC LIMIT 10",
        (_day_start_ts(),),
    ).fetchall()
    conn.close()
    winners = []
    for i, r in enumerate(rows):
        share = REWARD_SHARES[i] if i < len(REWARD_SHARES) else 0
        reward = int(DAILY_POOL * share)
        winners.append({"rank": i + 1, "username": r["username"],
                        "win_index": r["best"], "reward": reward})
    return {"pool": DAILY_POOL, "winners": winners}


@app.post("/api/fees")
def record_fee(payload: models.FeeCreate):
    conn = db.get_conn()
    conn.execute(
        "INSERT INTO fees (player_id, amount, created_at) VALUES (?, ?, ?)",
        (payload.player_id, payload.amount, int(time.time())),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/clients")
def clients():
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT p.username, SUM(f.amount) AS total "
        "FROM fees f JOIN players p ON p.id = f.player_id "
        "GROUP BY f.player_id ORDER BY total DESC LIMIT 50"
    ).fetchall()
    conn.close()
    result = [
        {"rank": i, "username": r["username"], "total": round(r["total"], 2)}
        for i, r in enumerate(rows, 1)
    ]
    return {"clients": result}


# 静态前端兜底（须在所有 API 路由之后注册）
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
