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
                return 3
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
