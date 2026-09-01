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


# 静态前端兜底（须在所有 API 路由之后注册）
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
