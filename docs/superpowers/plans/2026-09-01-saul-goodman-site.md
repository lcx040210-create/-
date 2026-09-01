# Saul Goodman 恶搞律师官网 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建一个 Saul Goodman 浮夸律师广告官网恶搞站（全英文），含注册、电话快答小游戏（综合制评分）、全玩家排行榜。

**Architecture:** FastAPI 单服务，同时 serve 静态前端和 REST API。SQLite 存玩家与分数。前端纯 HTML/CSS/JS（ES modules），游戏逻辑抽成纯函数用 Node 单测。评分公式前后端各一份、同一套测试用例锁定一致。

**Tech Stack:** Python 3.11+、FastAPI、uvicorn、pydantic、sqlite3（标准库）、pytest、httpx；前端原生 ES modules + Node `node --test`。

**Spec:** `docs/superpowers/specs/2026-09-01-saul-goodman-site-design.md`

## Global Constraints

- 全英文文案；招牌短句可引用，其余原创，不照搬剧集剧本。
- `username` 必填 1–40 字符；`email` 可选 ≤100 字符；排行榜不展示 email。
- 游戏 3 轮 × 每轮 5 题；题库 20 题；每题限时 10 秒，超时按答错。
- 评分公式：`单题 = 基础(对100/错0) + 速度(剩余秒×10, 上限100) + 连击(20×(连续答对题数-1), 从第2题起)`；满分 5100；`胜诉指数 = min(100, round(总分/5100×100))`。
- 等级：`≥90` Supreme Chicanery / `70–89` Worthy of answering Saul's phones / `50–69` Consult a lawyer... about consulting / `<50` Turn yourself in。
- 剧照不抓取，占位图由用户本地替换（文件名 `saul-hero.jpg` 1200×900、`saul-1..4.jpg` 600×400）。
- DB 路径从环境变量 `DATABASE_URL` 读，默认 `saul.db`。
- 单 repo 根目录 `saul-goodman/`，后端 `backend/`，前端 `frontend/`。

---

### Task 1: 项目骨架 + 后端评分公式（scoring.py）

**Files:**
- Create: `saul-goodman/backend/scoring.py`
- Create: `saul-goodman/backend/conftest.py`
- Create: `saul-goodman/backend/tests/test_scoring.py`
- Create: `saul-goodman/backend/requirements.txt`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `score_answer(correct: bool, seconds_left: float, streak_before: int) -> tuple[int, int, int]` 返回 `(基础分, 速度分, 连击分)`。`streak_before` = 答本题前已连续答对数。
  - `compute_win_index(total: int) -> int`
  - `rank_label(win_index: int) -> str`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_scoring.py
from scoring import score_answer, compute_win_index, rank_label


def test_correct_full_time_no_streak():
    assert score_answer(True, 10.0, 0) == (100, 100, 0)


def test_wrong_answer_zeroes_everything():
    assert score_answer(False, 5.0, 3) == (0, 0, 0)


def test_speed_is_seconds_left_times_ten():
    assert score_answer(True, 4.0, 0)[1] == 40


def test_speed_capped_at_100():
    assert score_answer(True, 10.0, 0)[1] == 100


def test_combo_starts_on_second_consecutive():
    assert score_answer(True, 10.0, 0)[2] == 0   # 第 1 题连击
    assert score_answer(True, 10.0, 1)[2] == 20  # 连续第 2 题
    assert score_answer(True, 10.0, 2)[2] == 40  # 连续第 3 题


def test_win_index_full_score_is_100():
    assert compute_win_index(5100) == 100


def test_win_index_zero():
    assert compute_win_index(0) == 0


def test_win_index_caps_at_100():
    assert compute_win_index(99999) == 100


def test_rank_labels_boundaries():
    assert rank_label(90) == "Saul-certified: Supreme Chicanery"
    assert rank_label(70) == "Worthy of answering Saul's phones"
    assert rank_label(50) == "Consult a lawyer... about consulting"
    assert rank_label(49) == "Turn yourself in"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd saul-goodman/backend && python -m pytest tests/test_scoring.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'scoring'`）

- [ ] **Step 3: 写 scoring.py 和 conftest.py**

```python
# scoring.py
"""电话快答评分公式（纯函数）。与 frontend/scripts/game.js 保持一致，测试用例相同。"""

MAX_SCORE = 5100  # 15 题全对满分


def score_answer(correct: bool, seconds_left: float, streak_before: int) -> tuple[int, int, int]:
    """返回 (基础分, 速度分, 连击分)。streak_before = 答本题前已连续答对数。"""
    if not correct:
        return 0, 0, 0
    base = 100
    speed = min(int(seconds_left) * 10, 100)
    combo = 20 * streak_before  # streak_before 0/1/2... -> 0/20/40...
    return base, speed, combo


def compute_win_index(total: int) -> int:
    return min(100, round(total / MAX_SCORE * 100))


def rank_label(win_index: int) -> str:
    if win_index >= 90:
        return "Saul-certified: Supreme Chicanery"
    if win_index >= 70:
        return "Worthy of answering Saul's phones"
    if win_index >= 50:
        return "Consult a lawyer... about consulting"
    return "Turn yourself in"
```

```python
# conftest.py  （放在 backend/ 根，让 pytest 能把 backend/ 加进 sys.path）
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
```

- [ ] **Step 4: 运行确认通过**

Run: `cd saul-goodman/backend && python -m pytest tests/test_scoring.py -v`
Expected: 9 passed

- [ ] **Step 5: 写 requirements.txt 并提交**

```text
fastapi
uvicorn[standard]
pydantic
pytest
httpx
```

```bash
git add backend/scoring.py backend/conftest.py backend/tests/test_scoring.py backend/requirements.txt
git commit -m "feat(backend): 评分公式纯函数（基础+速度+连击→胜诉指数+等级）"
```

---

### Task 2: 存储层 + 数据模型（db.py + models.py）

**Files:**
- Create: `saul-goodman/backend/db.py`
- Create: `saul-goodman/backend/models.py`
- Create: `saul-goodman/backend/tests/test_db.py`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `db.get_conn() -> sqlite3.Connection`（`row_factory = sqlite3.Row`）
  - `db.init_db() -> None`（建表 players / scores）
  - `models.PlayerCreate(username: str, email: str | None)`、`models.ScoreCreate(player_id: int, win_index: int, score: int)`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_db.py
import sqlite3

import db


def test_init_db_creates_tables(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    db.init_db()
    conn = sqlite3.connect(str(tmp_path / "t.db"))
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"players", "scores"} <= tables
    conn.close()


def test_player_username_unique(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    db.init_db()
    conn = db.get_conn()
    conn.execute(
        "INSERT INTO players (username, email, created_at) VALUES ('saul', NULL, 0)")
    conn.commit()
    try:
        conn.execute(
            "INSERT INTO players (username, email, created_at) VALUES ('saul', NULL, 0)")
        conn.commit()
        raised = False
    except sqlite3.IntegrityError:
        raised = True
    finally:
        conn.close()
    assert raised
```

- [ ] **Step 2: 运行确认失败**

Run: `cd saul-goodman/backend && python -m pytest tests/test_db.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'db'`）

- [ ] **Step 3: 写 db.py 和 models.py**

```python
# db.py
import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    win_index INTEGER NOT NULL,
    score INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
"""

DB_PATH = os.environ.get("DATABASE_URL", "saul.db")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
```

```python
# models.py
from pydantic import BaseModel, Field


class PlayerCreate(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    email: str | None = Field(default=None, max_length=100)


class ScoreCreate(BaseModel):
    player_id: int
    win_index: int
    score: int
```

- [ ] **Step 4: 运行确认通过**

Run: `cd saul-goodman/backend && python -m pytest tests/test_db.py -v`
Expected: 2 passed

- [ ] **Step 5: 提交**

```bash
git add backend/db.py backend/models.py backend/tests/test_db.py
git commit -m "feat(backend): SQLite 存储层 + Pydantic 请求模型"
```

---

### Task 3: FastAPI API（main.py）

**Files:**
- Create: `saul-goodman/backend/main.py`
- Create: `saul-goodman/backend/tests/test_api.py`

**Interfaces:**
- Consumes: `db.init_db/get_conn`（Task 2）、`models`（Task 2）、`scoring`（Task 1）。
- Produces:
  - `POST /api/players` 入参 `{username, email?}` → `{player_id}`；用户名重复返回 409。
  - `POST /api/scores` 入参 `{player_id, win_index, score}` → `{rank, total_players}`。
  - `GET /api/leaderboard` → `{"players": [{rank, username, win_index}, ...]}`（top 50，按最高 win_index 降序）。
  - `GET /api/health` → `{"ok": true}`。

- [ ] **Step 1: 写失败测试**

```python
# tests/test_api.py
import db
from main import app
from fastapi.testclient import TestClient


def _fresh_client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    db.init_db()
    return TestClient(app)


def test_create_player_returns_id(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    r = c.post("/api/players", json={"username": "saul", "email": "x@y.z"})
    assert r.status_code == 200
    assert r.json()["player_id"] >= 1


def test_create_player_rejects_duplicate_username(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    c.post("/api/players", json={"username": "saul"})
    r = c.post("/api/players", json={"username": "saul"})
    assert r.status_code == 409


def test_submit_score_and_leaderboard(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    a = c.post("/api/players", json={"username": "alice"}).json()["player_id"]
    b = c.post("/api/players", json={"username": "bob"}).json()["player_id"]
    c.post("/api/scores", json={"player_id": a, "win_index": 80, "score": 4000})
    c.post("/api/scores", json={"player_id": b, "win_index": 55, "score": 2000})
    lb = c.get("/api/leaderboard").json()["players"]
    assert [p["username"] for p in lb] == ["alice", "bob"]
    assert lb[0]["win_index"] == 80


def test_submit_score_returns_rank(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    a = c.post("/api/players", json={"username": "alice"}).json()["player_id"]
    b = c.post("/api/players", json={"username": "bob"}).json()["player_id"]
    c.post("/api/scores", json={"player_id": a, "win_index": 80, "score": 4000})
    r = c.post("/api/scores", json={"player_id": b, "win_index": 55, "score": 2000})
    assert r.json() == {"rank": 2, "total_players": 2}


def test_leaderboard_uses_best_score_per_player(tmp_path, monkeypatch):
    c = _fresh_client(tmp_path, monkeypatch)
    a = c.post("/api/players", json={"username": "alice"}).json()["player_id"]
    c.post("/api/scores", json={"player_id": a, "win_index": 40, "score": 1000})
    c.post("/api/scores", json={"player_id": a, "win_index": 90, "score": 5000})
    lb = c.get("/api/leaderboard").json()["players"]
    assert len(lb) == 1 and lb[0]["win_index"] == 90
```

- [ ] **Step 2: 运行确认失败**

Run: `cd saul-goodman/backend && python -m pytest tests/test_api.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'main'`）

- [ ] **Step 3: 写 main.py**

```python
# main.py
import sqlite3
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

import db
import models

app = FastAPI(title="Saul Goodman")


@app.on_event("startup")
def _startup():
    db.init_db()


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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd saul-goodman/backend && python -m pytest tests/test_api.py -v`
Expected: 5 passed

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_api.py
git commit -m "feat(backend): FastAPI 端点（注册/提交分数/排行榜/健康检查）"
```

---

### Task 4: 前端骨架（index.html + main.css + SVG 占位图）

**Files:**
- Create: `saul-goodman/frontend/index.html`
- Create: `saul-goodman/frontend/styles/main.css`
- Create: `saul-goodman/frontend/images/saul-hero.svg`
- Create: `saul-goodman/frontend/images/saul-1.svg` … `saul-4.svg`

**Interfaces:**
- Consumes: 无（纯静态）。
- Produces: 页面骨架 + 视觉风格 + 占位图，供 Task 5/6 的 JS 绑定 DOM。

- [ ] **Step 1: 写 index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Saul Goodman | Attorney at Law</title>
  <link rel="stylesheet" href="styles/main.css">
</head>
<body>
  <!-- 注册弹框 -->
  <div id="register-modal" class="modal hidden">
    <div class="modal-card">
      <h2>HOLD ON. WHO AM I REPRESENTING?</h2>
      <p>Tell me who you are before we talk. It's confidential. Probably.</p>
      <form id="register-form">
        <input id="username" name="username" type="text" placeholder="Your name (required)" required minlength="1" maxlength="40">
        <input id="email" name="email" type="text" placeholder="Your email (optional)" maxlength="100">
        <button type="submit">Let's do this</button>
      </form>
      <p id="register-error" class="error hidden"></p>
    </div>
  </div>

  <!-- Hero -->
  <header id="hero">
    <p class="as-seen-on">★ AS SEEN ON TV ★</p>
    <h1 class="mega">DID YOU KNOW YOU HAVE RIGHTS?</h1>
    <h2 class="mega sub">THE CONSTITUTION SAYS YOU DO!</h2>
    <img id="hero-img" src="images/saul-hero.jpg" alt="Saul Goodman"
         onerror="this.onerror=null;this.src='images/saul-hero.svg'">
    <a href="#game" class="btn btn-huge" id="better-call-saul">BETTER CALL SAUL!</a>
  </header>

  <!-- About -->
  <section id="about">
    <h2>SAUL GOODMAN, ATTORNEY AT LAW</h2>
    <div class="photo-row">
      <img src="images/saul-1.jpg" onerror="this.onerror=null;this.src='images/saul-1.svg'">
      <img src="images/saul-2.jpg" onerror="this.onerror=null;this.src='images/saul-2.svg'">
      <img src="images/saul-3.jpg" onerror="this.onerror=null;this.src='images/saul-3.svg'">
      <img src="images/saul-4.jpg" onerror="this.onerror=null;this.src='images/saul-4.svg'">
    </div>
    <ul class="services">
      <li><strong>Car accident?</strong> That wasn't your fault. Trust me.</li>
      <li><strong>Work injury?</strong> You tripped on purpose? Even better.</li>
      <li><strong>Criminal charges?</strong> Innocent until proven... busy.</li>
      <li><strong>Got scammed?</strong> Let's scam them back. Legally.</li>
      <li><strong>Divorce?</strong> Keep the dog. And the boat.</li>
      <li><strong>White-collar crime?</strong> You mean "creative accounting."</li>
    </ul>
  </section>

  <!-- 好评 -->
  <section id="reviews">
    <h2>REAL REVIEWS FROM REAL (ALLEGED) CLIENTS</h2>
    <div id="review-carousel" class="review"></div>
  </section>

  <!-- 小游戏 -->
  <section id="game">
    <h2>THE SAUL HOTLINE</h2>
    <p class="sub">A client calls. Talk them out of it like the pro you're not.</p>
    <button id="start-game" class="btn">TAKE A CALL</button>
    <div id="game-area" class="hidden"></div>
    <div id="leaderboard">
      <h3>TOP SNAKES</h3>
      <ol id="leaderboard-list"></ol>
    </div>
  </section>

  <!-- Call now -->
  <footer id="call-now">
    <h2 class="mega">CALL NOW!</h2>
    <p class="phone">(505) 555-0100</p>
    <div class="ticker"><span>FREE CONSULTATION</span></div>
    <p class="disclaimer">Results not guaranteed. Billing, however, is.</p>
    <p class="disclaimer">Parody site. Not affiliated with any actual law firm, cartel, or snack manufacturer.</p>
  </footer>

  <script type="module" src="scripts/main.js"></script>
  <script type="module" src="scripts/game.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 main.css**

```css
:root {
  --yellow: #ffd400;
  --blue: #1f3a8a;
  --red: #e11d2e;
  --ink: #111;
  --paper: #fffdf4;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: "Arial Black", "Impact", sans-serif;
  background: var(--yellow);
  color: var(--ink);
  line-height: 1.35;
  overflow-x: hidden;
}

h1, h2 { text-transform: uppercase; text-align: center; }

.mega { font-size: clamp(2rem, 6vw, 5rem); }
.sub { font-size: clamp(1rem, 3vw, 2rem); }

/* Hero */
#hero { padding: 3rem 1rem; text-align: center; }
.as-seen-on { color: var(--red); font-size: 1.2rem; letter-spacing: .2em; }
#hero-img { max-width: 420px; width: 90%; margin: 1.5rem auto; display: block;
  border: 6px solid var(--blue); box-shadow: 8px 8px 0 var(--red); }

/* 按钮 */
.btn {
  display: inline-block; background: var(--blue); color: #fff;
  padding: 1rem 2rem; text-decoration: none; font-size: 1.4rem;
  border: 3px solid #000; box-shadow: 6px 6px 0 #000; cursor: pointer;
  text-transform: uppercase;
}
.btn-huge { font-size: 2.2rem; margin-top: 1rem; }
@keyframes blink { 50% { background: var(--red); } }
#better-call-saul { animation: blink 1s step-start infinite; }

/* About */
#about, #reviews, #game, #call-now { padding: 2.5rem 1rem; max-width: 960px; margin: 0 auto; }
.photo-row { display: flex; gap: .5rem; flex-wrap: wrap; justify-content: center; margin: 1rem 0; }
.photo-row img { width: 220px; max-width: 45%; border: 4px solid var(--blue); }
.services { list-style: none; max-width: 640px; margin: 1rem auto; }
.services li { background: var(--paper); border: 3px dashed var(--red);
  padding: .75rem 1rem; margin: .5rem 0; font-size: 1.1rem; }

/* 好评轮播 */
.review { min-height: 6rem; font-size: 1.2rem; text-align: center;
  background: var(--paper); border: 3px solid #000; padding: 1rem; }

/* 游戏区 */
#game-area { margin-top: 1.5rem; }
.phone-ring { font-size: 2rem; text-align: center; animation: blink .4s step-start infinite; }
.q-box { background: var(--paper); border: 4px solid #000; padding: 1.25rem; }
.q-scenario { font-size: 1.25rem; margin-bottom: 1rem; }
.q-options button { display: block; width: 100%; margin: .5rem 0; padding: .7rem;
  font-size: 1rem; cursor: pointer; text-align: left; background: #fff;
  border: 2px solid var(--blue); }
.timer { font-size: 1.3rem; color: var(--red); font-weight: bold; }
.retort { margin: .75rem 0; font-style: italic; }
.result { text-align: center; font-size: 1.2rem; }
.result .index { font-size: 3rem; color: var(--red); }

/* 排行榜 */
#leaderboard { margin-top: 2rem; }
#leaderboard-list { max-width: 480px; margin: 1rem auto; list-style-position: inside;
  font-size: 1.1rem; }
#leaderboard-list li { background: var(--paper); margin: .3rem 0; padding: .4rem .75rem;
  border: 2px solid #000; }

/* Call now */
#call-now { text-align: center; }
.phone { font-size: clamp(2rem, 6vw, 4rem); color: var(--red); }
.ticker { overflow: hidden; background: var(--blue); color: #fff; margin: 1rem auto;
  padding: .4rem; max-width: 420px; border: 3px solid #000; }
.ticker span { display: inline-block; animation: scroll 6s linear infinite; white-space: nowrap; }
@keyframes scroll { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
.disclaimer { font-size: .8rem; margin-top: .5rem; }

/* 弹框 */
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex;
  align-items: center; justify-content: center; z-index: 10; }
.modal-card { background: var(--yellow); border: 6px solid #000; padding: 2rem;
  max-width: 420px; text-align: center; }
.modal-card input { display: block; width: 100%; margin: .6rem 0; padding: .6rem;
  font-size: 1rem; }
.hidden { display: none !important; }
.error { color: var(--red); }
```

- [ ] **Step 3: 写 5 个 SVG 占位图**（每个结构相同，只改文字；以 saul-hero.svg 为例）

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#ffd400"/>
  <rect x="30" y="30" width="1140" height="840" fill="none" stroke="#1f3a8a" stroke-width="12"/>
  <text x="600" y="420" font-family="Impact, sans-serif" font-size="120" fill="#e11d2e" text-anchor="middle">SAUL HERO</text>
  <text x="600" y="540" font-family="Impact, sans-serif" font-size="64" fill="#111" text-anchor="middle">1200 x 900</text>
</svg>
```

其余四个（`saul-1.svg` … `saul-4.svg`）用宽 600 高 400，文字换成 `SAUL 1` … `SAUL 4`，副文字 `600 x 400`。

- [ ] **Step 4: 手动验证布局**

Run: `cd saul-goodman/frontend && python -m http.server 8000`
Expected: 浏览器打开 `http://localhost:8000`，能看到黄底大字报、占位图、闪烁按钮、滚动条。注册弹框会在 Task 5 才生效，此步无 JS 报错即可。

- [ ] **Step 5: 提交**

```bash
git add frontend/index.html frontend/styles/main.css frontend/images/
git commit -m "feat(frontend): 页面骨架 + 视觉风格 + SVG 占位图"
```

---

### Task 5: 前端注册与交互（main.js）

**Files:**
- Create: `saul-goodman/frontend/scripts/main.js`

**Interfaces:**
- Consumes: `POST /api/players`、`GET /api/leaderboard`（Task 3）。
- Produces:
  - 全局 `window.playerId`（注册成功后写入 + 存 `localStorage.playerId`）。
  - 弹框显示/提交逻辑、好评轮播、`refreshLeaderboard()`（供 game.js 调用）。
  - 函数签名：`async function register(username, email) -> number`（返回 player_id）、`async function fetchLeaderboard() -> array`。

- [ ] **Step 1: 写 main.js**

```javascript
// main.js
const REVIEWS = [
  "Saul got my charges dropped AND my money back. I'm still not sure how. — Anonymous Client",
  "He's not a lawyer, he's a magician with a briefcase. — A Very Satisfied Criminal",
  "Better call Saul? Better call your mom and tell her it's handled. — Grateful Client",
  "I called about a parking ticket. I left owning the parking lot. — Confused but Happy",
];

const API = "/api";

async function register(username, email) {
  const res = await fetch(`${API}/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: email || null }),
  });
  if (res.status === 409) throw new Error("That name's taken. Pick a pseudonym, pal.");
  if (!res.ok) throw new Error("Couldn't sign you up. Try again.");
  const data = await res.json();
  return data.player_id;
}

async function fetchLeaderboard() {
  const res = await fetch(`${API}/leaderboard`);
  const data = await res.json();
  return data.players;
}

function initRegisterModal() {
  const modal = document.getElementById("register-modal");
  const form = document.getElementById("register-form");
  const err = document.getElementById("register-error");

  if (window.playerId) { modal.classList.add("hidden"); return; }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.classList.add("hidden");
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    try {
      const id = await register(username, email);
      window.playerId = id;
      localStorage.setItem("playerId", String(id));
      modal.classList.add("hidden");
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  });
}

function initReviews() {
  const el = document.getElementById("review-carousel");
  let i = 0;
  const show = () => { el.textContent = REVIEWS[i % REVIEWS.length]; i += 1; };
  show();
  setInterval(show, 3500);
}

async function refreshLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = "";
  const players = await fetchLeaderboard();
  for (const p of players) {
    const li = document.createElement("li");
    li.textContent = `#${p.rank}  ${p.username}  —  ${p.win_index} win index`;
    list.appendChild(li);
  }
}

window.playerId = Number(localStorage.getItem("playerId")) || null;

initRegisterModal();
initReviews();
refreshLeaderboard();

window.__saul = { register, fetchLeaderboard, refreshLeaderboard };
```

- [ ] **Step 2: 手动验证**

Run: `cd saul-goodman/frontend && python -m http.server 8000`
Expected: 打开页面会弹注册框；填用户名提交后框消失、刷新后不再弹（localStorage 生效）；好评每 3.5 秒切换。注意：注册框提交会调 `/api/players`，纯 `http.server` 下会 404，属预期；完整验证走 Task 7 的 FastAPI 服务。

- [ ] **Step 3: 提交**

```bash
git add frontend/scripts/main.js
git commit -m "feat(frontend): 注册弹框 + 好评轮播 + 排行榜渲染"
```

---

### Task 6: 前端游戏逻辑（game.js + Node 单测）

**Files:**
- Create: `saul-goodman/frontend/scripts/game.js`
- Create: `saul-goodman/frontend/package.json`
- Create: `saul-goodman/frontend/tests/game.test.js`

**Interfaces:**
- Consumes: `window.playerId`（Task 5）、`POST /api/scores`、`refreshLeaderboard()`（Task 5）。
- Produces:
  - 纯函数：`shuffle(arr)`、`drawRound(questions, used, n)`、`scoreAnswer(correct, secondsLeft, streakBefore)`、`computeWinIndex(total)`、`rankLabel(winIndex)`（与后端 `scoring.py` 同语义）。
  - `QUESTIONS` 题库数组（每项 `{ scenario, type, options?, answer, retort }`）。
  - `class Game`（状态机：`start` / `answer` / `tick` / `finish`）。

- [ ] **Step 1: 写失败测试**

```javascript
// tests/game.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  shuffle, drawRound, scoreAnswer, computeWinIndex, rankLabel, QUESTIONS,
} from "../scripts/game.js";

test("scoreAnswer full time no streak", () => {
  assert.deepEqual(scoreAnswer(true, 10, 0), [100, 100, 0]);
});

test("scoreAnswer wrong zeroes", () => {
  assert.deepEqual(scoreAnswer(false, 5, 3), [0, 0, 0]);
});

test("combo starts on second consecutive", () => {
  assert.equal(scoreAnswer(true, 10, 1)[2], 20);
  assert.equal(scoreAnswer(true, 10, 2)[2], 40);
});

test("computeWinIndex full and cap", () => {
  assert.equal(computeWinIndex(5100), 100);
  assert.equal(computeWinIndex(99999), 100);
});

test("rankLabel boundaries", () => {
  assert.equal(rankLabel(90), "Saul-certified: Supreme Chicanery");
  assert.equal(rankLabel(49), "Turn yourself in");
});

test("drawRound draws n unique unused questions", () => {
  const used = new Set();
  const round = drawRound(QUESTIONS, used, 5);
  assert.equal(round.length, 5);
  assert.equal(new Set(round.map((q) => q.scenario)).size, 5);
});

test("QUESTIONS has at least 20 items and valid shape", () => {
  assert.ok(QUESTIONS.length >= 20);
  for (const q of QUESTIONS) {
    assert.ok(q.scenario);
    assert.ok(["choice", "judge"].includes(q.type));
    assert.ok("retort" in q);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd saul-goodman/frontend && node --test tests/`
Expected: FAIL（`Cannot find module '../scripts/game.js'` 或语法错误）

- [ ] **Step 3: 写 package.json 和 game.js**

```json
{
  "name": "saul-goodman-frontend",
  "type": "module",
  "scripts": { "test": "node --test tests/" }
}
```

```javascript
// game.js  —— 纯函数 + 题库 + 状态机
export const QUESTIONS = [
  { type: "choice", scenario: "Client: I crashed my car and the cops are here!",
    options: ["Run and say nothing", "Don't touch anyone. Call me. NOW.",
              "Post about it first", "Was it on purpose?"],
    answer: 1, retort: "Now you're talking. Say nothing, call Saul." },
  { type: "choice", scenario: "Client: I found a bag of cash. Asking for a friend.",
    options: ["Spend it fast", "Return it, obviously", "Don't tell me where. Hide it.",
              "Donate it to charity"],
    answer: 2, retort: "I never heard a word. Neither did you." },
  { type: "choice", scenario: "Client: My boss caught me sleeping at my desk.",
    options: ["Sue him for harassment", "Say it was a medical episode",
              "Cry and apologize", "Frame the intern"],
    answer: 1, retort: "Worker's comp, baby. 'Exhaustion' is a diagnosis." },
  { type: "choice", scenario: "Client: The police want to search my trunk.",
    options: ["Let them, I'm clean", "Say no, lock it, call me",
              "Drive away fast", "Offer them coffee"],
    answer: 1, retort: "Warrant? What warrant? Now shut up and call me." },
  { type: "choice", scenario: "Client: My ex took the dog AND the boat.",
    options: ["Let it go", "Sue for the boat, dog's collateral",
              "Steal them back", "Call a hitman (kidding)"],
    answer: 1, retort: "We keep the boat. The dog was a rental, emotionally." },
  { type: "choice", scenario: "Client: I may have 'creatively' adjusted some invoices.",
    options: ["Burn the receipts", "It's not fraud, it's innovation. Call me",
              "Turn yourself in", "Blame the accountant"],
    answer: 1, retort: "That's the spirit. White-collar is just a color." },
  { type: "choice", scenario: "Client: I'm being audited by the IRS.",
    options: ["Cry", "Tell them you're a sovereign citizen",
              "Let me handle it. Say nothing to them", "Move to another country"],
    answer: 2, retort: "The only thing scarier than the IRS is my bill. Worth it." },
  { type: "judge", scenario: "Client wants to sue a coffee shop for 'hot coffee being hot'.",
    answer: true, retort: "A classic. We've won worse. Way worse." },
  { type: "judge", scenario: "Client wants me to represent their pet hamster in small claims.",
    answer: false, retort: "I have standards. The hamster can't pay my retainer." },
  { type: "judge", scenario: "Client is a mob boss who pays cash and asks no questions.",
    answer: true, retort: "My favorite kind of client: prompt, and quiet." },
  { type: "judge", scenario: "Client 'borrowed' a car and wants help returning it 'later'.",
    answer: false, retort: "I defend theft, I don't schedule it. Call me after." },
  { type: "judge", scenario: "Client slipped in a store and the manager apologized on camera.",
    answer: true, retort: "Cha-ching. That apology is a down payment." },
  { type: "choice", scenario: "Client: My landlord raised my rent 300%.",
    options: ["Pay it", "Sue. That's not rent, that's a robbery",
              "Sublet to strangers", "Stop paying and squat"],
    answer: 1, retort: "We'll negotiate. Aggressively. With a lawsuit." },
  { type: "choice", scenario: "Client: I got a ticket for 'excessive speeding'.",
    options: ["Pay the fine", "Fight it. The cop was emotional that day",
              "Bribe the judge", "Sell the car"],
    answer: 1, retort: "Speed limit is a suggestion. The ticket is not." },
  { type: "choice", scenario: "Client: My neighbor's dog won't stop barking.",
    options: ["Bark back", "Document it and sue for 'barking without a license'",
              "Move", "Poison the dog (DO NOT)"],
    answer: 1, retort: "There's a cause of action for everything. Everything." },
  { type: "judge", scenario: "Client wants to sue their reflection for 'looking at them funny'.",
    answer: false, retort: "Even I have limits. Also, your reflection pleads the Fifth." },
  { type: "judge", scenario: "Client 'found' a briefcase full of bearer bonds.",
    answer: true, retort: "Found, lost, found again. I love a good story." },
  { type: "choice", scenario: "Client: The Feds left a voicemail asking to 'chat'.",
    options: ["Call them back", "Talk to them, you're innocent",
              "Delete the voicemail and call me first", "Change your name"],
    answer: 2, retort: "You have the right to remain silent. USE IT. Then call me." },
  { type: "judge", scenario: "Client is a teacher who wants to sue the whole school district.",
    answer: true, retort: "David vs Goliath? I like David. He pays better." },
  { type: "judge", scenario: "Client wants to represent themselves in court.",
    answer: false, retort: "A lawyer who represents himself has a fool for a client. So do you." },
];

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawRound(questions, used, n) {
  const pool = shuffle(questions.filter((q) => !used.has(q.scenario)));
  const picked = pool.slice(0, n);
  picked.forEach((q) => used.add(q.scenario));
  return picked;
}

export function scoreAnswer(correct, secondsLeft, streakBefore) {
  if (!correct) return [0, 0, 0];
  const base = 100;
  const speed = Math.min(Math.floor(secondsLeft) * 10, 100);
  const combo = 20 * streakBefore;
  return [base, speed, combo];
}

export function computeWinIndex(total) {
  return Math.min(100, Math.round((total / 5100) * 100));
}

export function rankLabel(winIndex) {
  if (winIndex >= 90) return "Saul-certified: Supreme Chicanery";
  if (winIndex >= 70) return "Worthy of answering Saul's phones";
  if (winIndex >= 50) return "Consult a lawyer... about consulting";
  return "Turn yourself in";
}

const ROUNDS = 3;
const PER_ROUND = 5;
const TIME_LIMIT = 10;

export class Game {
  constructor(area) {
    this.area = area;
    this.used = new Set();
    this.round = 0;
    this.total = 0;
    this.streak = 0;
    this.secondsLeft = TIME_LIMIT;
    this.timerId = null;
    this.current = null;
  }

  start() {
    this.round = 0;
    this.total = 0;
    this.streak = 0;
    this.used = new Set();
    this._nextQuestion();
  }

  _nextQuestion() {
    if (this.used.size >= ROUNDS * PER_ROUND) { this._finish(); return; }
    this.round = Math.floor(this.used.size / PER_ROUND) + 1;
    this.current = drawRound(QUESTIONS, this.used, 1)[0];
    this.secondsLeft = TIME_LIMIT;
    this._renderQuestion();
    this._startTimer();
  }

  _startTimer() {
    clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      this.secondsLeft -= 1;
      const t = this.area.querySelector(".timer");
      if (t) t.textContent = `${this.secondsLeft}s`;
      if (this.secondsLeft <= 0) this.answer(-1);
    }, 1000);
  }

  _renderQuestion() {
    const q = this.current;
    let html = `<div class="q-box"><p class="phone-ring">☎ RING RING — ROUND ${this.round}</p>`
      + `<p class="q-scenario">"${q.scenario}"</p>`
      + `<p class="timer">${this.secondsLeft}s</p>`;
    if (q.type === "choice") {
      html += '<div class="q-options">';
      q.options.forEach((opt, i) => {
        html += `<button data-i="${i}">${String.fromCharCode(65 + i)}. ${opt}</button>`;
      });
      html += "</div>";
    } else {
      html += '<div class="q-options">'
        + '<button data-i="true">YES, I\'ll take this case</button>'
        + '<button data-i="false">NO, even I won\'t</button>'
        + "</div>";
    }
    html += "</div>";
    this.area.innerHTML = html;
    this.area.querySelectorAll(".q-options button").forEach((b) => {
      b.addEventListener("click", () => this.answer(b.dataset.i));
    });
  }

  answer(choice) {
    clearInterval(this.timerId);
    const q = this.current;
    let correct;
    if (q.type === "choice") correct = Number(choice) === q.answer;
    else correct = (choice === "true") === q.answer;

    const [base, speed, combo] = scoreAnswer(correct, this.secondsLeft, this.streak);
    if (correct) this.streak += 1; else this.streak = 0;
    this.total += base + speed + combo;

    this.area.innerHTML = `<div class="q-box"><p class="retort">Saul: "${q.retort}"</p>`
      + `<p>${correct ? "+" : "0"} points (base ${base}, speed ${speed}, combo ${combo})</p>`
      + `<button id="next" class="btn">NEXT CALL</button></div>`;
    this.area.querySelector("#next").addEventListener("click", () => this._nextQuestion());
  }

  async _finish() {
    clearInterval(this.timerId);
    const winIndex = computeWinIndex(this.total);
    const label = rankLabel(winIndex);
    let html = `<div class="result"><p>That's a wrap.</p>`
      + `<p class="index">${winIndex} / 100</p>`
      + `<p>${label}</p><p>Total: ${this.total}</p>`
      + `<button id="replay" class="btn">TAKE ANOTHER CALL</button></div>`;

    if (window.playerId) {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: window.playerId, win_index: winIndex, score: this.total }),
      });
      const data = await res.json();
      html += `<p>You rank #${data.rank} of ${data.total_players} snakes.</p>`;
    } else {
      html += "<p>(Sign up to get on the board, pal.)</p>";
    }
    this.area.innerHTML = html;
    this.area.querySelector("#replay").addEventListener("click", () => this.start());
    if (window.__saul) window.__saul.refreshLeaderboard();
  }
}

const game = new Game(document.getElementById("game-area"));
const startBtn = document.getElementById("start-game");
if (startBtn) {
  startBtn.addEventListener("click", () => {
    document.getElementById("game-area").classList.remove("hidden");
    game.start();
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd saul-goodman/frontend && npm test`
Expected: 7 tests passed

- [ ] **Step 5: 提交**

```bash
git add frontend/scripts/game.js frontend/package.json frontend/tests/game.test.js
git commit -m "feat(frontend): 电话快答游戏（题库/状态机/评分）+ Node 单测"
```

---

### Task 7: 整合验证 + README + 部署说明

**Files:**
- Create: `saul-goodman/README.md`

**Interfaces:**
- Consumes: 全部产物。
- Produces: 可运行的单服务站点 + 部署文档。

- [ ] **Step 1: 端到端手动验证**

Run: `cd saul-goodman/backend && uvicorn main:app --reload`
Expected: 浏览器打开 `http://127.0.0.1:8000`，完整流程走通：注册 → 玩 3 轮电话快答 → 结算显示指数/等级/排名 → 排行榜出现自己。若前端 `images/` 尚无 `.jpg`，占位 SVG 自动兜底显示。

- [ ] **Step 2: 全量测试**

Run: `cd saul-goodman/backend && python -m pytest -v` 与 `cd saul-goodman/frontend && npm test`
Expected: 后端 16 通过、前端 7 通过。

- [ ] **Step 3: 写 README.md**

```markdown
# Saul Goodman — Attorney at Law (恶搞站)

一个《风骚律师》风格的浮夸律师广告官网恶搞站。全英文，含注册、电话快答小游戏、全玩家排行榜。

## 本地运行

后端（同时 serve 前端与 API）：

    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload

打开 http://127.0.0.1:8000

## 测试

    cd backend && python -m pytest -v      # 后端
    cd frontend && npm test                # 前端游戏逻辑

## 图片替换

`frontend/images/` 下当前是 SVG 占位图。把你的剧照按同名保存为 `.jpg` 即可自动替换（HTML 已引用 `.jpg`，占位 SVG 仅兜底）：

- `saul-hero.jpg` — 主角大图，建议 1200×900
- `saul-1.jpg` … `saul-4.jpg` — 四张小图，建议 600×400

放进去后无需改代码。剧照请自行确认版权/用途。

## 部署到 render.com

1. 新建 Web Service，连接仓库，Root Directory 填 `saul-goodman/backend`。
2. Build Command：`pip install -r requirements.txt`
3. Start Command：`uvicorn main:app --host 0.0.0.0 --port $PORT`
4. 环境变量：`DATABASE_URL`（可选；默认 `saul.db`）。

注意：render 免费层磁盘 ephemeral，重启/部署会重置 SQLite 数据；要持久排行榜请接 render Postgres 或 persistent disk（把 `DATABASE_URL` 指向外部库）。

## 环境变量

- `DATABASE_URL` — SQLite 文件路径，默认 `saul.db`

## 版权

恶搞站，与任何真实律所/机构无关。招牌短句引用自剧集，其余文案原创。
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: 本地运行 / 测试 / 图片替换 / render 部署说明"
```

---

## Self-Review

**1. Spec coverage：**
- 视觉风格（黄底/大字报/闪烁/滚动/AS SEEN ON TV）✓ Task 4
- 单页结构（Hero/About/好评/游戏/Call Now）✓ Task 4
- 注册（username 必填 1–40、email 可选 ≤100）✓ Task 3 模型 + Task 5 前端
- 电话快答（3 轮×5 题、单选+判断、10 秒限时、20 题库）✓ Task 6
- 综合制评分（基础+速度+连击→5100→0-100→四档等级）✓ Task 1 + Task 6
- 排行榜（所有玩家、按最高分、不展示 email）✓ Task 3
- FastAPI + SQLite、`DATABASE_URL` ✓ Task 2/3
- 图片占位不抓剧照 ✓ Task 4（SVG 占位 + onerror 兜底 + README 替换说明）
- 部署 render 单服务 ✓ Task 7
- 测试（后端 pytest + 前端 node --test）✓ Task 1/2/3/6

**2. Placeholder scan：** 无 TBD/TODO。所有代码块完整可运行；文案全部给出具体英文内容。

**3. Type consistency：**
- `scoreAnswer(correct, seconds_left, streak_before)` 签名前后端一致（Python 参数名 vs JS 驼峰 `streakBefore` 对应，语义相同）。
- 等级文案四处引用一致：Supreme Chicanery / Worthy of answering Saul's phones / Consult a lawyer... about consulting / Turn yourself in。
- API 字段：`player_id` / `win_index` / `score` / `username` 前后端一致；排行榜返回 `{rank, username, win_index}`，前端渲染读取同名。
- `window.playerId` 由 Task 5 写入、Task 6 消费；`window.__saul.refreshLeaderboard` 由 Task 5 暴露、Task 6 调用。
- 测试命令路径：后端 `cd saul-goodman/backend`、前端 `cd saul-goodman/frontend`，各 task 一致。
