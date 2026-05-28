import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

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
