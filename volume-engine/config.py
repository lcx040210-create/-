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
    mode: str = "single"
    market: str = "spot"
    order_strategy: str = "follow"


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
