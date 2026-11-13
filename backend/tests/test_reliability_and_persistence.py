from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from typing import Any, Dict

import pandas as pd

from backend.data.fetcher import DataFetcher, MarketDataProvider
from backend.execution.paper_monitor import PaperTradeMonitor
from backend.journal.store import JournalStore
from backend.live_service import LiveMarketService
from backend.state import BotState
from backend.strategy.coordinator import StrategySignal, UnifiedStrategyCoordinator


class _FlakyMockProvider(MarketDataProvider):
    name = "MOCK_EXCHANGE"

    def __init__(self, fail_first_n: int = 0) -> None:
        self.fail_first_n = fail_first_n
        self.calls = 0
        self.reconnect_calls = 0
        self.connected = True
        self._df_15m = pd.DataFrame()
        self._df_4h = pd.DataFrame()

    def connect(self) -> bool:
        self.connected = True
        return True

    def reconnect(self) -> bool:
        self.reconnect_calls += 1
        self.connected = True
        return True

    def fetch_ohlcv(self, canonical_symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        self.calls += 1
        if self.calls <= self.fail_first_n:
            self.connected = False
            raise ConnectionError("Simulated socket drop")
        self.connected = True
        return (self._df_4h if timeframe == "4h" else self._df_15m).tail(limit).copy()

    def fetch_ticker(self, canonical_symbol: str) -> Dict[str, Any]:
        return {
            "symbol": canonical_symbol,
            "provider_symbol": f"{canonical_symbol}/USDT",
            "bid": 2000.0,
            "ask": 2000.2,
            "last": 2000.1,
            "spread": 0.2,
            "spread_pct": 0.01,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": self.name,
            "connected": self.connected,
        }

    def health_status(self) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "connected": self.connected,
            "reconnect_count": self.reconnect_calls,
        }


class TestReliabilityAndPersistence(unittest.TestCase):
    def test_incomplete_candle_rejection(self) -> None:
        # Candle starting at 10:00 on 15m closes at 10:15.
        # At 10:14:59 UTC it is INCOMPLETE and MUST be filtered out.
        df = pd.DataFrame(
            [
                {
                    "timestamp": pd.Timestamp("2026-11-12T09:45:00Z"),
                    "open": 100.0,
                    "high": 102.0,
                    "low": 99.0,
                    "close": 101.0,
                    "volume": 10.0,
                },
                {
                    "timestamp": pd.Timestamp("2026-11-12T10:00:00Z"),
                    "open": 101.0,
                    "high": 103.0,
                    "low": 100.0,
                    "close": 102.0,
                    "volume": 10.0,
                },
            ]
        )
        at_1014 = pd.Timestamp("2026-11-12T10:14:59Z")
        closed = DataFetcher._filter_closed_candles(df, "15m", now_utc=at_1014)
        self.assertEqual(len(closed), 1)
        self.assertEqual(closed.iloc[-1]["timestamp"], pd.Timestamp("2026-11-12T09:45:00Z"))

        at_1015 = pd.Timestamp("2026-11-12T10:15:00Z")
        closed2 = DataFetcher._filter_closed_candles(df, "15m", now_utc=at_1015)
        self.assertEqual(len(closed2), 2)

    def test_invalid_ohlcv_and_duplicate_filtering(self) -> None:
        df = pd.DataFrame(
            [
                {"timestamp": "2026-11-12T09:00:00Z", "open": 100, "high": 105, "low": 98, "close": 102, "volume": 5},
                {"timestamp": "2026-11-12T09:00:00Z", "open": 100, "high": 105, "low": 98, "close": 103, "volume": 6},  # duplicate ts
                {"timestamp": "2026-11-12T09:15:00Z", "open": 103, "high": 99, "low": 104, "close": 101, "volume": 5},   # high < low malformed
                {"timestamp": "2026-11-12T09:30:00Z", "open": -1, "high": 105, "low": 98, "close": 102, "volume": 5},    # negative price
                {"timestamp": "2026-11-12T09:45:00Z", "open": 103, "high": 106, "low": 102, "close": 105, "volume": 5},  # valid
            ]
        )
        clean, rejected = DataFetcher.validate_ohlcv(df)
        self.assertEqual(len(clean), 2)
        self.assertEqual(rejected, 3)
        self.assertEqual(float(clean.iloc[0]["close"]), 103.0)

    def test_missing_candle_gap_detection(self) -> None:
        df = pd.DataFrame(
            [
                {"timestamp": "2026-11-12T09:00:00Z", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
                {"timestamp": "2026-11-12T09:15:00Z", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
                # 09:30 and 09:45 missing -> 2 missing bars
                {"timestamp": "2026-11-12T10:00:00Z", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
            ]
        )
        rep = DataFetcher.detect_missing_candles(df, "15m")
        self.assertEqual(rep["missing_bars"], 2)
        self.assertEqual(len(rep["gaps"]), 1)

    def test_duplicate_signal_and_trade_prevention_and_mfe_mae(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_journal.db")
            store = JournalStore(db_path=db_path)
            pm = PaperTradeMonitor(store=store, initial_balance=10000.0, risk_percent=1.0)

            sig = StrategySignal(
                signal_id="SIG_TEST_001",
                strategy_name="CHAIN_OF_CHOCH_15M",
                symbol="BTCUSD",
                timeframe="15M",
                market_trend="BULLISH",
                direction="LONG",
                action_label="BUY",
                entry_price=50000.0,
                stop_loss=49500.0,
                take_profit=51000.0,
                signal_timestamp="2026-11-12T10:00:00Z",
                setup_status="ENTRY_TRIGGERED",
                reasoning="Test signal",
            )
            t1 = pm.process_signal(sig, live_ticker={"connected": True, "bid": 50000.0, "ask": 50001.0})
            self.assertIsNotNone(t1)
            self.assertEqual(len(pm.open_trades), 1)

            # Duplicate same signal_id must be suppressed
            t_dup_sig = pm.process_signal(sig)
            self.assertIsNone(t_dup_sig)

            # Different signal_id on SAME symbol+strategy while open trade exists must be prevented
            sig2 = StrategySignal(
                signal_id="SIG_TEST_002",
                strategy_name="CHAIN_OF_CHOCH_15M",
                symbol="BTCUSD",
                timeframe="15M",
                market_trend="BULLISH",
                direction="LONG",
                action_label="BUY",
                entry_price=50100.0,
                stop_loss=49600.0,
                take_profit=51100.0,
                signal_timestamp="2026-11-12T10:15:00Z",
                setup_status="ENTRY_TRIGGERED",
                reasoning="Second signal while position open",
            )
            t_dup_trade = pm.process_signal(sig2)
            self.assertIsNone(t_dup_trade)
            self.assertEqual(len(pm.open_trades), 1)

            # MFE / MAE tracking on live ticks
            pm.update_with_live_ticker("BTCUSD", {"connected": True, "bid": 50250.0, "ask": 50251.0})
            self.assertGreater(pm.open_trades[0]["mfe"], 0.0)
            pm.update_with_live_ticker("BTCUSD", {"connected": True, "bid": 49750.0, "ask": 49751.0})
            self.assertLess(pm.open_trades[0]["mae"], 0.0)

            # Closed bar hitting BOTH SL & TP on same candle resolves SL FIRST conservatively
            closed = pm.update_with_closed_bar(
                "BTCUSD", bar_high=51500.0, bar_low=49400.0, bar_ts="2026-11-12T10:15:00Z"
            )
            self.assertEqual(len(closed), 1)
            self.assertEqual(closed[0]["exit_condition"], "SL_HIT")
            self.assertEqual(closed[0]["final_result"], "LOSS")
            self.assertAlmostEqual(pm.balance, 9900.0, places=2)
            store.close()

    def test_restart_recovery_preserves_open_trades_and_coordinator_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "restart_recovery.db")

            # Instance 1: opens a paper trade and saves coordinator state
            store1 = JournalStore(db_path=db_path)
            pm1 = PaperTradeMonitor(store=store1, initial_balance=10000.0, risk_percent=0.5)
            coord1 = UnifiedStrategyCoordinator()
            coord1.last_smc_candle_ts["XAUUSD"] = "2026-11-12T10:00:00Z"

            sig = StrategySignal(
                signal_id="SIG_RESTART_1",
                strategy_name="SMC_4H_15M",
                symbol="XAUUSD",
                timeframe="4H + 15M",
                market_trend="BEARISH",
                direction="SHORT",
                action_label="SELL",
                entry_price=3850.0,
                stop_loss=3870.0,
                take_profit=3810.0,
                signal_timestamp="2026-11-12T10:00:00Z",
                setup_status="ENTRY_TRIGGERED",
                reasoning="Restart recovery test",
            )
            pm1.process_signal(sig)
            bot1 = BotState()
            svc1 = LiveMarketService(
                fetcher=DataFetcher(provider=_FlakyMockProvider()),
                coordinator=coord1,
                store=store1,
                paper_monitor=pm1,
                analyst=None,
                bot_state=bot1,
            )
            svc1.persist()
            store1.close()

            # Instance 2: simulated process restart on same SQLite DB
            store2 = JournalStore(db_path=db_path)
            pm2 = PaperTradeMonitor(store=store2, initial_balance=10000.0, risk_percent=0.5)
            coord2 = UnifiedStrategyCoordinator()
            bot2 = BotState()
            svc2 = LiveMarketService(
                fetcher=DataFetcher(provider=_FlakyMockProvider()),
                coordinator=coord2,
                store=store2,
                paper_monitor=pm2,
                analyst=None,
                bot_state=bot2,
            )
            self.assertEqual(len(pm2.open_trades), 1)
            self.assertEqual(pm2.open_trades[0]["signal_id"], "SIG_RESTART_1")
            self.assertEqual(coord2.last_smc_candle_ts.get("XAUUSD"), "2026-11-12T10:00:00Z")
            self.assertTrue(pm2.has_open_trade("XAUUSD", "SMC_4H_15M"))
            # Re-submitting same signal after restart is suppressed
            self.assertIsNone(pm2.process_signal(sig))
            store2.close()


if __name__ == "__main__":
    unittest.main()
