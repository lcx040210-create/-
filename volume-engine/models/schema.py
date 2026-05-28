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
