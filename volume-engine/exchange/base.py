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
    bids: list[tuple[float, float]]
    asks: list[tuple[float, float]]
    timestamp: int


@dataclass
class Order:
    id: str
    symbol: str
    side: str
    type: str
    amount: float
    price: float
    filled: float
    status: str
    fee: float = 0.0
    fee_currency: str = "USDT"


@dataclass
class Balance:
    free: dict[str, float]
    used: dict[str, float]
    total: dict[str, float]


@dataclass
class Position:
    symbol: str
    side: str
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
