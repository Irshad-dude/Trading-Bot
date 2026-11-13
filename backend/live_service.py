from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from backend.ai.analyst import AIAnalyst
from backend.config import (
    CONTEXT_15M_LIMIT,
    CONTEXT_4H_LIMIT,
    PAPER_TRADING_ONLY,
    SYMBOLS,
)
from backend.data.fetcher import DataFetcher
from backend.execution.paper_monitor import PaperTradeMonitor
from backend.journal.store import JournalStore
from backend.state import BotState, ScanResult, TradeRecord, bot
from backend.strategy.coordinator import StrategySignal, UnifiedStrategyCoordinator


class LiveMarketService:
    """
    Shared orchestrator connecting live closed market data (`DataFetcher`),
    the exact backtesting-identical strategy engines (`UnifiedStrategyCoordinator`),
    durable persistence (`JournalStore`), live paper monitoring (`PaperTradeMonitor`),
    and Graph RAG + Gemini commentary (`AIAnalyst`).
    """

    def __init__(
        self,
        fetcher: Optional[DataFetcher] = None,
        coordinator: Optional[UnifiedStrategyCoordinator] = None,
        store: Optional[JournalStore] = None,
        paper_monitor: Optional[PaperTradeMonitor] = None,
        analyst: Optional[AIAnalyst] = None,
        bot_state: BotState = bot,
    ) -> None:
        self.store = store or JournalStore()
        self.fetcher = fetcher or DataFetcher()
        self.coordinator = coordinator or UnifiedStrategyCoordinator()
        self.paper_monitor = paper_monitor or PaperTradeMonitor(store=self.store)
        self.analyst = analyst
        self.bot_state = bot_state
        self._last_cycle_snapshot: Dict[str, Any] = {}
        self.restore()

    def _get_analyst(self) -> Optional[AIAnalyst]:
        if self.analyst is None:
            try:
                self.analyst = AIAnalyst()
            except Exception as e:
                logger.warning(f"[LiveMarketService] AIAnalyst unavailable: {e}")
                return None
        return self.analyst

    def restore(self) -> None:
        saved = self.store.load_state("coordinator_state")
        if saved:
            self.coordinator.restore_states(saved)
            self.store.log_event(
                "SYSTEM_RESTORE",
                f"Restored coordinator state & {len(self.paper_monitor.open_trades)} open paper trade(s).",
            )
            self.bot_state.log(
                f"Recovered {len(self.paper_monitor.open_trades)} active paper trade(s) from journal DB."
            )
        self._sync_bot_state_from_store()

    def persist(self) -> None:
        self.store.save_state("coordinator_state", self.coordinator.export_states())

    def _sync_bot_state_from_store(self) -> None:
        summary = self.paper_monitor.get_summary()
        closed_trades = self.store.get_closed_paper_trades(limit=100)
        open_trades = self.paper_monitor.open_trades

        self.bot_state.paper_trading_only = PAPER_TRADING_ONLY
        self.bot_state.total_trades = summary["closed_count"]
        self.bot_state.wins = summary["wins"]
        self.bot_state.losses = summary["losses"]
        self.bot_state.daily_realized_pnl = summary["total_realized_pnl"]

        # Map open paper trades to legacy open_orders format cleanly
        self.bot_state.open_orders = [
            {
                "id": t["trade_id"],
                "symbol": t["symbol"],
                "side": t["action_label"],
                "type": f"PAPER_{t['strategy_name']}",
                "price": t["entry_price"],
                "amount": t["position_size"],
                "filled": t["position_size"],
                "remaining": 0.0,
                "cost": round(t["risk_amount"], 2),
                "status": "OPEN",
                "timestamp": t["opened_at"],
                "stop_loss": t["stop_loss"],
                "take_profit": t["take_profit"],
                "current_price": t["current_price"],
                "unrealized_pnl": t["unrealized_pnl"],
                "mfe": t["mfe"],
                "mae": t["mae"],
            }
            for t in open_trades
        ]

        # Map open + closed paper trades to TradeRecord list for backwards compatibility
        records: List[TradeRecord] = []
        for t in open_trades + closed_trades[:50]:
            records.append(
                TradeRecord(
                    id=t["trade_id"],
                    symbol=t["symbol"],
                    direction=t["direction"],
                    entry_price=float(t["entry_price"]),
                    stop_loss=float(t["stop_loss"]),
                    take_profit=float(t["take_profit"]),
                    setup=t["strategy_name"],
                    ai_confidence=int(t.get("ai_confidence") or 0),
                    status=t["status"],
                    timestamp=t["opened_at"],
                    amount=float(t.get("position_size") or 0.0),
                    cost=float(t.get("risk_amount") or 0.0),
                    order_id=t["trade_id"],
                    pnl=float(t["realized_pnl"]) if t["status"] == "CLOSED" else float(t.get("unrealized_pnl") or 0.0),
                )
            )
        self.bot_state.trade_history = records

    def _annotate_signal_with_ai(self, sig: StrategySignal) -> None:
        analyst = self._get_analyst()
        if analyst is None:
            sig.ai_decision = "PAPER_AUTO"
            sig.ai_confidence = 0
            sig.ai_reasoning = "AIAnalyst unavailable; paper-traded under strict backtest parity mode."
            return

        candidate = {
            "symbol": sig.symbol,
            "direction": sig.direction,
            "entry_price": sig.entry_price,
            "stop_loss": sig.stop_loss,
            "take_profit": sig.take_profit,
            "idm_level": sig.idm_level,
            "bos_level": sig.bos_level,
            "fvg_zone": {"top": sig.fvg_top, "bottom": sig.fvg_bottom},
            "setup_reason": sig.reasoning,
            "atr": sig.structural_levels.get("atr", 0.0),
        }
        try:
            ai_res = analyst.validate_setup(candidate, sig.market_trend)
            sig.ai_decision = ai_res.get("ai_decision") or ai_res.get("decision") or "APPROVE"
            sig.ai_confidence = int(ai_res.get("ai_confidence") or ai_res.get("confidence") or 0)
            sig.ai_reasoning = ai_res.get("ai_reasoning") or ai_res.get("reasoning") or ""
            rag_ctx = ai_res.get("graph_rag") or ai_res.get("graph_rag_context") or {}
            sig.matched_clusters = [
                str(m.get("pattern_type") or m.get("trade_num") or m)
                for m in (rag_ctx.get("similar_setups") or rag_ctx.get("matched_clusters") or [])
            ]
            candidate_payload = {
                "is_live_candidate": True,
                "symbol": sig.symbol,
                "direction": sig.direction,
                "trend": sig.market_trend,
                "strategy_name": sig.strategy_name,
                "setup_reason": sig.reasoning,
                "entry_price": sig.entry_price,
                "stop_loss": sig.stop_loss,
                "take_profit": sig.take_profit,
                "ai_decision": sig.ai_decision,
                "ai_confidence": sig.ai_confidence,
                "reasoning": sig.ai_reasoning,
                "graph_rag": rag_ctx,
                "timestamp": sig.signal_timestamp,
            }
            self.bot_state.last_graph_rag_candidate = candidate_payload
            self.bot_state.last_candidate_graph_rag = candidate_payload
        except Exception as e:
            logger.warning(f"[LiveMarketService] AI annotation error: {e}")
            sig.ai_decision = "PAPER_PARITY"
            sig.ai_confidence = 0
            sig.ai_reasoning = f"AI annotation fallback ({e}); executed strictly under backtest parity."

    def evaluate_symbol_live(
        self,
        symbol: str,
        allow_live_entries: bool = True,
    ) -> Dict[str, Any]:
        sym = self.fetcher.normalize_canonical_symbol(symbol)
        ticker = self.fetcher.get_live_ticker(sym)
        self.bot_state.live_tickers[sym] = ticker

        # Continuous live tick update for open paper trades
        closed_on_tick = self.paper_monitor.update_with_live_ticker(sym, ticker)
        for ct in closed_on_tick:
            self.bot_state.log(
                f"PAPER EXIT {ct['symbol']} ({ct['exit_condition']}) -> {ct['final_result']} (${ct['realized_pnl']:+.2f})"
            )

        # Fetch strict CLOSED candles only for strategy parity
        df_4h = self.fetcher.get_market_data(sym, "4h", limit=CONTEXT_4H_LIMIT, closed_only=True)
        df_15m = self.fetcher.get_market_data(sym, "15m", limit=CONTEXT_15M_LIMIT, closed_only=True)

        if df_4h.empty or df_15m.empty:
            msg = f"Insufficient closed candles for {sym} (4H={len(df_4h)}, 15M={len(df_15m)}). Signal skipped."
            logger.warning(f"[LiveMarketService] {msg}")
            self.store.log_event("DATA_INCOMPLETE", msg, symbol=sym)
            return {
                "symbol": sym,
                "ticker": ticker,
                "error": msg,
                "scan_result": ScanResult(
                    symbol=sym,
                    trend="UNKNOWN",
                    sweep_detected=False,
                    fvg_type=None,
                    setup_score=0,
                    status="DATA_ERROR",
                    last_price=float(ticker.get("last") or 0.0),
                    bid=float(ticker.get("bid") or 0.0),
                    ask=float(ticker.get("ask") or 0.0),
                    spread=float(ticker.get("spread") or 0.0),
                ),
            }

        # Check closed-bar exits cleanly on latest closed 15M bar before processing new signals
        latest_15m = df_15m.iloc[-1]
        latest_15m_ts = str(latest_15m["timestamp"].isoformat())
        if self.fetcher.is_new_closed_bar(sym, "15m", df_15m):
            closed_on_bar = self.paper_monitor.update_with_closed_bar(
                sym,
                bar_high=float(latest_15m["high"]),
                bar_low=float(latest_15m["low"]),
                bar_ts=latest_15m_ts,
            )
            for cb in closed_on_bar:
                self.bot_state.log(
                    f"PAPER BAR EXIT {cb['symbol']} ({cb['exit_condition']}) -> {cb['final_result']} (${cb['realized_pnl']:+.2f})"
                )

        # Evaluate BOTH strategies strictly on closed candles
        eval_res = self.coordinator.evaluate_symbol(
            sym,
            df_4h_closed=df_4h,
            df_15m_closed=df_15m,
            live_spread=float(ticker.get("spread") or 0.0),
            allow_live_entries=allow_live_entries,
        )

        opened_trades: List[Dict[str, Any]] = []
        for sig in eval_res["signals"]:
            if sig.setup_status == "ENTRY_TRIGGERED":
                self._annotate_signal_with_ai(sig)
                trade = self.paper_monitor.process_signal(sig, live_ticker=ticker)
                if trade:
                    opened_trades.append(trade)
                    self.bot_state.log(
                        f"PAPER {sig.action_label} {sym} [{sig.strategy_name}] @ {sig.entry_price:.2f} "
                        f"| SL {sig.stop_loss:.2f} | TP {sig.take_profit:.2f}"
                    )
            else:
                self.store.save_signal(sig.to_dict())

        smc_diag = eval_res["smc_analysis"]
        chain_diag = eval_res["chain_analysis"]

        live_px = float(ticker.get("last") or smc_diag.get("current_price") or latest_15m["close"])
        has_bos = bool(smc_diag.get("bos_level") or chain_diag.get("bos_level"))
        has_fvg = bool(smc_diag.get("fvg_zone") or chain_diag.get("pending_fvg"))
        stage_score = 40
        if smc_diag.get("macro_trend") in ("BULLISH", "BEARISH"):
            stage_score += 15
        if has_bos:
            stage_score += 20
        if has_fvg:
            stage_score += 15
        if smc_diag.get("stage_status") == "READY" or chain_diag.get("stage_status") == "TRIGGERED":
            stage_score = 95
        elif opened_trades:
            stage_score = 100

        status_label = "SIGNAL" if opened_trades else ("WATCHING" if has_fvg or has_bos else "IDLE")

        # Merge enriched strategy_monitor dict keeping existing UI fields untouched
        enriched_monitor = dict(smc_diag)
        enriched_monitor["current_price"] = live_px
        enriched_monitor["chain_of_choch"] = chain_diag
        enriched_monitor["choch_level"] = chain_diag.get("choch_level")
        enriched_monitor["last_angle"] = chain_diag.get("last_angle")
        enriched_monitor["spread"] = ticker.get("spread", 0.0)
        enriched_monitor["bid"] = ticker.get("bid", live_px)
        enriched_monitor["ask"] = ticker.get("ask", live_px)
        enriched_monitor["last_closed_15m_ts"] = latest_15m_ts
        if not enriched_monitor.get("fvg_zone") and chain_diag.get("pending_fvg"):
            pf = chain_diag["pending_fvg"]
            pf_top = pf.get("top")
            pf_bottom = pf.get("bottom")
            if pf_top is not None and pf_bottom is not None:
                enriched_monitor["fvg_zone"] = {
                    "type": f"CHAIN_{pf.get('direction', 'NEUTRAL')}_FVG",
                    "top": float(pf_top),
                    "bottom": float(pf_bottom),
                    "midpoint": round((float(pf_top) + float(pf_bottom)) / 2.0, 4),
                    "sl_price": pf.get("stop_loss"),
                }
                enriched_monitor["stop_loss"] = pf.get("stop_loss")
                enriched_monitor["take_profit"] = pf.get("take_profit")

        scan_res = ScanResult(
            symbol=sym,
            trend=smc_diag.get("macro_trend") or chain_diag.get("trend") or "NEUTRAL",
            sweep_detected=has_bos,
            fvg_type=(enriched_monitor.get("fvg_zone") or {}).get("type"),
            setup_score=stage_score,
            status=status_label,
            last_price=live_px,
            bid=float(ticker.get("bid") or live_px),
            ask=float(ticker.get("ask") or live_px),
            spread=float(ticker.get("spread") or 0.0),
            strategy_monitor=enriched_monitor,
            chain_monitor=chain_diag,
        )

        return {
            "symbol": sym,
            "ticker": ticker,
            "smc_analysis": smc_diag,
            "chain_analysis": chain_diag,
            "opened_trades": opened_trades,
            "signals": [s.to_dict() for s in eval_res["signals"]],
            "scan_result": scan_res,
        }

    def run_cycle(
        self,
        symbols: Optional[List[str]] = None,
        allow_live_entries: bool = True,
    ) -> Dict[str, Any]:
        target_symbols = symbols or list(SYMBOLS)
        results_by_symbol: Dict[str, Any] = {}
        scan_list: List[ScanResult] = []

        for sym in target_symbols:
            try:
                res = self.evaluate_symbol_live(sym, allow_live_entries=allow_live_entries)
                results_by_symbol[sym] = {
                    k: v for k, v in res.items() if k != "scan_result"
                }
                scan_list.append(res["scan_result"])
            except Exception as e:
                logger.error(f"[LiveMarketService] Cycle error for {sym}: {e}")
                self.bot_state.last_error = f"{sym}: {e}"
                self.store.log_event("SCAN_ERROR", str(e), symbol=sym)

        self.bot_state.scanner_results = scan_list
        self.bot_state.connection_status = self.fetcher.get_connection_status()
        self.bot_state.last_scan_at = datetime.now(timezone.utc).isoformat()
        self._sync_bot_state_from_store()
        self.persist()

        self._last_cycle_snapshot = {
            "timestamp": self.bot_state.last_scan_at,
            "paper_trading_only": PAPER_TRADING_ONLY,
            "connection": self.bot_state.connection_status,
            "symbols": results_by_symbol,
            "paper_summary": self.paper_monitor.get_summary(),
            "open_paper_trades": self.paper_monitor.open_trades,
            "recent_signals": self.store.list_signals(limit=30),
        }
        return self._last_cycle_snapshot

    def get_live_snapshot(self) -> Dict[str, Any]:
        return {
            "timestamp": self.bot_state.last_scan_at,
            "is_running": self.bot_state.is_running,
            "paper_trading_only": PAPER_TRADING_ONLY,
            "connection": self.fetcher.get_connection_status(),
            "tickers": self.bot_state.live_tickers,
            "paper_summary": self.paper_monitor.get_summary(),
            "open_paper_trades": self.paper_monitor.open_trades,
            "closed_paper_trades": self.store.get_closed_paper_trades(limit=50),
            "recent_signals": self.store.list_signals(limit=30),
            "smc_diagnostics": self.coordinator.last_smc_diagnostics,
            "chain_diagnostics": self.coordinator.last_chain_diagnostics,
        }

    def get_live_candles_payload(self, symbol: str, limit: int = 120) -> Dict[str, Any]:
        sym = self.fetcher.normalize_canonical_symbol(symbol)
        df_4h = self.fetcher.get_market_data(sym, "4h", limit=CONTEXT_4H_LIMIT, closed_only=True)
        df_15m_full = self.fetcher.get_market_data(sym, "15m", limit=CONTEXT_15M_LIMIT, closed_only=True)
        ticker = self.fetcher.get_live_ticker(sym)

        if df_15m_full.empty:
            return {"symbol": sym, "candles": [], "error": f"No closed 15M candles for {sym}"}

        df_15m = df_15m_full.tail(limit).reset_index(drop=True)
        offset = max(0, len(df_15m_full) - len(df_15m))

        # Run diagnostics on full closed context without emitting extra trades
        smc_diag = (
            self.coordinator.smc.diagnose_setup(sym, df_4h, df_15m_full)
            if not df_4h.empty
            else {}
        )
        chain_diag = self.coordinator.last_chain_diagnostics.get(sym) or {}
        if not chain_diag:
            eval_res = self.coordinator.evaluate_symbol(
                sym, df_4h, df_15m_full, live_spread=float(ticker.get("spread") or 0.0), allow_live_entries=False
            )
            chain_diag = eval_res["chain_analysis"]

        candles_list: List[List[Any]] = []
        for _, row in df_15m.iterrows():
            ts_str = row["timestamp"].strftime("%Y-%m-%dT%H:%M:%SZ")
            candles_list.append(
                [
                    ts_str,
                    round(float(row["open"]), 4),
                    round(float(row["high"]), 4),
                    round(float(row["low"]), 4),
                    round(float(row["close"]), 4),
                ]
            )

        n = len(candles_list)
        open_trade = next((t for t in self.paper_monitor.open_trades if t["symbol"] == sym), None)
        pending_fvg = chain_diag.get("pending_fvg") or {}

        def _shift_idx(raw_idx: Optional[int]) -> Optional[int]:
            if raw_idx is None:
                return None
            shifted = int(raw_idx) - offset
            return shifted if 0 <= shifted < n else None

        # Compute confirmed causal swing high and swing low on the visible window (p=4)
        recent_sh: Optional[Dict[str, Any]] = None
        recent_sl: Optional[Dict[str, Any]] = None
        p_len = 4
        if len(df_15m) >= 2 * p_len + 1:
            highs = df_15m["high"].values
            lows = df_15m["low"].values
            for s in range(p_len, len(df_15m) - p_len):
                wh = highs[s - p_len : s + p_len + 1]
                wl = lows[s - p_len : s + p_len + 1]
                if highs[s] == wh.max():
                    recent_sh = {
                        "index": int(s),
                        "price": round(float(highs[s]), 4),
                        "timestamp": df_15m.iloc[s]["timestamp"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                    }
                if lows[s] == wl.min():
                    recent_sl = {
                        "index": int(s),
                        "price": round(float(lows[s]), 4),
                        "timestamp": df_15m.iloc[s]["timestamp"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                    }

        has_active_setup = bool(open_trade) or bool(pending_fvg)

        direction = (
            (open_trade or {}).get("direction")
            or pending_fvg.get("direction")
            or ("LONG" if (smc_diag.get("macro_trend") or chain_diag.get("trend")) == "BULLISH" else "SHORT")
        )

        if open_trade:
            # Active paper trade currently running
            local_sh_idx = _shift_idx(open_trade.get("sh_idx"))
            local_idm_idx = _shift_idx(open_trade.get("idm_idx"))
            local_sweep_idx = _shift_idx(open_trade.get("sweep_idx"))
            local_bos_idx = _shift_idx(open_trade.get("bos_idx"))
            local_c1_idx = _shift_idx(open_trade.get("c1_idx"))
            local_c2_idx = _shift_idx(open_trade.get("c2_idx"))
            local_c3_idx = _shift_idx(open_trade.get("c3_idx"))
            local_entry_idx = _shift_idx(open_trade.get("entry_idx")) or (n - 1)
            sh_price = float(open_trade.get("sh_price") or open_trade.get("bos_level") or 0.0)
            bos_lvl = float(open_trade.get("bos_price") or open_trade.get("bos_level") or 0.0)
            idm_lvl = float(open_trade.get("idm_price") or open_trade.get("idm_level") or 0.0)
            choch_lvl = float(open_trade.get("choch_price") or 0.0) if open_trade.get("choch_price") else None
            entry_val = float(open_trade["entry_price"])
            planned_entry = entry_val
            sl_val = float(open_trade["stop_loss"])
            tp_val = float(open_trade["take_profit"])
            fvg_top_val = open_trade.get("fvg_top")
            fvg_bot_val = open_trade.get("fvg_bottom")
            setup_stage = "ACTIVE_TRADE"
            stage_status = "RUNNING"
            angle_val = open_trade.get("angle")

        elif pending_fvg:
            # Setup confirmed and waiting for 15M candle retrace touch
            local_sh_idx = _shift_idx(pending_fvg.get("sh_idx"))
            local_idm_idx = _shift_idx(pending_fvg.get("idm_idx"))
            local_sweep_idx = _shift_idx(pending_fvg.get("sweep_idx"))
            local_bos_idx = _shift_idx(pending_fvg.get("bos_idx"))
            local_c1_idx = _shift_idx(pending_fvg.get("c1_idx"))
            local_c2_idx = _shift_idx(pending_fvg.get("c2_idx"))
            local_c3_idx = _shift_idx(pending_fvg.get("c3_idx"))
            local_entry_idx = None
            sh_price = float(pending_fvg.get("sh_price") or pending_fvg.get("bos_level") or 0.0)
            bos_lvl = float(pending_fvg.get("bos_price") or pending_fvg.get("bos_level") or 0.0)
            idm_lvl = float(pending_fvg.get("idm_price") or pending_fvg.get("idm_level") or 0.0)
            choch_lvl = float(pending_fvg.get("choch_price") or 0.0) if pending_fvg.get("choch_price") else None
            fvg_top_val = pending_fvg.get("fvg_top")
            fvg_bot_val = pending_fvg.get("fvg_bottom")
            planned_entry = float(fvg_top_val) if pending_fvg.get("direction") == "LONG" else float(fvg_bot_val)
            entry_val = planned_entry
            sl_val = float(pending_fvg.get("stop_loss") or (pending_fvg.get("c1_low") if pending_fvg.get("direction") == "LONG" else pending_fvg.get("c1_high")))
            risk_d = abs(entry_val - sl_val)
            tp_val = float(pending_fvg.get("take_profit") or (entry_val + 2.0 * risk_d if pending_fvg.get("direction") == "LONG" else entry_val - 2.0 * risk_d))
            setup_stage = "FVG_TOUCH"
            stage_status = "WAITING"
            angle_val = pending_fvg.get("angle")

        else:
            # Scanning structure: NO breakout has occurred in the active regime
            local_sh_idx = None
            local_idm_idx = None
            local_sweep_idx = None
            local_bos_idx = None
            local_c1_idx = None
            local_c2_idx = None
            local_c3_idx = None
            local_entry_idx = None
            sh_price = None
            bos_lvl = None
            idm_lvl = None
            choch_lvl = None
            fvg_top_val = None
            fvg_bot_val = None
            entry_val = None
            planned_entry = None
            sl_val = None
            tp_val = None
            setup_stage = "SCANNING_STRUCTURE"
            stage_status = "WAITING"
            angle_val = chain_diag.get("last_angle")

        current_px = float(ticker.get("last") or (candles_list[-1][4] if candles_list else 0.0))

        return {
            "symbol": sym,
            "timeframe": "15M",
            "macro_trend": smc_diag.get("macro_trend") or chain_diag.get("trend"),
            "direction": direction,
            "trade_type": (open_trade or {}).get("trade_type") or pending_fvg.get("type") or "CONTINUATION_BOS",
            "sh_price": sh_price,
            "idm_level": idm_lvl,
            "idm_price": idm_lvl,
            "bos_level": bos_lvl,
            "bos_price": bos_lvl,
            "choch_price": choch_lvl,
            "fvg_top": fvg_top_val,
            "fvg_bottom": fvg_bot_val,
            "entry_price": entry_val,
            "planned_entry": planned_entry,
            "stop_loss": sl_val,
            "take_profit": tp_val,
            "is_active_trade": bool(open_trade),
            "open_trade": open_trade,
            "current_price": current_px,
            "setup_stage": setup_stage,
            "stage_status": stage_status,
            "angle": angle_val,
            "local_sh_idx": local_sh_idx,
            "local_idm_idx": local_idm_idx,
            "local_sweep_idx": local_sweep_idx,
            "local_bos_idx": local_bos_idx,
            "local_c1_idx": local_c1_idx,
            "local_c2_idx": local_c2_idx,
            "local_c3_idx": local_c3_idx,
            "local_entry_idx": local_entry_idx,
            "recent_swing_high": recent_sh,
            "recent_swing_low": recent_sl,
            "live_ticker": ticker,
            "candles": candles_list,
            "strategy_monitor": smc_diag,
            "chain_monitor": chain_diag,
        }
