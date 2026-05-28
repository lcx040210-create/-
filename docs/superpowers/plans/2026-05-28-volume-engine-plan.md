# 刷量引擎实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个支持币安和 Bittap 的加密货币刷量引擎，含单交易所自成交和跨交易所对倒模式，覆盖现货和永续合约。

**Architecture:** 五层架构——Web 层（FastAPI + Jinja2 + WebSocket）、引擎层（VolumeEngine 并发调度）、执行层（OrderExecutor 状态机）、适配层（ExchangeAdapter 抽象基类 + BinanceAdapter + BittapAdapter）、数据层（SQLite）。引擎和 Web 服务共享同一个 asyncio 事件循环。

**Tech Stack:** Python 3.11+, FastAPI, ccxt.pro (Binance), aiohttp (Bittap), SQLite (aiosqlite), Jinja2, Chart.js, bcrypt

---

### Task 1: 项目脚手架和依赖

**Files:**
- Create: `volume-engine/requirements.txt`
- Create: `volume-engine/engine/__init__.py`
- Create: `volume-engine/exchange/__init__.py`
- Create: `volume-engine/web/__init__.py`
- Create: `volume-engine/models/__init__.py`
- Create: `volume-engine/static/.gitkeep`

- [ ] **Step 1: 创建项目目录**

Run: `mkdir -p /c/Users/04/Desktop/volume-engine/{engine,exchange,web/templates,models,static}`

- [ ] **Step 2: 写入 requirements.txt**

```txt
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
ccxt[pro]>=4.2.0
aiohttp>=3.9.0
aiosqlite>=0.20.0
jinja2>=3.1.0
python-multipart>=0.0.9
bcrypt>=4.1.0
pyyaml>=6.0
```

- [ ] **Step 3: 写入空 __init__.py 文件**

Run:
```bash
touch /c/Users/04/Desktop/volume-engine/engine/__init__.py
touch /c/Users/04/Desktop/volume-engine/exchange/__init__.py
touch /c/Users/04/Desktop/volume-engine/web/__init__.py
touch /c/Users/04/Desktop/volume-engine/models/__init__.py
touch /c/Users/04/Desktop/volume-engine/static/.gitkeep
```

- [ ] **Step 4: 安装依赖验证**

Run: `cd /c/Users/04/Desktop/volume-engine && pip install -r requirements.txt 2>&1 | tail -5`
Expected: 无报错

- [ ] **Step 5: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/ && git commit -m "feat: scaffold volume-engine project with dependencies"
```

---

### Task 2: 数据模型与数据库初始化

**Files:**
- Create: `volume-engine/models/database.py`
- Create: `volume-engine/models/schema.py`

- [ ] **Step 1: 写数据库连接模块**

`volume-engine/models/database.py`:
```python
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
```

- [ ] **Step 2: 写建表 SQL**

`volume-engine/models/schema.py`:
```python
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    market TEXT NOT NULL CHECK(market IN ('spot','perpetual')),
    mode TEXT NOT NULL CHECK(mode IN ('single','cross')),
    side TEXT NOT NULL CHECK(side IN ('buy','sell')),
    amount REAL NOT NULL,
    price REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    fee_currency TEXT NOT NULL DEFAULT 'USDT',
    pnl REAL NOT NULL DEFAULT 0,
    order_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    total_volume REAL NOT NULL DEFAULT 0,
    trade_count INTEGER NOT NULL DEFAULT 0,
    total_fee REAL NOT NULL DEFAULT 0,
    total_pnl REAL NOT NULL DEFAULT 0,
    UNIQUE(date, exchange, symbol)
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_config (
    name TEXT PRIMARY KEY,
    api_key TEXT NOT NULL DEFAULT '',
    api_secret TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    fee_maker REAL NOT NULL DEFAULT 0.001,
    fee_taker REAL NOT NULL DEFAULT 0.001
);

CREATE TABLE IF NOT EXISTS risk_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('hard','soft')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO exchange_config (name, api_key, api_secret, enabled, fee_maker, fee_taker)
VALUES ('binance', '', '', 1, 0.0002, 0.0004);

INSERT OR IGNORE INTO exchange_config (name, api_key, api_secret, enabled, fee_maker, fee_taker)
VALUES ('bittap', '', '', 1, 0.0002, 0.0004);
"""
```

- [ ] **Step 3: 运行初始化验证**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
import asyncio
from models.database import init_db, DB_PATH
asyncio.run(init_db())
print('DB created at:', DB_PATH)
print('Tables:', __import__('sqlite3').connect(str(DB_PATH)).execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall())
"
```

- [ ] **Step 4: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/models/ && git commit -m "feat: add SQLite data models and schema"
```

---

### Task 3: 配置系统

**Files:**
- Create: `volume-engine/config.py`
- Create: `volume-engine/config.yaml`

- [ ] **Step 1: 写 config.py**

`volume-engine/config.py`:
```python
import yaml
from pathlib import Path
from dataclasses import dataclass, field

CONFIG_PATH = Path(__file__).parent / "config.yaml"


@dataclass
class EngineConfig:
    pairs: list[str] = field(default_factory=lambda: ["BTC/USDT", "ETH/USDT"])
    amount_per_trade: float = 100.0
    timeout_seconds: int = 15
    max_retries: int = 3
    daily_volume_limit: float = 500_000.0
    mode: str = "single"  # "single" | "cross"
    market: str = "spot"  # "spot" | "perpetual"
    order_strategy: str = "follow"  # "follow" | "depth_insert"


@dataclass
class RiskConfig:
    max_loss_per_round: float = 5.0
    max_loss_daily: float = 50.0
    min_balance: float = 100.0
    max_hold_seconds: int = 30
    max_spread_pct: float = 0.0005
    cancel_rate_limit: float = 0.8
    no_fill_rounds_limit: int = 10


@dataclass
class WebConfig:
    host: str = "127.0.0.1"
    port: int = 8080
    password_hash: str = ""


@dataclass
class AppConfig:
    engine: EngineConfig = field(default_factory=EngineConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    web: WebConfig = field(default_factory=WebConfig)


def load_config() -> AppConfig:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            data = yaml.safe_load(f) or {}
    else:
        data = {}
    cfg = AppConfig()
    if "engine" in data:
        for k, v in data["engine"].items():
            if hasattr(cfg.engine, k):
                setattr(cfg.engine, k, v)
    if "risk" in data:
        for k, v in data["risk"].items():
            if hasattr(cfg.risk, k):
                setattr(cfg.risk, k, v)
    if "web" in data:
        for k, v in data["web"].items():
            if hasattr(cfg.web, k):
                setattr(cfg.web, k, v)
    return cfg
```

- [ ] **Step 2: 写 config.yaml**

`volume-engine/config.yaml`:
```yaml
engine:
  pairs:
    - BTC/USDT
    - ETH/USDT
  amount_per_trade: 100
  timeout_seconds: 15
  max_retries: 3
  daily_volume_limit: 500000
  mode: single
  market: spot
  order_strategy: follow

risk:
  max_loss_per_round: 5.0
  max_loss_daily: 50.0
  min_balance: 100.0
  max_hold_seconds: 30
  max_spread_pct: 0.0005
  cancel_rate_limit: 0.8
  no_fill_rounds_limit: 10

web:
  host: "127.0.0.1"
  port: 8080
  password_hash: ""
```

- [ ] **Step 3: 验证加载**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
from config import load_config
cfg = load_config()
print('Engine:', cfg.engine)
print('Risk:', cfg.risk)
print('Web:', cfg.web)
"
```

- [ ] **Step 4: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/config.py volume-engine/config.yaml && git commit -m "feat: add config system with YAML and dataclasses"
```

---

### Task 4: 交易所适配器抽象基类

**Files:**
- Create: `volume-engine/exchange/base.py`

- [ ] **Step 1: 写抽象基类和数据类型**

`volume-engine/exchange/base.py`:
```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Optional


@dataclass
class Ticker:
    symbol: str
    bid: float
    ask: float
    last: float
    timestamp: int


@dataclass
class OrderBook:
    symbol: str
    bids: list[tuple[float, float]]  # [[price, amount], ...]
    asks: list[tuple[float, float]]
    timestamp: int


@dataclass
class Order:
    id: str
    symbol: str
    side: str  # "buy" | "sell"
    type: str  # "limit" | "market"
    amount: float
    price: float
    filled: float
    status: str  # "open" | "closed" | "canceled"
    fee: float = 0.0
    fee_currency: str = "USDT"


@dataclass
class Balance:
    free: dict[str, float]  # {"BTC": 1.0, "USDT": 5000.0}
    used: dict[str, float]
    total: dict[str, float]


@dataclass
class Position:
    symbol: str
    side: str  # "long" | "short"
    amount: float
    entry_price: float
    leverage: int
    unrealized_pnl: float


class ExchangeAdapter(ABC):
    def __init__(self, api_key: str, api_secret: str):
        self.api_key = api_key
        self.api_secret = api_secret

    @abstractmethod
    async def fetch_ticker(self, symbol: str) -> Ticker: ...

    @abstractmethod
    async def fetch_order_book(self, symbol: str, limit: int = 5) -> OrderBook: ...

    @abstractmethod
    async def create_limit_order(self, symbol: str, side: str, amount: float, price: float) -> Order: ...

    @abstractmethod
    async def create_market_order(self, symbol: str, side: str, amount: float) -> Order: ...

    @abstractmethod
    async def cancel_order(self, order_id: str, symbol: str) -> bool: ...

    @abstractmethod
    async def fetch_balance(self) -> Balance: ...

    @abstractmethod
    async def fetch_open_orders(self, symbol: Optional[str] = None) -> list[Order]: ...

    @abstractmethod
    async def fetch_positions(self) -> list[Position]: ...

    @abstractmethod
    async def set_leverage(self, symbol: str, leverage: int) -> bool: ...

    async def watch_order_book(self, symbol: str) -> AsyncIterator[OrderBook]:
        raise NotImplementedError

    async def watch_orders(self, symbol: str) -> AsyncIterator[Order]:
        raise NotImplementedError

    async def watch_balance(self) -> AsyncIterator[Balance]:
        raise NotImplementedError
```

- [ ] **Step 2: 验证导入**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
from exchange.base import ExchangeAdapter, Ticker, OrderBook, Order, Balance, Position
print('All types imported successfully')
"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/exchange/base.py && git commit -m "feat: add exchange adapter abstract base class and data types"
```

---

### Task 5: 币安适配器

**Files:**
- Create: `volume-engine/exchange/binance_adapter.py`

- [ ] **Step 1: 写 BinanceAdapter**

`volume-engine/exchange/binance_adapter.py`:
```python
import ccxt.pro as ccxt
from typing import AsyncIterator, Optional

from exchange.base import ExchangeAdapter, Ticker, OrderBook, Order, Balance, Position


class BinanceAdapter(ExchangeAdapter):
    def __init__(self, api_key: str, api_secret: str):
        super().__init__(api_key, api_secret)
        self._spot = ccxt.binance({"apiKey": api_key, "secret": api_secret})
        self._perp = ccxt.binanceusdm({"apiKey": api_key, "secret": api_secret})

    def _exchange(self, market: str) -> ccxt.Exchange:
        return self._spot if market == "spot" else self._perp

    def _market_type(self, symbol: str) -> str:
        return "spot" if "/USDT" in symbol and ":" not in symbol else "perpetual"

    async def fetch_ticker(self, symbol: str) -> Ticker:
        ex = self._exchange(self._market_type(symbol))
        t = await ex.fetch_ticker(symbol)
        return Ticker(symbol=symbol, bid=t["bid"], ask=t["ask"], last=t["last"], timestamp=t["timestamp"])

    async def fetch_order_book(self, symbol: str, limit: int = 5) -> OrderBook:
        ex = self._exchange(self._market_type(symbol))
        ob = await ex.fetch_order_book(symbol, limit)
        return OrderBook(symbol=symbol, bids=ob["bids"], asks=ob["asks"], timestamp=ob["timestamp"])

    async def create_limit_order(self, symbol: str, side: str, amount: float, price: float) -> Order:
        ex = self._exchange(self._market_type(symbol))
        o = await ex.create_order(symbol, "limit", side, amount, price)
        return Order(id=o["id"], symbol=symbol, side=side, type="limit",
                     amount=amount, price=price, filled=o.get("filled", 0), status=o["status"])

    async def create_market_order(self, symbol: str, side: str, amount: float) -> Order:
        ex = self._exchange(self._market_type(symbol))
        o = await ex.create_order(symbol, "market", side, amount)
        return Order(id=o["id"], symbol=symbol, side=side, type="market",
                     amount=amount, price=o.get("price", 0), filled=o.get("filled", amount), status=o["status"],
                     fee=o.get("fee", {}).get("cost", 0), fee_currency=o.get("fee", {}).get("currency", "USDT"))

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        ex = self._exchange(self._market_type(symbol))
        try:
            await ex.cancel_order(order_id, symbol)
            return True
        except Exception:
            return False

    async def fetch_balance(self) -> Balance:
        b = await self._spot.fetch_balance()
        return Balance(free=b.get("free", {}), used=b.get("used", {}), total=b.get("total", {}))

    async def fetch_open_orders(self, symbol: Optional[str] = None) -> list[Order]:
        orders = []
        for ex in [self._spot, self._perp]:
            raw = await ex.fetch_open_orders(symbol)
            for o in raw:
                orders.append(Order(id=o["id"], symbol=o["symbol"], side=o["side"],
                                    type=o["type"], amount=o["amount"], price=o["price"],
                                    filled=o.get("filled", 0), status=o["status"]))
        return orders

    async def fetch_positions(self) -> list[Position]:
        raw = await self._perp.fetch_positions()
        positions = []
        for p in raw:
            if float(p.get("contracts", 0)) == 0:
                continue
            positions.append(Position(
                symbol=p["symbol"], side=p["side"], amount=float(p["contracts"]),
                entry_price=p["entryPrice"], leverage=int(p["leverage"]),
                unrealized_pnl=p.get("unrealizedPnl", 0)))
        return positions

    async def set_leverage(self, symbol: str, leverage: int) -> bool:
        try:
            await self._perp.set_leverage(leverage, symbol)
            return True
        except Exception:
            return False

    async def watch_order_book(self, symbol: str) -> AsyncIterator[OrderBook]:
        ex = self._exchange(self._market_type(symbol))
        while True:
            ob = await ex.watch_order_book(symbol)
            yield OrderBook(symbol=symbol, bids=ob["bids"][:5], asks=ob["asks"][:5],
                            timestamp=ob["timestamp"])

    async def watch_orders(self, symbol: str) -> AsyncIterator[Order]:
        ex = self._exchange(self._market_type(symbol))
        while True:
            o = await ex.watch_orders(symbol)
            if o:
                latest = o[-1] if isinstance(o, list) else o
                yield Order(id=latest["id"], symbol=latest["symbol"], side=latest["side"],
                            type=latest["type"], amount=latest["amount"], price=latest["price"],
                            filled=latest.get("filled", 0), status=latest["status"],
                            fee=latest.get("fee", {}).get("cost", 0) if latest.get("fee") else 0)
```

- [ ] **Step 2: 验证导入**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
from exchange.binance_adapter import BinanceAdapter
print('BinanceAdapter imported')
"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/exchange/binance_adapter.py && git commit -m "feat: add Binance adapter via ccxt.pro"
```

---

### Task 6: Bittap 适配器（REST 部分）

**Files:**
- Create: `volume-engine/exchange/bittap_adapter.py`

> **注意：** Bittap 使用自定义 API 格式（非币安兼容）。以下实现基于已确认的信息：REST 端点 `https://openapi.bittap.com`，响应格式 `{"code":"0","data":{},"msg":"成功","success":true}`。签名算法待调研，当前用 HMAC-SHA256 占位。

- [ ] **Step 1: 写 BittapAdapter**

`volume-engine/exchange/bittap_adapter.py`:
```python
import hashlib
import hmac
import time
import aiohttp
from typing import AsyncIterator, Optional

from exchange.base import ExchangeAdapter, Ticker, OrderBook, Order, Balance, Position


class BittapAdapter(ExchangeAdapter):
    REST_URL = "https://openapi.bittap.com"
    WS_URL = "wss://ws.bittap.com"  # 待确认

    def __init__(self, api_key: str, api_secret: str):
        super().__init__(api_key, api_secret)
        self._session: Optional[aiohttp.ClientSession] = None

    async def _session_get(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def _sign(self, params: dict) -> str:
        query = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
        return hmac.new(self.api_secret.encode(), query.encode(), hashlib.sha256).hexdigest()

    async def _request(self, method: str, path: str, params: dict = None, signed: bool = False):
        session = await self._session_get()
        url = f"{self.REST_URL}{path}"
        headers = {"Content-Type": "application/json"}
        if params is None:
            params = {}
        if signed:
            params["timestamp"] = int(time.time() * 1000)
            params["apiKey"] = self.api_key
            params["sign"] = self._sign(params)
        if method == "GET":
            async with session.get(url, params=params, headers=headers) as resp:
                return await resp.json()
        else:
            async with session.request(method, url, json=params, headers=headers) as resp:
                return await resp.json()

    async def fetch_ticker(self, symbol: str) -> Ticker:
        data = await self._request("GET", "/api/v1/ticker", {"symbol": symbol})
        d = data["data"]
        return Ticker(symbol=symbol, bid=float(d["bid"]), ask=float(d["ask"]),
                      last=float(d["last"]), timestamp=d.get("timestamp", 0))

    async def fetch_order_book(self, symbol: str, limit: int = 5) -> OrderBook:
        data = await self._request("GET", "/api/v1/depth", {"symbol": symbol, "limit": limit})
        d = data["data"]
        bids = [[float(b[0]), float(b[1])] for b in d["bids"]]
        asks = [[float(a[0]), float(a[1])] for a in d["asks"]]
        return OrderBook(symbol=symbol, bids=bids, asks=asks, timestamp=d.get("timestamp", 0))

    async def create_limit_order(self, symbol: str, side: str, amount: float, price: float) -> Order:
        data = await self._request("POST", "/api/v1/order", {
            "symbol": symbol, "side": side.upper(), "type": "LIMIT",
            "quantity": amount, "price": price
        }, signed=True)
        d = data["data"]
        return Order(id=str(d["orderId"]), symbol=symbol, side=side, type="limit",
                     amount=amount, price=price, filled=0, status="open")

    async def create_market_order(self, symbol: str, side: str, amount: float) -> Order:
        data = await self._request("POST", "/api/v1/order", {
            "symbol": symbol, "side": side.upper(), "type": "MARKET",
            "quantity": amount
        }, signed=True)
        d = data["data"]
        return Order(id=str(d["orderId"]), symbol=symbol, side=side, type="market",
                     amount=amount, price=float(d.get("price", 0)),
                     filled=float(d.get("executedQty", amount)), status=d.get("status", "closed"))

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        data = await self._request("DELETE", "/api/v1/order", {
            "symbol": symbol, "orderId": order_id
        }, signed=True)
        return data["success"]

    async def fetch_balance(self) -> Balance:
        data = await self._request("GET", "/api/v1/account", signed=True)
        d = data["data"]
        free, used, total = {}, {}, {}
        for b in d.get("balances", []):
            asset = b["asset"]
            free[asset] = float(b["free"])
            used[asset] = float(b.get("locked", 0))
            total[asset] = free[asset] + used[asset]
        return Balance(free=free, used=used, total=total)

    async def fetch_open_orders(self, symbol: Optional[str] = None) -> list[Order]:
        params = {}
        if symbol:
            params["symbol"] = symbol
        data = await self._request("GET", "/api/v1/openOrders", params, signed=True)
        orders = []
        for o in data.get("data", []):
            orders.append(Order(id=str(o["orderId"]), symbol=o["symbol"],
                                side=o["side"].lower(), type=o["type"].lower(),
                                amount=float(o["origQty"]), price=float(o["price"]),
                                filled=float(o.get("executedQty", 0)), status=o["status"]))
        return orders

    async def fetch_positions(self) -> list[Position]:
        data = await self._request("GET", "/api/v1/positions", signed=True)
        positions = []
        for p in data.get("data", []):
            positions.append(Position(
                symbol=p["symbol"], side=p["side"].lower(),
                amount=float(p["positionAmt"]), entry_price=float(p["entryPrice"]),
                leverage=int(p["leverage"]), unrealized_pnl=float(p.get("unrealizedProfit", 0))))
        return positions

    async def set_leverage(self, symbol: str, leverage: int) -> bool:
        data = await self._request("POST", "/api/v1/leverage", {
            "symbol": symbol, "leverage": leverage
        }, signed=True)
        return data["success"]

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
```

- [ ] **Step 2: 验证导入**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
from exchange.bittap_adapter import BittapAdapter
print('BittapAdapter imported')
"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/exchange/bittap_adapter.py && git commit -m "feat: add Bittap adapter (REST)"
```

---

### Task 7: 风控管理器

**Files:**
- Create: `volume-engine/engine/risk_manager.py`

- [ ] **Step 1: 写 RiskManager**

`volume-engine/engine/risk_manager.py`:
```python
import asyncio
from dataclasses import dataclass, field
from datetime import datetime

from config import RiskConfig


@dataclass
class RiskState:
    daily_loss: float = 0.0
    daily_trades: int = 0
    cancel_count: int = 0
    total_orders: int = 0
    no_fill_rounds: int = 0
    taker_rounds: int = 0
    api_errors: int = 0
    api_total: int = 0
    paused_pairs: dict[str, float] = field(default_factory=dict)


class RiskManager:
    def __init__(self, config: RiskConfig):
        self.config = config
        self.state = RiskState()
        self._events: list[dict] = []
        self._lock = asyncio.Lock()

    async def check_hard_limits(self, spread: float, round_pnl: float) -> list[str]:
        triggers = []
        if spread > self.config.max_spread_pct:
            triggers.append(f"Spread {spread:.4%} exceeds limit {self.config.max_spread_pct:.4%}")
        if round_pnl < -self.config.max_loss_per_round:
            triggers.append(f"Round loss ${-round_pnl:.2f} exceeds max ${self.config.max_loss_per_round}")
        async with self._lock:
            if self.state.daily_loss < -self.config.max_loss_daily:
                triggers.append(f"Daily loss ${-self.state.daily_loss:.2f} exceeds max ${self.config.max_loss_daily}")
        return triggers

    async def check_balance(self, usdt_free: float) -> bool:
        return usdt_free >= self.config.min_balance

    async def check_soft_limits(self) -> list[str]:
        warnings = []
        async with self._lock:
            s = self.state
            if s.total_orders > 10 and s.cancel_count / s.total_orders > self.config.cancel_rate_limit:
                warnings.append(f"Cancel rate {s.cancel_count / s.total_orders:.1%} > {self.config.cancel_rate_limit:.1%}")
            if s.no_fill_rounds >= self.config.no_fill_rounds_limit:
                warnings.append(f"No-fill rounds {s.no_fill_rounds} >= limit {self.config.no_fill_rounds_limit}")
            if s.api_total > 20 and s.api_errors / s.api_total > 0.05:
                warnings.append(f"API error rate {s.api_errors / s.api_total:.1%} > 5%")
        return warnings

    async def record_trade(self, pnl: float):
        async with self._lock:
            self.state.daily_loss += pnl
            self.state.daily_trades += 1

    async def record_cancel(self):
        async with self._lock:
            self.state.cancel_count += 1
            self.state.total_orders += 1

    async def record_order(self):
        async with self._lock:
            self.state.total_orders += 1

    async def record_fill(self):
        async with self._lock:
            self.state.no_fill_rounds = 0

    async def record_no_fill(self):
        async with self._lock:
            self.state.no_fill_rounds += 1

    async def record_taker(self):
        async with self._lock:
            self.state.taker_rounds += 1

    async def record_api_error(self):
        async with self._lock:
            self.state.api_errors += 1
            self.state.api_total += 1

    async def record_api_success(self):
        async with self._lock:
            self.state.api_total += 1

    async def pause_pair(self, symbol: str, minutes: int = 5):
        async with self._lock:
            self.state.paused_pairs[symbol] = datetime.now().timestamp() + minutes * 60

    async def is_pair_paused(self, symbol: str) -> bool:
        async with self._lock:
            until = self.state.paused_pairs.get(symbol, 0)
            return datetime.now().timestamp() < until

    async def should_use_taker(self) -> int:
        """Returns 0=use maker, 1=maker retry, 2=taker, 3=abort"""
        async with self._lock:
            if self.state.taker_rounds >= 3:
                return 3  # abort
            return min(self.state.taker_rounds, 2)

    async def add_event(self, event_type: str, severity: str, message: str):
        async with self._lock:
            self._events.append({"type": event_type, "severity": severity, "message": message,
                                 "time": datetime.now().isoformat()})

    async def drain_events(self) -> list[dict]:
        async with self._lock:
            evts = self._events[:]
            self._events.clear()
            return evts

    async def reset_daily(self):
        async with self._lock:
            self.state.daily_loss = 0.0
            self.state.daily_trades = 0
```

- [ ] **Step 2: 验证**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
import asyncio
from engine.risk_manager import RiskManager
from config import RiskConfig
rm = RiskManager(RiskConfig())
print('Hard checks:', asyncio.run(rm.check_hard_limits(0.001, -1.0)))
print('Balance OK:', asyncio.run(rm.check_balance(500)))
print('Soft checks:', asyncio.run(rm.check_soft_limits()))
"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/engine/risk_manager.py && git commit -m "feat: add risk manager with hard/soft limits"
```

---

### Task 8: 订单执行器（状态机 + 现货自成交）

**Files:**
- Create: `volume-engine/engine/order_executor.py`

- [ ] **Step 1: 写 OrderExecutor**

`volume-engine/engine/order_executor.py`:
```python
import asyncio
import logging
from enum import Enum
from dataclasses import dataclass

from exchange.base import ExchangeAdapter, Order, OrderBook
from engine.risk_manager import RiskManager

logger = logging.getLogger(__name__)


class RoundState(Enum):
    IDLE = "idle"
    PLACING = "placing"
    WAITING = "waiting"
    FILLED_BUY = "filled_buy"
    FILLED_SELL = "filled_sell"
    TIMEOUT = "timeout"
    CANCELING = "canceling"
    CLOSING = "closing"
    PARTIAL_FILL = "partial_fill"


@dataclass
class RoundResult:
    symbol: str
    volume: float  # quote volume (USDT)
    pnl: float
    fee: float
    rounds: int


class OrderExecutor:
    def __init__(self, adapter: ExchangeAdapter, risk: RiskManager,
                 timeout: float = 15, amount: float = 100, strategy: str = "follow"):
        self.adapter = adapter
        self.risk = risk
        self.timeout = timeout
        self.amount = amount
        self.strategy = strategy

    async def execute_spot_single_round(self, symbol: str) -> RoundResult:
        """单交易所自成交（现货）- 一轮"""
        state = RoundState.IDLE
        buy_order: Order | None = None
        sell_order: Order | None = None
        fee = 0.0
        volume = 0.0
        pnl = 0.0

        try:
            # 1. 获取盘口
            ob = await self.adapter.fetch_order_book(symbol)
            await self.risk.record_api_success()

            bid = ob.bids[0][0]
            ask = ob.asks[0][0]
            spread = (ask - bid) / bid

            # 2. 风控检查
            triggers = await self.risk.check_hard_limits(spread, 0)
            if triggers:
                logger.warning(f"Hard limit triggered: {triggers}")
                return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

            # 3. 计算挂单价
            if self.strategy == "depth_insert":
                bid_price = bid * 0.999
                ask_price = ask * 1.001
            else:
                bid_price = bid
                ask_price = ask

            # 确定数量
            base = symbol.split("/")[0]
            ticker = await self.adapter.fetch_ticker(symbol)
            amount_in_base = self.amount / ticker.last

            # 4. 双边挂 Maker 单
            state = RoundState.PLACING
            await self.risk.record_order()
            buy_order = await self.adapter.create_limit_order(symbol, "buy", amount_in_base, bid_price)
            sell_order = await self.adapter.create_limit_order(symbol, "sell", amount_in_base, ask_price)
            await self.risk.record_order()

            # 5. 等待成交
            state = RoundState.WAITING
            deadline = asyncio.get_event_loop().time() + self.timeout
            buy_filled = False
            sell_filled = False
            retries = 0

            while asyncio.get_event_loop().time() < deadline and retries < 3:
                ob_new = await self.adapter.fetch_order_book(symbol)
                await self.risk.record_api_success()

                # 检查是否成交：如果盘口穿过我们的价格，视为成交
                if ob_new.bids[0][0] >= ask_price:
                    sell_filled = True
                if ob_new.asks[0][0] <= bid_price:
                    buy_filled = True

                if buy_filled or sell_filled:
                    break

                # 盘口变动，撤单重挂
                if abs(ob_new.bids[0][0] - bid) / bid > 0.0002:
                    await self.adapter.cancel_order(buy_order.id, symbol)
                    await self.adapter.cancel_order(sell_order.id, symbol)
                    await self.risk.record_cancel()
                    await self.risk.record_cancel()
                    retries += 1
                    bid = ob_new.bids[0][0]
                    ask = ob_new.asks[0][0]
                    bid_price = bid if self.strategy == "follow" else bid * 0.999
                    ask_price = ask if self.strategy == "follow" else ask * 1.001
                    buy_order = await self.adapter.create_limit_order(symbol, "buy", amount_in_base, bid_price)
                    sell_order = await self.adapter.create_limit_order(symbol, "sell", amount_in_base, ask_price)
                    await self.risk.record_order()
                    await self.risk.record_order()

                await asyncio.sleep(1)

            # 6. 超时处理
            if not buy_filled and not sell_filled:
                state = RoundState.TIMEOUT
                await self.risk.record_no_fill()
                await self.adapter.cancel_order(buy_order.id, symbol)
                await self.adapter.cancel_order(sell_order.id, symbol)
                return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

            # 7. 单边成交 → 平仓
            await self.risk.record_fill()
            if buy_filled and not sell_filled:
                state = RoundState.FILLED_BUY
                await self.adapter.cancel_order(sell_order.id, symbol)
                close_order = await self.adapter.create_market_order(symbol, "sell", amount_in_base)
                fee = close_order.fee
                volume = self.amount * 2  # 买卖各一次
                # 估算 PnL（简化）
                pnl = (close_order.price - buy_order.price) * amount_in_base - fee
            elif sell_filled and not buy_filled:
                state = RoundState.FILLED_SELL
                await self.adapter.cancel_order(buy_order.id, symbol)
                close_order = await self.adapter.create_market_order(symbol, "buy", amount_in_base)
                fee = close_order.fee
                volume = self.amount * 2
                pnl = (sell_order.price - close_order.price) * amount_in_base - fee
            else:
                # 双边都成交（理想情况）
                if buy_order and sell_order:
                    pnl = (sell_order.price - buy_order.price) * amount_in_base
                volume = self.amount * 2

            state = RoundState.CLOSING
            await self.risk.record_trade(pnl)
            return RoundResult(symbol=symbol, volume=volume, pnl=pnl, fee=fee, rounds=1)

        except Exception as e:
            logger.error(f"Round error: {e}")
            await self.risk.record_api_error()
            # 紧急撤单
            try:
                if buy_order:
                    await self.adapter.cancel_order(buy_order.id, symbol)
                if sell_order:
                    await self.adapter.cancel_order(sell_order.id, symbol)
            except Exception:
                pass
            return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

    async def execute_perpetual_single_round(self, symbol: str) -> RoundResult:
        """单交易所自成交（永续合约）- 同时开多空"""
        try:
            ob = await self.adapter.fetch_order_book(symbol)
            ticker = await self.adapter.fetch_ticker(symbol)
            amount_in_contracts = self.amount / ticker.last

            spread = (ob.asks[0][0] - ob.bids[0][0]) / ob.bids[0][0]
            triggers = await self.risk.check_hard_limits(spread, 0)
            if triggers:
                return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

            await self.adapter.set_leverage(symbol, 1)

            bid_price = ob.bids[0][0] if self.strategy == "follow" else ob.bids[0][0] * 0.999
            ask_price = ob.asks[0][0] if self.strategy == "follow" else ob.asks[0][0] * 1.001

            long_order = await self.adapter.create_limit_order(symbol, "buy", amount_in_contracts, bid_price)
            short_order = await self.adapter.create_limit_order(symbol, "sell", amount_in_contracts, ask_price)

            volume = self.amount * 2
            return RoundResult(symbol=symbol, volume=volume, pnl=0, fee=0, rounds=1)

        except Exception as e:
            logger.error(f"Perpetual round error: {e}")
            await self.risk.record_api_error()
            return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)
```

- [ ] **Step 2: 验证导入**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
from engine.order_executor import OrderExecutor, RoundState, RoundResult
print('OrderExecutor imported')
"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/engine/order_executor.py && git commit -m "feat: add order executor with spot state machine and perpetual support"
```

---

### Task 9: 跨交易所对倒执行器

**Files:**
- Modify: `volume-engine/engine/order_executor.py` — 追加 `execute_cross_exchange_round` 方法

- [ ] **Step 1: 追加跨交易所方法**

在 `OrderExecutor` 类末尾追加：

```python
    async def execute_cross_exchange_round(self, symbol: str, adapter_a: ExchangeAdapter,
                                            adapter_b: ExchangeAdapter, exchange_a: str,
                                            exchange_b: str) -> RoundResult:
        """跨交易所对倒：在 A 买、B 卖"""
        try:
            ob_a = await adapter_a.fetch_order_book(symbol)
            ob_b = await adapter_b.fetch_order_book(symbol)
            ticker = await adapter_a.fetch_ticker(symbol)
            amount_in_base = self.amount / ticker.last

            bid_a = ob_a.bids[0][0]
            ask_b = ob_b.asks[0][0]

            if bid_a >= ask_b:
                logger.warning(f"Cross prices unfavorable: A bid {bid_a} >= B ask {ask_b}")
                return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

            # 双边挂 Maker 单
            buy_order = await adapter_a.create_limit_order(symbol, "buy", amount_in_base, bid_a)
            sell_order = await adapter_b.create_limit_order(symbol, "sell", amount_in_base, ask_b)

            # 等待 5 秒
            deadline = asyncio.get_event_loop().time() + self.timeout
            buy_filled = False
            sell_filled = False

            while asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(1)
                # 检查订单状态
                ob_a_new = await adapter_a.fetch_order_book(symbol)
                ob_b_new = await adapter_b.fetch_order_book(symbol)
                if ob_a_new.bids[0][0] >= bid_a:
                    buy_filled = True
                if ob_b_new.asks[0][0] <= ask_b:
                    sell_filled = True
                if buy_filled and sell_filled:
                    break

            fee = 0.0
            pnl = 0.0
            volume = 0.0

            if buy_filled and sell_filled:
                # 双边成交，各自反向平仓
                close_a = await adapter_a.create_market_order(symbol, "sell", amount_in_base)
                close_b = await adapter_b.create_market_order(symbol, "buy", amount_in_base)
                fee = (close_a.fee or 0) + (close_b.fee or 0)
                pnl = (sell_order.price - buy_order.price) * amount_in_base - fee
                volume = self.amount * 4  # A买卖 + B买卖
            elif buy_filled:
                await adapter_b.cancel_order(sell_order.id, symbol)
                close_a = await adapter_a.create_market_order(symbol, "sell", amount_in_base)
                fee = close_a.fee or 0
                volume = self.amount * 2
            elif sell_filled:
                await adapter_a.cancel_order(buy_order.id, symbol)
                close_b = await adapter_b.create_market_order(symbol, "buy", amount_in_base)
                fee = close_b.fee or 0
                volume = self.amount * 2
            else:
                await adapter_a.cancel_order(buy_order.id, symbol)
                await adapter_b.cancel_order(sell_order.id, symbol)
                return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

            await self.risk.record_trade(pnl)
            return RoundResult(symbol=symbol, volume=volume, pnl=pnl, fee=fee, rounds=1)

        except Exception as e:
            logger.error(f"Cross-exchange round error: {e}")
            await self.risk.record_api_error()
            return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)
```

- [ ] **Step 2: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/engine/order_executor.py && git commit -m "feat: add cross-exchange wash trading to order executor"
```

---

### Task 10: 刷量引擎核心

**Files:**
- Create: `volume-engine/engine/volume_engine.py`

- [ ] **Step 1: 写 VolumeEngine**

`volume-engine/engine/volume_engine.py`:
```python
import asyncio
import logging
from datetime import datetime
from dataclasses import dataclass
from enum import Enum

from config import AppConfig, load_config
from exchange.base import ExchangeAdapter
from engine.order_executor import OrderExecutor, RoundResult
from engine.risk_manager import RiskManager

logger = logging.getLogger(__name__)


class EngineStatus(Enum):
    STOPPED = "stopped"
    RUNNING = "running"
    PAUSED = "paused"


@dataclass
class EngineState:
    status: EngineStatus = EngineStatus.STOPPED
    daily_volume: float = 0.0
    daily_trades: int = 0
    daily_pnl: float = 0.0
    daily_fee: float = 0.0
    current_pair: str = ""
    pair_volumes: dict[str, float] = None

    def __post_init__(self):
        if self.pair_volumes is None:
            self.pair_volumes = {}


class VolumeEngine:
    def __init__(self, config: AppConfig, adapters: dict[str, ExchangeAdapter]):
        self.config = config
        self.adapters = adapters
        self.risk = RiskManager(config.risk)
        self.state = EngineState()
        self._tasks: list[asyncio.Task] = []
        self._lock = asyncio.Lock()

    async def _run_pair_loop(self, symbol: str, adapter: ExchangeAdapter):
        executor = OrderExecutor(adapter, self.risk,
                                 timeout=self.config.engine.timeout_seconds,
                                 amount=self.config.engine.amount_per_trade,
                                 strategy=self.config.engine.order_strategy)
        while True:
            async with self._lock:
                if self.state.status != EngineStatus.RUNNING:
                    break
                if self.state.daily_volume >= self.config.engine.daily_volume_limit:
                    self.state.status = EngineStatus.PAUSED
                    logger.info("Daily volume limit reached, pausing")
                    break

            if await self.risk.is_pair_paused(symbol):
                await asyncio.sleep(5)
                continue

            if not await self.risk.check_balance(200):
                logger.warning("Balance too low, pausing")
                self.state.status = EngineStatus.PAUSED
                break

            result: RoundResult
            if self.config.engine.market == "perpetual":
                result = await executor.execute_perpetual_single_round(symbol)
            else:
                result = await executor.execute_spot_single_round(symbol)

            async with self._lock:
                self.state.daily_volume += result.volume
                self.state.daily_trades += 1 if result.rounds > 0 else 0
                self.state.daily_pnl += result.pnl
                self.state.daily_fee += result.fee
                self.state.current_pair = symbol
                self.state.pair_volumes[symbol] = self.state.pair_volumes.get(symbol, 0) + result.volume

            events = await self.risk.drain_events()
            for evt in events:
                logger.info(f"[{evt['severity']}] {evt['type']}: {evt['message']}")

    async def _run_cross_exchange_loop(self, symbol: str, adapter_a: ExchangeAdapter,
                                        adapter_b: ExchangeAdapter, name_a: str, name_b: str):
        executor = OrderExecutor(adapter_a, self.risk,
                                 timeout=self.config.engine.timeout_seconds,
                                 amount=self.config.engine.amount_per_trade,
                                 strategy=self.config.engine.order_strategy)
        while True:
            async with self._lock:
                if self.state.status != EngineStatus.RUNNING:
                    break
                if self.state.daily_volume >= self.config.engine.daily_volume_limit:
                    self.state.status = EngineStatus.PAUSED
                    break

            result = await executor.execute_cross_exchange_round(
                symbol, adapter_a, adapter_b, name_a, name_b)

            async with self._lock:
                self.state.daily_volume += result.volume
                self.state.daily_trades += 1 if result.rounds > 0 else 0
                self.state.daily_pnl += result.pnl
                self.state.daily_fee += result.fee

    async def start(self):
        async with self._lock:
            if self.state.status == EngineStatus.RUNNING:
                return
            self.state.status = EngineStatus.RUNNING

        adapter_names = list(self.adapters.keys())

        if self.config.engine.mode == "cross" and len(adapter_names) >= 2:
            for symbol in self.config.engine.pairs:
                t = asyncio.create_task(self._run_cross_exchange_loop(
                    symbol, self.adapters[adapter_names[0]], self.adapters[adapter_names[1]],
                    adapter_names[0], adapter_names[1]))
                self._tasks.append(t)
        else:
            primary = self.adapters.get(adapter_names[0] if adapter_names else None)
            if not primary:
                return
            for symbol in self.config.engine.pairs:
                t = asyncio.create_task(self._run_pair_loop(symbol, primary))
                self._tasks.append(t)

    async def pause(self):
        async with self._lock:
            self.state.status = EngineStatus.PAUSED

    async def stop(self):
        async with self._lock:
            self.state.status = EngineStatus.STOPPED
        for t in self._tasks:
            t.cancel()
        self._tasks.clear()

    async def resume(self):
        if self.state.status == EngineStatus.PAUSED:
            await self.start()

    def get_status(self) -> dict:
        return {
            "status": self.state.status.value,
            "daily_volume": self.state.daily_volume,
            "daily_trades": self.state.daily_trades,
            "daily_pnl": self.state.daily_pnl,
            "daily_fee": self.state.daily_fee,
            "current_pair": self.state.current_pair,
            "pair_volumes": self.state.pair_volumes,
            "config": {
                "mode": self.config.engine.mode,
                "market": self.config.engine.market,
                "pairs": self.config.engine.pairs,
                "amount_per_trade": self.config.engine.amount_per_trade,
            }
        }
```

- [ ] **Step 2: 验证导入**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
from engine.volume_engine import VolumeEngine, EngineStatus, EngineState
print('VolumeEngine imported')
"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/engine/volume_engine.py && git commit -m "feat: add volume engine core with single/cross mode orchestration"
```

---

### Task 11: Web 认证模块

**Files:**
- Create: `volume-engine/web/auth.py`

- [ ] **Step 1: 写认证模块**

`volume-engine/web/auth.py`:
```python
import bcrypt
import secrets
from fastapi import Request, HTTPException
from fastapi.responses import RedirectResponse

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
```

- [ ] **Step 2: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/web/auth.py && git commit -m "feat: add web auth with bcrypt and session cookie"
```

---

### Task 12: WebSocket 推送

**Files:**
- Create: `volume-engine/web/ws.py`

- [ ] **Step 1: 写 WebSocket 模块**

`volume-engine/web/ws.py`:
```python
import asyncio
import json
from fastapi import WebSocket


class WSManager:
    def __init__(self):
        self._connections: list[WebSocket] = []
        self._engine = None  # VolumeEngine 引用，启动时注入

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
```

- [ ] **Step 2: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/web/ws.py && git commit -m "feat: add WebSocket push manager for real-time dashboard"
```

---

### Task 13: Web 路由和模板

**Files:**
- Create: `volume-engine/web/routes.py`
- Create: `volume-engine/web/templates/base.html`
- Create: `volume-engine/web/templates/login.html`
- Create: `volume-engine/web/templates/dashboard.html`
- Create: `volume-engine/web/templates/trades.html`
- Create: `volume-engine/web/templates/settings.html`

- [ ] **Step 1: 写 Jinja2 base 模板**

`volume-engine/web/templates/base.html`:
```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{% block title %}刷量引擎{% endblock %}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; }
    nav { background: #161b22; border-bottom: 1px solid #30363d; padding: 0 24px; display: flex; align-items: center; height: 48px; gap: 24px; }
    nav a { color: #8b949e; text-decoration: none; font-size: 14px; }
    nav a:hover, nav a.active { color: #e1e4e8; }
    nav .brand { font-weight: 700; color: #58a6ff; margin-right: auto; }
    main { max-width: 1200px; margin: 24px auto; padding: 0 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .card h3 { font-size: 14px; color: #8b949e; margin-bottom: 8px; }
    .card .value { font-size: 28px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; font-size: 13px; }
    th { color: #8b949e; font-weight: 600; }
    button, .btn { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    button.danger { background: #da3633; }
    button.warn { background: #d29922; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    input, select { background: #0d1117; border: 1px solid #30363d; color: #e1e4e8; padding: 8px 12px; border-radius: 6px; font-size: 13px; width: 100%; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 4px; }
    .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .status.running { background: #3fb950; }
    .status.paused { background: #d29922; }
    .status.stopped { background: #f85149; }
    .alerts { max-height: 300px; overflow-y: auto; }
  </style>
</head>
<body>
  <nav>
    <span class="brand">刷量引擎</span>
    <a href="/" class="{% if active == 'dashboard' %}active{% endif %}">仪表盘</a>
    <a href="/trades" class="{% if active == 'trades' %}active{% endif %}">交易日志</a>
    <a href="/settings" class="{% if active == 'settings' %}active{% endif %}">交易所配置</a>
  </nav>
  <main>{% block content %}{% endblock %}</main>
</body>
</html>
```

- [ ] **Step 2: 写登录页**

`volume-engine/web/templates/login.html`:
```html
{% extends "base.html" %}
{% block title %}登录{% endblock %}
{% block content %}
<div style="max-width:400px;margin:100px auto;">
  <div class="card">
    <h2 style="margin-bottom:16px;">登录</h2>
    {% if error %}<p style="color:#f85149;margin-bottom:12px;">{{ error }}</p>{% endif %}
    <form method="post" action="/login">
      <div class="form-group">
        <label>密码</label>
        <input type="password" name="password" required autofocus>
      </div>
      <button type="submit" style="width:100%;">登录</button>
    </form>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 3: 写仪表盘**

`volume-engine/web/templates/dashboard.html`:
```html
{% extends "base.html" %}
{% set active = "dashboard" %}
{% block content %}
<div class="grid">
  <div class="card">
    <h3>状态</h3>
    <div class="value" style="font-size:20px;"><span id="status-dot" class="status"></span><span id="status-text">-</span></div>
  </div>
  <div class="card">
    <h3>今日成交量 (USDT)</h3>
    <div class="value" id="vol">0.00</div>
  </div>
  <div class="card">
    <h3>成交笔数</h3>
    <div class="value" id="trades">0</div>
  </div>
  <div class="card">
    <h3>今日盈亏 (USDT)</h3>
    <div class="value" id="pnl">0.00</div>
  </div>
</div>

<div class="stats-grid" style="margin-top:16px;">
  <div class="card"><h3>各交易对分布</h3><canvas id="pairChart" height="200"></canvas></div>
  <div class="card"><h3>控制</h3>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button onclick="engineAction('start')">启动</button>
      <button class="warn" onclick="engineAction('pause')">暂停</button>
      <button class="danger" onclick="engineAction('stop')">停止</button>
    </div>
    <div style="font-size:13px;color:#8b949e;">模式: {{ config.mode }} | 市场: {{ config.market }} | 每笔: ${{ config.amount_per_trade }}</div>
  </div>
</div>
{% endblock %}
{% block scripts %}
<script>
let chartCtx = document.getElementById('pairChart').getContext('2d');
let pairChart = new Chart(chartCtx, {type:'doughnut',data:{labels:[],datasets:[{data:[],backgroundColor:['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff']}]}});

function engineAction(action) {
  fetch('/api/engine/' + action, {method:'POST'}).then(r => r.json()).then(d => console.log(d));
}

let ws = new WebSocket('ws://' + location.host + '/ws');
ws.onmessage = function(e) {
  let d = JSON.parse(e.data);
  document.getElementById('vol').textContent = d.daily_volume.toLocaleString(undefined, {minimumFractionDigits:2});
  document.getElementById('trades').textContent = d.daily_trades;
  document.getElementById('pnl').textContent = d.daily_pnl.toLocaleString(undefined, {minimumFractionDigits:2});
  document.getElementById('status-text').textContent = d.status;
  document.getElementById('status-dot').className = 'status ' + d.status;
  if (d.pair_volumes) {
    pairChart.data.labels = Object.keys(d.pair_volumes);
    pairChart.data.datasets[0].data = Object.values(d.pair_volumes);
    pairChart.update();
  }
};
</script>
{% endblock %}
```

- [ ] **Step 4: 写交易日志页**

`volume-engine/web/templates/trades.html`:
```html
{% extends "base.html" %}
{% set active = "trades" %}
{% block content %}
<div class="card">
  <h3>交易日志</h3>
  <table><thead><tr><th>时间</th><th>交易所</th><th>交易对</th><th>方向</th><th>数量</th><th>价格</th><th>手续费</th><th>盈亏</th></tr></thead>
  <tbody id="trade-body"><tr><td colspan="8" style="color:#8b949e;">加载中...</td></tr></tbody></table>
  <div style="margin-top:12px;"><button onclick="loadTrades(0)">上一页</button> <span id="page-info"></span> <button onclick="loadTrades(1)">下一页</button></div>
</div>
{% endblock %}
{% block scripts %}
<script>
let page = 0;
function loadTrades(dir) {
  page = dir ? page + 1 : Math.max(0, page - 1);
  fetch('/api/trades?page=' + page).then(r => r.json()).then(d => {
    let html = '';
    d.trades.forEach(t => {
      html += `<tr><td>${t.created_at}</td><td>${t.exchange}</td><td>${t.symbol}</td><td>${t.side}</td><td>${t.amount}</td><td>${t.price}</td><td>${t.fee}</td><td>${t.pnl}</td></tr>`;
    });
    document.getElementById('trade-body').innerHTML = html || '<tr><td colspan="8">无记录</td></tr>';
    document.getElementById('page-info').textContent = '第 ' + (page + 1) + ' 页';
  });
}
loadTrades(0);
</script>
{% endblock %}
```

- [ ] **Step 5: 写交易所配置页**

`volume-engine/web/templates/settings.html`:
```html
{% extends "base.html" %}
{% set active = "settings" %}
{% block content %}
<div class="card">
  <h3>交易所配置</h3>
  <div id="exchanges">加载中...</div>
</div>
{% endblock %}
{% block scripts %}
<script>
fetch('/api/exchanges').then(r => r.json()).then(data => {
  let html = '';
  data.forEach(ex => {
    html += `<div class="card" style="margin-bottom:12px;">
      <h3>${ex.name.toUpperCase()} <span class="status ${ex.enabled ? 'running' : 'stopped'}"></span></h3>
      <div class="form-group"><label>API Key</label><input type="text" value="${ex.api_key || ''}" onchange="save('${ex.name}','api_key',this.value)"></div>
      <div class="form-group"><label>API Secret</label><input type="password" value="${ex.api_secret ? '****' : ''}" onchange="save('${ex.name}','api_secret',this.value)"></div>
      <label><input type="checkbox" ${ex.enabled ? 'checked' : ''} onchange="save('${ex.name}','enabled',this.checked)"> 启用</label>
      <button onclick="testConn('${ex.name}')" style="margin-left:12px;">测试连接</button>
    </div>`;
  });
  document.getElementById('exchanges').innerHTML = html;
});

function save(name, key, value) {
  fetch('/api/exchanges/' + name, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({[key]:value})});
}

function testConn(name) {
  fetch('/api/exchanges/' + name + '/test', {method:'POST'}).then(r => r.json()).then(d => alert(d.ok ? '连接成功' : '连接失败: ' + d.error));
}
</script>
{% endblock %}
```

- [ ] **Step 6: 写 FastAPI 路由**

`volume-engine/web/routes.py`:
```python
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
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
            # persist hash to config
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

    # --- API ---

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
                await ws.receive_text()  # keep alive, ignore client messages
        except WebSocketDisconnect:
            ws_manager.disconnect(ws)
```

- [ ] **Step 7: 验证路由导入**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
print('Templates exist:', __import__('pathlib').Path('web/templates/base.html').exists())
"
```

- [ ] **Step 8: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/web/ && git commit -m "feat: add web routes, templates, and dashboard UI"
```

---

### Task 14: 主入口

**Files:**
- Create: `volume-engine/main.py`

- [ ] **Step 1: 写 main.py**

`volume-engine/main.py`:
```python
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
```

- [ ] **Step 2: 验证整个项目可导入**

Run:
```bash
cd /c/Users/04/Desktop/volume-engine && python -c "
from main import app
print('FastAPI app created:', app.title or 'volume-engine')
"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/main.py && git commit -m "feat: add main entry point with FastAPI lifespan"
```

---

### Task 15: 集成验证

**Files:**
- Create: `volume-engine/tests/test_risk_manager.py`

- [ ] **Step 1: 写风控快速单元测试**

`volume-engine/tests/test_risk_manager.py`:
```python
import asyncio
import sys
sys.path.insert(0, "..")

from config import RiskConfig
from engine.risk_manager import RiskManager


def test_hard_limit_spread():
    rm = RiskManager(RiskConfig())
    triggers = asyncio.run(rm.check_hard_limits(0.01, 0))
    assert len(triggers) == 1
    assert "Spread" in triggers[0]


def test_hard_limit_loss():
    rm = RiskManager(RiskConfig())
    triggers = asyncio.run(rm.check_hard_limits(0.0001, -10.0))
    assert len(triggers) == 1
    assert "Round loss" in triggers[0]


def test_balance_ok():
    rm = RiskManager(RiskConfig())
    assert asyncio.run(rm.check_balance(500))


def test_balance_low():
    rm = RiskManager(RiskConfig())
    assert not asyncio.run(rm.check_balance(50))


def test_should_use_taker_abort():
    rm = RiskManager(RiskConfig())
    asyncio.run(rm.record_taker())
    asyncio.run(rm.record_taker())
    asyncio.run(rm.record_taker())
    assert asyncio.run(rm.should_use_taker()) == 3


if __name__ == "__main__":
    test_hard_limit_spread()
    test_hard_limit_loss()
    test_balance_ok()
    test_balance_low()
    test_should_use_taker_abort()
    print("All tests passed")
```

- [ ] **Step 2: 运行测试**

Run: `cd /c/Users/04/Desktop/volume-engine/tests && python test_risk_manager.py`
Expected: `All tests passed`

- [ ] **Step 3: Commit**

```bash
cd /c/Users/04/Desktop && git add volume-engine/tests/ && git commit -m "test: add risk manager unit tests"
```

---

## 后续计划

完成以上 15 个任务后，刷量引擎核心功能可运行。Bittap WebSocket 适配器和永续合约的完整测试需要在获取 Bittap API 文档后补充。

其余子项目按用户优先级后续实现：
- **交易所连接器框架**（统一配置管理、多交易所切换）
- **资金费率套利引擎**（费率监控、跨所对冲）
