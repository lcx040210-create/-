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
