import asyncio
import uuid
import pandas as pd
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from pydantic import BaseModel
from typing import Optional
import uvicorn

from backend.data.fetcher import DataFetcher
from backend.strategy.smc import SMCEngine
from backend.ai.analyst import AIAnalyst
from backend.ai.graph_rag import TradeKnowledgeGraph
from backend.risk.manager import RiskManager
from backend.execution.broker import BrokerAdapter
from backend.execution.paper_monitor import PaperTradeMonitor
from backend.journal.store import JournalStore
from backend.live_service import LiveMarketService
from backend.state import bot, TradeRecord, ScanResult
from backend.strategy.coordinator import UnifiedStrategyCoordinator
from backend import config

# ─── App Setup ───────────────────────────────────────────────────────────────
app = FastAPI(title="Agent Nexus V2", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Singletons ───────────────────────────────────────────────────────────────
fetcher = DataFetcher()
smc = SMCEngine()
ai = AIAnalyst()
kg = ai.kg
risk = RiskManager()
broker = BrokerAdapter()
journal_store = JournalStore()
paper_monitor = PaperTradeMonitor(store=journal_store, risk_percent=config.RISK_PERCENT)
coordinator = UnifiedStrategyCoordinator()
live_service = LiveMarketService(
    fetcher=fetcher,
    coordinator=coordinator,
    store=journal_store,
    paper_monitor=paper_monitor,
    analyst=ai,
    bot_state=bot,
)


# ─── Autonomous Trading Loop ─────────────────────────────────────────────────
async def autonomous_trading_loop():
    logger.info("[SYSTEM] Autonomous live analysis loop initialised — waiting for engine start.")
    while True:
        if not bot.is_running:
            await asyncio.sleep(3)
            continue

        try:
            bot.add_log(
                f"Live cycle scanning {len(config.SYMBOLS)} pairs "
                f"(Open Paper Trades: {len(paper_monitor.open_trades)})..."
            )
            await asyncio.to_thread(live_service.run_cycle, config.SYMBOLS, True)
        except Exception as e:
            logger.error(f"[SYSTEM] Loop error: {e}")
            bot.add_log(f"ERROR: {e}")

        await asyncio.sleep(bot.scan_interval)


# ─── REST API ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    conn = fetcher.get_connection_status()
    return {
        "status": "ok",
        "running": bot.is_running,
        "paper_trading_only": config.PAPER_TRADING_ONLY,
        "feed_connected": conn.get("connected", False),
        "provider": conn.get("provider", "BINANCE_DEMO"),
    }


@app.post("/api/strategy-monitor/scan")
async def run_strategy_monitor_scan():
    """Fetch closed market data and diagnose BOTH strategies (paper/analysis mode only)."""
    try:
        snapshot = await asyncio.to_thread(live_service.run_cycle, config.SYMBOLS, False)
        return {
            "mode": "LIVE_ANALYSIS_PAPER_ONLY",
            "count": len(bot.scanner_results),
            "scanner_results": [
                {
                    "symbol": s.symbol,
                    "trend": s.trend,
                    "sweep_detected": s.sweep_detected,
                    "fvg_type": s.fvg_type,
                    "setup_score": s.setup_score,
                    "status": s.status,
                    "last_price": s.last_price,
                    "bid": s.bid,
                    "ask": s.ask,
                    "spread": s.spread,
                    "strategy_monitor": s.strategy_monitor,
                    "chain_monitor": s.chain_monitor,
                }
                for s in bot.scanner_results
            ],
            "connection": snapshot.get("connection"),
        }
    except Exception as e:
        logger.exception(f"[MONITOR] Scan failed: {e}")
        return {"mode": "LIVE_ANALYSIS_PAPER_ONLY", "count": 0, "error": str(e), "scanner_results": []}


@app.get("/api/strategy-monitor/candles")
async def get_strategy_monitor_candles(symbol: str = "BTCUSD"):
    """Returns closed 15M candles + live ticker + structural levels for the requested symbol."""
    try:
        return await asyncio.to_thread(live_service.get_live_candles_payload, symbol, 120)
    except Exception as e:
        logger.exception(f"Failed to get strategy monitor candles for {symbol}: {e}")
        return {"error": str(e)}


@app.get("/api/live-analysis")
async def get_live_analysis():
    """Returns full live market analysis state: connection health, tickers, signals, and paper trades."""
    return live_service.get_live_snapshot()


@app.get("/api/signals")
async def get_signals(symbol: Optional[str] = None, limit: int = 50):
    return {"signals": journal_store.list_signals(limit=limit, symbol=symbol)}


@app.get("/api/paper-trades")
async def get_paper_trades(limit: int = 100):
    return {
        "paper_trading_only": config.PAPER_TRADING_ONLY,
        "summary": paper_monitor.get_summary(),
        "open_trades": paper_monitor.open_trades,
        "closed_trades": journal_store.get_closed_paper_trades(limit=limit),
    }


class ClosePaperTradeRequest(BaseModel):
    trade_id: str


@app.post("/api/paper-trades/close")
async def close_paper_trade(req: ClosePaperTradeRequest):
    closed = paper_monitor.close_manual(req.trade_id)
    if closed:
        live_service._sync_bot_state_from_store()
        return {"status": "closed", "trade": closed, "summary": paper_monitor.get_summary()}
    return {"status": "not_found", "message": f"Open paper trade {req.trade_id} not found"}


@app.post("/api/connection/reconnect")
async def reconnect_feed():
    ok = False
    if hasattr(fetcher.provider, "reconnect"):
        ok = await asyncio.to_thread(fetcher.provider.reconnect)
    elif hasattr(fetcher.provider, "connect"):
        ok = await asyncio.to_thread(fetcher.provider.connect)
    bot.connection_status = fetcher.get_connection_status()
    return {"reconnected": ok, "connection": bot.connection_status}


@app.get("/api/status")
async def get_status():
    return {
        "is_running": bot.is_running,
        "is_paper_trading": config.PAPER_TRADING_ONLY,
        "paper_trading_only": config.PAPER_TRADING_ONLY,
        "scan_interval": bot.scan_interval,
        "risk_percent": bot.risk_percent,
        "daily_trades_count": bot.daily_trades_count,
        "total_trades": bot.total_trades,
        "wins": bot.wins,
        "losses": bot.losses,
        "last_scan_at": bot.last_scan_at,
        "engine_log": bot.engine_log,
        "connection_status": bot.connection_status or fetcher.get_connection_status(),
        "live_tickers": bot.live_tickers,
        "paper_summary": paper_monitor.get_summary(),
        "paper_trades_open": paper_monitor.open_trades,
        "paper_trades_closed": journal_store.get_closed_paper_trades(limit=50),
        "recent_signals": journal_store.list_signals(limit=30),
        "open_orders": bot.open_orders,
        "open_positions": paper_monitor.open_trades,
        "scanner_results": [
            {
                "symbol": s.symbol,
                "trend": s.trend,
                "sweep_detected": s.sweep_detected,
                "fvg_type": s.fvg_type,
                "setup_score": s.setup_score,
                "status": s.status,
                "last_price": s.last_price,
                "bid": s.bid,
                "ask": s.ask,
                "spread": s.spread,
                "strategy_monitor": s.strategy_monitor,
                "chain_monitor": s.chain_monitor,
            }
            for s in bot.scanner_results
        ],
        "last_candidate_graph_rag": bot.last_candidate_graph_rag,
        "trade_history": [
            {
                "id": t.id,
                "order_id": getattr(t, "order_id", t.id),
                "symbol": t.symbol,
                "direction": t.direction,
                "entry_price": t.entry_price,
                "amount": getattr(t, "amount", 0.0),
                "cost": getattr(t, "cost", 0.0),
                "stop_loss": t.stop_loss,
                "take_profit": t.take_profit,
                "setup": t.setup,
                "ai_confidence": t.ai_confidence,
                "status": t.status,
                "pnl": getattr(t, "pnl", 0.0),
                "timestamp": t.timestamp,
            }
            for t in bot.trade_history[:50]
        ],
    }


class ControlRequest(BaseModel):
    action: str            # "start" | "stop"
    scan_interval: Optional[int] = None
    risk_percent: Optional[float] = None


@app.post("/api/control")
async def control_engine(req: ControlRequest):
    if req.action == "start":
        if req.scan_interval:
            bot.scan_interval = req.scan_interval
        if req.risk_percent:
            bot.risk_percent = req.risk_percent
        bot.is_running = True
        bot.add_log("Live Analysis Engine STARTED (Paper Trading Safety Lock ACTIVE).")
        logger.info("[SYSTEM] Engine started via frontend (PAPER ONLY).")
        return {"status": "started", "paper_trading_only": config.PAPER_TRADING_ONLY}

    if req.action == "stop":
        bot.is_running = False
        bot.add_log("Live Analysis Engine STOPPED by user.")
        logger.info("[SYSTEM] Engine stopped via frontend.")
        return {"status": "stopped"}

    return {"error": "Invalid action. Use 'start' or 'stop'."}


class ManualTradeRequest(BaseModel):
    symbol: str
    direction: str   # "LONG" | "SHORT" | "BUY" | "SELL"


@app.post("/api/trade/manual")
async def manual_trade(req: ManualTradeRequest):
    """
    When PAPER_TRADING_ONLY is True (safety lock), simulates a manual paper trade
    at live Bid/Ask instead of sending any order to Binance or MT5.
    """
    sym = fetcher.normalize_canonical_symbol(req.symbol)
    ticker = await asyncio.to_thread(fetcher.get_live_ticker, sym)
    if not ticker.get("connected") or not ticker.get("last"):
        return {"status": "failed", "message": f"Live feed unavailable for {sym}"}

    side_norm = req.direction.upper()
    direction = "LONG" if side_norm in ("LONG", "BUY") else "SHORT"
    action_label = "BUY" if direction == "LONG" else "SELL"
    entry = float(ticker["ask"] if direction == "LONG" else ticker["bid"]) or float(ticker["last"])
    sl_dist = max(entry * 0.005, 0.5)
    sl = entry - sl_dist if direction == "LONG" else entry + sl_dist
    tp = entry + (sl_dist * 2.0) if direction == "LONG" else entry - (sl_dist * 2.0)

    from backend.strategy.coordinator import StrategySignal

    sig = StrategySignal(
        signal_id=f"MANUAL_{sym}_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
        strategy_name="MANUAL_PAPER",
        symbol=sym,
        timeframe="LIVE_TICK",
        market_trend="MANUAL",
        direction=direction,
        action_label=action_label,
        entry_price=entry,
        stop_loss=sl,
        take_profit=tp,
        risk_reward_ratio=2.0,
        signal_timestamp=datetime.utcnow().isoformat(),
        setup_status="ENTRY_TRIGGERED",
        reasoning=f"Manual UI paper order triggered on {sym} ({action_label} @ {entry:.2f}).",
        spread_at_signal=float(ticker.get("spread") or 0.0),
        ai_decision="MANUAL_PAPER",
        ai_confidence=100,
    )
    trade = paper_monitor.process_signal(sig, live_ticker=ticker)
    if trade:
        live_service._sync_bot_state_from_store()
        bot.add_log(f"MANUAL PAPER {action_label} {sym} @ ${entry:.2f} (SL {sl:.2f} / TP {tp:.2f})")
        return {
            "status": "sent",
            "order_id": trade["trade_id"],
            "mode": "PAPER_TRADING_ONLY",
            "message": f"Paper {action_label} opened on {sym} @ ${entry:.2f} (No real money risked).",
        }
    return {
        "status": "failed",
        "message": f"Manual paper trade skipped (active MANUAL_PAPER trade already open on {sym}).",
    }


class CancelOrderRequest(BaseModel):
    order_id: str
    symbol: str


@app.post("/api/order/cancel")
async def cancel_order_api(req: CancelOrderRequest):
    closed = paper_monitor.close_manual(req.order_id)
    if closed:
        live_service._sync_bot_state_from_store()
        bot.add_log(f"CLOSED PAPER POSITION {req.order_id} ({req.symbol}) @ ${closed['exit_price']}")
        return {"status": "success", "message": f"Paper trade {req.order_id} closed"}
    return {"status": "failed", "message": f"Paper trade {req.order_id} not found"}


@app.get("/api/balance")
async def get_balance():
    summary = paper_monitor.get_summary()
    return {
        "paper_trading_only": config.PAPER_TRADING_ONLY,
        "balances": {
            "USDT": {
                "total": summary["balance"],
                "free": summary["balance"],
                "equity": summary["equity"],
            }
        },
        "summary": summary,
    }


@app.get("/api/backtest")
async def get_backtest_results():
    import json, os
    json_path = os.path.join(os.path.dirname(__file__), "data", "backtest_results.json")
    if os.path.exists(json_path):
        with open(json_path, "r") as f:
            return json.load(f)
    return {"summary": None, "trades": []}


# ─── Graph RAG Endpoints ─────────────────────────────────────────────────────

@app.get("/api/graph/network")
async def get_graph_network():
    """Returns the full knowledge graph nodes, links, winning DNA, and high-win clusters."""
    return kg.export_graph_for_frontend()


@app.get("/api/graph/winning-dna")
async def get_winning_dna():
    """Returns the Winning DNA rules, cluster win rates, and losing trap filters."""
    return {
        "winning_dna": kg.winning_dna,
        "high_win_clusters": [c for c in kg.clusters if c["status"] == "HIGH_WIN_CLUSTER"],
        "losing_traps": kg.losing_traps,
        "all_clusters": kg.clusters,
    }


class GraphQueryRequest(BaseModel):
    symbol: str
    direction: str
    angle: Optional[float] = 42.0
    session_name: Optional[str] = "London / New York Overlap (Peak Volatility)"
    setup_reason: Optional[str] = "Chain-of-CHoCH: CONTINUATION_BOS (LONG) -> 15M FVG Retrace Touch"


@app.post("/api/graph/query")
async def query_graph(req: GraphQueryRequest):
    """Retrieves nearest neighbor trades and calculates cluster win rate."""
    candidate = {
        "symbol": req.symbol,
        "direction": req.direction,
        "angle": req.angle,
        "session_name": req.session_name,
        "setup_reason": req.setup_reason,
    }
    retrieval = kg.retrieve_similar_trades(candidate, top_k=6)
    reasoning_prompt = kg.generate_rag_reasoning_prompt(candidate)
    return {
        "query": candidate,
        "retrieval": retrieval,
        "rag_prompt": reasoning_prompt,
    }


@app.get("/api/graph/latest-candidate")
async def get_latest_candidate_telemetry():
    """Returns the latest candidate setup telemetry and its Graph RAG retrieval."""
    if bot.last_candidate_graph_rag:
        return {
            "status": "active_candidate",
            "is_live_candidate": True,
            "data": bot.last_candidate_graph_rag,
        }
    
    # Return benchmark candidate if no active candidate has been detected yet
    benchmark_candidate = {
        "symbol": "XAUUSD",
        "direction": "LONG",
        "angle": 42.5,
        "session_name": "London/NY Overlap (Peak Volume)",
        "setup_reason": "Chain-of-CHoCH: CONTINUATION_BOS (LONG) -> 15M FVG Retrace Touch",
        "entry_price": 2735.40,
        "stop_loss": 2732.10,
        "take_profit": 2742.00,
    }
    retrieval = kg.retrieve_similar_trades(benchmark_candidate, top_k=6)
    return {
        "status": "benchmark_candidate",
        "is_live_candidate": False,
        "data": {
            "symbol": benchmark_candidate["symbol"],
            "direction": benchmark_candidate["direction"],
            "setup_reason": benchmark_candidate["setup_reason"],
            "ai_decision": "APPROVE",
            "ai_confidence": 85,
            "entry_price": benchmark_candidate["entry_price"],
            "stop_loss": benchmark_candidate["stop_loss"],
            "take_profit": benchmark_candidate["take_profit"],
            "graph_rag": {
                "neighborhood_win_rate": retrieval["neighborhood_win_rate"],
                "sample_size": retrieval["neighborhood_sample_size"],
                "recommendation": retrieval["recommendation"],
                "top_matches": retrieval["top_matches"][:3],
            },
            "timestamp": datetime.utcnow().isoformat(),
        }
    }


@app.get("/api/graph-rag")
async def get_unified_graph_rag():
    """Unified Graph RAG endpoint providing graph metadata, winning DNA, high-win clusters, losing traps, and candidate telemetry."""
    network_meta = {
        "schema_version": "2.0.0",
        "is_static": True,
        "total_nodes": kg.graph.number_of_nodes(),
        "total_links": kg.graph.number_of_edges(),
        "total_trades": len(kg.trades),
        "exported_at": getattr(kg, "last_exported_at", datetime.utcnow().isoformat()),
    }
    candidate_telemetry = await get_latest_candidate_telemetry()
    return {
        "status": "ok",
        "network": network_meta,
        "winning_dna": kg.winning_dna,
        "high_win_clusters": [c for c in kg.clusters if c["status"] == "HIGH_WIN_CLUSTER"],
        "losing_traps": kg.losing_traps,
        "candidate": candidate_telemetry,
    }


# ─── Startup ──────────────────────────────────────────────────────────────────
async def _initial_warmup_scan():
    try:
        await asyncio.to_thread(live_service.run_cycle, config.SYMBOLS, False)
        logger.info("[SYSTEM] Initial live market warmup complete (PAPER_TRADING_ONLY=True).")
    except Exception as e:
        logger.warning(f"[SYSTEM] Initial warmup scan failed: {e}")


@app.on_event("startup")
async def startup():
    logger.info("[SYSTEM] Agent Nexus V2 starting up (Paper Trading Mode Only)...")
    asyncio.create_task(_initial_warmup_scan())
    asyncio.create_task(autonomous_trading_loop())
    logger.info("[SYSTEM] Live analysis loop spawned. Engine is IDLE — start from frontend.")


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)
