# SmartMoney Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an on-chain smart money tracking and signal generation system on Robinhood Chain that monitors tagged wallets and outputs structured trade signals via local Claude Code skill + OKX.AI ASP dual endpoints.

**Architecture:** Event-driven pipeline — Scanner (WebSocket block listener) → Data Pipeline (tx enrichment + method decode + price) → Analysis Engine (wallet profiles + 7 signal patterns + weighted confidence) → Dual output (FastAPI local API + A2A ASP gateway). SQLite for persistence.

**Tech Stack:** Python 3.11+, web3.py, FastAPI, aiosqlite, aiohttp, pytest

## Global Constraints

- Python ≥ 3.11
- Robinhood Chain only (Chain ID 4663, Arbitrum Orbit, EVM compatible)
- SQLite for local storage (aiosqlite)
- All CLI entry points via `smartmoney-lens` command
- TDD: every task writes a failing test first, then makes it pass
- Commit after every task

## File Structure

```
smartmoney-lens/
├── smartmoney_lens/
│   ├── __init__.py           # Package init, version
│   ├── config.py             # Configuration from env + defaults
│   ├── models.py             # Dataclasses: Wallet, Transaction, Signal
│   ├── db.py                 # SQLite init, migrations, CRUD operations
│   ├── decoder.py            # 4-byte selector → method name lookup
│   ├── scanner.py            # Block listener: WebSocket + historical
│   ├── pipeline.py           # Tx enrichment: decode → token → price → store
│   ├── tokens.py             # Token metadata + price aggregation
│   ├── engine.py             # Analysis: profiles + signal matching + confidence
│   ├── server.py             # FastAPI: local API + ASP A2A gateway
│   └── cli.py                # CLI: start / stop / status
├── skill/
│   └── SKILL.md              # Claude Code skill definition
├── tests/
│   ├── __init__.py
│   ├── conftest.py           # Shared fixtures: test db, web3 mock, sample data
│   ├── test_db.py
│   ├── test_decoder.py
│   ├── test_scanner.py
│   ├── test_pipeline.py
│   ├── test_tokens.py
│   ├── test_engine.py
│   └── test_server.py
├── pyproject.toml
└── README.md
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `smartmoney-lens/pyproject.toml`
- Create: `smartmoney-lens/smartmoney_lens/__init__.py`
- Create: `smartmoney-lens/smartmoney_lens/config.py`
- Create: `smartmoney-lens/tests/__init__.py`
- Create: `smartmoney-lens/tests/conftest.py`

**Interfaces:**
- Produces: `smartmoney_lens.__version__`, `Config` dataclass with all settings

- [ ] **Step 1: Create project directory and pyproject.toml**

```bash
mkdir -p smartmoney-lens/smartmoney_lens smartmoney-lens/tests smartmoney-lens/skill
```

```toml
# smartmoney-lens/pyproject.toml
[project]
name = "smartmoney-lens"
version = "0.1.0"
description = "On-chain smart money tracking and signal generation on Robinhood Chain"
requires-python = ">=3.11"
dependencies = [
    "web3>=7.0.0",
    "fastapi>=0.115.0",
    "uvicorn>=0.30.0",
    "aiosqlite>=0.20.0",
    "aiohttp>=3.9.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "pytest-mock>=3.14.0",
]

[project.scripts]
smartmoney-lens = "smartmoney_lens.cli:main"

[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 2: Write package init**

```python
# smartmoney-lens/smartmoney_lens/__init__.py
"""SmartMoney Lens — on-chain smart money tracking and signal generation."""

__version__ = "0.1.0"
```

- [ ] **Step 3: Write Config dataclass**

```python
# smartmoney-lens/smartmoney_lens/config.py
import os
from dataclasses import dataclass, field


@dataclass
class Config:
    # Robinhood Chain
    chain_id: int = 4663
    rpc_http: str = field(default_factory=lambda: os.getenv(
        "SM_RPC_HTTP", "https://rpc.mainnet.chain.robinhood.com"
    ))
    rpc_ws: str = field(default_factory=lambda: os.getenv(
        "SM_RPC_WS", "wss://rpc.mainnet.chain.robinhood.com"
    ))
    blockscout_api: str = field(default_factory=lambda: os.getenv(
        "SM_BLOCKSCOUT_API", "https://robinhoodchain.blockscout.com/api"
    ))

    # Scanner
    history_scan_blocks: int = 100_000
    min_tx_value_eth: float = 0.01
    whale_alert_threshold_eth: float = 5.0
    auto_discover_daily_min_tx: int = 3

    # Database
    db_path: str = field(default_factory=lambda: os.getenv(
        "SM_DB_PATH", "smartmoney.db"
    ))

    # Server
    api_host: str = "127.0.0.1"
    api_port: int = 8765

    # Analysis
    signal_confidence_high: float = 0.6
    signal_confidence_low: float = 0.4
```

- [ ] **Step 4: Write test conftest**

```python
# smartmoney-lens/tests/conftest.py
import pytest
from smartmoney_lens.config import Config


@pytest.fixture
def config():
    return Config(db_path=":memory:")


@pytest.fixture
def sample_wallet_address():
    return "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb2"


@pytest.fixture
def sample_tx_hash():
    return "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
```

- [ ] **Step 5: Init test file**

```python
# smartmoney-lens/tests/__init__.py
```

- [ ] **Step 6: Install dependencies and verify**

```bash
cd smartmoney-lens && pip install -e ".[dev]" 2>&1
```

- [ ] **Step 7: Verify tests run**

```bash
cd smartmoney-lens && python -m pytest tests/ -v
```

Expected: 0 tests collected (no tests yet) but no import errors.

- [ ] **Step 8: Commit**

```bash
cd smartmoney-lens && git init && git add -A && git commit -m "chore: scaffold smartmoney-lens project

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Data Models

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/models.py`
- Create: `smartmoney-lens/tests/test_db.py` (model validation tests)

**Interfaces:**
- Produces: `Wallet`, `Transaction`, `Signal` dataclasses with `from_row()` / `to_dict()`

- [ ] **Step 1: Write tests for model serialization**

```python
# smartmoney-lens/tests/test_db.py (part 1 — model tests)
import json
from smartmoney_lens.models import Wallet, Transaction, Signal


class TestWallet:
    def test_from_row_creates_wallet(self):
        row = (1, "0xabc", "TestWhale", "manual", "active", "2026-07-19")
        w = Wallet.from_row(row)
        assert w.id == 1
        assert w.address == "0xabc"
        assert w.label == "TestWhale"
        assert w.source == "manual"
        assert w.status == "active"

    def test_to_dict_serializes(self):
        w = Wallet(id=1, address="0xabc", label="Test",
                   source="manual", status="active")
        d = w.to_dict()
        assert d["address"] == "0xabc"
        assert d["label"] == "Test"


class TestTransaction:
    def test_from_row_creates_transaction(self):
        row = (
            1, "0xtx", 123456, 1718208000, "0xwallet", "from",
            "swap", "0xtokenA", "WETH", 1.5, "0xtokenB", "USDC", 3000.0,
            1.5, 3000.0, "0xrouter", 100000, 10.5, "2026-07-19"
        )
        tx = Transaction.from_row(row)
        assert tx.tx_hash == "0xtx"
        assert tx.method == "swap"
        assert tx.token_in_symbol == "WETH"
        assert tx.value_usd == 3000.0

    def test_to_dict_includes_all_fields(self):
        tx = Transaction(
            id=1, tx_hash="0xtx", block_number=100, timestamp=1718208000,
            wallet_address="0xwallet", direction="from", method="swap",
            token_in_address="0xA", token_in_symbol="TKN", token_in_amount=10.0,
            token_out_address="0xB", token_out_symbol="USD", token_out_amount=100.0,
            value_eth=1.0, value_usd=2000.0, dex_router="0xrouter",
            gas_used=50000, gas_price_gwei=5.0
        )
        d = tx.to_dict()
        assert d["tx_hash"] == "0xtx"
        assert d["method"] == "swap"


class TestSignal:
    def test_from_row_creates_signal(self):
        factors = json.dumps({"wallet_win_rate": 0.72, "position_size_pct": 0.15})
        row = (
            1, "sig_001", "ENTRY", "0xwallet", "0xtoken",
            "BUY", 0.78, factors, "0xtrigger",
            "SmartWhale bought 2 ETH TOKEN", 0, "2026-07-19"
        )
        s = Signal.from_row(row)
        assert s.signal_id == "sig_001"
        assert s.type == "ENTRY"
        assert s.confidence == 0.78

    def test_signal_types_include_all_seven(self):
        valid_types = {"ENTRY", "BUYING", "WARNING", "EXIT",
                       "FLIP", "WHALE_ALERT", "CONFLUENCE"}
        for t in valid_types:
            s = Signal(signal_id=f"sig_{t}", type=t,
                       wallet_address="0xw", direction="BUY",
                       confidence=0.7, trigger_tx_hash="0xt",
                       summary=f"Test {t}")
            assert s.type in valid_types
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd smartmoney-lens && python -m pytest tests/test_db.py -v
```

Expected: ImportError — `smartmoney_lens.models` not found.

- [ ] **Step 3: Write models**

```python
# smartmoney-lens/smartmoney_lens/models.py
from dataclasses import dataclass, field
from typing import Optional
import json


@dataclass
class Wallet:
    id: Optional[int] = None
    address: str = ""
    label: str = ""
    source: str = "manual"
    status: str = "active"
    added_at: str = ""

    @classmethod
    def from_row(cls, row: tuple) -> "Wallet":
        return cls(
            id=row[0], address=row[1], label=row[2] or "",
            source=row[3] or "manual", status=row[4] or "active",
            added_at=row[5] or "",
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "address": self.address,
            "label": self.label, "source": self.source,
            "status": self.status, "added_at": self.added_at,
        }


@dataclass
class Transaction:
    id: Optional[int] = None
    tx_hash: str = ""
    block_number: int = 0
    timestamp: int = 0
    wallet_address: str = ""
    direction: str = ""
    method: str = ""
    token_in_address: Optional[str] = None
    token_in_symbol: Optional[str] = None
    token_in_amount: Optional[float] = None
    token_out_address: Optional[str] = None
    token_out_symbol: Optional[str] = None
    token_out_amount: Optional[float] = None
    value_eth: float = 0.0
    value_usd: Optional[float] = None
    dex_router: Optional[str] = None
    gas_used: Optional[int] = None
    gas_price_gwei: Optional[float] = None
    created_at: str = ""

    @classmethod
    def from_row(cls, row: tuple) -> "Transaction":
        return cls(
            id=row[0], tx_hash=row[1], block_number=row[2],
            timestamp=row[3], wallet_address=row[4], direction=row[5],
            method=row[6], token_in_address=row[7], token_in_symbol=row[8],
            token_in_amount=row[9], token_out_address=row[10],
            token_out_symbol=row[11], token_out_amount=row[12],
            value_eth=row[13] or 0.0, value_usd=row[14],
            dex_router=row[15], gas_used=row[16],
            gas_price_gwei=row[17], created_at=row[18] or "",
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "tx_hash": self.tx_hash,
            "block_number": self.block_number, "timestamp": self.timestamp,
            "wallet_address": self.wallet_address, "direction": self.direction,
            "method": self.method, "token_in_address": self.token_in_address,
            "token_in_symbol": self.token_in_symbol,
            "token_in_amount": self.token_in_amount,
            "token_out_address": self.token_out_address,
            "token_out_symbol": self.token_out_symbol,
            "token_out_amount": self.token_out_amount,
            "value_eth": self.value_eth, "value_usd": self.value_usd,
            "dex_router": self.dex_router, "gas_used": self.gas_used,
            "gas_price_gwei": self.gas_price_gwei, "created_at": self.created_at,
        }


@dataclass
class Signal:
    id: Optional[int] = None
    signal_id: str = ""
    type: str = ""
    wallet_address: str = ""
    token_address: Optional[str] = None
    direction: str = "BUY"
    confidence: float = 0.0
    confidence_factors: Optional[dict] = None
    trigger_tx_hash: str = ""
    summary: str = ""
    dispatched: int = 0
    created_at: str = ""

    VALID_TYPES = {"ENTRY", "BUYING", "WARNING", "EXIT",
                   "FLIP", "WHALE_ALERT", "CONFLUENCE"}

    @classmethod
    def from_row(cls, row: tuple) -> "Signal":
        factors = json.loads(row[6]) if row[6] else None
        return cls(
            id=row[0], signal_id=row[1], type=row[2],
            wallet_address=row[3], token_address=row[4],
            direction=row[5], confidence=row[6] if isinstance(row[6], float) else float(row[6]) if row[6] else 0.0,
            confidence_factors=factors,
            trigger_tx_hash=row[7], summary=row[8],
            dispatched=row[9], created_at=row[10] or "",
        )

    def to_dict(self) -> dict:
        return {
            "signal_id": self.signal_id, "type": self.type,
            "wallet_address": self.wallet_address,
            "token_address": self.token_address,
            "direction": self.direction,
            "confidence": self.confidence,
            "confidence_factors": self.confidence_factors,
            "trigger_tx_hash": self.trigger_tx_hash,
            "summary": self.summary,
            "dispatched": self.dispatched,
        }
```

Wait — there's a bug in `Signal.from_row`: `row[6]` is used for both `confidence` (float) and `confidence_factors` (JSON string). Let me fix the row indexing. The Signal table has: id, signal_id, type, wallet_address, token_address, direction, confidence, confidence_factors, trigger_tx_hash, summary, dispatched, created_at. That's 12 columns (indices 0-11). So confidence is row[6], confidence_factors is row[7], trigger_tx_hash is row[8], etc. Let me correct this.

- [ ] **Step 3: Write models (corrected Signal.from_row)**

```python
# smartmoney-lens/smartmoney_lens/models.py
from dataclasses import dataclass, field
from typing import Optional
import json


@dataclass
class Wallet:
    id: Optional[int] = None
    address: str = ""
    label: str = ""
    source: str = "manual"
    status: str = "active"
    added_at: str = ""

    @classmethod
    def from_row(cls, row: tuple) -> "Wallet":
        return cls(
            id=row[0], address=row[1], label=row[2] or "",
            source=row[3] or "manual", status=row[4] or "active",
            added_at=row[5] or "",
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "address": self.address,
            "label": self.label, "source": self.source,
            "status": self.status, "added_at": self.added_at,
        }


@dataclass
class Transaction:
    id: Optional[int] = None
    tx_hash: str = ""
    block_number: int = 0
    timestamp: int = 0
    wallet_address: str = ""
    direction: str = ""
    method: str = ""
    token_in_address: Optional[str] = None
    token_in_symbol: Optional[str] = None
    token_in_amount: Optional[float] = None
    token_out_address: Optional[str] = None
    token_out_symbol: Optional[str] = None
    token_out_amount: Optional[float] = None
    value_eth: float = 0.0
    value_usd: Optional[float] = None
    dex_router: Optional[str] = None
    gas_used: Optional[int] = None
    gas_price_gwei: Optional[float] = None
    created_at: str = ""

    @classmethod
    def from_row(cls, row: tuple) -> "Transaction":
        return cls(
            id=row[0], tx_hash=row[1], block_number=row[2],
            timestamp=row[3], wallet_address=row[4], direction=row[5],
            method=row[6], token_in_address=row[7], token_in_symbol=row[8],
            token_in_amount=row[9], token_out_address=row[10],
            token_out_symbol=row[11], token_out_amount=row[12],
            value_eth=row[13] or 0.0, value_usd=row[14],
            dex_router=row[15], gas_used=row[16],
            gas_price_gwei=row[17], created_at=row[18] or "",
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "tx_hash": self.tx_hash,
            "block_number": self.block_number, "timestamp": self.timestamp,
            "wallet_address": self.wallet_address, "direction": self.direction,
            "method": self.method, "token_in_address": self.token_in_address,
            "token_in_symbol": self.token_in_symbol,
            "token_in_amount": self.token_in_amount,
            "token_out_address": self.token_out_address,
            "token_out_symbol": self.token_out_symbol,
            "token_out_amount": self.token_out_amount,
            "value_eth": self.value_eth, "value_usd": self.value_usd,
            "dex_router": self.dex_router, "gas_used": self.gas_used,
            "gas_price_gwei": self.gas_price_gwei, "created_at": self.created_at,
        }


@dataclass
class Signal:
    id: Optional[int] = None
    signal_id: str = ""
    type: str = ""
    wallet_address: str = ""
    token_address: Optional[str] = None
    direction: str = "BUY"
    confidence: float = 0.0
    confidence_factors: Optional[dict] = None
    trigger_tx_hash: str = ""
    summary: str = ""
    dispatched: int = 0
    created_at: str = ""

    VALID_TYPES = {"ENTRY", "BUYING", "WARNING", "EXIT",
                   "FLIP", "WHALE_ALERT", "CONFLUENCE"}

    @classmethod
    def from_row(cls, row: tuple) -> "Signal":
        # DB order: id, signal_id, type, wallet_address, token_address,
        # direction, confidence, confidence_factors, trigger_tx_hash,
        # summary, dispatched, created_at
        raw_factors = row[7]
        try:
            factors = json.loads(raw_factors) if raw_factors else None
        except (json.JSONDecodeError, TypeError):
            factors = None
        return cls(
            id=row[0], signal_id=row[1], type=row[2],
            wallet_address=row[3], token_address=row[4],
            direction=row[5],
            confidence=float(row[6]) if row[6] is not None else 0.0,
            confidence_factors=factors,
            trigger_tx_hash=row[8], summary=row[9],
            dispatched=row[10] or 0, created_at=row[11] or "",
        )

    def to_dict(self) -> dict:
        return {
            "signal_id": self.signal_id, "type": self.type,
            "wallet_address": self.wallet_address,
            "token_address": self.token_address,
            "direction": self.direction,
            "confidence": self.confidence,
            "confidence_factors": self.confidence_factors,
            "trigger_tx_hash": self.trigger_tx_hash,
            "summary": self.summary,
            "dispatched": self.dispatched,
        }
```

- [ ] **Step 4: Update test to match corrected row indices**

Fix the Signal test row to use correct 12-column order:
```python
# In test_db.py, fix TestSignal.test_from_row_creates_signal:
row = (
    1, "sig_001", "ENTRY", "0xwallet", "0xtoken",
    "BUY", 0.78, factors, "0xtrigger",
    "SmartWhale bought 2 ETH TOKEN", 0, "2026-07-19"
)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd smartmoney-lens && python -m pytest tests/test_db.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add data models (Wallet, Transaction, Signal)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Database Layer

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/db.py`
- Modify: `smartmoney-lens/tests/test_db.py` (add DB tests)

**Interfaces:**
- Consumes: `Config`, `Wallet`, `Transaction`, `Signal` from models
- Produces: `Database` class with async methods:
  - `async init()` — create tables
  - `async add_wallet(address, label, source) -> Wallet`
  - `async get_wallets(status) -> list[Wallet]`
  - `async get_wallet(address) -> Wallet | None`
  - `async insert_transaction(tx: Transaction) -> int`
  - `async get_transactions(wallet_address, limit) -> list[Transaction]`
  - `async insert_signal(signal: Signal) -> int`
  - `async get_recent_signals(limit) -> list[Signal]`
  - `async get_confluence_signals(window_minutes) -> list[Signal]`

- [ ] **Step 1: Write failing DB tests**

```python
# Add to smartmoney-lens/tests/test_db.py
import pytest
from smartmoney_lens.db import Database
from smartmoney_lens.models import Wallet, Transaction, Signal


@pytest.fixture
async def db(config):
    database = Database(config)
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
class TestDatabase:
    async def test_init_creates_tables(self, db):
        # Query sqlite_master to verify tables exist
        async with db._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ) as cursor:
            tables = [row[0] async for row in cursor]
        assert "wallets" in tables
        assert "transactions" in tables
        assert "signals" in tables

    async def test_add_and_get_wallet(self, db):
        wallet = await db.add_wallet("0xABC", "Test Whale", "manual")
        assert wallet.address == "0xABC"
        assert wallet.label == "Test Whale"

        found = await db.get_wallet("0xABC")
        assert found is not None
        assert found.label == "Test Whale"

        not_found = await db.get_wallet("0xDEAD")
        assert not_found is None

    async def test_add_wallet_duplicate_ignored(self, db):
        await db.add_wallet("0xABC", "First", "manual")
        await db.add_wallet("0xABC", "Second", "manual")
        wallets = await db.get_wallets()
        assert len(wallets) == 1
        assert wallets[0].label == "First"

    async def test_get_wallets_by_status(self, db):
        await db.add_wallet("0xA", "Active", "manual")
        await db.add_wallet("0xB", "Candidate", "auto_discovered")
        active = await db.get_wallets("active")
        assert len(active) == 1
        candidates = await db.get_wallets("candidate")
        assert len(candidates) == 1

    async def test_insert_and_get_transactions(self, db):
        tx = Transaction(
            tx_hash="0xTX1", block_number=100, timestamp=1718208000,
            wallet_address="0xW", direction="from", method="swap",
            token_in_address="0xA", token_in_symbol="WETH",
            token_in_amount=1.5, token_out_address="0xB",
            token_out_symbol="USDC", token_out_amount=3000.0,
            value_eth=1.5, value_usd=3000.0, dex_router="0xR",
            gas_used=100000, gas_price_gwei=10.0,
        )
        row_id = await db.insert_transaction(tx)
        assert row_id == 1

        txs = await db.get_transactions("0xW", limit=10)
        assert len(txs) == 1
        assert txs[0].tx_hash == "0xTX1"
        assert txs[0].method == "swap"

    async def test_insert_transaction_duplicate_ignored(self, db):
        tx1 = Transaction(tx_hash="0xTX", block_number=1, timestamp=1,
                          wallet_address="0xW", direction="from", method="swap",
                          value_eth=0.0)
        await db.insert_transaction(tx1)
        # Insert same tx_hash + wallet_address combo
        row_id = await db.insert_transaction(tx1)
        assert row_id == 1  # Returns existing id, no new row

    async def test_insert_and_get_signals(self, db):
        s = Signal(
            signal_id="sig_001", type="ENTRY", wallet_address="0xW",
            token_address="0xT", direction="BUY", confidence=0.78,
            confidence_factors={"wallet_win_rate": 0.72},
            trigger_tx_hash="0xTX", summary="Test signal",
        )
        await db.insert_signal(s)
        signals = await db.get_recent_signals(limit=10)
        assert len(signals) == 1
        assert signals[0].signal_id == "sig_001"

    async def test_get_confluence_signals(self, db):
        # Insert 3 ENTRY signals for same token within 60 min
        now = 1718208000
        for i in range(3):
            s = Signal(
                signal_id=f"sig_{i}", type="ENTRY",
                wallet_address=f"0xW{i}", token_address="0xTOKEN",
                direction="BUY", confidence=0.7,
                trigger_tx_hash=f"0xTX{i}",
                summary=f"Test {i}",
            )
            s.created_at = "2026-07-19T00:00:00"
            await db.insert_signal(s)

        # Override timestamps for testing
        import time
        # Insert 3 signals with close timestamps
        signals = await db.get_confluence_signals(window_minutes=1440)
        # At least 3 for same token = confluence
        assert len(signals) >= 3
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd smartmoney-lens && python -m pytest tests/test_db.py::TestDatabase -v
```

Expected: ImportError for `smartmoney_lens.db`.

- [ ] **Step 3: Write database module**

```python
# smartmoney-lens/smartmoney_lens/db.py
import aiosqlite
from smartmoney_lens.config import Config
from smartmoney_lens.models import Wallet, Transaction, Signal


SCHEMA = """
CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL,
    label TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'active',
    added_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    wallet_address TEXT NOT NULL,
    direction TEXT NOT NULL,
    method TEXT NOT NULL,
    token_in_address TEXT,
    token_in_symbol TEXT,
    token_in_amount REAL,
    token_out_address TEXT,
    token_out_symbol TEXT,
    token_out_amount REAL,
    value_eth REAL DEFAULT 0.0,
    value_usd REAL,
    dex_router TEXT,
    gas_used INTEGER,
    gas_price_gwei REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tx_hash, wallet_address)
);

CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    token_address TEXT,
    direction TEXT NOT NULL,
    confidence REAL NOT NULL,
    confidence_factors TEXT,
    trigger_tx_hash TEXT NOT NULL,
    summary TEXT NOT NULL,
    dispatched INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet_address, timestamp);
CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_signal_type ON signals(type);
CREATE INDEX IF NOT EXISTS idx_signal_token ON signals(token_address);
"""


class Database:
    def __init__(self, config: Config):
        self.config = config
        self._conn: aiosqlite.Connection | None = None

    async def init(self):
        self._conn = await aiosqlite.connect(self.config.db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(SCHEMA)
        await self._conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()
            self._conn = None

    # --- Wallets ---

    async def add_wallet(self, address: str, label: str = "",
                         source: str = "manual") -> Wallet:
        await self._conn.execute(
            "INSERT OR IGNORE INTO wallets (address, label, source) VALUES (?, ?, ?)",
            (address, label, source),
        )
        await self._conn.commit()
        return await self.get_wallet(address)

    async def get_wallet(self, address: str) -> Wallet | None:
        async with self._conn.execute(
            "SELECT * FROM wallets WHERE address = ?", (address,)
        ) as cursor:
            row = await cursor.fetchone()
            return Wallet.from_row(tuple(row)) if row else None

    async def get_wallets(self, status: str = "active") -> list[Wallet]:
        async with self._conn.execute(
            "SELECT * FROM wallets WHERE status = ? ORDER BY added_at DESC",
            (status,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [Wallet.from_row(tuple(r)) for r in rows]

    # --- Transactions ---

    async def insert_transaction(self, tx: Transaction) -> int:
        cursor = await self._conn.execute(
            """INSERT OR IGNORE INTO transactions
               (tx_hash, block_number, timestamp, wallet_address, direction,
                method, token_in_address, token_in_symbol, token_in_amount,
                token_out_address, token_out_symbol, token_out_amount,
                value_eth, value_usd, dex_router, gas_used, gas_price_gwei)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (tx.tx_hash, tx.block_number, tx.timestamp, tx.wallet_address,
             tx.direction, tx.method, tx.token_in_address, tx.token_in_symbol,
             tx.token_in_amount, tx.token_out_address, tx.token_out_symbol,
             tx.token_out_amount, tx.value_eth, tx.value_usd, tx.dex_router,
             tx.gas_used, tx.gas_price_gwei),
        )
        await self._conn.commit()
        if cursor.lastrowid == 0:
            # Duplicate — get existing id
            async with self._conn.execute(
                "SELECT id FROM transactions WHERE tx_hash = ? AND wallet_address = ?",
                (tx.tx_hash, tx.wallet_address),
            ) as c:
                row = await c.fetchone()
                return row[0] if row else 0
        return cursor.lastrowid

    async def get_transactions(self, wallet_address: str,
                               limit: int = 50) -> list[Transaction]:
        async with self._conn.execute(
            """SELECT * FROM transactions
               WHERE wallet_address = ?
               ORDER BY timestamp DESC LIMIT ?""",
            (wallet_address, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            return [Transaction.from_row(tuple(r)) for r in rows]

    # --- Signals ---

    async def insert_signal(self, signal: Signal) -> int:
        import json
        factors_json = json.dumps(signal.confidence_factors) if signal.confidence_factors else None
        cursor = await self._conn.execute(
            """INSERT OR IGNORE INTO signals
               (signal_id, type, wallet_address, token_address, direction,
                confidence, confidence_factors, trigger_tx_hash, summary)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (signal.signal_id, signal.type, signal.wallet_address,
             signal.token_address, signal.direction, signal.confidence,
             factors_json, signal.trigger_tx_hash, signal.summary),
        )
        await self._conn.commit()
        return cursor.lastrowid

    async def get_recent_signals(self, limit: int = 20) -> list[Signal]:
        async with self._conn.execute(
            "SELECT * FROM signals ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [Signal.from_row(tuple(r)) for r in rows]

    async def get_confluence_signals(self,
                                     window_minutes: int = 60) -> list[Signal]:
        async with self._conn.execute(
            """SELECT * FROM signals
               WHERE type IN ('ENTRY', 'CONFLUENCE')
               AND created_at > datetime('now', ? || ' minutes')
               ORDER BY token_address, created_at DESC""",
            (f"-{window_minutes}",),
        ) as cursor:
            rows = await cursor.fetchall()
            return [Signal.from_row(tuple(r)) for r in rows]
```

- [ ] **Step 4: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_db.py -v
```

Expected: All tests pass (13 tests across model + database tests).

- [ ] **Step 5: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add database layer with SQLite schema and CRUD

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 4-Byte Selector Decoder

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/decoder.py`
- Create: `smartmoney-lens/tests/test_decoder.py`

**Interfaces:**
- Produces: `decode_method(input_data: str) -> str` — takes "0x" + 4-byte selector, returns method name
- Produces: `DEX_ROUTERS: dict[str, str]` — router address → DEX name

- [ ] **Step 1: Write failing test**

```python
# smartmoney-lens/tests/test_decoder.py
from smartmoney_lens.decoder import decode_method, DEX_ROUTERS


class TestDecodeMethod:
    def test_swap_exact_input(self):
        # 0x38ed1739 = swapExactTokensForETH (Uniswap V2)
        result = decode_method("0x38ed1739" + "00" * 100)
        assert result == "swap"

    def test_transfer(self):
        # 0xa9059cbb = transfer(address,uint256)
        result = decode_method("0xa9059cbb" + "00" * 100)
        assert result == "transfer"

    def test_mint(self):
        # 0xa0712d68 = mint(uint256) (various)
        result = decode_method("0xa0712d68" + "00" * 100)
        assert result == "mint"

    def test_unknown_selector_returns_unknown(self):
        result = decode_method("0xdeadbeef" + "00" * 100)
        assert result == "unknown"

    def test_short_input_returns_unknown(self):
        result = decode_method("0xab")
        assert result == "unknown"

    def test_empty_input_returns_unknown(self):
        result = decode_method("0x")
        assert result == "unknown"


class TestDexRouters:
    def test_known_router_return_name(self):
        # Uniswap V2 Router (same address on all EVM chains)
        assert "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" in DEX_ROUTERS
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd smartmoney-lens && python -m pytest tests/test_decoder.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write decoder module**

```python
# smartmoney-lens/smartmoney_lens/decoder.py

# 4-byte selector → human-readable method name
SELECTOR_MAP = {
    # Swaps
    "0x38ed1739": "swap",
    "0x7ff36ab5": "swap",
    "0x18cbafe5": "swap",
    "0x8803dbee": "swap",
    "0xfb3bdb41": "swap",
    "0xb6f9de95": "swap",
    "0x5c11d795": "swap",
    "0x791ac947": "swap",
    "0x12aa3caf": "swap",
    "0xe449022e": "swap",
    "0x414bf389": "swap",
    "0x128acb08": "swap",
    "0x04e45aaf": "swap",
    # Transfers
    "0xa9059cbb": "transfer",
    "0x23b872dd": "transfer",
    # Mint / Burn
    "0xa0712d68": "mint",
    "0x42966c68": "burn",
    "0xb6b55f25": "mint",
    "0x40c10f19": "mint",
    # Liquidity
    "0xe8e33700": "addLiquidity",
    "0xf305d719": "addLiquidity",
    "0xbaa2abde": "removeLiquidity",
    "0x02751cec": "removeLiquidity",
    "0x2195995c": "removeLiquidity",
    "0xded9382a": "removeLiquidity",
    # Stake / Unstake
    "0xa694fc3a": "stake",
    "0x2e1a7d4d": "unstake",
    # Bridge
    "0x7129bb1a": "bridge",
    "0x4f9e71a0": "bridge",
}


def decode_method(input_data: str) -> str:
    """Extract 4-byte selector from input data and return method name."""
    if not input_data or len(input_data) < 10:
        return "unknown"
    selector = input_data[:10].lower()
    return SELECTOR_MAP.get(selector, "unknown")


# Known DEX router addresses (same across all EVM chains)
DEX_ROUTERS: dict[str, str] = {
    "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D": "UniswapV2",
    "0xE592427A0AEce92De3Edee1F18E0157C05861564": "UniswapV3",
    "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45": "UniswapV3-2",
    "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506": "SushiSwap",
    "0xDef1C0ded9bec7F1a1670819833240f027b25EfF": "0x",
    "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5": "KyberSwap",
}


def identify_dex(router_address: str) -> str:
    """Return DEX name for a given router address."""
    return DEX_ROUTERS.get(router_address, "unknown")
```

- [ ] **Step 4: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_decoder.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add 4-byte selector decoder with DEX router map

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Token Info + Price Aggregation

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/tokens.py`
- Create: `smartmoney-lens/tests/test_tokens.py`

**Interfaces:**
- Produces: `async get_token_info(web3, token_address) -> dict` — name, symbol, decimals
- Produces: `async get_token_price(web3, token_address, router_address) -> float | None`
- Produces: `async get_eth_price() -> float`

- [ ] **Step 1: Write failing tests**

```python
# smartmoney-lens/tests/test_tokens.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from smartmoney_lens.tokens import (
    get_token_info, get_token_price, get_eth_price, ERC20_ABI,
)


class TestGetTokenInfo:
    @pytest.mark.asyncio
    async def test_returns_token_metadata(self):
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_w3.eth.contract.return_value = mock_contract

        async def mock_name():
            return "Wrapped Ether"
        async def mock_symbol():
            return "WETH"
        async def mock_decimals():
            return 18

        mock_contract.functions.name.return_value.call = mock_name
        mock_contract.functions.symbol.return_value.call = mock_symbol
        mock_contract.functions.decimals.return_value.call = mock_decimals

        info = await get_token_info(mock_w3, "0xToken")
        assert info["name"] == "Wrapped Ether"
        assert info["symbol"] == "WETH"
        assert info["decimals"] == 18

    @pytest.mark.asyncio
    async def test_returns_unknown_on_error(self):
        mock_w3 = MagicMock()
        mock_w3.eth.contract.side_effect = Exception("RPC error")
        info = await get_token_info(mock_w3, "0xToken")
        assert info["symbol"] == "UNKNOWN"
        assert info["decimals"] == 18


class TestGetTokenPrice:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_router(self):
        mock_w3 = MagicMock()
        price = await get_token_price(mock_w3, "0xToken", None)
        assert price is None


class TestGetEthPrice:
    @pytest.mark.asyncio
    async def test_returns_positive_number(self):
        with patch("smartmoney_lens.tokens.aiohttp.ClientSession.get") as mock_get:
            mock_resp = AsyncMock()
            mock_resp.status = 200
            mock_resp.json = AsyncMock(return_value={
                "ethereum": {"usd": 3000.0}
            })
            mock_get.return_value.__aenter__.return_value = mock_resp

            price = await get_eth_price()
            assert price == 3000.0
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd smartmoney-lens && python -m pytest tests/test_tokens.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write tokens module**

```python
# smartmoney-lens/smartmoney_lens/tokens.py
import aiohttp


ERC20_ABI = [
    {"constant": True, "inputs": [], "name": "name", "outputs": [{"name": "", "type": "string"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "symbol", "outputs": [{"name": "", "type": "string"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
]

UNISWAP_V2_PAIR_ABI = [
    {"constant": True, "inputs": [], "name": "getReserves",
     "outputs": [
         {"name": "reserve0", "type": "uint112"},
         {"name": "reserve1", "type": "uint112"},
         {"name": "blockTimestampLast", "type": "uint32"},
     ], "type": "function"},
    {"constant": True, "inputs": [], "name": "token0",
     "outputs": [{"name": "", "type": "address"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "token1",
     "outputs": [{"name": "", "type": "address"}], "type": "function"},
]

COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"

# In-memory cache for token metadata
_token_cache: dict[str, dict] = {}


async def get_token_info(web3, token_address: str) -> dict:
    """Fetch token name, symbol, decimals from on-chain."""
    if token_address in _token_cache:
        return _token_cache[token_address]

    try:
        checksummed = web3.to_checksum_address(token_address)
        contract = web3.eth.contract(address=checksummed, abi=ERC20_ABI)
        name = await contract.functions.name().call()
        symbol = await contract.functions.symbol().call()
        decimals = await contract.functions.decimals().call()
        info = {"name": name, "symbol": symbol, "decimals": decimals}
    except Exception:
        info = {"name": "Unknown", "symbol": "UNKNOWN", "decimals": 18}

    _token_cache[token_address] = info
    return info


async def get_token_price(web3, token_address: str,
                          router_address: str | None = None) -> float | None:
    """Get token price in USD. Tries DEX reserves first, then CoinGecko.

    Returns None if price unavailable.
    """
    if router_address is None:
        # Try CoinGecko as fallback
        return await _coingecko_price(token_address)

    # For now, DEX pair reserve lookup is complex (need pair address).
    # Start with CoinGecko and add DEX direct pricing later.
    return await _coingecko_price(token_address)


async def _coingecko_price(token_address: str) -> float | None:
    """Query CoinGecko for token price by contract address."""
    try:
        async with aiohttp.ClientSession() as session:
            url = f"{COINGECKO_URL}"
            params = {
                "contract_addresses": token_address,
                "vs_currencies": "usd",
                "x_cg_demo_api_key": "",
            }
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get(token_address.lower(), {}).get("usd")
    except Exception:
        pass
    return None


async def get_eth_price() -> float:
    """Get ETH/USD price from CoinGecko."""
    try:
        async with aiohttp.ClientSession() as session:
            url = f"{COINGECKO_URL}?ids=ethereum&vs_currencies=usd"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data["ethereum"]["usd"]
    except Exception:
        pass
    return 0.0
```

- [ ] **Step 4: Add aiohttp to conftest for async tests**

```python
# Add to smartmoney-lens/tests/conftest.py
# Ensure pytest-asyncio is configured
# In pyproject.toml add:
# [tool.pytest.ini_options]
# asyncio_mode = "auto"
```

- [ ] **Step 4b: Update pyproject.toml**

```toml
# Add after [build-system] in smartmoney-lens/pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 5: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_tokens.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add token info + price aggregation with CoinGecko fallback

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Scanner (Block Listener)

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/scanner.py`
- Create: `smartmoney-lens/tests/test_scanner.py`

**Interfaces:**
- Consumes: `Config`, `Database`, web3 instance
- Produces: `Scanner` class:
  - `async start()` — begin WebSocket subscription (or polling fallback) for new blocks
  - `async stop()` — graceful shutdown
  - `async scan_history(from_block, to_block)` — historical backscan
  - `on_transaction(callback: Callable)` — register callback for matched transactions (callback receives `dict` with tx_hash, wallet_address, block_number, timestamp, from_addr, to_addr, value_eth, input_data)

- [ ] **Step 1: Write failing tests**

```python
# smartmoney-lens/tests/test_scanner.py
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from smartmoney_lens.scanner import Scanner


@pytest.fixture
def mock_w3():
    w3 = MagicMock()
    w3.eth.get_block = AsyncMock()
    w3.eth.get_transaction = AsyncMock()
    return w3


@pytest.fixture
async def scanner(config, db, mock_w3):
    s = Scanner(config, db, mock_w3)
    await s._load_tracked_addresses()
    return s


class TestScannerFilter:
    @pytest.mark.asyncio
    async def test_matches_tracked_from_address(self, scanner):
        scanner._tracked = {"0xTrackedFrom"}
        tx = {
            "hash": "0xTX1", "blockNumber": 100,
            "from": "0xTrackedFrom", "to": "0xRandom",
            "value": 1000000000000000000,  # 1 ETH
            "input": "0x",
        }
        result = scanner._matches(tx)
        assert result is not None
        assert result["wallet_address"] == "0xTrackedFrom"

    @pytest.mark.asyncio
    async def test_matches_tracked_to_address(self, scanner):
        scanner._tracked = {"0xTrackedTo"}
        tx = {
            "hash": "0xTX2", "blockNumber": 101,
            "from": "0xRandom", "to": "0xTrackedTo",
            "value": 500000000000000000,  # 0.5 ETH
            "input": "0x",
        }
        result = scanner._matches(tx)
        assert result is not None
        assert result["direction"] == "to"

    @pytest.mark.asyncio
    async def test_skips_dust_transactions(self, scanner):
        scanner._tracked = {"0xSmall"}
        tx = {
            "hash": "0xTX3", "blockNumber": 102,
            "from": "0xSmall", "to": "0xRandom",
            "value": 1,  # 1 wei — dust
            "input": "0x",
        }
        result = scanner._matches(tx)
        assert result is None

    @pytest.mark.asyncio
    async def test_flags_large_unknown_tx(self, scanner):
        scanner._tracked = set()
        tx = {
            "hash": "0xTX4", "blockNumber": 103,
            "from": "0xUnknown", "to": "0xAlsoUnknown",
            "value": 10 * 10**18,  # 10 ETH — whale alert
            "input": "0x",
        }
        result = scanner._matches(tx)
        assert result is not None
        assert result["whale_alert"] is True

    @pytest.mark.asyncio
    async def test_skips_small_unknown_tx(self, scanner):
        scanner._tracked = set()
        tx = {
            "hash": "0xTX5", "blockNumber": 104,
            "from": "0xUnknown", "to": "0xAlsoUnknown",
            "value": 100000000000000000,  # 0.1 ETH — below 5 ETH threshold
            "input": "0x",
        }
        result = scanner._matches(tx)
        assert result is None


class TestScanHistory:
    @pytest.mark.asyncio
    async def test_scan_history_pulls_blocks(self, scanner, mock_w3):
        mock_block = {
            "number": 100,
            "timestamp": 1718208000,
            "transactions": [],
        }
        mock_w3.eth.get_block.return_value = mock_block

        matched = []
        scanner.on_transaction(lambda tx: matched.append(tx))

        await scanner.scan_history(100, 100)
        # No transactions in block — callback not called
        assert len(matched) == 0
        mock_w3.eth.get_block.assert_called()
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd smartmoney-lens && python -m pytest tests/test_scanner.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write scanner module**

```python
# smartmoney-lens/smartmoney_lens/scanner.py
import asyncio
from typing import Callable, Awaitable
from web3 import Web3, AsyncWeb3
from web3.types import BlockData, TxData
from smartmoney_lens.config import Config
from smartmoney_lens.db import Database


class Scanner:
    """Block listener that watches for transactions involving tracked wallets."""

    def __init__(self, config: Config, db: Database, web3: AsyncWeb3):
        self.config = config
        self.db = db
        self.w3 = web3
        self._tracked: set[str] = set()
        self._callbacks: list[Callable[[dict], Awaitable[None]]] = []
        self._running = False
        self._task: asyncio.Task | None = None

    async def _load_tracked_addresses(self):
        """Load tracked wallet addresses from database."""
        wallets = await self.db.get_wallets("active")
        self._tracked = {w.address.lower() for w in wallets}

    def on_transaction(self, callback: Callable[[dict], Awaitable[None]]):
        """Register a callback for matched transactions."""
        self._callbacks.append(callback)

    def _matches(self, tx: dict) -> dict | None:
        """Check if transaction matches tracked wallets. Returns enriched dict or None."""
        from_addr = (tx.get("from") or "").lower()
        to_addr = (tx.get("to") or "").lower()
        value_eth = float(Web3.from_wei(int(tx.get("value", 0)), "ether"))

        # Check tracked wallets
        if from_addr in self._tracked:
            if value_eth < self.config.min_tx_value_eth:
                return None
            return {
                "tx_hash": tx["hash"].hex() if isinstance(tx["hash"], bytes) else str(tx["hash"]),
                "wallet_address": from_addr,
                "block_number": tx.get("blockNumber", 0),
                "timestamp": tx.get("timestamp", 0),
                "from_addr": from_addr,
                "to_addr": to_addr,
                "value_eth": value_eth,
                "input_data": tx.get("input", "0x"),
                "direction": "from",
                "whale_alert": False,
            }

        if to_addr in self._tracked:
            if value_eth < self.config.min_tx_value_eth:
                return None
            return {
                "tx_hash": tx["hash"].hex() if isinstance(tx["hash"], bytes) else str(tx["hash"]),
                "wallet_address": to_addr,
                "block_number": tx.get("blockNumber", 0),
                "timestamp": tx.get("timestamp", 0),
                "from_addr": from_addr,
                "to_addr": to_addr,
                "value_eth": value_eth,
                "input_data": tx.get("input", "0x"),
                "direction": "to",
                "whale_alert": False,
            }

        # Whale alert for large unknown transactions
        if value_eth >= self.config.whale_alert_threshold_eth:
            return {
                "tx_hash": tx["hash"].hex() if isinstance(tx["hash"], bytes) else str(tx["hash"]),
                "wallet_address": from_addr,
                "block_number": tx.get("blockNumber", 0),
                "timestamp": tx.get("timestamp", 0),
                "from_addr": from_addr,
                "to_addr": to_addr,
                "value_eth": value_eth,
                "input_data": tx.get("input", "0x"),
                "direction": "from",
                "whale_alert": True,
            }

        return None

    async def _process_block(self, block_number: int):
        """Fetch block and filter its transactions."""
        try:
            block = await self.w3.eth.get_block(block_number, full_transactions=True)
        except Exception:
            return

        for tx in block.get("transactions", []):
            tx_dict = dict(tx) if hasattr(tx, "__iter__") else tx
            tx_dict["blockNumber"] = block_number
            tx_dict["timestamp"] = block.get("timestamp", 0)
            # Ensure hash is a string
            if hasattr(tx_dict.get("hash"), "hex"):
                tx_dict["hash"] = tx_dict["hash"].hex()
            matched = self._matches(tx_dict)
            if matched:
                for cb in self._callbacks:
                    await cb(matched)

    async def scan_history(self, from_block: int, to_block: int):
        """Historical backscan of a block range."""
        for block_num in range(from_block, to_block + 1):
            await self._process_block(block_num)
            await asyncio.sleep(0.01)  # Don't hammer RPC

    async def start(self):
        """Start real-time block listening via polling."""
        await self._load_tracked_addresses()
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())

    async def _poll_loop(self):
        """Poll new blocks every 1 second (fallback if WebSocket unavailable)."""
        last_block = await self.w3.eth.block_number
        while self._running:
            try:
                current_block = await self.w3.eth.block_number
                if current_block > last_block:
                    for bn in range(last_block + 1, current_block + 1):
                        await self._process_block(bn)
                    last_block = current_block
                await asyncio.sleep(1)
            except Exception:
                await asyncio.sleep(5)

    async def stop(self):
        """Stop the scanner."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
```

- [ ] **Step 4: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_scanner.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add scanner with block polling, tx filter, and whale alerts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Data Pipeline

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/pipeline.py`
- Create: `smartmoney-lens/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `Config`, `Database`, `AsyncWeb3`, Scanner output dict
- Produces: `Pipeline` class:
  - `async process(tx_dict: dict) -> Transaction` — full enrichment pipeline

- [ ] **Step 1: Write failing tests**

```python
# smartmoney-lens/tests/test_pipeline.py
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from smartmoney_lens.pipeline import Pipeline


@pytest.fixture
def mock_w3():
    w3 = MagicMock()
    w3.eth.get_transaction_receipt = AsyncMock()
    return w3


@pytest.fixture
async def pipeline(config, db, mock_w3):
    return Pipeline(config, db, mock_w3)


class TestPipeline:
    @pytest.mark.asyncio
    async def test_process_swap_transaction(self, pipeline, mock_w3):
        mock_w3.eth.get_transaction_receipt.return_value = {
            "status": 1,
            "gasUsed": 150000,
            "effectiveGasPrice": 10_000_000_000,
            "logs": [],
        }
        mock_w3.to_checksum_address = lambda a: a

        tx_dict = {
            "tx_hash": "0xTX_SWAP",
            "wallet_address": "0xWallet",
            "block_number": 200,
            "timestamp": 1718208000,
            "from_addr": "0xWallet",
            "to_addr": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
            "value_eth": 0.0,
            "input_data": "0x38ed1739" + "00" * 200,
            "direction": "from",
            "whale_alert": False,
        }

        tx = await pipeline.process(tx_dict)
        assert tx.tx_hash == "0xTX_SWAP"
        assert tx.method == "swap"
        assert tx.dex_router == "UniswapV2"
        assert tx.gas_used == 150000
        assert tx.gas_price_gwei == 10.0

    @pytest.mark.asyncio
    async def test_process_eth_transfer(self, pipeline, mock_w3):
        mock_w3.eth.get_transaction_receipt.return_value = {
            "status": 1, "gasUsed": 21000,
            "effectiveGasPrice": 20_000_000_000, "logs": [],
        }

        tx_dict = {
            "tx_hash": "0xTX_ETH",
            "wallet_address": "0xWallet",
            "block_number": 201,
            "timestamp": 1718208100,
            "from_addr": "0xWallet",
            "to_addr": "0xRecipient",
            "value_eth": 2.5,
            "input_data": "0x",
            "direction": "from",
            "whale_alert": False,
        }

        tx = await pipeline.process(tx_dict)
        assert tx.tx_hash == "0xTX_ETH"
        assert tx.method == "transfer"
        assert tx.value_eth == 2.5
        assert tx.token_in_address is None  # Plain ETH transfer
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd smartmoney-lens && python -m pytest tests/test_pipeline.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write pipeline module**

```python
# smartmoney-lens/smartmoney_lens/pipeline.py
import asyncio
from web3 import AsyncWeb3, Web3
from smartmoney_lens.config import Config
from smartmoney_lens.db import Database
from smartmoney_lens.models import Transaction
from smartmoney_lens.decoder import decode_method, identify_dex
from smartmoney_lens.tokens import get_token_info, get_token_price, get_eth_price


class Pipeline:
    """Enriches raw scanner output into structured Transaction records."""

    def __init__(self, config: Config, db: Database, web3: AsyncWeb3):
        self.config = config
        self.db = db
        self.w3 = web3

    async def process(self, tx_dict: dict) -> Transaction:
        """Full enrichment: receipt → method decode → token info → price → store."""
        tx_hash = tx_dict["tx_hash"]

        # 1. Get receipt
        receipt = await self.w3.eth.get_transaction_receipt(tx_hash)
        gas_used = receipt.get("gasUsed", 0)
        gas_price_wei = receipt.get("effectiveGasPrice", 0)
        gas_price_gwei = float(Web3.from_wei(gas_price_wei, "gwei")) if gas_price_wei else 0.0

        # 2. Decode method
        input_data = tx_dict.get("input_data", "0x")
        method = decode_method(input_data)

        # 3. Identify DEX if swap
        to_addr = tx_dict.get("to_addr", "")
        dex_name = identify_dex(to_addr) if method == "swap" else None

        # 4. ETH value in USD
        eth_price = await get_eth_price()
        value_usd = tx_dict["value_eth"] * eth_price if eth_price else None

        # 5. Token info (only for non-plain-ETH transactions with contract interaction)
        token_in_address = None
        token_in_symbol = None
        token_in_amount = None
        token_out_address = None
        token_out_symbol = None
        token_out_amount = None

        if method == "swap" and input_data != "0x":
            # TODO: Parse swap input data to extract token addresses and amounts
            # For now, mark as swap without full token details
            pass

        # 6. Build Transaction model
        tx = Transaction(
            tx_hash=tx_hash,
            block_number=tx_dict["block_number"],
            timestamp=tx_dict["timestamp"],
            wallet_address=tx_dict["wallet_address"],
            direction=tx_dict["direction"],
            method=method,
            token_in_address=token_in_address,
            token_in_symbol=token_in_symbol,
            token_in_amount=token_in_amount,
            token_out_address=token_out_address,
            token_out_symbol=token_out_symbol,
            token_out_amount=token_out_amount,
            value_eth=tx_dict["value_eth"],
            value_usd=value_usd,
            dex_router=dex_name,
            gas_used=gas_used,
            gas_price_gwei=gas_price_gwei,
        )

        # 7. Store to database
        await self.db.insert_transaction(tx)
        return tx
```

- [ ] **Step 4: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_pipeline.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add data pipeline for tx enrichment and structured storage

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Analysis Engine — Wallet Profiles

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/engine.py`
- Create: `smartmoney-lens/tests/test_engine.py`

**Interfaces:**
- Consumes: `Config`, `Database`
- Produces: `async compute_profile(wallet_address) -> dict` — full wallet profile
- Produces: `async update_profiles()` — batch update all active wallets

- [ ] **Step 1: Write failing tests**

```python
# smartmoney-lens/tests/test_engine.py
import pytest
from smartmoney_lens.engine import AnalysisEngine
from smartmoney_lens.models import Transaction, Signal


@pytest.fixture
async def engine(config, db):
    eng = AnalysisEngine(config, db)
    await eng._ensure_profile_table()
    return eng


class TestComputeProfile:
    @pytest.mark.asyncio
    async def test_empty_wallet_returns_defaults(self, engine, db):
        profile = await engine.compute_profile("0xEmpty")
        assert profile["wallet_address"] == "0xEmpty"
        assert profile["total_trades"] == 0
        assert profile["win_rate"] == 0.0
        assert profile["avg_roi"] == 0.0
        assert profile["style"]["frequency"] == "low"

    @pytest.mark.asyncio
    async def test_computes_frequency_from_tx_count(self, engine, db):
        now = 1718208000
        for i in range(10):
            tx = Transaction(
                tx_hash=f"0xTX{i}", block_number=i, timestamp=now - i * 3600,
                wallet_address="0xBusy", direction="from", method="swap",
                value_eth=1.0,
            )
            await db.insert_transaction(tx)

        profile = await engine.compute_profile("0xBusy")
        assert profile["total_trades"] >= 10
        assert profile["style"]["frequency"] == "high"

    @pytest.mark.asyncio
    async def test_labels_style_correctly(self, engine, db):
        # 3 trades in 24h = moderate frequency
        now = 1718208000
        for i in range(3):
            tx = Transaction(
                tx_hash=f"0xMOD{i}", block_number=i, timestamp=now - i * 7200,
                wallet_address="0xModerate", direction="from", method="swap",
                value_eth=2.0,
            )
            await db.insert_transaction(tx)

        profile = await engine.compute_profile("0xModerate")
        assert profile["style"]["frequency"] == "medium"
        assert profile["style"]["scale"] in ("small", "medium", "large")
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd smartmoney-lens && python -m pytest tests/test_engine.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write engine (profile portion)**

```python
# smartmoney-lens/smartmoney_lens/engine.py
import json
import hashlib
import time
import asyncio
from smartmoney_lens.config import Config
from smartmoney_lens.db import Database
from smartmoney_lens.models import Transaction, Signal


PROFILE_TABLE = """
CREATE TABLE IF NOT EXISTS profiles (
    wallet_address TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


class AnalysisEngine:
    """Computes wallet profiles and generates trading signals."""

    def __init__(self, config: Config, db: Database):
        self.config = config
        self.db = db
        self._recent_signals: dict[str, float] = {}  # signal key → timestamp for dedup

    async def _ensure_profile_table(self):
        await self.db._conn.execute(PROFILE_TABLE)
        await self.db._conn.commit()

    async def compute_profile(self, wallet_address: str) -> dict:
        """Compute a full profile for a single wallet."""
        txs = await self.db.get_transactions(wallet_address, limit=500)

        total_trades = len(txs)
        now = int(time.time())

        # Frequency
        if total_trades == 0:
            frequency = "low"
            avg_daily = 0
        else:
            # Use last 7 days of transactions
            seven_days_ago = now - 7 * 86400
            recent_txs = [t for t in txs if t.timestamp >= seven_days_ago]
            avg_daily = len(recent_txs) / 7 if recent_txs else total_trades / 30
            if avg_daily > 5:
                frequency = "high"
            elif avg_daily >= 1:
                frequency = "medium"
            else:
                frequency = "low"

        # Scale
        total_value = sum(t.value_usd or 0 for t in txs)
        if total_value > 1_000_000:
            scale = "large"
        elif total_value > 10_000:
            scale = "medium"
        else:
            scale = "small"

        # Holding period — estimate from swap-in / swap-out pairs
        holding_period = "unknown"
        swaps = [t for t in txs if t.method == "swap"]
        if len(swaps) >= 2:
            durations = []
            for i in range(len(swaps) - 1):
                dur = abs(swaps[i].timestamp - swaps[i + 1].timestamp)
                durations.append(dur)
            avg_duration = sum(durations) / len(durations) if durations else 0
            if avg_duration < 3600:
                holding_period = "short"
            elif avg_duration < 86400:
                holding_period = "medium"
            else:
                holding_period = "long"

        return {
            "wallet_address": wallet_address,
            "total_trades": total_trades,
            "win_rate": 0.0,  # Requires P&L tracking — placeholder
            "avg_roi": 0.0,
            "sharpe_approx": 0.0,
            "max_drawdown": 0.0,
            "avg_holding_time_seconds": 0,
            "style": {
                "frequency": frequency,
                "preference": "mixed",
                "holding_period": holding_period,
                "scale": scale,
            },
            "recent_activity": {
                "trades_7d": len([t for t in txs if t.timestamp >= now - 7 * 86400]),
                "volume_7d_usd": sum(
                    (t.value_usd or 0) for t in txs
                    if t.timestamp >= now - 7 * 86400
                ),
            },
        }

    async def update_profiles(self):
        """Batch update profiles for all active wallets."""
        wallets = await self.db.get_wallets("active")
        for w in wallets:
            profile = await self.compute_profile(w.address)
            await self.db._conn.execute(
                "INSERT OR REPLACE INTO profiles (wallet_address, data) VALUES (?, ?)",
                (w.address, json.dumps(profile)),
            )
        await self.db._conn.commit()
```

- [ ] **Step 4: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_engine.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add analysis engine — wallet profile computation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Analysis Engine — Signal Generation

**Files:**
- Modify: `smartmoney-lens/smartmoney_lens/engine.py` (add signal methods)
- Modify: `smartmoney-lens/tests/test_engine.py` (add signal tests)

**Interfaces:**
- Produces: `async analyze_transaction(tx: Transaction) -> list[Signal]` — generate signals from a single tx
- Produces: `async check_confluence() -> list[Signal]` — check for overlapping signals

- [ ] **Step 1: Write failing signal tests**

```python
# Add to smartmoney-lens/tests/test_engine.py

class TestSignalGeneration:
    @pytest.mark.asyncio
    async def test_first_buy_generates_entry_signal(self, engine, db):
        # Insert a swap "from" wallet = first buy
        now = int(time.time())
        tx = Transaction(
            tx_hash="0xFIRST", block_number=500, timestamp=now,
            wallet_address="0xWhale", direction="from", method="swap",
            token_in_address="0xWETH", token_in_symbol="WETH",
            token_in_amount=5.0, value_eth=5.0, value_usd=15000.0,
        )
        signals = await engine.analyze_transaction(tx)
        assert len(signals) >= 1
        entry_signal = [s for s in signals if s.type == "ENTRY"]
        assert len(entry_signal) >= 1
        assert entry_signal[0].wallet_address == "0xWhale"
        assert entry_signal[0].direction == "BUY"

    @pytest.mark.asyncio
    async def test_whale_alert_generates_signal(self, engine, db):
        now = int(time.time())
        tx = Transaction(
            tx_hash="0xWHALE", block_number=600, timestamp=now,
            wallet_address="0xUnknown", direction="from", method="transfer",
            value_eth=25.0, value_usd=75000.0,
        )
        # This wallet is not tracked — simulate whale alert
        signals = await engine.analyze_transaction(tx, whale_alert=True)
        assert len(signals) >= 1
        whale_signals = [s for s in signals if s.type == "WHALE_ALERT"]
        assert len(whale_signals) >= 1

    @pytest.mark.asyncio
    async def test_confidence_at_or_below_one(self, engine, db):
        now = int(time.time())
        tx = Transaction(
            tx_hash="0xCONF", block_number=700, timestamp=now,
            wallet_address="0xW", direction="from", method="swap",
            value_eth=1.0, value_usd=3000.0,
        )
        signals = await engine.analyze_transaction(tx)
        for s in signals:
            assert 0.0 <= s.confidence <= 1.0

    @pytest.mark.asyncio
    async def test_consecutive_buys_generate_buying_signal(self, engine, db):
        now = int(time.time())
        # First buy
        tx1 = Transaction(
            tx_hash="0xBUY1", block_number=100, timestamp=now - 3600,
            wallet_address="0xAccum", direction="from", method="swap",
            token_in_address="0xWETH", token_out_address="0xTOKEN",
            token_out_symbol="TOKEN", token_out_amount=1000.0,
            value_eth=2.0, value_usd=6000.0,
        )
        await db.insert_transaction(tx1)
        await engine.analyze_transaction(tx1)

        # Second buy within 24h
        tx2 = Transaction(
            tx_hash="0xBUY2", block_number=101, timestamp=now - 1800,
            wallet_address="0xAccum", direction="from", method="swap",
            token_in_address="0xWETH", token_out_address="0xTOKEN",
            token_out_symbol="TOKEN", token_out_amount=500.0,
            value_eth=1.0, value_usd=3000.0,
        )
        signals = await engine.analyze_transaction(tx2)
        buying_signals = [s for s in signals if s.type == "BUYING"]
        assert len(buying_signals) >= 1
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd smartmoney-lens && python -m pytest tests/test_engine.py::TestSignalGeneration -v
```

Expected: AttributeError — `analyze_transaction` not found.

- [ ] **Step 3: Add signal generation methods to engine**

```python
# Add these methods to AnalysisEngine class in smartmoney-lens/smartmoney_lens/engine.py

    def _make_signal_id(self, tx_hash: str, signal_type: str) -> str:
        raw = f"{tx_hash}:{signal_type}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def _compute_confidence(self, wallet_address: str, position_size_pct: float = 0.1,
                            holding_time_hours: float = 0, confluence_count: int = 0,
                            win_rate: float = 0.5) -> float:
        """Weighted confidence score (0.0 – 1.0)."""
        # Normalize position size (0-1 scale, cap at 50% of wallet)
        pos_score = min(position_size_pct / 0.5, 1.0)

        # Normalize holding time (shorter = higher confidence for short-term signals)
        if holding_time_hours <= 0:
            hold_score = 0.5
        elif holding_time_hours < 1:
            hold_score = 1.0
        elif holding_time_hours < 24:
            hold_score = 0.5
        else:
            hold_score = 0.2

        # Normalize confluence (3+ = max)
        conf_score = min(confluence_count / 3.0, 1.0)

        return (
            win_rate * 0.35 +
            pos_score * 0.25 +
            hold_score * 0.15 +
            conf_score * 0.25
        )

    async def analyze_transaction(self, tx: Transaction,
                                  whale_alert: bool = False) -> list[Signal]:
        """Generate signals from a single transaction."""
        signals: list[Signal] = []
        now = int(time.time())

        # Whale alert
        if whale_alert:
            confidence = self._compute_confidence(
                tx.wallet_address,
                position_size_pct=min(tx.value_eth / 50.0, 1.0),
            )
            if confidence >= self.config.signal_confidence_low:
                signals.append(Signal(
                    signal_id=self._make_signal_id(tx.tx_hash, "WHALE_ALERT"),
                    type="WHALE_ALERT",
                    wallet_address=tx.wallet_address,
                    direction="BUY" if tx.direction == "from" else "SELL",
                    confidence=confidence,
                    confidence_factors={"value_eth": tx.value_eth},
                    trigger_tx_hash=tx.tx_hash,
                    summary=f"巨鲸异动：{tx.wallet_address[:10]}... 发生 {tx.value_eth:.1f} ETH 交易",
                ))
            return signals

        # Skip non-trade methods
        if tx.method not in ("swap", "transfer", "mint", "burn"):
            return signals

        direction = "BUY" if tx.direction == "from" else "SELL"

        # Check for existing transactions by this wallet for the same token
        existing_txs = await self.db.get_transactions(tx.wallet_address, limit=100)

        # Is this a first-time buy of this token?
        same_token_txs = [
            t for t in existing_txs
            if ((tx.token_in_address and t.token_in_address == tx.token_in_address) or
                (tx.token_out_address and t.token_out_address == tx.token_out_address))
            and t.tx_hash != tx.tx_hash
        ]

        if not same_token_txs and direction == "BUY" and tx.method in ("swap", "mint"):
            # ENTRY: first time buying this token
            confidence = self._compute_confidence(
                tx.wallet_address,
                position_size_pct=0.15,
                win_rate=0.65,  # default until profile is richer
            )
            if confidence >= self.config.signal_confidence_low:
                token_label = tx.token_out_symbol or tx.token_in_symbol or "未知代币"
                signals.append(Signal(
                    signal_id=self._make_signal_id(tx.tx_hash, "ENTRY"),
                    type="ENTRY",
                    wallet_address=tx.wallet_address,
                    token_address=tx.token_out_address or tx.token_in_address,
                    direction="BUY",
                    confidence=confidence,
                    confidence_factors={
                        "position_size_pct": 0.15,
                        "wallet_win_rate": 0.65,
                    },
                    trigger_tx_hash=tx.tx_hash,
                    summary=f"{tx.wallet_address[:10]}... 首次买入 {tx.value_usd:.0f} USD {token_label}",
                ))

        # Check for consecutive buys (BUYING signal)
        recent_buys_24h = [
            t for t in same_token_txs
            if t.timestamp >= (now - 86400) and t.direction == "from"
        ]
        if len(recent_buys_24h) >= 1 and direction == "BUY":
            confidence = self._compute_confidence(
                tx.wallet_address,
                position_size_pct=0.2,
                confluence_count=len(recent_buys_24h),
            )
            if confidence >= self.config.signal_confidence_low:
                token_label = tx.token_out_symbol or tx.token_in_symbol or "未知代币"
                signals.append(Signal(
                    signal_id=self._make_signal_id(tx.tx_hash, "BUYING"),
                    type="BUYING",
                    wallet_address=tx.wallet_address,
                    token_address=tx.token_out_address or tx.token_in_address,
                    direction="BUY",
                    confidence=confidence,
                    confidence_factors={
                        "consecutive_buys": len(recent_buys_24h) + 1,
                        "confluence_count": len(recent_buys_24h),
                    },
                    trigger_tx_hash=tx.tx_hash,
                    summary=f"{tx.wallet_address[:10]}... 24h 内第 {len(recent_buys_24h) + 1} 次买入 {token_label}",
                ))

        # Store signals
        for s in signals:
            await self.db.insert_signal(s)

        return signals

    async def check_confluence(self, window_minutes: int = 60) -> list[Signal]:
        """Check for multiple wallets buying the same token simultaneously."""
        recent_signals = await self.db.get_confluence_signals(window_minutes)

        # Group by token
        by_token: dict[str, list[Signal]] = {}
        for s in recent_signals:
            if s.token_address:
                by_token.setdefault(s.token_address, []).append(s)

        confluence_signals: list[Signal] = []
        for token_addr, sigs in by_token.items():
            if len(sigs) >= 3:
                wallets = [s.wallet_address[:10] + "..." for s in sigs]
                confidence = self._compute_confidence(
                    "", confluence_count=len(sigs), win_rate=0.6,
                )
                if confidence >= self.config.signal_confidence_low:
                    c = Signal(
                        signal_id=self._make_signal_id(token_addr, "CONFLUENCE"),
                        type="CONFLUENCE",
                        wallet_address=",".join(wallets),
                        token_address=token_addr,
                        direction="BUY",
                        confidence=confidence,
                        confidence_factors={
                            "confluence_count": len(sigs),
                            "wallets": wallets,
                        },
                        trigger_tx_hash=sigs[0].trigger_tx_hash,
                        summary=f"多人同向：{len(sigs)} 个钱包同时买入同一代币",
                    )
                    await self.db.insert_signal(c)
                    confluence_signals.append(c)

        return confluence_signals
```

- [ ] **Step 4: Ensure tests have time import**

Add `import time` to test_engine.py imports.

- [ ] **Step 5: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_engine.py -v
```

Expected: All tests pass (3 profile + 5 signal = 8 tests).

- [ ] **Step 6: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add signal generation — ENTRY, BUYING, WHALE_ALERT, CONFLUENCE patterns

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: FastAPI Server — Local API

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/server.py`
- Create: `smartmoney-lens/tests/test_server.py`

**Interfaces:**
- Consumes: `Config`, `Database`, `AnalysisEngine`, `Scanner`
- Produces: FastAPI app with routes:
  - `GET /api/health`
  - `GET /api/signals/recent?limit=10`
  - `GET /api/wallets`
  - `GET /api/wallets/{address}/profile`
  - `POST /api/wallets/add`
  - `GET /api/signals/confluence`

- [ ] **Step 1: Write failing test**

```python
# smartmoney-lens/tests/test_server.py
import pytest
from httpx import ASGITransport, AsyncClient
from smartmoney_lens.server import create_app
from smartmoney_lens.config import Config


@pytest.fixture
async def app(config, db):
    app = create_app(config, db)
    return app


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_returns_ok(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"


class TestSignalsEndpoint:
    @pytest.mark.asyncio
    async def test_recent_signals_returns_list(self, client):
        resp = await client.get("/api/signals/recent?limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert "signals" in data
        assert isinstance(data["signals"], list)


class TestWalletsEndpoint:
    @pytest.mark.asyncio
    async def test_list_wallets_empty(self, client):
        resp = await client.get("/api/wallets")
        assert resp.status_code == 200
        data = resp.json()
        assert "wallets" in data

    @pytest.mark.asyncio
    async def test_add_wallet(self, client):
        resp = await client.post("/api/wallets/add", json={
            "address": "0xNewWallet",
            "label": "Test Whale",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["wallet"]["address"] == "0xNewWallet"

    @pytest.mark.asyncio
    async def test_get_wallet_profile_not_found(self, client):
        resp = await client.get("/api/wallets/0xDead/profile")
        assert resp.status_code == 200
        data = resp.json()
        assert "wallet_address" in data
        assert data["total_trades"] == 0
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd smartmoney-lens && pip install httpx && python -m pytest tests/test_server.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write server module**

```python
# smartmoney-lens/smartmoney_lens/server.py
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from smartmoney_lens.config import Config
from smartmoney_lens.db import Database


class AddWalletRequest(BaseModel):
    address: str
    label: str = ""
    source: str = "manual"


def create_app(config: Config, db: Database,
               engine=None, scanner=None) -> FastAPI:

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await db.init()
        if engine:
            await engine._ensure_profile_table()
        yield
        await db.close()

    app = FastAPI(title="SmartMoney Lens", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Health ---
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": "0.1.0"}

    # --- Signals ---
    @app.get("/api/signals/recent")
    async def recent_signals(limit: int = Query(default=10, le=100)):
        signals = await db.get_recent_signals(limit=limit)
        return {"signals": [s.to_dict() for s in signals]}

    @app.get("/api/signals/confluence")
    async def confluence_signals(window_minutes: int = Query(default=60)):
        if engine:
            signals = await engine.check_confluence(window_minutes)
        else:
            signals = await db.get_confluence_signals(window_minutes)
        return {"signals": [s.to_dict() for s in signals]}

    # --- Wallets ---
    @app.get("/api/wallets")
    async def list_wallets(status: str = Query(default="active")):
        wallets = await db.get_wallets(status=status)
        return {"wallets": [w.to_dict() for w in wallets]}

    @app.get("/api/wallets/{address}/profile")
    async def wallet_profile(address: str):
        if engine:
            profile = await engine.compute_profile(address)
        else:
            profile = {
                "wallet_address": address,
                "total_trades": 0,
                "win_rate": 0.0,
                "style": {"frequency": "low"},
            }
        return profile

    @app.post("/api/wallets/add")
    async def add_wallet(req: AddWalletRequest):
        wallet = await db.add_wallet(req.address, req.label, req.source)
        return {"ok": True, "wallet": wallet.to_dict()}

    return app
```

- [ ] **Step 4: Run tests**

```bash
cd smartmoney-lens && python -m pytest tests/test_server.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add FastAPI server with local API endpoints

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: CLI Entry Point

**Files:**
- Create: `smartmoney-lens/smartmoney_lens/cli.py`

**Interfaces:**
- Produces: `smartmoney-lens start|stop|status` CLI commands

- [ ] **Step 1: Write CLI module**

```python
# smartmoney-lens/smartmoney_lens/cli.py
"""CLI entry point for SmartMoney Lens."""
import sys
import asyncio
from web3 import AsyncWeb3
from smartmoney_lens.config import Config
from smartmoney_lens.db import Database
from smartmoney_lens.scanner import Scanner
from smartmoney_lens.pipeline import Pipeline
from smartmoney_lens.engine import AnalysisEngine
from smartmoney_lens.server import create_app


def main():
    if len(sys.argv) < 2:
        print("Usage: smartmoney-lens <start|stop|status|scan-history>")
        sys.exit(1)

    cmd = sys.argv[1]
    config = Config()

    if cmd == "start":
        asyncio.run(_start(config))
    elif cmd == "status":
        asyncio.run(_status(config))
    elif cmd == "scan-history":
        from_block = int(sys.argv[2]) if len(sys.argv) > 2 else 0
        to_block = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        asyncio.run(_scan_history(config, from_block, to_block))
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


async def _start(config: Config):
    print(f"[smartmoney-lens] Starting on {config.rpc_http}")
    db = Database(config)
    await db.init()

    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(config.rpc_http))

    scanner = Scanner(config, db, w3)
    pipeline = Pipeline(config, db, w3)
    engine = AnalysisEngine(config, db)
    await engine._ensure_profile_table()

    # Wire scanner → pipeline → engine
    async def on_tx(tx_dict: dict):
        enriched = await pipeline.process(tx_dict)
        signals = await engine.analyze_transaction(
            enriched, whale_alert=tx_dict.get("whale_alert", False)
        )
        for s in signals:
            print(f"  📡 Signal: [{s.type}] {s.summary} (confidence: {s.confidence:.2f})")

    scanner.on_transaction(on_tx)

    # Start scanner
    await scanner.start()

    # Start FastAPI
    import uvicorn
    app = create_app(config, db, engine, scanner)
    server = uvicorn.Server(uvicorn.Config(
        app, host=config.api_host, port=config.api_port, log_level="info",
    ))
    print(f"[smartmoney-lens] API server at http://{config.api_host}:{config.api_port}")
    await server.serve()


async def _status(config: Config):
    db = Database(config)
    await db.init()
    wallets = await db.get_wallets("active")
    signals = await db.get_recent_signals(limit=5)
    print(f"Tracked wallets: {len(wallets)}")
    print(f"Recent signals:   {len(signals)}")
    for s in signals:
        print(f"  [{s.type}] {s.summary}")
    await db.close()


async def _scan_history(config: Config, from_block: int, to_block: int):
    if from_block == 0 or to_block == 0:
        w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(config.rpc_http))
        current = await w3.eth.block_number
        if from_block == 0:
            from_block = max(0, current - config.history_scan_blocks)
        if to_block == 0:
            to_block = current
    print(f"[smartmoney-lens] Scanning blocks {from_block} → {to_block}")
    db = Database(config)
    await db.init()
    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(config.rpc_http))
    scanner = Scanner(config, db, w3)
    pipeline = Pipeline(config, db, w3)
    engine = AnalysisEngine(config, db)

    count = 0
    async def on_tx(tx_dict: dict):
        nonlocal count
        count += 1
        enriched = await pipeline.process(tx_dict)
        await engine.analyze_transaction(enriched)

    scanner.on_transaction(on_tx)
    await scanner.scan_history(from_block, to_block)
    print(f"[smartmoney-lens] Done. Matched {count} transactions.")
    await db.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Install package in editable mode and verify CLI**

```bash
cd smartmoney-lens && pip install -e . && smartmoney-lens status
```

Expected: `Tracked wallets: 0` (or current count).

- [ ] **Step 3: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add CLI entry point with start/status/scan-history commands

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Claude Code Skill

**Files:**
- Create: `smartmoney-lens/skill/SKILL.md`

**Interfaces:**
- Produces: Claude Code skill invoked via `/smartmoney <subcommand>`

- [ ] **Step 1: Write skill file**

```markdown
# smartmoney-lens/skill/SKILL.md
---
name: smartmoney
description: Track smart money wallet activity on Robinhood Chain — check signals, view wallet profiles, add tracked wallets, see confluence alerts.
---

# SmartMoney Lens

On-chain smart money tracking on Robinhood Chain (Chain ID 4663).

## Commands

When the user invokes `/smartmoney <subcommand>`, call the local API at `http://127.0.0.1:8765`:

| Subcommand | HTTP Call | Render |
|---|---|---|
| `check` | `GET /api/signals/recent?limit=10` | Table: type, wallet (truncated), token, direction, confidence bar, summary |
| `wallet <addr>` | `GET /api/wallets/{addr}/profile` | Profile card: trades, win rate, style badges, recent 30d volume |
| `confluence` | `GET /api/signals/confluence?window_minutes=60` | List: token, wallet count, confidence |
| `add <addr> <label>` | `POST /api/wallets/add` `{"address":"<addr>","label":"<label>"}` | Confirmation line |

## Rendering rules

- Wallet addresses: show first 6 + last 4 chars (`0x742d...bEb2`)
- Confidence: render as `████░░ 0.78` bar (filled = confidence × 10 chars)
- Signal types: ENTRY=🟢, BUYING=📈, WARNING=🟡, EXIT=🔴, FLIP=💨, WHALE_ALERT=🐋, CONFLUENCE=🤝
- Language: Chinese (match user's language)

## Fallback

If `GET /api/health` returns non-200, tell the user: "SmartMoney Lens 服务未运行。请先在终端执行 `smartmoney-lens start` 启动服务。"
```

- [ ] **Step 2: Create symlink/copy to Claude Code skills directory**

```bash
cp smartmoney-lens/skill/SKILL.md ~/.claude/skills/smartmoney.md
```

- [ ] **Step 3: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add Claude Code skill for smart money tracking

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: Integration — End-to-End Wiring

**Files:**
- Modify: `smartmoney-lens/smartmoney_lens/server.py` (add ASP A2A gateway routes)
- Create: `smartmoney-lens/tests/test_integration.py`

**Interfaces:**
- Produces: ASP A2A endpoints:
  - `GET /a2a/signals?wallet=<addr>&limit=10` — signal feed
  - `GET /a2a/wallets/{address}/profile` — wallet profile
  - `GET /a2a/top-wallets` — top tracked wallets by win rate
  - `GET /a2a/tokens/{address}/activity` — token activity from smart money

- [ ] **Step 1: Write integration test**

```python
# smartmoney-lens/tests/test_integration.py
import pytest
from httpx import ASGITransport, AsyncClient
from smartmoney_lens.config import Config
from smartmoney_lens.db import Database
from smartmoney_lens.engine import AnalysisEngine
from smartmoney_lens.server import create_app
from smartmoney_lens.models import Wallet, Signal


@pytest.fixture
async def populated_db(config):
    db = Database(config)
    await db.init()
    await db.add_wallet("0xWhale1", "Smart Whale Alpha", "manual")
    await db.add_wallet("0xWhale2", "Smart Whale Beta", "manual")
    return db


@pytest.fixture
async def app_with_data(config, populated_db):
    engine = AnalysisEngine(config, populated_db)
    await engine._ensure_profile_table()
    return create_app(config, populated_db, engine=engine)


@pytest.fixture
async def client(app_with_data):
    transport = ASGITransport(app=app_with_data)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestA2AEndpoints:
    @pytest.mark.asyncio
    async def test_signal_feed(self, client):
        resp = await client.get("/a2a/signals?limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert "signals" in data

    @pytest.mark.asyncio
    async def test_wallet_profile(self, client):
        resp = await client.get("/a2a/wallets/0xWhale1/profile")
        assert resp.status_code == 200
        data = resp.json()
        assert data["wallet_address"] == "0xWhale1"

    @pytest.mark.asyncio
    async def test_top_wallets(self, client):
        resp = await client.get("/a2a/top-wallets")
        assert resp.status_code == 200
        data = resp.json()
        assert "wallets" in data
        assert isinstance(data["wallets"], list)

    @pytest.mark.asyncio
    async def test_token_activity(self, client):
        resp = await client.get("/a2a/tokens/0xToken/activity")
        assert resp.status_code == 200
        data = resp.json()
        assert "transactions" in data


class TestEndToEnd:
    @pytest.mark.asyncio
    async def test_full_flow_add_wallet_to_signal(self, client, populated_db):
        # 1. Add wallet
        resp = await client.post("/api/wallets/add", json={
            "address": "0xFullFlow",
            "label": "E2E Test Whale",
        })
        assert resp.status_code == 200

        # 2. Verify in list
        resp = await client.get("/api/wallets")
        wallets = resp.json()["wallets"]
        assert any(w["address"] == "0xFullFlow" for w in wallets)

        # 3. Profile should exist
        resp = await client.get("/api/wallets/0xFullFlow/profile")
        assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd smartmoney-lens && python -m pytest tests/test_integration.py -v
```

Expected: 404 on /a2a/* routes.

- [ ] **Step 3: Add ASP A2A routes to server**

```python
# Add these routes to create_app() in smartmoney-lens/smartmoney_lens/server.py

    # === ASP A2A Gateway ===

    @app.get("/a2a/signals")
    async def a2a_signal_feed(
        wallet: str = Query(default=None),
        limit: int = Query(default=10, le=50),
    ):
        if wallet:
            # Return signals for specific wallet from recent
            all_signals = await db.get_recent_signals(limit=200)
            wallet_signals = [s for s in all_signals if s.wallet_address.lower() == wallet.lower()]
            return {"signals": [s.to_dict() for s in wallet_signals[:limit]]}
        signals = await db.get_recent_signals(limit=limit)
        return {"signals": [s.to_dict() for s in signals]}

    @app.get("/a2a/wallets/{address}/profile")
    async def a2a_wallet_profile(address: str):
        if engine:
            profile = await engine.compute_profile(address)
        else:
            profile = {"wallet_address": address, "total_trades": 0}
        return profile

    @app.get("/a2a/top-wallets")
    async def a2a_top_wallets(limit: int = Query(default=10, le=50)):
        wallets = await db.get_wallets("active")
        profiles = []
        for w in wallets:
            if engine:
                p = await engine.compute_profile(w.address)
            else:
                p = {"wallet_address": w.address, "total_trades": 0}
            profiles.append(p)
        # Sort by trade count desc (placeholder for win_rate sort)
        profiles.sort(key=lambda p: p.get("total_trades", 0), reverse=True)
        return {"wallets": profiles[:limit]}

    @app.get("/a2a/tokens/{address}/activity")
    async def a2a_token_activity(address: str, limit: int = Query(default=20, le=100)):
        # Get all transactions where this token was involved
        # This requires a full table scan — acceptable for MVP
        import aiosqlite
        async with db._conn.execute(
            """SELECT * FROM transactions
               WHERE token_in_address = ? OR token_out_address = ?
               ORDER BY timestamp DESC LIMIT ?""",
            (address, address, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            from smartmoney_lens.models import Transaction
            txs = [Transaction.from_row(tuple(r)) for r in rows]
        return {"transactions": [t.to_dict() for t in txs]}
```

- [ ] **Step 4: Run all tests**

```bash
cd smartmoney-lens && python -m pytest tests/ -v
```

Expected: All tests pass (25+ tests).

- [ ] **Step 5: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "feat: add ASP A2A gateway endpoints + end-to-end integration tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: README

**Files:**
- Create: `smartmoney-lens/README.md`

**Interfaces:**
- Documentation only

- [ ] **Step 1: Write README**

````markdown
# SmartMoney Lens

On-chain smart money tracking and signal generation on Robinhood Chain (Chain ID 4663).

## Quick Start

```bash
cd smartmoney-lens
pip install -e ".[dev]"
smartmoney-lens start
```

Then in Claude Code: `/smartmoney check`

## Architecture

```
Robinhood Chain → Scanner → Data Pipeline → Analysis Engine → REST API → Claude Code Skill
                                                     └──→ ASP A2A Gateway
```

## CLI

| Command | Description |
|---------|-------------|
| `smartmoney-lens start` | Start scanner + API server |
| `smartmoney-lens status` | Show tracked wallets + recent signals |
| `smartmoney-lens scan-history <from> <to>` | Historical backscan |

## API

### Local (localhost:8765)

- `GET /api/signals/recent` — Recent signals
- `GET /api/wallets` — Tracked wallets
- `GET /api/wallets/{addr}/profile` — Wallet profile
- `POST /api/wallets/add` — Add wallet
- `GET /api/signals/confluence` — Confluence signals

### ASP A2A (public)

- `GET /a2a/signals` — Signal feed
- `GET /a2a/wallets/{addr}/profile` — Wallet profile
- `GET /a2a/top-wallets` — Top wallets
- `GET /a2a/tokens/{addr}/activity` — Token activity

## Config

Environment variables (optional):

| Var | Default |
|-----|---------|
| `SM_RPC_HTTP` | `https://rpc.mainnet.chain.robinhood.com` |
| `SM_DB_PATH` | `smartmoney.db` |
````

- [ ] **Step 2: Commit**

```bash
cd smartmoney-lens && git add -A && git commit -m "docs: add README with quick start and API reference

Co-Authored-By: Claude <noreply@anthropic.com>"
```
