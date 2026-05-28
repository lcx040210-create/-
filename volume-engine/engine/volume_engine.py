import asyncio
import logging
from dataclasses import dataclass
from enum import Enum

from config import AppConfig
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
