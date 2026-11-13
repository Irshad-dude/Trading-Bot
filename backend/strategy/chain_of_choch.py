"""
Unified 15M Chain-of-CHoCH SMC Engine (Single Source of Truth).

Used identically by BOTH:
  - Historical backtesting (`chain_of_choch_backtest.py` / `run_feb_nov_backtest.py`)
  - Real-time live market analysis (`backend/strategy/coordinator.py` / `backend/main.py`)

Preserves Irshad's exact Chain-of-CHoCH strategy rules:
  - 15M Fractal Swing Points (pivot p=4)
  - ATR-normalized Impulse Angle filter (>= 35 deg Gold, >= 30 deg BTC/ETH/US30)
  - Inducement (IDM) Sweep + Decisive BOS Candle Close Continuation
  - Dynamic CHoCH calculation (min low / max high between structural anchor and BOS)
  - CHoCH Break Trend Reversal (body close beyond active CHoCH level)
  - 3-Candle FVG at [B-1, B, B+1] evaluated after B+1 (C3) closes (any non-zero gap > 0)
  - Pre-touch C1 extreme invalidation
  - Immediate FVG touch entry at min(fvg_top, c_open) LONG / max(fvg_bottom, c_open) SHORT
  - Rule #8 Zero-Buffer C1 Extreme Stop-Loss & Rule #9 Strict 1:2 R:R Target
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

IST = timezone(timedelta(hours=5, minutes=30))


def get_session_name(dt_utc: datetime) -> str:
    hour = dt_utc.hour
    if 0 <= hour < 7:
        return "Asian Session (Tokyo/Sydney)"
    elif 7 <= hour < 13:
        return "London Opening & Morning Session"
    elif 13 <= hour < 17:
        return "London / New York Overlap (Peak Volatility)"
    elif 17 <= hour < 21:
        return "New York Afternoon Session"
    return "Global Twilight Session"


def default_min_angle_for_symbol(symbol: str) -> float:
    sym = symbol.upper()
    if "XAU" in sym or "PAXG" in sym or "GOLD" in sym:
        return 35.0
    return 30.0


@dataclass
class ChainState:
    """Persistent incremental state for 15M Chain-of-CHoCH per symbol."""

    symbol: str
    trend: str = "BULLISH"
    current_choch: Optional[Dict[str, Any]] = None
    pending_breakout: Optional[Dict[str, Any]] = None
    pending_fvg: Optional[Dict[str, Any]] = None
    active_pos: Optional[Dict[str, Any]] = None
    last_processed_ts: Optional[str] = None
    last_idm_level: Optional[float] = None
    last_bos_level: Optional[float] = None
    last_choch_level: Optional[float] = None
    last_rejection_reason: Optional[str] = None
    last_stage: str = "SCANNING_STRUCTURE"
    last_stage_status: str = "WAITING"
    last_angle: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChainState":
        valid_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in valid_fields}
        return cls(**filtered)


class ChainOfChochEngine:
    """
    Causal, stateful Chain-of-CHoCH strategy engine.
    Produces identical decisions in historical batch execution and live bar-by-bar evaluation.
    """

    def __init__(self, pivot_length: int = 4):
        self.pivot_length = pivot_length

    @staticmethod
    def prepare_dataframe(df_raw: pd.DataFrame) -> pd.DataFrame:
        """Standardizes columns, timestamps, and computes ATR(14)."""
        df = df_raw.copy()
        if "timestamp" not in df.columns:
            df = df.reset_index()
            if "index" in df.columns and "timestamp" not in df.columns:
                df = df.rename(columns={"index": "timestamp"})
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)
        prev_c = close.shift(1)
        tr = pd.concat(
            [high - low, (high - prev_c).abs(), (low - prev_c).abs()],
            axis=1,
        ).max(axis=1)
        df["atr"] = tr.rolling(14).mean().bfill()
        return df

    @staticmethod
    def get_impulse_angle(df: pd.DataFrame, idx: int, lookback: int = 4) -> float:
        if idx < lookback:
            return 0.0
        dp = abs(float(df["close"].iloc[idx]) - float(df["close"].iloc[idx - lookback]))
        atr_val = float(df["atr"].iloc[idx])
        if atr_val <= 0 or math.isnan(atr_val):
            return 0.0
        slope = dp / (lookback * atr_val)
        return float(np.degrees(np.arctan(slope)))

    def detect_causal_swings(
        self,
        df: pd.DataFrame,
        up_to_idx: Optional[int] = None,
    ) -> Tuple[List[Tuple[int, float]], List[Tuple[int, float]]]:
        """
        Detects fractal swings using ONLY candles <= up_to_idx (zero future lookahead).
        A pivot at bar `s` requires bars `[s - p .. s + p]`, so it is confirmed when `s + p <= max_idx`.
        """
        p = self.pivot_length
        max_idx = (len(df) - 1) if up_to_idx is None else min(up_to_idx, len(df) - 1)
        swing_highs: List[Tuple[int, float]] = []
        swing_lows: List[Tuple[int, float]] = []

        if max_idx < 2 * p:
            return swing_highs, swing_lows

        highs = df["high"].values
        lows = df["low"].values

        for s in range(p, max_idx - p + 1):
            wh = highs[s - p : s + p + 1]
            wl = lows[s - p : s + p + 1]
            if highs[s] == wh.max():
                swing_highs.append((s, float(highs[s])))
            if lows[s] == wl.min():
                swing_lows.append((s, float(lows[s])))

        return swing_highs, swing_lows

    def update_causal_swings_at_bar(
        self,
        df: pd.DataFrame,
        bar_idx: int,
        swing_highs: List[Tuple[int, float]],
        swing_lows: List[Tuple[int, float]],
    ) -> None:
        """
        O(1) incremental swing confirmation: when closed bar `bar_idx` arrives,
        candidate pivot `s = bar_idx - p` now has its full `[s - p .. s + p]` window closed.
        """
        p = self.pivot_length
        s = bar_idx - p
        if s < p or bar_idx >= len(df):
            return
        highs = df["high"].values
        lows = df["low"].values
        wh = highs[s - p : s + p + 1]
        wl = lows[s - p : s + p + 1]
        if highs[s] == wh.max():
            if not swing_highs or swing_highs[-1][0] != s:
                swing_highs.append((s, float(highs[s])))
        if lows[s] == wl.min():
            if not swing_lows or swing_lows[-1][0] != s:
                swing_lows.append((s, float(lows[s])))

    def step_bar(
        self,
        df: pd.DataFrame,
        i: int,
        state: ChainState,
        swing_highs: List[Tuple[int, float]],
        swing_lows: List[Tuple[int, float]],
        min_trend_angle: Optional[float] = None,
        allow_entries: bool = True,
    ) -> Dict[str, Any]:
        """
        Processes a single newly closed candle at index `i` on prepared DataFrame `df`
        using only bars `0..i` and updates `state` in place.

        Returns an event dict describing what happened on bar `i`:
          - closed_trade: dict if active_pos hit SL/TP on bar `i`
          - triggered_signal: dict if pending_fvg triggered entry on bar `i`
          - invalidated_reason: str if pending_fvg invalidated before touch
          - new_fvg: dict if a C3 bar closed and formed a valid FVG
          - breakout_event: dict if BOS or CHoCH break occurred on bar `i`
        """
        if min_trend_angle is None:
            min_trend_angle = default_min_angle_for_symbol(state.symbol)

        events: Dict[str, Any] = {
            "bar_index": i,
            "timestamp": str(df["timestamp"].iloc[i]),
            "closed_trade": None,
            "triggered_signal": None,
            "invalidated_reason": None,
            "new_fvg": None,
            "breakout_event": None,
        }

        if i < 20:
            state.last_processed_ts = str(df["timestamp"].iloc[i])
            return events

        bar = df.iloc[i]
        prev = df.iloc[i - 1]
        c_open = float(bar["open"])
        c_high = float(bar["high"])
        c_low = float(bar["low"])
        c_close = float(bar["close"])
        ts = bar["timestamp"]
        ts_str = str(ts)

        # ── Step 0: Evaluate any pending B+1 FVG from previous bar's BOS/CHoCH break ──
        if state.pending_breakout is not None:
            pb = state.pending_breakout
            if i == pb["c2_idx"] + 1 and i >= 2:
                c1_idx = pb["c1_idx"]
                c2_idx = pb["c2_idx"]
                c3_idx = i
                c1 = df.iloc[c1_idx]
                c3 = df.iloc[c3_idx]

                if pb["direction"] == "LONG":
                    gap = float(c3["low"]) - float(c1["high"])
                    fvg_top = float(c3["low"])
                    fvg_bottom = float(c1["high"])
                else:
                    gap = float(c1["low"]) - float(c3["high"])
                    fvg_top = float(c1["low"])
                    fvg_bottom = float(c3["high"])

                if gap > 0:
                    if state.active_pos is None and state.pending_fvg is None:
                        fvg_setup = {
                            "type": pb["type"],
                            "direction": pb["direction"],
                            "sh_idx": pb["sh_idx"],
                            "sh_price": pb["sh_price"],
                            "idm_idx": pb["idm_idx"],
                            "idm_price": pb["idm_price"],
                            "sweep_idx": pb["sweep_idx"],
                            "sweep_price": pb["sweep_price"],
                            "bos_idx": pb["bos_idx"],
                            "bos_price": pb["bos_price"],
                            "bos_level": pb["bos_level"],
                            "idm_level": pb["idm_level"],
                            "choch_idx": pb["choch_idx"],
                            "choch_price": pb["choch_price"],
                            "choch_break_idx": pb.get("choch_break_idx", c2_idx),
                            "choch_break_price": pb.get("choch_break_price", pb["bos_price"]),
                            "c1_idx": c1_idx,
                            "c2_idx": c2_idx,
                            "c3_idx": c3_idx,
                            "c1_ts": str(df["timestamp"].iloc[c1_idx]),
                            "c3_ts": ts_str,
                            "c1_high": float(c1["high"]),
                            "c1_low": float(c1["low"]),
                            "fvg_top": round(fvg_top, 4),
                            "fvg_bottom": round(fvg_bottom, 4),
                            "gap_size": round(gap, 4),
                            "angle": round(pb["angle"], 2),
                            "anchor_ts": str(df["timestamp"].iloc[c2_idx]),
                        }
                        state.pending_fvg = fvg_setup
                        state.last_stage = "FVG_TOUCH"
                        state.last_stage_status = "WAITING"
                        state.last_rejection_reason = None
                        events["new_fvg"] = fvg_setup
                else:
                    reason = (
                        f"{pb['type']} ({pb['direction']}) at {pb.get('c2_ts', '')} rejected: "
                        f"3-candle FVG gap <= 0 ({gap:.4f}) after C3 closed."
                    )
                    state.last_rejection_reason = reason
                    state.last_stage = "15M_FVG"
                    state.last_stage_status = "REJECTED"
                state.pending_breakout = None

        # ── Step A: Manage Active Position (Exit Check) ──────────────────────
        if state.active_pos is not None:
            pos = state.active_pos
            hit_tp = False
            hit_sl = False
            exit_price = pos["entry_price"]

            if pos["direction"] == "LONG":
                if c_low <= pos["stop_loss"]:
                    hit_sl = True
                    exit_price = pos["stop_loss"]
                elif c_high >= pos["take_profit"]:
                    hit_tp = True
                    exit_price = pos["take_profit"]
            else:
                if c_high >= pos["stop_loss"]:
                    hit_sl = True
                    exit_price = pos["stop_loss"]
                elif c_low <= pos["take_profit"]:
                    hit_tp = True
                    exit_price = pos["take_profit"]

            if hit_tp or hit_sl:
                outcome = "WIN" if hit_tp else "LOSS"
                events["closed_trade"] = {
                    "position": pos,
                    "outcome": outcome,
                    "exit_condition": "TP_HIT" if hit_tp else "SL_HIT",
                    "exit_price": round(float(exit_price), 4),
                    "exit_time": ts_str,
                    "exit_idx": i,
                }
                state.active_pos = None

        # ── Step B: Check Pending FVG Retrace Touch / C1 Extreme Invalidation ─
        if state.active_pos is None and state.pending_fvg is not None:
            f = state.pending_fvg
            c3_idx = f.get("c3_idx", -1)
            # Expire stale FVG setups if more than 30 closed 15M candles have elapsed without mitigation
            if c3_idx >= 0 and (i - c3_idx) > 30:
                reason = f"Pending {f['direction']} FVG expired: 30+ candles ({i - c3_idx}) elapsed without mitigation."
                state.pending_fvg = None
                state.last_stage = "SCANNING_STRUCTURE"
                state.last_stage_status = "WAITING"
                state.last_rejection_reason = reason
                events["invalidated_reason"] = reason

            elif state.pending_fvg is not None:
                # Strictly evaluate on candles AFTER C3 closed (by timestamp or index)
                c3_ts = f.get("c3_ts")
                is_after_c3 = (ts_str > c3_ts) if c3_ts else (i > c3_idx)

                if is_after_c3:
                    if f["direction"] == "LONG":
                        if c_low <= f["c1_low"]:
                            reason = f"Pending LONG FVG invalidated: candle low ({c_low:.2f}) breached C1 Low SL ({f['c1_low']:.2f}) before zone touch."
                            state.pending_fvg = None
                            state.last_rejection_reason = reason
                            state.last_stage = "FVG_TOUCH"
                            state.last_stage_status = "INVALIDATED"
                            events["invalidated_reason"] = reason
                        elif c_low <= f["fvg_top"] and c_high >= f["fvg_bottom"]:
                            entry_p = min(f["fvg_top"], c_open)
                            sl = float(f["c1_low"])
                            risk_d = entry_p - sl
                            if risk_d > 0.05 and allow_entries:
                                tp = round(entry_p + 2.0 * risk_d, 2)
                                pos_dict = {
                                    "strategy_name": "CHAIN_OF_CHOCH_15M",
                                    "type": f["type"],
                                    "direction": "LONG",
                                    "entry_time": ts_str,
                                    "entry_price": round(entry_p, 2),
                                    "stop_loss": round(sl, 2),
                                    "take_profit": tp,
                                    "risk_distance": round(risk_d, 4),
                                    "sh_idx": f["sh_idx"],
                                    "sh_price": f["sh_price"],
                                    "idm_idx": f["idm_idx"],
                                    "idm_price": f["idm_price"],
                                    "sweep_idx": f.get("sweep_idx", f["idm_idx"]),
                                    "sweep_price": f.get("sweep_price", f["idm_price"]),
                                    "bos_idx": f["bos_idx"],
                                    "bos_price": f["bos_price"],
                                    "bos_level": f["bos_level"],
                                    "idm_level": f["idm_level"],
                                    "choch_idx": f.get("choch_idx", f["sh_idx"]),
                                    "choch_price": f.get("choch_price", f["bos_level"]),
                                    "choch_break_idx": f.get("choch_break_idx", f["c2_idx"]),
                                    "c1_idx": f["c1_idx"],
                                    "c2_idx": f["c2_idx"],
                                    "c3_idx": f["c3_idx"],
                                    "fvg_top": f["fvg_top"],
                                    "fvg_bottom": f["fvg_bottom"],
                                    "entry_idx": i,
                                    "angle": f.get("angle", 0.0),
                                    "anchor_ts": f.get("anchor_ts", ts_str),
                                }
                                state.active_pos = pos_dict
                                state.pending_fvg = None
                                state.last_stage = "ENTRY_TRIGGERED"
                                state.last_stage_status = "TRIGGERED"
                                state.last_rejection_reason = None
                                events["triggered_signal"] = pos_dict
                            elif risk_d <= 0.05:
                                reason = f"Pending LONG FVG skipped: risk distance ({risk_d:.4f}) <= 0.05 minimum threshold."
                                state.pending_fvg = None
                                state.last_rejection_reason = reason
                                events["invalidated_reason"] = reason

                elif f["direction"] == "SHORT":
                    if c_high >= f["c1_high"]:
                        reason = f"Pending SHORT FVG invalidated: candle high ({c_high:.2f}) breached C1 High SL ({f['c1_high']:.2f}) before zone touch."
                        state.pending_fvg = None
                        state.last_rejection_reason = reason
                        state.last_stage = "FVG_TOUCH"
                        state.last_stage_status = "INVALIDATED"
                        events["invalidated_reason"] = reason
                    elif c_high >= f["fvg_bottom"] and c_low <= f["fvg_top"]:
                        entry_p = max(f["fvg_bottom"], c_open)
                        sl = float(f["c1_high"])
                        risk_d = sl - entry_p
                        if risk_d > 0.05 and allow_entries:
                            tp = round(entry_p - 2.0 * risk_d, 2)
                            pos_dict = {
                                "strategy_name": "CHAIN_OF_CHOCH_15M",
                                "type": f["type"],
                                "direction": "SHORT",
                                "entry_time": ts_str,
                                "entry_price": round(entry_p, 2),
                                "stop_loss": round(sl, 2),
                                "take_profit": tp,
                                "risk_distance": round(risk_d, 4),
                                "sh_idx": f["sh_idx"],
                                "sh_price": f["sh_price"],
                                "idm_idx": f["idm_idx"],
                                "idm_price": f["idm_price"],
                                "sweep_idx": f.get("sweep_idx", f["idm_idx"]),
                                "sweep_price": f.get("sweep_price", f["idm_price"]),
                                "bos_idx": f["bos_idx"],
                                "bos_price": f["bos_price"],
                                "bos_level": f["bos_level"],
                                "idm_level": f["idm_level"],
                                "choch_idx": f.get("choch_idx", f["sh_idx"]),
                                "choch_price": f.get("choch_price", f["bos_level"]),
                                "choch_break_idx": f.get("choch_break_idx", f["c2_idx"]),
                                "c1_idx": f["c1_idx"],
                                "c2_idx": f["c2_idx"],
                                "c3_idx": f["c3_idx"],
                                "fvg_top": f["fvg_top"],
                                "fvg_bottom": f["fvg_bottom"],
                                "entry_idx": i,
                                "angle": f.get("angle", 0.0),
                                "anchor_ts": f.get("anchor_ts", ts_str),
                            }
                            state.active_pos = pos_dict
                            state.pending_fvg = None
                            state.last_stage = "ENTRY_TRIGGERED"
                            state.last_stage_status = "TRIGGERED"
                            state.last_rejection_reason = None
                            events["triggered_signal"] = pos_dict
                        elif risk_d <= 0.05:
                            reason = f"Pending SHORT FVG skipped: risk distance ({risk_d:.4f}) <= 0.05 minimum threshold."
                            state.pending_fvg = None
                            state.last_rejection_reason = reason
                            events["invalidated_reason"] = reason

        # ── Step C: Impulse Angle Filter ──────────────────────────────────────
        ang_4 = self.get_impulse_angle(df, i, 4)
        ang_6 = self.get_impulse_angle(df, i, 6)
        max_angle = max(ang_4, ang_6)
        state.last_angle = round(max_angle, 2)
        is_trending = max_angle >= min_trend_angle

        if not is_trending and state.pending_fvg is None and state.active_pos is None:
            state.last_rejection_reason = (
                f"Flat/sideways market rejected by impulse angle filter ({max_angle:.1f}° < {min_trend_angle:.1f}° minimum)."
            )

        # ── Step D: CHoCH Break (Trend Reversal) Detection ───────────────────
        if state.current_choch is not None and is_trending:
            if state.trend == "BULLISH" and c_close < state.current_choch["price"]:
                state.trend = "BEARISH"
                choch_data = state.current_choch
                state.current_choch = None
                state.last_choch_level = round(float(choch_data["price"]), 2)
                c1_idx = i - 1
                state.pending_breakout = {
                    "type": "REVERSAL_CHOCH",
                    "direction": "SHORT",
                    "sh_idx": choch_data.get("sh_idx", choch_data["idx"]),
                    "sh_price": choch_data.get("sh_price", choch_data["price"]),
                    "idm_idx": choch_data.get("idm_idx", c1_idx),
                    "idm_price": choch_data.get("idm_price", float(df["high"].iloc[c1_idx])),
                    "sweep_idx": choch_data.get("sweep_idx", choch_data.get("idm_idx", c1_idx)),
                    "sweep_price": choch_data.get("sweep_price", choch_data.get("idm_price", float(df["high"].iloc[c1_idx]))),
                    "bos_idx": choch_data.get("bos_idx", i),
                    "bos_price": choch_data.get("bos_price", c_close),
                    "bos_level": choch_data.get("bos_level", choch_data.get("sh_price", choch_data["price"])),
                    "idm_level": choch_data.get("idm_level", choch_data.get("idm_price", float(df["high"].iloc[c1_idx]))),
                    "choch_idx": choch_data["idx"],
                    "choch_price": choch_data["price"],
                    "choch_break_idx": i,
                    "choch_break_price": c_close,
                    "c1_idx": c1_idx,
                    "c2_idx": i,
                    "c2_ts": ts_str,
                    "angle": max_angle,
                }
                state.last_stage = "15M_CHOCH"
                state.last_stage_status = "CONFIRMED_WAITING_C3"
                events["breakout_event"] = state.pending_breakout

            elif state.trend == "BEARISH" and c_close > state.current_choch["price"]:
                state.trend = "BULLISH"
                choch_data = state.current_choch
                state.current_choch = None
                state.last_choch_level = round(float(choch_data["price"]), 2)
                c1_idx = i - 1
                state.pending_breakout = {
                    "type": "REVERSAL_CHOCH",
                    "direction": "LONG",
                    "sh_idx": choch_data.get("sh_idx", choch_data["idx"]),
                    "sh_price": choch_data.get("sh_price", choch_data["price"]),
                    "idm_idx": choch_data.get("idm_idx", c1_idx),
                    "idm_price": choch_data.get("idm_price", float(df["low"].iloc[c1_idx])),
                    "sweep_idx": choch_data.get("sweep_idx", choch_data.get("idm_idx", c1_idx)),
                    "sweep_price": choch_data.get("sweep_price", choch_data.get("idm_price", float(df["low"].iloc[c1_idx]))),
                    "bos_idx": choch_data.get("bos_idx", i),
                    "bos_price": choch_data.get("bos_price", c_close),
                    "bos_level": choch_data.get("bos_level", choch_data.get("sh_price", choch_data["price"])),
                    "idm_level": choch_data.get("idm_level", choch_data.get("idm_price", float(df["low"].iloc[c1_idx]))),
                    "choch_idx": choch_data["idx"],
                    "choch_price": choch_data["price"],
                    "choch_break_idx": i,
                    "choch_break_price": c_close,
                    "c1_idx": c1_idx,
                    "c2_idx": i,
                    "c2_ts": ts_str,
                    "angle": max_angle,
                }
                state.last_stage = "15M_CHOCH"
                state.last_stage_status = "CONFIRMED_WAITING_C3"
                events["breakout_event"] = state.pending_breakout

        # ── Step E: Trend Continuation (BOS) & CHoCH Update ──────────────────
        if state.trend == "BULLISH" and is_trending:
            recent_shs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if i - 60 <= sh_idx < i - 1]
            for (sh_idx, sh_p) in reversed(recent_shs):
                if c_close > sh_p and float(prev["close"]) <= sh_p:
                    pullback_lows = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sh_idx < sl_idx < i and sl_p < sh_p]
                    if not pullback_lows:
                        continue
                    idm_idx, idm_p = pullback_lows[0]
                    bars_between = df.iloc[idm_idx + 1 : i]
                    if bars_between.empty:
                        continue

                    idm_swept = False
                    sweep_idx = None
                    sweep_price = None
                    for b_idx, b_row in bars_between.iterrows():
                        if float(b_row["low"]) <= idm_p:
                            idm_swept = True
                            sweep_idx = int(b_idx)
                            sweep_price = float(b_row["low"])
                            break

                    if idm_swept:
                        range_bars = df.iloc[sh_idx : i + 1]
                        min_low = float(range_bars["low"].min())
                        min_idx = int(range_bars["low"].idxmin())

                        state.current_choch = {
                            "price": min_low,
                            "idx": min_idx,
                            "created_at": i,
                            "type": "BEARISH_CHOCH",
                            "sh_idx": int(sh_idx),
                            "sh_price": round(float(sh_p), 2),
                            "idm_idx": int(idm_idx),
                            "idm_price": round(float(idm_p), 2),
                            "sweep_idx": int(sweep_idx) if sweep_idx is not None else int(idm_idx),
                            "sweep_price": round(float(sweep_price), 2) if sweep_price is not None else round(float(idm_p), 2),
                            "bos_idx": i,
                            "bos_price": round(float(c_close), 2),
                            "bos_level": round(float(sh_p), 2),
                            "idm_level": round(float(idm_p), 2),
                        }
                        state.last_idm_level = round(float(idm_p), 2)
                        state.last_bos_level = round(float(sh_p), 2)
                        state.last_choch_level = round(min_low, 2)

                        if state.pending_breakout is None:
                            state.pending_breakout = {
                                "type": "CONTINUATION_BOS",
                                "direction": "LONG",
                                "sh_idx": int(sh_idx),
                                "sh_price": round(float(sh_p), 2),
                                "idm_idx": int(idm_idx),
                                "idm_price": round(float(idm_p), 2),
                                "sweep_idx": int(sweep_idx) if sweep_idx is not None else int(idm_idx),
                                "sweep_price": round(float(sweep_price), 2) if sweep_price is not None else round(float(idm_p), 2),
                                "bos_idx": i,
                                "bos_price": round(float(c_close), 2),
                                "bos_level": round(float(sh_p), 2),
                                "idm_level": round(float(idm_p), 2),
                                "choch_idx": min_idx,
                                "choch_price": round(min_low, 2),
                                "choch_break_idx": i,
                                "choch_break_price": c_close,
                                "c1_idx": i - 1,
                                "c2_idx": i,
                                "c2_ts": ts_str,
                                "angle": max_angle,
                            }
                            state.last_stage = "15M_BOS"
                            state.last_stage_status = "CONFIRMED_WAITING_C3"
                            events["breakout_event"] = state.pending_breakout
                        break

        elif state.trend == "BEARISH" and is_trending:
            recent_sls = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if i - 60 <= sl_idx < i - 1]
            for (sl_idx, sl_p) in reversed(recent_sls):
                if c_close < sl_p and float(prev["close"]) >= sl_p:
                    pullback_highs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sl_idx < sh_idx < i and sh_p > sl_p]
                    if not pullback_highs:
                        continue
                    idm_idx, idm_p = pullback_highs[0]
                    bars_between = df.iloc[idm_idx + 1 : i]
                    if bars_between.empty:
                        continue

                    idm_swept = False
                    sweep_idx = None
                    sweep_price = None
                    for b_idx, b_row in bars_between.iterrows():
                        if float(b_row["high"]) >= idm_p:
                            idm_swept = True
                            sweep_idx = int(b_idx)
                            sweep_price = float(b_row["high"])
                            break

                    if idm_swept:
                        range_bars = df.iloc[sl_idx : i + 1]
                        max_high = float(range_bars["high"].max())
                        max_idx = int(range_bars["high"].idxmax())

                        state.current_choch = {
                            "price": max_high,
                            "idx": max_idx,
                            "created_at": i,
                            "type": "BULLISH_CHOCH",
                            "sh_idx": int(sl_idx),
                            "sh_price": round(float(sl_p), 2),
                            "idm_idx": int(idm_idx),
                            "idm_price": round(float(idm_p), 2),
                            "sweep_idx": int(sweep_idx) if sweep_idx is not None else int(idm_idx),
                            "sweep_price": round(float(sweep_price), 2) if sweep_price is not None else round(float(idm_p), 2),
                            "bos_idx": i,
                            "bos_price": round(float(c_close), 2),
                            "bos_level": round(float(sl_p), 2),
                            "idm_level": round(float(idm_p), 2),
                        }
                        state.last_idm_level = round(float(idm_p), 2)
                        state.last_bos_level = round(float(sl_p), 2)
                        state.last_choch_level = round(max_high, 2)

                        if state.pending_breakout is None:
                            state.pending_breakout = {
                                "type": "CONTINUATION_BOS",
                                "direction": "SHORT",
                                "sh_idx": int(sl_idx),
                                "sh_price": round(float(sl_p), 2),
                                "idm_idx": int(idm_idx),
                                "idm_price": round(float(idm_p), 2),
                                "sweep_idx": int(sweep_idx) if sweep_idx is not None else int(idm_idx),
                                "sweep_price": round(float(sweep_price), 2) if sweep_price is not None else round(float(idm_p), 2),
                                "bos_idx": i,
                                "bos_price": round(float(c_close), 2),
                                "bos_level": round(float(sl_p), 2),
                                "idm_level": round(float(idm_p), 2),
                                "choch_idx": max_idx,
                                "choch_price": round(max_high, 2),
                                "choch_break_idx": i,
                                "choch_break_price": c_close,
                                "c1_idx": i - 1,
                                "c2_idx": i,
                                "c2_ts": ts_str,
                                "angle": max_angle,
                            }
                            state.last_stage = "15M_BOS"
                            state.last_stage_status = "CONFIRMED_WAITING_C3"
                            events["breakout_event"] = state.pending_breakout
                        break

        state.last_processed_ts = ts_str
        return events

    def run_backtest_dataframe(
        self,
        df_raw: pd.DataFrame,
        symbol: str,
        min_trend_angle: Optional[float] = None,
        starting_balance: float = 10000.0,
        risk_percent: float = 1.0,
        capture_windows: bool = True,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any], float, ChainState]:
        """
        Runs the causal bar-by-bar simulation on a historical DataFrame.
        Uses exact step_bar() logic so batch backtesting and live streaming share ONE code path.
        """
        df = self.prepare_dataframe(df_raw)
        state = ChainState(symbol=symbol)
        balance = starting_balance
        trades: List[Dict[str, Any]] = []
        trade_candles_dict: Dict[str, Any] = {}

        if min_trend_angle is None:
            min_trend_angle = default_min_angle_for_symbol(symbol)

        swing_highs, swing_lows = self.detect_causal_swings(df, up_to_idx=19)
        for i in range(20, len(df)):
            self.update_causal_swings_at_bar(df, i, swing_highs, swing_lows)
            ev = self.step_bar(
                df=df,
                i=i,
                state=state,
                swing_highs=swing_highs,
                swing_lows=swing_lows,
                min_trend_angle=min_trend_angle,
                allow_entries=True,
            )

            closed = ev.get("closed_trade")
            if closed:
                pos = closed["position"]
                outcome = closed["outcome"]
                risk_amt = balance * (risk_percent / 100.0)
                pnl_dollars = (risk_amt * 2.0) if outcome == "WIN" else (-risk_amt)
                pnl_percent = (2.0 * risk_percent) if outcome == "WIN" else (-risk_percent)
                balance += pnl_dollars

                entry_dt = pd.to_datetime(pos["entry_time"])
                exit_dt = pd.to_datetime(closed["exit_time"])
                dur_hours = round(max(0.25, (exit_dt - entry_dt).total_seconds() / 3600.0), 1)
                entry_dt_utc = entry_dt.to_pydatetime() if hasattr(entry_dt, "to_pydatetime") else entry_dt
                exit_dt_utc = exit_dt.to_pydatetime() if hasattr(exit_dt, "to_pydatetime") else exit_dt

                trade_num = len(trades) + 1
                trade_record = {
                    "trade_num": trade_num,
                    "symbol": symbol,
                    "asset_name": (
                        "Gold (XAU/USD)" if ("XAU" in symbol or "PAXG" in symbol)
                        else ("US30 (Dow Jones)" if ("US30" in symbol or "DJI" in symbol or "YM" in symbol)
                              else ("Ethereum (ETH/USD)" if "ETH" in symbol else "Bitcoin (BTC/USDT)"))
                    ),
                    "timeframe": "15m",
                    "trade_type": pos["type"],
                    "direction": pos["direction"],
                    "entry_time": str(pos["entry_time"]),
                    "entry_price": round(float(pos["entry_price"]), 2),
                    "exit_time": str(closed["exit_time"]),
                    "exit_price": round(float(closed["exit_price"]), 2),
                    "stop_loss": round(float(pos["stop_loss"]), 2),
                    "take_profit": round(float(pos["take_profit"]), 2),
                    "risk_distance": round(float(pos["risk_distance"]), 2),
                    "rr_ratio": "1:2",
                    "result": outcome,
                    "pnl_percent": round(pnl_percent, 1),
                    "pnl_dollar": round(pnl_dollars, 2),
                    "running_balance": round(balance, 2),
                    "session_name": get_session_name(entry_dt_utc),
                    "entry_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                    "exit_time_ist": exit_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                    "duration_hours": dur_hours,
                    "setup_reason": f"Chain-of-CHoCH: {pos['type']} ({pos['direction']}) -> 15M FVG Retrace Touch [SL: C1 Extreme]",
                    "sh_idx": pos["sh_idx"],
                    "sh_price": pos["sh_price"],
                    "idm_idx": pos["idm_idx"],
                    "idm_price": pos["idm_price"],
                    "bos_idx": pos["bos_idx"],
                    "bos_price": pos["bos_price"],
                    "bos_level": pos["bos_level"],
                    "idm_level": pos["idm_level"],
                    "choch_idx": pos.get("choch_idx", pos["sh_idx"]),
                    "choch_price": pos.get("choch_price", pos["bos_level"]),
                    "choch_break_idx": pos.get("choch_break_idx", pos["c2_idx"]),
                    "c1_idx": pos["c1_idx"],
                    "c2_idx": pos["c2_idx"],
                    "c3_idx": pos["c3_idx"],
                    "fvg_top": round(float(pos["fvg_top"]), 2),
                    "fvg_bottom": round(float(pos["fvg_bottom"]), 2),
                    "entry_idx": pos["entry_idx"],
                    "exit_idx": i,
                    "angle": round(float(pos.get("angle", 0.0)), 1),
                }
                trades.append(trade_record)

                if capture_windows:
                    w_start = max(
                        0,
                        min(
                            pos["sh_idx"],
                            pos["idm_idx"],
                            pos["bos_idx"],
                            pos.get("choch_idx", pos["sh_idx"]),
                            pos.get("choch_break_idx", pos["c2_idx"]),
                            pos["c1_idx"],
                        ) - 12,
                    )
                    w_end = min(len(df), i + 12)
                    window_df = df.iloc[w_start:w_end]
                    candles_list = [
                        [
                            str(row["timestamp"]),
                            round(float(row["open"]), 2),
                            round(float(row["high"]), 2),
                            round(float(row["low"]), 2),
                            round(float(row["close"]), 2),
                        ]
                        for _, row in window_df.iterrows()
                    ]
                    trade_key = f"{symbol}_{trade_num}"
                    trade_candles_dict[trade_key] = {
                        "window_start_global": w_start,
                        "window_end_global": w_end,
                        "local_sh_idx": pos["sh_idx"] - w_start,
                        "local_idm_idx": pos["idm_idx"] - w_start,
                        "local_sweep_idx": pos.get("sweep_idx", pos["idm_idx"]) - w_start,
                        "local_bos_idx": pos["bos_idx"] - w_start,
                        "local_choch_idx": pos.get("choch_idx", pos["sh_idx"]) - w_start,
                        "local_choch_break_idx": pos.get("choch_break_idx", pos["c2_idx"]) - w_start,
                        "local_c1_idx": pos["c1_idx"] - w_start,
                        "local_c2_idx": pos["c2_idx"] - w_start,
                        "local_c3_idx": pos["c3_idx"] - w_start,
                        "local_entry_idx": pos["entry_idx"] - w_start,
                        "local_exit_idx": i - w_start,
                        "sh_price": pos["sh_price"],
                        "idm_price": pos["idm_price"],
                        "sweep_price": pos.get("sweep_price", pos["idm_price"]),
                        "bos_price": pos["bos_price"],
                        "bos_level": pos["bos_level"],
                        "idm_level": pos["idm_level"],
                        "choch_price": pos.get("choch_price", pos["bos_level"]),
                        "trade_type": pos["type"],
                        "fvg_top": round(float(pos["fvg_top"]), 2),
                        "fvg_bottom": round(float(pos["fvg_bottom"]), 2),
                        "entry_price": round(float(pos["entry_price"]), 2),
                        "stop_loss": round(float(pos["stop_loss"]), 2),
                        "take_profit": round(float(pos["take_profit"]), 2),
                        "exit_price": round(float(closed["exit_price"]), 2),
                        "direction": pos["direction"],
                        "result": outcome,
                        "angle": round(float(pos.get("angle", 0.0)), 1),
                        "candles": candles_list,
                    }

        return trades, trade_candles_dict, balance, state
