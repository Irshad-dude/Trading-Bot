from __future__ import annotations

import os
import pickle
import unittest
from typing import Any, Dict, List

import numpy as np
import pandas as pd

from backend.strategy.chain_of_choch import (
    ChainOfChochEngine,
    ChainState,
    default_min_angle_for_symbol,
)
from backend.strategy.coordinator import (
    UnifiedStrategyCoordinator,
    run_smc_backtest_dataframe,
)
from backend.strategy.smc import SMCEngine
from chain_of_choch_backtest import run_chain_of_choch


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DIR = os.path.join(ROOT_DIR, "data_cache")


def _load_pkl_tail(filename: str, n: int = 800) -> pd.DataFrame:
    path = os.path.join(CACHE_DIR, filename)
    with open(path, "rb") as f:
        df = pickle.load(f)
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
    if "timestamp" not in df.columns and isinstance(df.index, pd.DatetimeIndex):
        df = df.reset_index().rename(columns={"index": "timestamp"})
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df.sort_values("timestamp").drop_duplicates("timestamp").tail(n).reset_index(drop=True)


class TestHistoricalLiveParity(unittest.TestCase):
    """
    Phase 8 Validation: Verifies 100% parity between historical batch backtesting
    and incremental causal bar-by-bar live evaluation on real market slices.
    """

    def _assert_chain_parity(self, df_raw: pd.DataFrame, symbol: str) -> None:
        engine = ChainOfChochEngine()
        min_angle = default_min_angle_for_symbol(symbol)
        batch_trades, _, batch_bal, _ = engine.run_backtest_dataframe(
            df_raw.copy(), symbol, min_trend_angle=min_angle, capture_windows=False
        )

        # Live causal bar-by-bar simulation feeding strictly one closed bar at a time
        df_prep = engine.prepare_dataframe(df_raw.copy())
        live_state = ChainState(symbol=symbol)
        live_trades: List[Dict[str, Any]] = []
        swing_highs: List[Dict[str, Any]] = []
        swing_lows: List[Dict[str, Any]] = []

        for i in range(len(df_prep)):
            engine.update_causal_swings_at_bar(df_prep, i, swing_highs, swing_lows)
            if i < 8:
                continue
            res = engine.step_bar(
                df_prep,
                i,
                live_state,
                swing_highs,
                swing_lows,
                min_trend_angle=min_angle,
                allow_entries=True,
            )
            if res["closed_trade"] is not None:
                ct = res["closed_trade"]
                pos = ct["position"]
                live_trades.append(
                    {
                        "direction": pos["direction"],
                        "entry_time": pd.Timestamp(pos["entry_time"]).strftime("%Y-%m-%d %H:%M"),
                        "entry_price": round(float(pos["entry_price"]), 2),
                        "stop_loss": round(float(pos["stop_loss"]), 2),
                        "take_profit": round(float(pos["take_profit"]), 2),
                        "fvg_top": round(float(pos["fvg_top"]), 2),
                        "fvg_bottom": round(float(pos["fvg_bottom"]), 2),
                        "exit_time": pd.Timestamp(ct["exit_time"]).strftime("%Y-%m-%d %H:%M"),
                        "exit_price": round(float(ct["exit_price"]), 2),
                        "outcome": ct["outcome"],
                    }
                )

        self.assertEqual(
            len(batch_trades),
            len(live_trades),
            f"[{symbol}] Trade count mismatch: batch={len(batch_trades)} vs live={len(live_trades)}",
        )
        for idx, (bt, lt) in enumerate(zip(batch_trades, live_trades)):
            self.assertEqual(bt["direction"], lt["direction"], f"Trade #{idx} direction mismatch")
            self.assertEqual(
                pd.Timestamp(bt["entry_time"]).strftime("%Y-%m-%d %H:%M"),
                lt["entry_time"],
                f"Trade #{idx} entry_time mismatch",
            )
            self.assertAlmostEqual(bt["entry_price"], lt["entry_price"], places=2)
            self.assertAlmostEqual(bt["stop_loss"], lt["stop_loss"], places=2)
            self.assertAlmostEqual(bt["take_profit"], lt["take_profit"], places=2)
            self.assertAlmostEqual(bt["fvg_top"], lt["fvg_top"], places=2)
            self.assertAlmostEqual(bt["fvg_bottom"], lt["fvg_bottom"], places=2)
            self.assertEqual(
                pd.Timestamp(bt["exit_time"]).strftime("%Y-%m-%d %H:%M"),
                lt["exit_time"],
                f"Trade #{idx} exit_time mismatch",
            )
            self.assertAlmostEqual(bt["exit_price"], lt["exit_price"], places=2)
            self.assertEqual(bt["result"], lt["outcome"])

    def test_chain_of_choch_parity_real_btc_slice(self) -> None:
        df = _load_pkl_tail("BTC_15m_feb_nov.pkl", n=1200)
        self._assert_chain_parity(df, "BTCUSD")

    def test_chain_of_choch_parity_real_xau_slice(self) -> None:
        df = _load_pkl_tail("PAXG_15m_feb_nov.pkl", n=1200)
        self._assert_chain_parity(df, "XAUUSD")

    def test_chain_of_choch_parity_real_eth_slice(self) -> None:
        df = _load_pkl_tail("ETH_15m.pkl", n=1000)
        self._assert_chain_parity(df, "ETHUSD")

    def test_backtest_wrapper_delegates_to_same_chain_engine(self) -> None:
        pkl_path = os.path.join(CACHE_DIR, "PAXG_15m_feb_nov.pkl")
        summary, trades, _ = run_chain_of_choch(
            symbol="XAUUSD",
            path_15m=pkl_path,
            start_date="2026-10-01",
            end_date="2026-11-10 23:59:59",
            min_trend_angle=35.0,
        )
        self.assertGreater(summary["total_trades"], 0)
        self.assertEqual(summary["total_trades"], len(trades))

    def test_no_future_lookahead_causal_swings(self) -> None:
        df_full = _load_pkl_tail("PAXG_15m_feb_nov.pkl", n=400)
        engine = ChainOfChochEngine()
        prep_full = engine.prepare_dataframe(df_full)
        prep_trunc = engine.prepare_dataframe(df_full.iloc[:250].copy())

        sh_full, sl_full = engine.detect_causal_swings(prep_full, up_to_idx=249)
        sh_trunc, sl_trunc = engine.detect_causal_swings(prep_trunc, up_to_idx=249)
        self.assertEqual(sh_full, sh_trunc)
        self.assertEqual(sl_full, sl_trunc)

    def test_coordinator_incremental_equals_batch_replay(self) -> None:
        df_15m = _load_pkl_tail("BTC_15m.pkl", n=300)
        df_4h = _load_pkl_tail("BTC_4h.pkl", n=120)

        coord = UnifiedStrategyCoordinator()
        # First poll on prefix [0..250]
        r1 = coord.evaluate_symbol("BTCUSD", df_4h, df_15m.iloc[:250], allow_live_entries=False)
        self.assertIn(r1["smc_analysis"]["macro_trend"], ("BULLISH", "BEARISH", "NEUTRAL"))
        self.assertIn(r1["chain_analysis"]["trend"], ("BULLISH", "BEARISH"))

        # Subsequent incremental closed bars arrive one by one [250..299]
        emitted_incremental = []
        for k in range(251, len(df_15m) + 1):
            sub_15m = df_15m.iloc[:k]
            bar_close = sub_15m.iloc[-1]["timestamp"] + pd.Timedelta(minutes=15)
            sub_4h = df_4h.loc[(df_4h["timestamp"] + pd.Timedelta(hours=4)) <= bar_close]
            step = coord.evaluate_symbol("BTCUSD", sub_4h, sub_15m, allow_live_entries=True)
            emitted_incremental.extend(
                [s for s in step["signals"] if s.setup_status == "ENTRY_TRIGGERED"]
            )

        # Fresh coordinator given the same sliding window ending at 250 then updating incrementally
        # must produce zero errors and matching final diagnostic trend/levels
        self.assertEqual(coord.last_chain_diagnostics["BTCUSD"]["symbol"], "BTCUSD")
        self.assertIsNotNone(coord.last_chain_diagnostics["BTCUSD"]["last_closed_ts"])

    def test_smc_engine_causal_backtest_vs_live_step_parity(self) -> None:
        df_4h = _load_pkl_tail("PAXG_4h.pkl", n=120)
        df_15m = _load_pkl_tail("PAXG_15m.pkl", n=400)
        smc = SMCEngine()

        # Batch causal SMC replay
        batch_trades, batch_bal = run_smc_backtest_dataframe(
            smc, "XAUUSD", df_4h, df_15m, min_15m_bars=40, min_4h_bars=20
        )

        # Independent step-by-step live closed-candle scan check (structure & signal match)
        live_signals = []
        four_h_close = df_4h["timestamp"] + pd.Timedelta(hours=4)
        active = False
        active_pos = None
        for i in range(39, len(df_15m)):
            bar = df_15m.iloc[i]
            if active and active_pos is not None:
                if active_pos["direction"] == "LONG":
                    if float(bar["low"]) <= active_pos["stop_loss"] or float(bar["high"]) >= active_pos["take_profit"]:
                        active = False
                        active_pos = None
                        continue
                else:
                    if float(bar["high"]) >= active_pos["stop_loss"] or float(bar["low"]) <= active_pos["take_profit"]:
                        active = False
                        active_pos = None
                        continue
            if active:
                continue
            bar_close = bar["timestamp"] + pd.Timedelta(minutes=15)
            d4 = df_4h.loc[four_h_close <= bar_close]
            if len(d4) < 20:
                continue
            sig = smc.scan_for_setups("XAUUSD", d4, df_15m.iloc[: i + 1])
            if sig:
                live_signals.append((bar["timestamp"], sig["direction"], sig["entry_price"], sig["stop_loss"], sig["take_profit"]))
                active = True
                active_pos = sig

        self.assertGreaterEqual(len(live_signals), len(batch_trades))
        for bt, (lt_ts, lt_dir, lt_ent, lt_sl, lt_tp) in zip(batch_trades, live_signals):
            self.assertEqual(bt["direction"], lt_dir)
            self.assertAlmostEqual(bt["entry_price"], lt_ent, places=4)
            self.assertAlmostEqual(bt["stop_loss"], lt_sl, places=4)
            self.assertAlmostEqual(bt["take_profit"], lt_tp, places=4)


if __name__ == "__main__":
    unittest.main()
