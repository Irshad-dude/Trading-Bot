from __future__ import annotations

import hashlib
import os
from dataclasses import asdict, dataclass, field

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from backend.strategy.chain_of_choch import (
    ChainOfChochEngine,
    ChainState,
    default_min_angle_for_symbol,
)
from backend.strategy.smc import SMCEngine


def _to_iso_utc(ts: Any) -> str:
    if ts is None:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(ts, pd.Timestamp):
        if ts.tzinfo is None:
            ts = ts.tz_localize("UTC")
        else:
            ts = ts.tz_convert("UTC")
        return ts.isoformat()
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        else:
            ts = ts.astimezone(timezone.utc)
        return ts.isoformat()
    return str(ts)


def build_signal_id(strategy_name: str, symbol: str, direction: str, candle_ts: str) -> str:
    raw = f"{strategy_name}|{symbol.upper()}|{direction.upper()}|{candle_ts}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"{strategy_name[:3]}_{symbol.upper()}_{digest}"


@dataclass
class StrategySignal:
    signal_id: str
    strategy_name: str  # "SMC_4H_15M" or "CHAIN_OF_CHOCH_15M"
    symbol: str
    timeframe: str
    market_trend: str
    direction: str  # "LONG" or "SHORT"
    action_label: str  # "BUY" or "SELL"
    structural_levels: Dict[str, Any] = field(default_factory=dict)
    idm_level: Optional[float] = None
    bos_level: Optional[float] = None
    bos_confirmed: bool = False
    choch_info: Optional[Dict[str, Any]] = None
    fvg_top: Optional[float] = None
    fvg_bottom: Optional[float] = None
    entry_price: float = 0.0
    entry_zone: Dict[str, Any] = field(default_factory=dict)
    stop_loss: float = 0.0
    take_profit: float = 0.0
    risk_reward_ratio: float = 2.0
    signal_timestamp: str = ""
    setup_status: str = "ENTRY_TRIGGERED"  # ENTRY_TRIGGERED, WAITING_CONFIRMATION, SETUP_DETECTED, REJECTED
    reasoning: str = ""
    rejection_reason: Optional[str] = None
    spread_at_signal: float = 0.0
    ai_decision: Optional[str] = None
    ai_confidence: Optional[int] = None
    ai_reasoning: Optional[str] = None
    matched_clusters: List[str] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _normalize_ts_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    out["timestamp"] = pd.to_datetime(out["timestamp"], utc=True)
    out = (
        out.sort_values("timestamp")
        .drop_duplicates(subset=["timestamp"])
        .reset_index(drop=True)
    )
    return out


def run_smc_backtest_dataframe(
    smc_engine: SMCEngine,
    symbol: str,
    df_4h_raw: pd.DataFrame,
    df_15m_raw: pd.DataFrame,
    min_15m_bars: int = 40,
    min_4h_bars: int = 25,
    initial_balance: float = 10000.0,
    risk_pct: float = 0.01,
) -> Tuple[List[Dict[str, Any]], float]:
    """
    Causal bar-by-bar historical replay of SMCEngine.scan_for_setups().

    Only closed 4H candles whose close time (start + 4h) <= current 15M candle
    close time (start + 15m) are visible at each 15M step so there is zero
    future lookahead. Uses the exact same exit ordering (SL checked first, then TP).
    """
    df_4h = _normalize_ts_df(df_4h_raw)
    df_15m = _normalize_ts_df(df_15m_raw)

    if df_4h.empty or len(df_15m) < min_15m_bars:
        return [], initial_balance

    balance = initial_balance
    trades: List[Dict[str, Any]] = []
    active_pos: Optional[Dict[str, Any]] = None

    four_h_close_times = df_4h["timestamp"] + pd.Timedelta(hours=4)

    for i in range(min_15m_bars - 1, len(df_15m)):
        bar = df_15m.iloc[i]
        bar_ts = bar["timestamp"]
        bar_close_ts = bar_ts + pd.Timedelta(minutes=15)

        if active_pos is not None:
            sl = active_pos["stop_loss"]
            tp = active_pos["take_profit"]
            direction = active_pos["direction"]
            high = float(bar["high"])
            low = float(bar["low"])
            outcome = None
            exit_price = None
            exit_condition = None

            if direction == "LONG":
                if low <= sl:
                    outcome = "LOSS"
                    exit_price = sl
                    exit_condition = "SL_HIT"
                elif high >= tp:
                    outcome = "WIN"
                    exit_price = tp
                    exit_condition = "TP_HIT"
            else:
                if high >= sl:
                    outcome = "LOSS"
                    exit_price = sl
                    exit_condition = "SL_HIT"
                elif low <= tp:
                    outcome = "WIN"
                    exit_price = tp
                    exit_condition = "TP_HIT"

            if outcome is not None:
                pnl = active_pos["risk_amount"] * (2.0 if outcome == "WIN" else -1.0)
                balance += pnl
                closed = {
                    **active_pos,
                    "exit_idx": i,
                    "exit_time": _to_iso_utc(bar_ts),
                    "exit_price": round(float(exit_price), 5),
                    "exit_condition": exit_condition,
                    "outcome": outcome,
                    "pnl": round(float(pnl), 2),
                    "balance": round(float(balance), 2),
                }
                trades.append(closed)
                active_pos = None
                continue

        if active_pos is not None:
            continue

        df_4h_slice = df_4h.loc[four_h_close_times <= bar_close_ts]
        if len(df_4h_slice) < min_4h_bars:
            continue

        df_15m_slice = df_15m.iloc[: i + 1]
        setup = smc_engine.scan_for_setups(symbol, df_4h_slice, df_15m_slice)
        if setup:
            risk_amount = balance * risk_pct
            active_pos = {
                "strategy_name": "SMC_4H_15M",
                "symbol": symbol,
                "direction": setup["direction"],
                "entry_idx": i,
                "entry_time": _to_iso_utc(bar_ts),
                "entry_price": float(setup["entry_price"]),
                "stop_loss": float(setup["stop_loss"]),
                "take_profit": float(setup["take_profit"]),
                "risk_amount": float(risk_amount),
                "idm_level": setup.get("idm_level"),
                "bos_level": setup.get("bos_level"),
                "fvg_zone": setup.get("fvg_zone"),
                "macro_trend": setup.get("macro_trend"),
                "setup_reason": setup.get("setup_reason", ""),
            }

    return trades, balance


class UnifiedStrategyCoordinator:
    """
    Single source of truth coordinator running BOTH user strategies on closed candles:
      1. SMCEngine (4H macro trend + 15M IDM/BOS/FVG + Confirmation Candle + <= 3*ATR)
      2. ChainOfChochEngine (Pure 15M p=4 + ATR-angle + BOS/CHoCH + B+1 FVG touch)

    Guarantees identical strategy decisions across historical replay and live closed bars.
    """

    def __init__(self) -> None:
        self.smc = SMCEngine()
        self.chain = ChainOfChochEngine()
        self.chain_states: Dict[str, ChainState] = {}
        self._chain_dfs: Dict[str, pd.DataFrame] = {}
        self._chain_swings: Dict[str, Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]] = {}
        self.last_smc_candle_ts: Dict[str, str] = {}
        self.last_smc_diagnostics: Dict[str, Dict[str, Any]] = {}
        self.last_chain_diagnostics: Dict[str, Dict[str, Any]] = {}

    def export_states(self) -> Dict[str, Any]:
        return {
            "chain_states": {sym: st.to_dict() for sym, st in self.chain_states.items()},
            "last_smc_candle_ts": dict(self.last_smc_candle_ts),
        }

    def restore_states(self, saved: Optional[Dict[str, Any]]) -> None:
        if not saved:
            return
        raw_chain = saved.get("chain_states", {})
        for sym, state_dict in raw_chain.items():
            try:
                self.chain_states[sym] = ChainState.from_dict(state_dict)
            except Exception:
                continue
        raw_smc = saved.get("last_smc_candle_ts", {})
        if isinstance(raw_smc, dict):
            self.last_smc_candle_ts.update({str(k): str(v) for k, v in raw_smc.items()})

    def _get_or_init_chain_state(self, symbol: str) -> ChainState:
        sym = symbol.upper()
        if sym not in self.chain_states:
            self.chain_states[sym] = ChainState(symbol=sym)
        return self.chain_states[sym]

    def _replay_chain_context(
        self,
        symbol: str,
        df_15m_closed: pd.DataFrame,
        allow_live_entries_on_new_bars: bool = True,
    ) -> Tuple[List[StrategySignal], List[Dict[str, Any]], Dict[str, Any]]:
        """
        Advances ChainOfChochEngine incrementally over closed 15M bars for `symbol`.

        Maintains an append-only cumulative bar buffer `_chain_dfs[sym]` so bar indices
        inside `pending_fvg` / `pending_breakout` / `current_choch` never drift on
        sliding API windows. On cold start or process restart, replays structural state
        causally over history without triggering stale signals on previously processed bars.
        """
        sym = symbol.upper()
        incoming_df = _normalize_ts_df(df_15m_closed)
        signals: List[StrategySignal] = []
        events: List[Dict[str, Any]] = []

        if incoming_df.empty or len(incoming_df) < 10:
            diag = {
                "strategy_name": "CHAIN_OF_CHOCH_15M",
                "symbol": sym,
                "timeframe": "15M",
                "trend": "UNKNOWN",
                "stage": "WARMUP",
                "stage_status": "WAITING",
                "reason": f"Need at least 10 closed 15M bars for Chain of CHoCH (got {len(incoming_df)}).",
                "pending_fvg": None,
                "pending_breakout": None,
                "current_choch": None,
                "last_angle": None,
            }
            self.last_chain_diagnostics[sym] = diag
            return signals, events, diag

        state = self._get_or_init_chain_state(sym)
        min_angle = default_min_angle_for_symbol(sym)
        pivot_n = self.chain.pivot_length

        existing_df = self._chain_dfs.get(sym)
        if existing_df is None or existing_df.empty:
            # Cold start or post-restart boot: prepare incoming window and replay context causally
            df = self.chain.prepare_dataframe(incoming_df)
            self._chain_dfs[sym] = df
            swing_highs, swing_lows = self.chain.detect_causal_swings(df, pivot_n * 2)
            self._chain_swings[sym] = (swing_highs, swing_lows)

            saved_last_ts: Optional[pd.Timestamp] = None
            if state.last_processed_ts:
                saved_last_ts = pd.Timestamp(state.last_processed_ts)
                if saved_last_ts.tzinfo is None:
                    saved_last_ts = saved_last_ts.tz_localize("UTC")
                else:
                    saved_last_ts = saved_last_ts.tz_convert("UTC")

            # Rebuild exact structural state cleanly over the window
            state = ChainState(symbol=sym)
            self.chain_states[sym] = state

            for idx in range(len(df)):
                if idx > pivot_n * 2:
                    self.chain.update_causal_swings_at_bar(df, idx, swing_highs, swing_lows)
                bar_ts = df.iloc[idx]["timestamp"]
                if idx < 8:
                    state.last_processed_ts = _to_iso_utc(bar_ts)
                    continue

                if saved_last_ts is not None:
                    is_live_bar = bar_ts > saved_last_ts
                else:
                    is_live_bar = idx == (len(df) - 1)

                allow_entries = allow_live_entries_on_new_bars and is_live_bar
                step_res = self.chain.step_bar(
                    df,
                    idx,
                    state,
                    swing_highs,
                    swing_lows,
                    min_trend_angle=min_angle,
                    allow_entries=allow_entries,
                )
                if is_live_bar:
                    self._collect_chain_step_outputs(
                        sym, df, idx, state, step_res, signals, events
                    )
        else:
            last_existing_ts = existing_df.iloc[-1]["timestamp"]
            new_rows = incoming_df.loc[incoming_df["timestamp"] > last_existing_ts]
            if new_rows.empty:
                diag = self._build_chain_diagnostic(sym, existing_df, state)
                self.last_chain_diagnostics[sym] = diag
                return signals, events, diag

            prev_len = len(existing_df)
            combined_raw = pd.concat([existing_df[["timestamp", "open", "high", "low", "close", "volume"]], new_rows[["timestamp", "open", "high", "low", "close", "volume"]]], ignore_index=True)
            df = self.chain.prepare_dataframe(combined_raw)
            self._chain_dfs[sym] = df

            swing_highs, swing_lows = self._chain_swings.get(sym, ([], []))
            for idx in range(prev_len, len(df)):
                self.chain.update_causal_swings_at_bar(df, idx, swing_highs, swing_lows)
                if idx < 8:
                    state.last_processed_ts = _to_iso_utc(df.iloc[idx]["timestamp"])
                    continue
                step_res = self.chain.step_bar(
                    df,
                    idx,
                    state,
                    swing_highs,
                    swing_lows,
                    min_trend_angle=min_angle,
                    allow_entries=allow_live_entries_on_new_bars,
                )
                self._collect_chain_step_outputs(
                    sym, df, idx, state, step_res, signals, events
                )
            self._chain_swings[sym] = (swing_highs, swing_lows)

        diag = self._build_chain_diagnostic(sym, df, state)
        self.last_chain_diagnostics[sym] = diag
        return signals, events, diag

    def _collect_chain_step_outputs(
        self,
        sym: str,
        df: pd.DataFrame,
        idx: int,
        state: ChainState,
        step_res: Dict[str, Any],
        signals: List[StrategySignal],
        events: List[Dict[str, Any]],
    ) -> None:
        bar_ts = _to_iso_utc(df.iloc[idx]["timestamp"])
        if step_res.get("breakout_event"):
            events.append({"type": "BREAKOUT", "symbol": sym, **step_res["breakout_event"]})
        if step_res.get("new_fvg"):
            events.append({"type": "NEW_FVG", "symbol": sym, **step_res["new_fvg"]})
        if step_res.get("invalidated_reason"):
            events.append(
                {
                    "type": "INVALIDATED",
                    "symbol": sym,
                    "reason": step_res["invalidated_reason"],
                    "timestamp": bar_ts,
                }
            )
            # Emit a structured rejection signal record so dashboard shows strategy rejection reasons
            rej_sig = StrategySignal(
                signal_id=build_signal_id("CHAIN_REJ", sym, state.trend, bar_ts),
                strategy_name="CHAIN_OF_CHOCH_15M",
                symbol=sym,
                timeframe="15M",
                market_trend=state.trend,
                direction="LONG" if state.trend == "BULLISH" else "SHORT",
                action_label="BUY" if state.trend == "BULLISH" else "SELL",
                structural_levels={
                    "choch_price": state.last_choch_level,
                    "bos_level": state.last_bos_level,
                    "idm_level": state.last_idm_level,
                    "angle": state.last_angle,
                },
                idm_level=state.last_idm_level,
                bos_level=state.last_bos_level,
                bos_confirmed=False,
                choch_info=(
                    {
                        "choch_price": state.current_choch.get("price"),
                        "angle": state.last_angle,
                    }
                    if state.current_choch
                    else None
                ),
                signal_timestamp=bar_ts,
                setup_status="REJECTED",
                reasoning=f"Candidate Chain of CHoCH setup rejected: {step_res['invalidated_reason']}",
                rejection_reason=step_res["invalidated_reason"],
            )
            signals.append(rej_sig)

        trig = step_res.get("triggered_signal")
        if trig:
            direction = trig["direction"]
            action_label = "BUY" if direction == "LONG" else "SELL"
            btype = trig.get("type", "BOS")
            fvg_top = float(trig["fvg_top"])
            fvg_bottom = float(trig["fvg_bottom"])
            entry = float(trig["entry_price"])
            sl = float(trig["stop_loss"])
            tp = float(trig["take_profit"])
            angle = float(trig.get("angle", 0.0))
            candle_ts = _to_iso_utc(trig.get("entry_time") or bar_ts)

            reason = (
                f"[{sym} 15M Chain-of-CHoCH] {trig['type']} {direction} confirmed: "
                f"Impulse angle {angle:.1f}° >= min threshold, "
                f"3-candle B+1 FVG [{fvg_bottom:.2f} - {fvg_top:.2f}] formed after breakout "
                f"({float(trig.get('bos_price', 0)):.2f}), retraced & touched at {entry:.2f} "
                f"without invalidating C1 extreme ({sl:.2f}). TP set at 1:2 RR ({tp:.2f})."
            )
            sig = StrategySignal(
                signal_id=build_signal_id("CHAIN_OF_CHOCH_15M", sym, direction, candle_ts),
                strategy_name="CHAIN_OF_CHOCH_15M",
                symbol=sym,
                timeframe="15M",
                market_trend=state.trend,
                direction=direction,
                action_label=action_label,
                structural_levels={
                    "bos_price": trig.get("bos_price"),
                    "choch_price": trig.get("choch_price"),
                    "idm_price": trig.get("idm_price"),
                    "c1_extreme": sl,
                    "impulse_angle": angle,
                },
                idm_level=trig.get("idm_price"),
                bos_level=trig.get("bos_price"),
                bos_confirmed=True,
                choch_info={
                    "type": btype,
                    "choch_price": trig.get("choch_price"),
                    "angle": angle,
                },
                fvg_top=fvg_top,
                fvg_bottom=fvg_bottom,
                entry_price=entry,
                entry_zone={"top": fvg_top, "bottom": fvg_bottom},
                stop_loss=sl,
                take_profit=tp,
                risk_reward_ratio=2.0,
                signal_timestamp=candle_ts,
                setup_status="ENTRY_TRIGGERED",
                reasoning=reason,
                rejection_reason=None,
                extra={
                    "c1_idx": trig.get("c1_idx"),
                    "c2_idx": trig.get("c2_idx"),
                    "c3_idx": trig.get("c3_idx"),
                    "bos_idx": trig.get("bos_idx"),
                    "entry_idx": trig.get("entry_idx"),
                    "risk_distance": trig.get("risk_distance"),
                },
            )
            signals.append(sig)

    def _build_chain_diagnostic(
        self, sym: str, df: pd.DataFrame, state: ChainState
    ) -> Dict[str, Any]:
        last_close = float(df.iloc[-1]["close"]) if not df.empty else 0.0
        last_ts = _to_iso_utc(df.iloc[-1]["timestamp"]) if not df.empty else None
        reason = state.last_rejection_reason or (
            f"15M Trend={state.trend}, Stage={state.last_stage} ({state.last_stage_status})"
        )

        pf_summary = None
        if state.pending_fvg:
            pf = state.pending_fvg
            pf_dir = pf.get("direction", "LONG")
            pf_top = pf.get("fvg_top") if pf.get("fvg_top") is not None else pf.get("top")
            pf_bot = pf.get("fvg_bottom") if pf.get("fvg_bottom") is not None else pf.get("bottom")
            sl_val = pf.get("stop_loss")
            tp_val = pf.get("take_profit")
            if sl_val is None and pf_top is not None and pf_bot is not None:
                if pf_dir == "LONG" and pf.get("c1_low") is not None:
                    sl_val = float(pf["c1_low"])
                    planned_entry = float(pf_top)
                    risk_d = max(0.0, planned_entry - sl_val)
                    tp_val = round(planned_entry + 2.0 * risk_d, 4)
                elif pf_dir == "SHORT" and pf.get("c1_high") is not None:
                    sl_val = float(pf["c1_high"])
                    planned_entry = float(pf_bot)
                    risk_d = max(0.0, sl_val - planned_entry)
                    tp_val = round(planned_entry - 2.0 * risk_d, 4)

            pf_summary = {
                "direction": pf_dir,
                "top": float(pf_top) if pf_top is not None else None,
                "bottom": float(pf_bot) if pf_bot is not None else None,
                "stop_loss": round(float(sl_val), 4) if sl_val is not None else None,
                "take_profit": round(float(tp_val), 4) if tp_val is not None else None,
                "angle": pf.get("angle"),
                "type": pf.get("type"),
                "c1_idx": pf.get("c1_idx"),
                "c2_idx": pf.get("c2_idx"),
                "c3_idx": pf.get("c3_idx"),
                "bos_idx": pf.get("bos_idx"),
            }

        return {
            "strategy_name": "CHAIN_OF_CHOCH_15M",
            "symbol": sym,
            "timeframe": "15M",
            "trend": state.trend,
            "stage": state.last_stage,
            "stage_status": state.last_stage_status,
            "current_price": last_close,
            "last_closed_ts": last_ts,
            "idm_level": state.last_idm_level,
            "bos_level": state.last_bos_level,
            "choch_level": (
                state.current_choch.get("price")
                if state.current_choch
                else state.last_choch_level
            ),
            "last_angle": state.last_angle,
            "pending_breakout": (
                {
                    "type": state.pending_breakout.get("type"),
                    "bos_price": state.pending_breakout.get("bos_price"),
                    "angle": state.pending_breakout.get("angle"),
                    "waiting_b1": state.pending_breakout.get("waiting_b1"),
                }
                if state.pending_breakout
                else None
            ),
            "pending_fvg": pf_summary,
            "rejection_reason": state.last_rejection_reason,
            "reason": reason,
        }

    def evaluate_symbol(
        self,
        symbol: str,
        df_4h_closed: Optional[pd.DataFrame] = None,
        df_15m_closed: Optional[pd.DataFrame] = None,
        live_spread: float = 0.0,
        allow_live_entries: bool = True,
        df_htf_closed: Optional[pd.DataFrame] = None,
        df_ltf_closed: Optional[pd.DataFrame] = None,
    ) -> Dict[str, Any]:
        """
        Runs BOTH strategies (SMCEngine + ChainOfChochEngine) strictly on closed candles.
        Never reads incomplete/forming candles.
        Supports customizable testing resolutions (e.g., 30M trend + 1M execution).
        """
        sym = symbol.upper()
        signals: List[StrategySignal] = []

        htf_in = df_htf_closed if df_htf_closed is not None else df_4h_closed
        ltf_in = df_ltf_closed if df_ltf_closed is not None else df_15m_closed

        if htf_in is None or ltf_in is None:
            return {
                "symbol": sym,
                "last_closed_15m_ts": "",
                "smc_analysis": {},
                "chain_analysis": {},
                "signals": [],
                "events": [],
            }

        htf_tf = os.getenv("HTF_TIMEFRAME", "30m").upper()
        ltf_tf = os.getenv("LTF_TIMEFRAME", "1m").upper()
        timeframe_label = f"{htf_tf} + {ltf_tf}"

        df_htf = _normalize_ts_df(htf_in)
        df_ltf = _normalize_ts_df(ltf_in)

        # ── 1. ChainOfChochEngine (Pure LTF execution, p=4) ───────────────
        chain_signals, chain_events, chain_diag = self._replay_chain_context(
            sym, df_ltf, allow_live_entries_on_new_bars=allow_live_entries
        )
        for s in chain_signals:
            s.spread_at_signal = live_spread
            s.timeframe = ltf_tf
        signals.extend(chain_signals)

        # ── 2. SMCEngine (HTF Trend + LTF IDM/BOS/FVG + Confirm Candle) ───
        smc_diag = self.smc.diagnose_setup(sym, df_htf, df_ltf)
        self.last_smc_diagnostics[sym] = smc_diag

        latest_ltf_ts = _to_iso_utc(df_ltf.iloc[-1]["timestamp"]) if not df_ltf.empty else ""
        smc_setup = None
        if (
            allow_live_entries
            and latest_ltf_ts
            and self.last_smc_candle_ts.get(sym) != latest_ltf_ts
            and len(df_htf) >= 15
            and len(df_ltf) >= 15
        ):
            smc_setup = self.smc.scan_for_setups(sym, df_htf, df_ltf)
            self.last_smc_candle_ts[sym] = latest_ltf_ts

            if smc_setup:
                direction = smc_setup["direction"]
                action_label = "BUY" if direction == "LONG" else "SELL"
                fvg_zone = smc_setup.get("fvg_zone") or {}
                fvg_top = fvg_zone.get("top")
                fvg_bottom = fvg_zone.get("bottom")
                confirm = smc_setup.get("confirm_candle") or {}

                sig = StrategySignal(
                    signal_id=build_signal_id(f"SMC_{htf_tf}_{ltf_tf}", sym, direction, latest_ltf_ts),
                    strategy_name=f"SMC_{htf_tf}_{ltf_tf}",
                    symbol=sym,
                    timeframe=timeframe_label,
                    market_trend=smc_setup.get("macro_trend", smc_diag.get("macro_trend", "NEUTRAL")),
                    direction=direction,
                    action_label=action_label,
                    structural_levels={
                        "anchor_price": smc_setup.get("anchor_price"),
                        "idm_level": smc_setup.get("idm_level"),
                        "bos_level": smc_setup.get("bos_level"),
                        "c2_high": smc_setup.get("c2_high"),
                        "c2_low": smc_setup.get("c2_low"),
                        "atr": smc_setup.get("atr"),
                    },
                    idm_level=smc_setup.get("idm_level"),
                    bos_level=smc_setup.get("bos_level"),
                    bos_confirmed=True,
                    choch_info=None,
                    fvg_top=float(fvg_top) if fvg_top is not None else None,
                    fvg_bottom=float(fvg_bottom) if fvg_bottom is not None else None,
                    entry_price=float(smc_setup["entry_price"]),
                    entry_zone={"top": fvg_top, "bottom": fvg_bottom},
                    stop_loss=float(smc_setup["stop_loss"]),
                    take_profit=float(smc_setup["take_profit"]),
                    risk_reward_ratio=float(smc_setup.get("reward_risk_ratio", 2.0)),
                    signal_timestamp=latest_ltf_ts,
                    setup_status="ENTRY_TRIGGERED",
                    reasoning=smc_setup.get("setup_reason", smc_diag.get("reason", "")),
                    rejection_reason=None,
                    spread_at_signal=live_spread,
                    extra={
                        "bos_index": smc_setup.get("bos_index"),
                        "confirm_candle": confirm,
                        "risk_distance": smc_setup.get("risk_distance"),
                        "risk_percentage": smc_setup.get("risk_percentage"),
                    },
                )
                signals.append(sig)
            elif smc_diag.get("stage_status") == "FAILED":
                rej_sig = StrategySignal(
                    signal_id=build_signal_id(
                        "SMC_REJ", sym, smc_diag.get("macro_trend", "NEUTRAL"), latest_ltf_ts
                    ),
                    strategy_name=f"SMC_{htf_tf}_{ltf_tf}",
                    symbol=sym,
                    timeframe=timeframe_label,
                    market_trend=smc_diag.get("macro_trend", "NEUTRAL"),
                    direction="LONG" if smc_diag.get("macro_trend") == "BULLISH" else "SHORT",
                    action_label="BUY" if smc_diag.get("macro_trend") == "BULLISH" else "SELL",
                    structural_levels={
                        "anchor_price": smc_diag.get("anchor_price"),
                        "idm_level": smc_diag.get("idm_level"),
                        "bos_level": smc_diag.get("bos_level"),
                    },
                    idm_level=smc_diag.get("idm_level"),
                    bos_level=smc_diag.get("bos_level"),
                    bos_confirmed=bool(smc_diag.get("bos_level")),
                    fvg_top=(smc_diag.get("fvg_zone") or {}).get("top"),
                    fvg_bottom=(smc_diag.get("fvg_zone") or {}).get("bottom"),
                    signal_timestamp=latest_ltf_ts,
                    setup_status="REJECTED",
                    reasoning=smc_diag.get("reason", "SMC setup validation failed."),
                    rejection_reason=smc_diag.get("reason"),
                    spread_at_signal=live_spread,
                )
                signals.append(rej_sig)

        return {
            "symbol": sym,
            "last_closed_15m_ts": latest_ltf_ts,
            "last_closed_ltf_ts": latest_ltf_ts,
            "smc_analysis": smc_diag,
            "chain_analysis": chain_diag,
            "signals": signals,
            "events": chain_events,
        }

