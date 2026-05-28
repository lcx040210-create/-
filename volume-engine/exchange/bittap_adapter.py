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
