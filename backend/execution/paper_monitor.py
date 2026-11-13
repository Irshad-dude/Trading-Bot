from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from backend.config import PAPER_TRADING_ONLY, RISK_PERCENT
from backend.journal.store import JournalStore
from backend.strategy.coordinator import StrategySignal


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PaperTradeMonitor:
    """
    Live Paper Trading Engine & Lifecycle Monitor.
    Strictly enforces `PAPER_TRADING_ONLY` safety lock (zero real broker orders).
    Persists open/closed paper trades and account balance to SQLite via `JournalStore`.
    Monitors active trades continuously on live Bid/Ask ticks and closed 15M candle extremes
    using the exact same exit ordering (SL checked before TP) as historical backtesting.
    """

    def __init__(
        self,
        store: Optional[JournalStore] = None,
        initial_balance: float = 10000.0,
        risk_percent: float = RISK_PERCENT,
    ) -> None:
        self.store = store or JournalStore()
        self.initial_balance = float(initial_balance)
        self.risk_percent = float(risk_percent)
        self.balance = self._restore_balance()
        self.open_trades: List[Dict[str, Any]] = self.store.get_open_paper_trades()

    def _restore_balance(self) -> float:
        saved = self.store.load_state("paper_account")
        if saved and "balance" in saved:
            return float(saved["balance"])
        self.store.save_state(
            "paper_account",
            {
                "initial_balance": self.initial_balance,
                "balance": self.initial_balance,
                "paper_trading_only": PAPER_TRADING_ONLY,
            },
        )
        return self.initial_balance

    def _save_balance(self) -> None:
        self.store.save_state(
            "paper_account",
            {
                "initial_balance": self.initial_balance,
                "balance": round(self.balance, 4),
                "paper_trading_only": PAPER_TRADING_ONLY,
            },
        )

    def has_open_trade(self, symbol: str, strategy_name: Optional[str] = None) -> bool:
        sym = symbol.upper()
        for t in self.open_trades:
            if t["symbol"] == sym and t["status"] == "OPEN":
                if strategy_name is None or t["strategy_name"] == strategy_name:
                    return True
        return False

    def process_signal(
        self,
        signal: StrategySignal,
        live_ticker: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Records a signal (valid or rejected) and, if `ENTRY_TRIGGERED`, opens a paper trade
        strictly without real broker execution, enforcing duplicate-signal and duplicate-trade guards.
        """
        sig_dict = signal.to_dict()
        inserted = self.store.save_signal(sig_dict)
        if not inserted:
            logger.debug(f"[PaperMonitor] Duplicate signal suppressed: {signal.signal_id}")
            return None

        if signal.setup_status != "ENTRY_TRIGGERED":
            return None

        if self.store.has_trade_for_signal(signal.signal_id):
            logger.debug(f"[PaperMonitor] Trade already exists for signal {signal.signal_id}")
            return None

        if self.has_open_trade(signal.symbol, signal.strategy_name):
            reason = (
                f"Duplicate trade prevented: active paper trade already open for "
                f"{signal.symbol} ({signal.strategy_name})."
            )
            logger.info(f"[PaperMonitor] {reason}")
            self.store.log_event("DUPLICATE_TRADE_PREVENTED", reason, symbol=signal.symbol)
            return None

        entry = float(signal.entry_price)
        sl = float(signal.stop_loss)
        tp = float(signal.take_profit)
        risk_dist = abs(entry - sl)
        if entry <= 0 or risk_dist <= 1e-9:
            logger.warning(f"[PaperMonitor] Invalid risk geometry for {signal.signal_id}: entry={entry}, sl={sl}")
            return None

        risk_amount = round(self.balance * (self.risk_percent / 100.0), 2)
        position_size = risk_amount / risk_dist

        init_price = entry
        if live_ticker and live_ticker.get("connected"):
            if signal.direction == "LONG" and live_ticker.get("bid"):
                init_price = float(live_ticker["bid"])
            elif signal.direction == "SHORT" and live_ticker.get("ask"):
                init_price = float(live_ticker["ask"])

        trade = {
            "trade_id": f"PT-{uuid.uuid4().hex[:10].upper()}",
            "signal_id": signal.signal_id,
            "strategy_name": signal.strategy_name,
            "symbol": signal.symbol,
            "timeframe": signal.timeframe,
            "direction": signal.direction,
            "action_label": signal.action_label,
            "market_trend": signal.market_trend,
            "entry_price": round(entry, 5),
            "stop_loss": round(sl, 5),
            "take_profit": round(tp, 5),
            "risk_distance": round(risk_dist, 5),
            "risk_amount": risk_amount,
            "position_size": round(position_size, 6),
            "current_price": round(init_price, 5),
            "unrealized_pnl": 0.0,
            "unrealized_r": 0.0,
            "realized_pnl": 0.0,
            "mfe": 0.0,
            "mae": 0.0,
            "max_favorable_price": round(entry, 5),
            "max_adverse_price": round(entry, 5),
            "status": "OPEN",
            "lifecycle_stage": "ENTRY_TRIGGERED",
            "exit_condition": None,
            "exit_price": None,
            "final_result": None,
            "idm_level": signal.idm_level,
            "bos_level": signal.bos_level,
            "choch_info": signal.choch_info,
            "fvg_top": signal.fvg_top,
            "fvg_bottom": signal.fvg_bottom,
            "spread_at_signal": signal.spread_at_signal,
            "ai_decision": signal.ai_decision,
            "ai_confidence": signal.ai_confidence,
            "ai_reasoning": signal.ai_reasoning,
            "reasoning": signal.reasoning,
            "paper_trading_only": True,
            "opened_at": _utc_now(),
            "signal_timestamp": signal.signal_timestamp,
            "closed_at": None,
        }

        self._apply_mark_to_market(trade, init_price)
        self.open_trades.append(trade)
        self.store.upsert_paper_trade(trade)
        self.store.log_event(
            "PAPER_TRADE_OPENED",
            f"Opened PAPER {trade['direction']} on {trade['symbol']} ({trade['strategy_name']}) @ {entry}",
            symbol=trade["symbol"],
            payload=trade,
        )
        logger.success(
            f"[PaperMonitor] PAPER {trade['action_label']} {trade['symbol']} "
            f"[{trade['strategy_name']}] Entry={entry} SL={sl} TP={tp} Risk=${risk_amount}"
        )
        return trade

    def _apply_mark_to_market(self, trade: Dict[str, Any], mark_price: float) -> None:
        if mark_price <= 0:
            return
        entry = float(trade["entry_price"])
        size = float(trade["position_size"])
        risk_amt = float(trade["risk_amount"]) or 1.0
        direction = trade["direction"]

        if direction == "LONG":
            pnl = (mark_price - entry) * size
            if mark_price > float(trade["max_favorable_price"]):
                trade["max_favorable_price"] = round(mark_price, 5)
            if mark_price < float(trade["max_adverse_price"]):
                trade["max_adverse_price"] = round(mark_price, 5)
            mfe_usd = max(0.0, (float(trade["max_favorable_price"]) - entry) * size)
            mae_usd = min(0.0, (float(trade["max_adverse_price"]) - entry) * size)
        else:
            pnl = (entry - mark_price) * size
            if mark_price < float(trade["max_favorable_price"]):
                trade["max_favorable_price"] = round(mark_price, 5)
            if mark_price > float(trade["max_adverse_price"]):
                trade["max_adverse_price"] = round(mark_price, 5)
            mfe_usd = max(0.0, (entry - float(trade["max_favorable_price"])) * size)
            mae_usd = min(0.0, (entry - float(trade["max_adverse_price"])) * size)

        trade["current_price"] = round(mark_price, 5)
        trade["unrealized_pnl"] = round(pnl, 2)
        trade["unrealized_r"] = round(pnl / risk_amt, 2)
        trade["mfe"] = round(max(float(trade.get("mfe", 0.0)), mfe_usd), 2)
        trade["mae"] = round(min(float(trade.get("mae", 0.0)), mae_usd), 2)

    def _close_trade(
        self,
        trade: Dict[str, Any],
        exit_price: float,
        exit_condition: str,
        closed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        entry = float(trade["entry_price"])
        size = float(trade["position_size"])
        if trade["direction"] == "LONG":
            pnl = (exit_price - entry) * size
        else:
            pnl = (entry - exit_price) * size

        result = "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "BREAKEVEN")
        self.balance = round(self.balance + pnl, 2)
        self._save_balance()

        trade["current_price"] = round(exit_price, 5)
        trade["exit_price"] = round(exit_price, 5)
        trade["exit_condition"] = exit_condition
        trade["final_result"] = result
        trade["realized_pnl"] = round(pnl, 2)
        trade["unrealized_pnl"] = 0.0
        trade["status"] = "CLOSED"
        trade["lifecycle_stage"] = "CLOSED"
        trade["closed_at"] = closed_at or _utc_now()
        self.store.upsert_paper_trade(trade)
        self.store.log_event(
            "PAPER_TRADE_CLOSED",
            f"Closed PAPER {trade['direction']} {trade['symbol']} ({exit_condition}) -> {result} (${pnl:+.2f})",
            symbol=trade["symbol"],
            payload=trade,
        )
        logger.info(
            f"[PaperMonitor] CLOSED {trade['symbol']} [{trade['strategy_name']}] "
            f"{exit_condition} @ {exit_price} -> {result} (${pnl:+.2f})"
        )
        return trade

    def update_with_live_ticker(
        self, symbol: str, ticker: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Updates MTM, MFE/MAE, and checks SL/TP triggers using live Bid (LONG) / Ask (SHORT)."""
        sym = symbol.upper()
        if not ticker or not ticker.get("connected"):
            return []

        bid = float(ticker.get("bid") or ticker.get("last") or 0.0)
        ask = float(ticker.get("ask") or ticker.get("last") or 0.0)
        closed_now: List[Dict[str, Any]] = []
        still_open: List[Dict[str, Any]] = []

        for trade in self.open_trades:
            if trade["symbol"] != sym or trade["status"] != "OPEN":
                still_open.append(trade)
                continue

            sl = float(trade["stop_loss"])
            tp = float(trade["take_profit"])
            if trade["direction"] == "LONG":
                mark = bid
                self._apply_mark_to_market(trade, mark)
                if mark > 0 and mark <= sl:
                    closed_now.append(self._close_trade(trade, sl, "SL_HIT"))
                    continue
                if mark > 0 and mark >= tp:
                    closed_now.append(self._close_trade(trade, tp, "TP_HIT"))
                    continue
            else:
                mark = ask
                self._apply_mark_to_market(trade, mark)
                if mark > 0 and mark >= sl:
                    closed_now.append(self._close_trade(trade, sl, "SL_HIT"))
                    continue
                if mark > 0 and mark <= tp:
                    closed_now.append(self._close_trade(trade, tp, "TP_HIT"))
                    continue

            self.store.upsert_paper_trade(trade)
            still_open.append(trade)

        self.open_trades = still_open
        return closed_now

    def update_with_closed_bar(
        self,
        symbol: str,
        bar_high: float,
        bar_low: float,
        bar_ts: str,
    ) -> List[Dict[str, Any]]:
        """
        Checks newly closed 15M bar High/Low against open paper trades using exact backtest
        exit precedence (SL checked BEFORE TP). Only applies to bars strictly after trade signal_timestamp.
        """
        sym = symbol.upper()
        closed_now: List[Dict[str, Any]] = []
        still_open: List[Dict[str, Any]] = []

        for trade in self.open_trades:
            if trade["symbol"] != sym or trade["status"] != "OPEN":
                still_open.append(trade)
                continue

            sig_ts = trade.get("signal_timestamp", "")
            if sig_ts and bar_ts <= sig_ts:
                still_open.append(trade)
                continue

            sl = float(trade["stop_loss"])
            tp = float(trade["take_profit"])

            # Update MFE/MAE from bar extremes cleanly
            if trade["direction"] == "LONG":
                self._apply_mark_to_market(trade, bar_high)
                self._apply_mark_to_market(trade, bar_low)
                if bar_low <= sl:
                    closed_now.append(self._close_trade(trade, sl, "SL_HIT", closed_at=bar_ts))
                    continue
                if bar_high >= tp:
                    closed_now.append(self._close_trade(trade, tp, "TP_HIT", closed_at=bar_ts))
                    continue
            else:
                self._apply_mark_to_market(trade, bar_low)
                self._apply_mark_to_market(trade, bar_high)
                if bar_high >= sl:
                    closed_now.append(self._close_trade(trade, sl, "SL_HIT", closed_at=bar_ts))
                    continue
                if bar_low <= tp:
                    closed_now.append(self._close_trade(trade, tp, "TP_HIT", closed_at=bar_ts))
                    continue

            self.store.upsert_paper_trade(trade)
            still_open.append(trade)

        self.open_trades = still_open
        return closed_now

    def close_manual(self, trade_id: str, exit_price: Optional[float] = None) -> Optional[Dict[str, Any]]:
        for idx, trade in enumerate(self.open_trades):
            if trade["trade_id"] == trade_id and trade["status"] == "OPEN":
                px = float(exit_price or trade["current_price"] or trade["entry_price"])
                closed = self._close_trade(trade, px, "MANUAL_CLOSE")
                self.open_trades.pop(idx)
                return closed
        return None

    def get_summary(self) -> Dict[str, Any]:
        closed = self.store.get_closed_paper_trades(limit=200)
        total_unrealized = round(sum(float(t.get("unrealized_pnl", 0.0)) for t in self.open_trades), 2)
        total_realized = round(sum(float(t.get("realized_pnl", 0.0)) for t in closed), 2)
        wins = sum(1 for t in closed if t.get("final_result") == "WIN")
        losses = sum(1 for t in closed if t.get("final_result") == "LOSS")
        total = len(closed)
        return {
            "paper_trading_only": PAPER_TRADING_ONLY,
            "initial_balance": self.initial_balance,
            "balance": round(self.balance, 2),
            "equity": round(self.balance + total_unrealized, 2),
            "total_unrealized_pnl": total_unrealized,
            "total_realized_pnl": total_realized,
            "open_count": len(self.open_trades),
            "closed_count": total,
            "wins": wins,
            "losses": losses,
            "win_rate": round((wins / total) * 100.0, 2) if total > 0 else 0.0,
        }
