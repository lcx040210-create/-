# Predict.fun 数据采集器 实现计划（Phase 1 / w1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 24/7 运行的数据采集器，把 Predict.fun 的 `btc-updown-5m` 盘口 + BTC 价格流落盘成 SQLite，并在窗口收盘后用官方结果回填结算。

**Architecture:** 单进程 asyncio 守护进程：一条 WS 连接订 `predictOrderbook/{marketId}` + `assetPriceUpdate/1`，盘口或价格任一变动即组装一行 Tick 写 SQLite（WAL append-only）；独立 reaper 循环回填结算；REST 快照做重连 resync。模型/回测/闸门是后续独立计划，只读这份存储。

**Tech Stack:** Python 3.11+，`websockets`（WS），`aiohttp`（REST），`aiosqlite`（SQLite），`pytest` + `pytest-asyncio`（测试），`pyarrow` + `pandas`（Parquet 导出）。

**Spec:** `docs/superpowers/specs/2026-08-31-predict-updown-bot-design.md`

**范围说明：** 本计划只覆盖 spec 的 **w1 采集器**。模型/回测/闸门（w2–3）与 TS 执行层（w4）是后续独立计划——它们依赖本计划产出的数据与 Task 1 确认的协议，且 w4 还卡在"纸上 EV>0"这个条件上，现在写只会是猜测。

## Global Constraints

- 语言 Python 3.11+；下单层不在本计划内（w4 TS 薄层单独计划）。
- 时间戳一律 UTC 毫秒（`int`），取 WS 帧到达本地时刻。
- 结算标签只能用官方结果，**严禁**用币安 K 线自己判涨跌。
- 时钟纪律：本机用 `w32tm /resync` 对准（运维步骤，见 Task 8 README），代码里 `ts_ms = time.time_ns() // 1_000_000`。
- 单条 WS 连接共连两 topic；若实测 API 强制分连接，降级为双连接 + 对表校准（见 Task 1 协议笔记）。
- API Key / 私钥只从环境变量读（`PREDICT_FUN_API_KEY`），不进仓库、不进 exe。

---

### Task 1: 协议探测 + 捕获原始帧（fixture）

**Files:**
- Create: `predict-updown-bot/collector/__init__.py`
- Create: `predict-updown-bot/collector/probe.py`
- Create: `predict-updown-bot/docs/predict-fun-protocol.md`
- Create: `predict-updown-bot/fixtures/.gitkeep`

**Interfaces:**
- Consumes: 环境变量 `PREDICT_FUN_API_KEY`（Discord 开，可选——先试无鉴权）。
- Produces: `fixtures/*.jsonl`（原始帧，带本地接收时间戳）、`docs/predict-fun-protocol.md`（订阅格式/消息字段/鉴权结论/结算端点，作为后续所有 task 的协议真源）。

- [ ] **Step 1: 写 probe 脚本**（连接 + 尝试订阅 + 抓原始帧）

```python
# collector/probe.py
"""捕获 Predict.fun WS 原始帧 + REST 快照，确定协议并产出 TDD fixture。

用法: python -m collector.probe --market-id <id> --seconds 30
输出: fixtures/ws_<ts>.jsonl（每行 {recv_ms, raw}）、fixtures/rest_<ts>.json
"""
import argparse, asyncio, json, os, time
import aiohttp
from aiohttp import WSMsgType

WS_URL = os.environ.get("PREDICT_FUN_WS_URL", "wss://ws.predict.fun/ws")
REST_BASE = os.environ.get("PREDICT_FUN_REST_BASE", "https://api.predict.fun/v1")
API_KEY = os.environ.get("PREDICT_FUN_API_KEY", "")

# 订阅消息的候选格式，逐个尝试直到收到数据帧
SUBSCRIBE_CANDIDATES = [
    {"type": "subscribe", "topics": ["predictOrderbook/{m}", "assetPriceUpdate/{f}"]},
    {"op": "subscribe", "channels": ["predictOrderbook/{m}", "assetPriceUpdate/{f}"]},
    {"method": "subscribe", "params": {"topics": ["predictOrderbook/{m}", "assetPriceUpdate/{f}"]}},
    {"type": "SUBSCRIBE", "topic": "predictOrderbook/{m}"},
]

async def capture_ws(market_id: str, feed_id: int, seconds: int, out: str) -> None:
    headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}
    async with aiohttp.ClientSession(headers=headers) as sess:
        async with sess.ws_connect(WS_URL) as ws:
            for cand in SUBSCRIBE_CANDIDATES:
                await ws.send_str(json.dumps(cand).replace("{m}", market_id).replace("{f}", str(feed_id)))
            deadline = time.monotonic() + seconds
            with open(out, "a") as fh:
                while time.monotonic() < deadline:
                    msg = await asyncio.wait_for(ws.receive(), timeout=5)
                    if msg.type == WSMsgType.TEXT:
                        fh.write(json.dumps({"recv_ms": time.time_ns() // 1_000_000,
                                             "raw": json.loads(msg.data)}) + "\n")
                        fh.flush()

async def capture_rest(market_id: str, out: str) -> None:
    async with aiohttp.ClientSession() as sess:
        async with sess.get(f"{REST_BASE}/markets/{market_id}/orderbook") as r:
            data = await r.json()
        with open(out, "w") as fh:
            json.dump(data, fh, indent=2)

async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market-id", required=True)
    ap.add_argument("--feed-id", type=int, default=1)
    ap.add_argument("--seconds", type=int, default=30)
    a = ap.parse_args()
    ts = int(time.time())
    await capture_ws(a.market_id, a.feed_id, a.seconds, f"fixtures/ws_{ts}.jsonl")
    await capture_rest(a.market_id, f"fixtures/rest_{ts}.json")

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: 运行 probe 并确认连得上**

Run: `python -m collector.probe --market-id <真实marketId> --seconds 30`
Expected: `fixtures/ws_*.jsonl` 出现数据帧；若无数据帧，把 4 个候选订阅消息的输出贴出来排查。

- [ ] **Step 3: 写协议笔记**

把 Step 2 观察到的结果写进 `docs/predict-fun-protocol.md`，至少覆盖：
1. 订阅消息的**实际生效格式**（哪个 candidate 被 ACK）
2. 是否需要鉴权（`PREDICT_FUN_API_KEY` 有无差异）
3. `predictOrderbook` 帧的字段名与结构（bid/ask 是 `price/size` 列表？字符串还是数字？）
4. `assetPriceUpdate` 帧的字段名（`price`、`feedId`、`timestamp`？）
5. 单连接订两 topic 是否可行，还是必须分两条连接
6. REST 快照 `/markets/{id}/orderbook` 的响应结构
7. 市场元数据 + 官方结算结果从哪个 REST 端点取（`price_to_beat`、`Final Price`、`resolved` 来源）

- [ ] **Step 4: 提交 fixture 与协议笔记**

```bash
git add collector/probe.py collector/__init__.py docs/predict-fun-protocol.md fixtures/
git commit -m "feat(collector): WS 协议探测脚本 + 原始帧 fixture + 协议笔记"
```

> **暂停门：** 这一步产出 `predict-fun-protocol.md` 是 Task 3/5/7 的协议真源。执行时若字段名与下文"工作假设"不符，只改 `parser.py` 里的键名映射，Tick 契约与下游不变。

---

### Task 2: 存储层（schema + db）

**Files:**
- Create: `predict-updown-bot/storage/__init__.py`
- Create: `predict-updown-bot/storage/schema.sql`
- Create: `predict-updown-bot/storage/db.py`
- Test: `predict-updown-bot/tests/test_db.py`

**Interfaces:**
- Produces:
  - `async def init_db(path: str) -> None` — 建表 + WAL。
  - `async def connect(path: str) -> aiosqlite.Connection` — 返回连接（调用方负责 `await conn.close()`）。
  - 表：`markets`、`ticks`、`trades`（见 schema）。

- [ ] **Step 1: 写失败测试**

```python
# tests/test_db.py
import aiosqlite, pytest

@pytest.mark.asyncio
async def test_init_db_creates_tables_and_wal(tmp_path):
    from storage.db import init_db, connect
    p = str(tmp_path / "test.db")
    await init_db(p)
    conn = await connect(p)
    cur = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {r[0] for r in await cur.fetchall()}
    assert {"markets", "ticks", "trades"} <= tables
    jm = await conn.execute("PRAGMA journal_mode")
    assert (await jm.fetchone())[0] == "wal"
    await conn.close()
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_db.py -v`
Expected: FAIL（`No module named 'storage.db'`）

- [ ] **Step 3: 写 schema.sql**

```sql
CREATE TABLE IF NOT EXISTS markets (
    market_id        TEXT PRIMARY KEY,
    slug             TEXT NOT NULL,
    window_start     INTEGER NOT NULL,   -- UTC 毫秒
    window_end       INTEGER NOT NULL,   -- UTC 毫秒
    price_to_beat    REAL,
    feed_id          INTEGER,
    resolved         INTEGER,            -- 1=Up 0=Down -1=Flat NULL=未结算
    end_price        REAL,
    settlement_source TEXT
);

CREATE TABLE IF NOT EXISTS ticks (
    ts_ms      INTEGER NOT NULL,
    market_id  TEXT NOT NULL REFERENCES markets(market_id),
    spot       REAL,
    up_bid     REAL,
    up_ask     REAL,
    up_bid_sz  REAL,
    up_ask_sz  REAL,
    spread     REAL,
    t_left_sec REAL,
    PRIMARY KEY (market_id, ts_ms)
);
CREATE INDEX IF NOT EXISTS idx_ticks_ts ON ticks(ts_ms);

CREATE TABLE IF NOT EXISTS trades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms      INTEGER NOT NULL,
    market_id  TEXT NOT NULL,
    side       TEXT NOT NULL,            -- 'up' / 'down'
    p_hat      REAL,
    ask        REAL,
    ev         REAL,
    filled     INTEGER,                  -- 0/1
    settlement REAL,
    fee        REAL,
    live       INTEGER                   -- 0=纸上 1=实盘
);
```

- [ ] **Step 4: 写 db.py**

```python
# storage/db.py
import os
import aiosqlite

SCHEMA = os.path.join(os.path.dirname(__file__), "schema.sql")

async def init_db(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = await aiosqlite.connect(path)
    await conn.execute("PRAGMA journal_mode=WAL")
    with open(SCHEMA, encoding="utf-8") as fh:
        await conn.executescript(fh.read())
    await conn.commit()
    await conn.close()

async def connect(path: str) -> aiosqlite.Connection:
    conn = await aiosqlite.connect(path)
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA synchronous=NORMAL")
    return conn
```

- [ ] **Step 5: 运行确认通过**

Run: `pytest tests/test_db.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add storage/ tests/test_db.py
git commit -m "feat(collector): SQLite schema + db 模块（WAL）"
```

---

### Task 3: 数据模型 + 消息解析器

**Files:**
- Create: `predict-updown-bot/collector/models.py`
- Create: `predict-updown-bot/collector/parser.py`
- Test: `predict-updown-bot/tests/test_parser.py`

**Interfaces:**
- Consumes: Task 1 的 `fixtures/*.jsonl`（原始帧）与 `docs/predict-fun-protocol.md`。
- Produces:
  - `models.Tick`（frozen dataclass）、`models.OrderbookUpdate`、`models.PriceUpdate`。
  - `parser.parse_frame(raw: dict) -> OrderbookUpdate | PriceUpdate | None`（非数据帧返回 None）。

- [ ] **Step 1: 写失败测试**（用 Task 1 抓到的真实帧；若字段名不同，按协议笔记改 `parse_frame` 内部键名）

```python
# tests/test_parser.py
import json
from collector.parser import parse_frame
from collector.models import OrderbookUpdate, PriceUpdate

def _frame(path):
    with open(path) as fh:
        return json.loads(fh.readline())["raw"]

def test_parse_orderbook_frame():
    raw = _frame("fixtures/ws_*.jsonl")  # 替换为 Task 1 实际文件名
    upd = parse_frame(raw)
    assert isinstance(upd, OrderbookUpdate)
    assert upd.up_bid > 0 and upd.up_ask > 0
    assert upd.up_bid <= upd.up_ask

def test_parse_price_frame():
    # 取一条 assetPriceUpdate 帧；这里用结构占位，键名以协议笔记为准
    raw = {"type": "assetPriceUpdate", "feedId": 1, "price": 97000.5}
    upd = parse_frame(raw)
    assert isinstance(upd, PriceUpdate)
    assert upd.spot == 97000.5
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_parser.py -v`
Expected: FAIL（`No module named 'collector.parser'`）

- [ ] **Step 3: 写 models.py**

```python
# collector/models.py
from dataclasses import dataclass

@dataclass(frozen=True)
class OrderbookUpdate:
    market_id: str
    up_bid: float
    up_ask: float
    up_bid_sz: float
    up_ask_sz: float

@dataclass(frozen=True)
class PriceUpdate:
    market_id: str
    spot: float

@dataclass(frozen=True)
class Tick:
    ts_ms: int
    market_id: str
    spot: float
    up_bid: float
    up_ask: float
    up_bid_sz: float
    up_ask_sz: float
    spread: float
    t_left_sec: float
```

- [ ] **Step 4: 写 parser.py**（键名映射为单一 seam，按 Task 1 协议笔记校正）

```python
# collector/parser.py
"""把原始 WS 帧解析成 typed update。键名映射集中在此文件，协议变了只改这里。"""
from .models import OrderbookUpdate, PriceUpdate

def _f(x) -> float:
    return float(x)

def parse_frame(raw: dict):
    t = raw.get("type") or raw.get("event")
    if t == "predictOrderbook":      # 以协议笔记为准
        return _orderbook(raw)
    if t == "assetPriceUpdate":
        return PriceUpdate(market_id=str(raw.get("feedId") or raw.get("marketId")),
                           spot=_f(raw["price"]))
    return None

def _orderbook(raw: dict) -> OrderbookUpdate:
    bids = raw.get("bids") or []
    asks = raw.get("asks") or []
    return OrderbookUpdate(
        market_id=str(raw["marketId"]),
        up_bid=_f(bids[0]["price"]) if bids else 0.0,
        up_ask=_f(asks[0]["price"]) if asks else 0.0,
        up_bid_sz=_f(bids[0]["size"]) if bids else 0.0,
        up_ask_sz=_f(asks[0]["size"]) if asks else 0.0,
    )
```

- [ ] **Step 5: 运行确认通过**

Run: `pytest tests/test_parser.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add collector/models.py collector/parser.py tests/test_parser.py
git commit -m "feat(collector): Tick/update 数据模型 + WS 帧解析器"
```

---

### Task 4: 组装器 + 写入器（state → Tick → SQLite）

**Files:**
- Create: `predict-updown-bot/collector/assembler.py`
- Create: `predict-updown-bot/collector/writer.py`
- Test: `predict-updown-bot/tests/test_assembler_writer.py`

**Interfaces:**
- Consumes: `models.OrderbookUpdate` / `models.PriceUpdate`（Task 3）、`storage.db`（Task 2）。
- Produces:
  - `assembler.TickAssembler`：`push(update) -> Tick | None`，内部缓存最新 spot/盘口，任一变动即产出 Tick（`spread=up_ask-up_bid`，`t_left_sec=(window_end - ts_ms)/1000`）。
  - `writer.upsert_tick(conn, tick) -> None`：`INSERT ... ON CONFLICT(market_id, ts_ms) DO NOTHING`。

- [ ] **Step 1: 写失败测试**

```python
# tests/test_assembler_writer.py
import pytest
from collector.assembler import TickAssembler
from collector.models import PriceUpdate, OrderbookUpdate

def test_assembler_emits_on_first_price_and_orderbook():
    a = TickAssembler(market_id="m1", window_end=1700000003000)
    assert a.push(PriceUpdate("m1", 97000.0)) is None   # 缺盘口，不产出
    tick = a.push(OrderbookUpdate("m1", 0.50, 0.52, 100.0, 80.0))
    assert tick is not None
    assert tick.spot == 97000.0 and tick.up_bid == 0.50
    assert tick.spread == pytest.approx(0.02)
    assert tick.t_left_sec == pytest.approx(0.0)  # ts_ms 由注入时钟决定

def test_assembler_does_not_emit_when_unchanged():
    a = TickAssembler(market_id="m1", window_end=1700000003000, now=lambda: 1700000000000)
    a.push(PriceUpdate("m1", 97000.0))
    a.push(OrderbookUpdate("m1", 0.50, 0.52, 100.0, 80.0))
    assert a.push(OrderbookUpdate("m1", 0.50, 0.52, 100.0, 80.0)) is None  # 相同盘口，不产出

@pytest.mark.asyncio
async def test_upsert_tick_dedup(tmp_path):
    from storage.db import init_db, connect
    from collector.writer import upsert_tick
    from collector.models import Tick
    p = str(tmp_path / "t.db"); await init_db(p); conn = await connect(p)
    t = Tick(1700000000000, "m1", 97000.0, 0.50, 0.52, 100.0, 80.0, 0.02, 3.0)
    await upsert_tick(conn, t)
    await upsert_tick(conn, t)  # 重复主键，忽略
    cur = await conn.execute("SELECT COUNT(*) FROM ticks")
    assert (await cur.fetchone())[0] == 1
    await conn.close()
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_assembler_writer.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 assembler.py**

```python
# collector/assembler.py
"""缓存最新 spot 与盘口，任一变动即组装一行 Tick。"""
import time
from .models import OrderbookUpdate, PriceUpdate, Tick

class TickAssembler:
    def __init__(self, market_id: str, window_end: int, now=time.time_ns):
        self.market_id = market_id
        self.window_end = window_end
        self._now = now
        self._spot = None
        self._ob = None

    def push(self, upd):
        if isinstance(upd, PriceUpdate):
            self._spot = upd.spot
        elif isinstance(upd, OrderbookUpdate):
            self._ob = upd
        if self._spot is None or self._ob is None:
            return None
        ts = self._now() // 1_000_000
        tick = Tick(ts, self.market_id, self._spot, self._ob.up_bid, self._ob.up_ask,
                    self._ob.up_bid_sz, self._ob.up_ask_sz,
                    self._ob.up_ask - self._ob.up_bid,
                    (self.window_end - ts) / 1000)
        # 若与上一 tick 完全相同则不重复产出（简单去重：记录上一 tick 字段）
        if self._last == (tick.spot, tick.up_bid, tick.up_ask, tick.up_bid_sz, tick.up_ask_sz):
            return None
        self._last = (tick.spot, tick.up_bid, tick.up_ask, tick.up_bid_sz, tick.up_ask_sz)
        return tick
```

- [ ] **Step 4: 写 writer.py**

```python
# collector/writer.py
from .models import Tick

async def upsert_tick(conn, tick: Tick) -> None:
    await conn.execute(
        "INSERT OR IGNORE INTO ticks (ts_ms, market_id, spot, up_bid, up_ask, up_bid_sz, up_ask_sz, spread, t_left_sec) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (tick.ts_ms, tick.market_id, tick.spot, tick.up_bid, tick.up_ask,
         tick.up_bid_sz, tick.up_ask_sz, tick.spread, tick.t_left_sec),
    )
    await conn.commit()
```

- [ ] **Step 5: 运行确认通过**

Run: `pytest tests/test_assembler_writer.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add collector/assembler.py collector/writer.py tests/test_assembler_writer.py
git commit -m "feat(collector): Tick 组装器 + SQLite 写入（去重 upsert）"
```

---

### Task 5: WS 客户端（订阅 / 重连 / REST resync）

**Files:**
- Create: `predict-updown-bot/collector/ws_client.py`
- Test: `predict-updown-bot/tests/test_ws_client.py`

**Interfaces:**
- Consumes: `parser.parse_frame`（Task 3）、`TickAssembler`（Task 4）、`storage.db`（Task 2）。
- Produces:
  - `ws_client.subscribe(topics: list[str]) -> str` — 返回订阅消息 JSON 字符串（按 Task 1 协议笔记）。
  - `ws_client.CollectorClient`：`run(market_id, feed_id, conn, on_tick)`，内部 `_connect()` + 指数退避重连 + 重连后 `_resync_from_rest(market_id)`。

- [ ] **Step 1: 写失败测试**（用 fake WS 回放，不连真网）

```python
# tests/test_ws_client.py
import json
from collector.ws_client import subscribe

def test_subscribe_builds_expected_message():
    msg = subscribe(["predictOrderbook/m1", "assetPriceUpdate/1"])
    data = json.loads(msg)
    assert data["type"] == "subscribe"           # 以 Task 1 协议笔记为准
    assert "predictOrderbook/m1" in data["topics"]
    assert "assetPriceUpdate/1" in data["topics"]
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_ws_client.py -v`
Expected: FAIL

- [ ] **Step 3: 写 ws_client.py**

```python
# collector/ws_client.py
"""WS 连接、订阅、指数退避重连、REST 快照 resync。协议细节以 Task 1 笔记为准。"""
import asyncio, json, os
import aiohttp
from aiohttp import WSMsgType
from .parser import parse_frame
from .assembler import TickAssembler
from .writer import upsert_tick

WS_URL = os.environ.get("PREDICT_FUN_WS_URL", "wss://ws.predict.fun/ws")
REST_BASE = os.environ.get("PREDICT_FUN_REST_BASE", "https://api.predict.fun/v1")

def subscribe(topics: list[str]) -> str:
    return json.dumps({"type": "subscribe", "topics": topics})  # 格式以协议笔记为准

class CollectorClient:
    def __init__(self, market_id: str, feed_id: int, assembler: TickAssembler):
        self.market_id, self.feed_id, self.assembler = market_id, feed_id, assembler
        self.topics = [f"predictOrderbook/{market_id}", f"assetPriceUpdate/{feed_id}"]

    async def run(self, conn):
        backoff = 1.0
        while True:
            try:
                await self._session(conn)
                backoff = 1.0
            except Exception:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def _session(self, conn):
        async with aiohttp.ClientSession() as sess:
            async with sess.ws_connect(WS_URL) as ws:
                await ws.send_str(subscribe(self.topics))
                await self._resync_from_rest(sess)
                async for msg in ws:
                    if msg.type != WSMsgType.TEXT:
                        continue
                    upd = parse_frame(json.loads(msg.data))
                    if upd is None:
                        continue
                    tick = self.assembler.push(upd)
                    if tick is not None:
                        await upsert_tick(conn, tick)

    async def _resync_from_rest(self, sess):
        async with sess.get(f"{REST_BASE}/markets/{self.market_id}/orderbook") as r:
            data = await r.json()
        # 用 REST 快照重新对齐 assembler 的盘口状态（键名以协议笔记为准）
        from .models import OrderbookUpdate
        self.assembler.push(OrderbookUpdate(
            self.market_id,
            float(data["bids"][0]["price"]), float(data["asks"][0]["price"]),
            float(data["bids"][0]["size"]), float(data["asks"][0]["size"]),
        ))
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_ws_client.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add collector/ws_client.py tests/test_ws_client.py
git commit -m "feat(collector): WS 客户端（订阅/重连/REST resync）"
```

---

### Task 6: 市场跟踪器（窗口翻转）

**Files:**
- Create: `predict-updown-bot/collector/market_tracker.py`
- Test: `predict-updown-bot/tests/test_market_tracker.py`

**Interfaces:**
- Consumes: `storage.db`（Task 2）。
- Produces:
  - `market_tracker.parse_slug(slug: str) -> tuple[int, int]` — `(window_start, window_end)`，从 `btc-updown-5m-{unix}` 解析，`window_end = window_start + 300_000`。
  - `market_tracker.MarketTracker.current(window_start) -> str` — 给定当前时间，算出当前市场 slug。

- [ ] **Step 1: 写失败测试**

```python
# tests/test_market_tracker.py
from collector.market_tracker import parse_slug, MarketTracker

def test_parse_slug_derives_window():
    start, end = parse_slug("btc-updown-5m-1700000000")
    assert start == 1700000000
    assert end == 1700000000 + 300_000

def test_current_maps_to_5m_bucket():
    mt = MarketTracker()
    # 1700000123 落在 [1700000000, 1700000300) 这个桶
    assert mt.current(1700000123) == "btc-updown-5m-1700000000"
    assert mt.current(1700000300) == "btc-updown-5m-1700000300"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_market_tracker.py -v`
Expected: FAIL

- [ ] **Step 3: 写 market_tracker.py**

```python
# collector/market_tracker.py
WINDOW_MS = 300_000

def parse_slug(slug: str) -> tuple[int, int]:
    start = int(slug.rsplit("-", 1)[1])
    return start, start + WINDOW_MS

class MarketTracker:
    def current(self, now_ms: int) -> str:
        start = now_ms - (now_ms % WINDOW_MS)
        return f"btc-updown-5m-{start}"
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_market_tracker.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add collector/market_tracker.py tests/test_market_tracker.py
git commit -m "feat(collector): 市场窗口跟踪（slug 解析 + 5m 桶）"
```

---

### Task 7: 结算 reaper（回填 resolved / end_price）

**Files:**
- Create: `predict-updown-bot/collector/settlement_reaper.py`
- Test: `predict-updown-bot/tests/test_settlement_reaper.py`

**Interfaces:**
- Consumes: `storage.db`（Task 2）、官方结算端点（Task 1 笔记确认）。
- Produces:
  - `settlement_reaper.fetch_settlement(sess, market_id) -> tuple[int | None, float | None]` — 返回 `(resolved, end_price)`；拿不到返回 `(None, None)`。
  - `settlement_reaper.backfill(conn, market_id) -> bool` — 回填 `markets`，成功返回 True。

- [ ] **Step 1: 写失败测试**（用 fixture 结算结果，不连真网）

```python
# tests/test_settlement_reaper.py
import pytest
from collector.settlement_reaper import backfill

class _Sess:
    async def get(self, url):
        class R:
            async def json(self): return {"resolved": 1, "finalPrice": 97050.0}  # 以协议笔记为准
        return R()

@pytest.mark.asyncio
async def test_backfill_writes_resolved(tmp_path):
    from storage.db import init_db, connect
    p = str(tmp_path / "t.db"); await init_db(p); conn = await connect(p)
    await conn.execute("INSERT INTO markets (market_id, slug, window_start, window_end) VALUES ('m1','btc-updown-5m-1',0,300000)")
    await conn.commit()
    ok = await backfill(conn, "m1", sess=_Sess())
    assert ok is True
    cur = await conn.execute("SELECT resolved, end_price FROM markets WHERE market_id='m1'")
    row = await cur.fetchone()
    assert row == (1, 97050.0)
    await conn.close()
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_settlement_reaper.py -v`
Expected: FAIL

- [ ] **Step 3: 写 settlement_reaper.py**

```python
# collector/settlement_reaper.py
"""窗口收盘后回填官方结算结果（resolved / end_price）。严禁用币安 K 线自判。"""
import os
REST_BASE = os.environ.get("PREDICT_FUN_REST_BASE", "https://api.predict.fun/v1")

async def fetch_settlement(sess, market_id: str):
    # 端点以 Task 1 协议笔记为准
    async with sess.get(f"{REST_BASE}/markets/{market_id}/settlement") as r:
        if r.status != 200:
            return None, None
        data = await r.json()
        return data.get("resolved"), data.get("finalPrice")

async def backfill(conn, market_id: str, sess=None) -> bool:
    import aiohttp
    owns = sess is None
    sess = sess or aiohttp.ClientSession()
    try:
        resolved, end_price = await fetch_settlement(sess, market_id)
        if resolved is None:
            return False
        await conn.execute(
            "UPDATE markets SET resolved=?, end_price=?, settlement_source=? WHERE market_id=?",
            (resolved, end_price, "official", market_id),
        )
        await conn.commit()
        return True
    finally:
        if owns:
            await sess.close()
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_settlement_reaper.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add collector/settlement_reaper.py tests/test_settlement_reaper.py
git commit -m "feat(collector): 结算 reaper（官方结果回填）"
```

---

### Task 8: Parquet 导出 + CLI 入口 + README

**Files:**
- Create: `predict-updown-bot/storage/export.py`
- Create: `predict-updown-bot/collector/main.py`
- Create: `predict-updown-bot/requirements.txt`
- Create: `predict-updown-bot/README.md`
- Test: `predict-updown-bot/tests/test_export.py`

**Interfaces:**
- Consumes: `storage.db`（Task 2）、上面全部 collector 组件。
- Produces:
  - `export.export_ticks(conn, out_dir: str) -> str` — 导出 `ticks` JOIN `markets` 到 Parquet（按天分区），返回输出路径。
  - `main.py` — 入口：初始化 DB → 确定当前市场 → 起 WS 采集循环 + 结算 reaper 循环，直到 Ctrl-C。

- [ ] **Step 1: 写失败测试**

```python
# tests/test_export.py
import pytest

@pytest.mark.asyncio
async def test_export_ticks_writes_parquet(tmp_path):
    from storage.db import init_db, connect
    from storage.export import export_ticks
    p = str(tmp_path / "t.db"); await init_db(p); conn = await connect(p)
    await conn.execute("INSERT INTO markets (market_id, slug, window_start, window_end) VALUES ('m1','btc-updown-5m-1',0,300000)")
    await conn.execute("INSERT INTO ticks (ts_ms, market_id, spot) VALUES (1700000000000, 'm1', 97000.0)")
    await conn.commit()
    out = export_ticks(conn, str(tmp_path / "parquet"))
    import os
    assert os.path.exists(out)
    await conn.close()
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_export.py -v`
Expected: FAIL

- [ ] **Step 3: 写 export.py**

```python
# storage/export.py
import os
import pandas as pd

async def export_ticks(conn, out_dir: str) -> str:
    df = pd.read_sql_query(
        "SELECT t.*, m.slug, m.window_start, m.window_end, m.price_to_beat, m.resolved, m.end_price "
        "FROM ticks t JOIN markets m ON t.market_id = m.market_id ORDER BY t.ts_ms", conn)
    os.makedirs(out_dir, exist_ok=True)
    day = pd.to_datetime(df["ts_ms"], unit="ms").dt.date.astype(str).iloc[0] if len(df) else "empty"
    out = os.path.join(out_dir, f"ticks-{day}.parquet")
    df.to_parquet(out, index=False)
    return out
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_export.py -v`
Expected: PASS

- [ ] **Step 5: 写 main.py + requirements.txt + README**

```python
# collector/main.py
"""采集器入口：初始化 DB → 确定当前市场 → 起采集循环 + 结算 reaper。"""
import asyncio, time
from .market_tracker import MarketTracker, parse_slug
from .assembler import TickAssembler
from .ws_client import CollectorClient
from .settlement_reaper import backfill
from storage.db import init_db, connect
import os, aiohttp

DB_PATH = os.environ.get("PREDICT_FUN_DB", "data/predict.db")
FEED_ID = 1

async def reaper_loop(conn):
    while True:
        cur = await conn.execute("SELECT market_id FROM markets WHERE resolved IS NULL AND window_end < ?", (time.time_ns() // 1_000_000,))
        for (mid,) in await cur.fetchall():
            await backfill(conn, mid)
        await asyncio.sleep(30)

async def main():
    await init_db(DB_PATH)
    conn = await connect(DB_PATH)
    tracker = MarketTracker()
    try:
        while True:
            now = time.time_ns() // 1_000_000
            slug = tracker.current(now)
            start, end = parse_slug(slug)
            await conn.execute(
                "INSERT OR IGNORE INTO markets (market_id, slug, window_start, window_end, feed_id) VALUES (?,?,?,?,?)",
                (slug, slug, start, end, FEED_ID))
            await conn.commit()
            assembler = TickAssembler(market_id=slug, window_end=end)
            client = CollectorClient(slug, FEED_ID, assembler)
            await asyncio.gather(client.run(conn), reaper_loop(conn))
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
```

```text
# requirements.txt
websockets
aiohttp
aiosqlite
pandas
pyarrow
pytest
pytest-asyncio
```

README 要点（写进 `README.md`）：
- 环境变量：`PREDICT_FUN_API_KEY`、`PREDICT_FUN_DB`。
- 时钟纪律：运行前 `w32tm /resync`，建议加计划任务定期校时。
- 启动：`python -m collector.main`。
- w1 对齐校验：跑满一天后，比对 `markets.end_price`（官方结算）与窗口内 `ticks.spot` 的收盘值，确认与 Price to Beat 链条一致，对不上就停（spec 要求）。

- [ ] **Step 6: 提交**

```bash
git add storage/export.py collector/main.py requirements.txt README.md tests/test_export.py
git commit -m "feat(collector): Parquet 导出 + CLI 入口 + README"
```

---

## Self-Review

**1. Spec coverage（w1 部分）：**
- 采集器守护进程 ✓（Task 5/8）
- 单 WS 连接两 topic ✓（Task 1/5）
- 事件驱动写行 ✓（Task 4）
- 市场翻转订阅 ✓（Task 6/8）
- 结算 reaper 回填 ✓（Task 7）
- UTC 毫秒时钟 + w32tm ✓（Global Constraints + Task 8 README）
- 断线重连 + REST resync ✓（Task 5）
- SQLite WAL append-only ✓（Task 2/4）
- Parquet 导出 ✓（Task 8）
- 对齐校验（w1 出口）✓（Task 8 README）
- **gap：** 特征/模型/闸门/回测/执行层——本计划范围外，后续独立计划（已在范围说明标注）。

**2. Placeholder scan：** 无 TBD/TODO。"以协议笔记为准"是刻意设计的 seam（Task 1 是协议真源），非占位——字段语义已定，只键名可能微调。

**3. Type consistency：**
- `Tick` 字段名全程一致：`ts_ms, market_id, spot, up_bid, up_ask, up_bid_sz, up_ask_sz, spread, t_left_sec`（Task 3 定义 → Task 4 使用）。
- `parse_frame` 返回 `OrderbookUpdate | PriceUpdate | None`，`TickAssembler.push` 消费一致。
- `upsert_tick(conn, tick)` / `backfill(conn, market_id, sess=None)` / `export_ticks(conn, out_dir)` 签名前后一致。
- `market_id` 用 `slug` 作主键（`btc-updown-5m-{unix}` 天然唯一），`markets.market_id` 与 `ticks.market_id` 对齐。
