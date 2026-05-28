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
    volume: float
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
        buy_order: Order | None = None
        sell_order: Order | None = None
        fee = 0.0
        volume = 0.0
        pnl = 0.0

        try:
            ob = await self.adapter.fetch_order_book(symbol)
            await self.risk.record_api_success()

            bid = ob.bids[0][0]
            ask = ob.asks[0][0]
            spread = (ask - bid) / bid

            triggers = await self.risk.check_hard_limits(spread, 0)
            if triggers:
                logger.warning(f"Hard limit triggered: {triggers}")
                return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

            if self.strategy == "depth_insert":
                bid_price = bid * 0.999
                ask_price = ask * 1.001
            else:
                bid_price = bid
                ask_price = ask

            ticker = await self.adapter.fetch_ticker(symbol)
            amount_in_base = self.amount / ticker.last

            await self.risk.record_order()
            buy_order = await self.adapter.create_limit_order(symbol, "buy", amount_in_base, bid_price)
            sell_order = await self.adapter.create_limit_order(symbol, "sell", amount_in_base, ask_price)
            await self.risk.record_order()

            deadline = asyncio.get_event_loop().time() + self.timeout
            buy_filled = False
            sell_filled = False
            retries = 0

            while asyncio.get_event_loop().time() < deadline and retries < 3:
                ob_new = await self.adapter.fetch_order_book(symbol)
                await self.risk.record_api_success()

                if ob_new.bids[0][0] >= ask_price:
                    sell_filled = True
                if ob_new.asks[0][0] <= bid_price:
                    buy_filled = True

                if buy_filled or sell_filled:
                    break

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

            if not buy_filled and not sell_filled:
                await self.risk.record_no_fill()
                await self.adapter.cancel_order(buy_order.id, symbol)
                await self.adapter.cancel_order(sell_order.id, symbol)
                return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

            await self.risk.record_fill()
            if buy_filled and not sell_filled:
                await self.adapter.cancel_order(sell_order.id, symbol)
                close_order = await self.adapter.create_market_order(symbol, "sell", amount_in_base)
                fee = close_order.fee
                volume = self.amount * 2
                pnl = (close_order.price - buy_order.price) * amount_in_base - fee
            elif sell_filled and not buy_filled:
                await self.adapter.cancel_order(buy_order.id, symbol)
                close_order = await self.adapter.create_market_order(symbol, "buy", amount_in_base)
                fee = close_order.fee
                volume = self.amount * 2
                pnl = (sell_order.price - close_order.price) * amount_in_base - fee
            else:
                if buy_order and sell_order:
                    pnl = (sell_order.price - buy_order.price) * amount_in_base
                volume = self.amount * 2

            await self.risk.record_trade(pnl)
            return RoundResult(symbol=symbol, volume=volume, pnl=pnl, fee=fee, rounds=1)

        except Exception as e:
            logger.error(f"Round error: {e}")
            await self.risk.record_api_error()
            try:
                if buy_order:
                    await self.adapter.cancel_order(buy_order.id, symbol)
                if sell_order:
                    await self.adapter.cancel_order(sell_order.id, symbol)
            except Exception:
                pass
            return RoundResult(symbol=symbol, volume=0, pnl=0, fee=0, rounds=0)

    async def execute_perpetual_single_round(self, symbol: str) -> RoundResult:
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
