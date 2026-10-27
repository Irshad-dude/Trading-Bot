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
from backend.risk.manager import RiskManager
from backend.execution.broker import BrokerAdapter
from backend.state import bot, TradeRecord, ScanResult
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
smc     = SMCEngine()
ai      = AIAnalyst()
risk    = RiskManager()
broker  = BrokerAdapter()

# ─── Autonomous Trading Loop ─────────────────────────────────────────────────
async def autonomous_trading_loop():
    logger.info("[SYSTEM] Autonomous trading loop initialised — waiting for engine start.")
    while True:
        if not bot.is_running:
            await asyncio.sleep(5)
            continue

        try:
            bot.last_scan_at = datetime.utcnow().isoformat()
            bot.add_log(f"Scanning {len(config.SYMBOLS)} symbols...")
            new_scanner_results = []

            for symbol in config.SYMBOLS:
                bot.add_log(f"Analysing {symbol}...")

                # ── 1. Fetch Data ─────────────────────────────────────────
                df_4h  = fetcher.get_market_data(symbol, timeframe="4h",  limit=100)
                df_15m = fetcher.get_market_data(symbol, timeframe="15m", limit=200)
                df_1m  = fetcher.get_market_data(symbol, timeframe="1m",  limit=150)

                if df_15m.empty or df_4h.empty:
                    bot.add_log(f"No data for {symbol}, skipping.")
                    continue

                # ── 2. Market Structure Analysis (scanner score on 15M) ──────────
                trend       = smc.determine_macro_trend(df_4h)
                df_15m_scan = smc.detect_swings_and_bos(df_15m.copy())
                fvgs        = smc.detect_fvg(df_15m_scan)
                recent_bos  = df_15m_scan["bos_type"].iloc[-15:].dropna()
                last_candle = df_15m.iloc[-1]
                bos_detected = len(recent_bos) > 0
                has_active_fvg = len([f for f in fvgs if f["index"] >= len(df_15m_scan) - 15]) > 0

                score = 0
                if trend != "NEUTRAL":    score += 30
                if bos_detected:          score += 40
                if has_active_fvg:        score += 30

                new_scanner_results.append(ScanResult(
                    symbol=symbol,
                    trend=trend,
                    sweep_detected=bos_detected,
                    fvg_type="ACTIVE FVG" if has_active_fvg else None,
                    setup_score=score,
                    status="READY" if score >= 70 else "SCANNING",
                    last_price=float(last_candle["close"]),
                    timestamp=datetime.utcnow().isoformat(),
                ))

                # ── 3. Signal Detection via Irshad's SMC Strategy ─────────
                # Pipeline: 4H Trend → IDM → BOS → FVG → Touch → Confirm
                candidate = smc.scan_for_setups(symbol, df_4h, df_15m)
                if not candidate:
                    continue

                bot.add_log(f"Setup: {symbol} {candidate['direction']} — validating with Gemini AI...")

                # ── 4. AI Validation ──────────────────────────────────────
                candidate = ai.validate_setup(candidate, trend)

                # ── 5. Risk Gate ──────────────────────────────────────────
                if not risk.validate_trade(candidate):
                    continue

                # ── 6. Execute via Binance Demo Broker ───────────────────
                res = await broker.execute_trade(candidate)
                if res.get("success"):
                    trade = TradeRecord(
                        id=res["order_id"],
                        symbol=symbol,
                        direction=res["side"],
                        entry_price=res["price"],
                        stop_loss=candidate.get("stop_loss", 0),
                        take_profit=candidate.get("take_profit", 0),
                        risk_percent=candidate.get("risk_percentage", 0.5),
                        setup=candidate["setup_reason"],
                        ai_reasoning=candidate.get("ai_reasoning", ""),
                        ai_confidence=candidate.get("ai_confidence", 0),
                        status="EXECUTED",
                        timestamp=res["timestamp"],
                        amount=res.get("amount", 0.0),
                        cost=res.get("cost", 0.0),
                        order_id=res["order_id"],
                    )
                    bot.trade_history.insert(0, trade)
                    bot.daily_trades_count += 1
                    bot.total_trades       += 1
                    if res.get("tp_order_id"):
                        bot.add_log(
                            f"OPEN TP ORDER [{symbol}] SELL {res['amount']} "
                            f"@ ${res['tp_price']:.2f} (ID: {res['tp_order_id']})"
                        )
                else:
                    err_msg = res.get("error", "Unknown error")
                    bot.add_log(f"BINANCE ORDER REJECTED [{symbol}]: {err_msg}")

            bot.scanner_results = new_scanner_results

        except Exception as e:
            logger.error(f"[SYSTEM] Loop error: {e}")
            bot.add_log(f"ERROR: {e}")

        await asyncio.sleep(bot.scan_interval)


# ─── REST API ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "running": bot.is_running}


@app.get("/api/status")
async def get_status():
    open_orders = await broker.get_open_orders()
    return {
        "is_running":         bot.is_running,
        "scan_interval":      bot.scan_interval,
        "risk_percent":       bot.risk_percent,
        "daily_trades_count": bot.daily_trades_count,
        "total_trades":       bot.total_trades,
        "wins":               bot.wins,
        "losses":             bot.losses,
        "last_scan_at":       bot.last_scan_at,
        "engine_log":         bot.engine_log,
        "open_orders":        open_orders,
        "scanner_results": [
            {
                "symbol":         s.symbol,
                "trend":          s.trend,
                "sweep_detected": s.sweep_detected,
                "fvg_type":       s.fvg_type,
                "setup_score":    s.setup_score,
                "status":         s.status,
                "last_price":     s.last_price,
            }
            for s in bot.scanner_results
        ],
        "trade_history": [
            {
                "id":            t.id,
                "order_id":      getattr(t, "order_id", t.id),
                "symbol":        t.symbol,
                "direction":     t.direction,
                "entry_price":   t.entry_price,
                "amount":        getattr(t, "amount", 0.0),
                "cost":          getattr(t, "cost", 0.0),
                "stop_loss":     t.stop_loss,
                "take_profit":   t.take_profit,
                "setup":         t.setup,
                "ai_confidence": t.ai_confidence,
                "status":        t.status,
                "timestamp":     t.timestamp,
            }
            for t in bot.trade_history[:20]
        ],
    }


class ControlRequest(BaseModel):
    action:        str            # "start" | "stop"
    scan_interval: Optional[int]   = None
    risk_percent:  Optional[float] = None


@app.post("/api/control")
async def control_engine(req: ControlRequest):
    if req.action == "start":
        if req.scan_interval: bot.scan_interval = req.scan_interval
        if req.risk_percent:  bot.risk_percent  = req.risk_percent
        bot.is_running         = True
        bot.daily_trades_count = 0
        bot.add_log("Engine STARTED by user from dashboard.")
        logger.info("[SYSTEM] Engine started via frontend.")
        return {"status": "started"}

    if req.action == "stop":
        bot.is_running = False
        bot.add_log("Engine STOPPED by user.")
        logger.info("[SYSTEM] Engine stopped via frontend.")
        return {"status": "stopped"}

    return {"error": "Invalid action. Use 'start' or 'stop'."}


class ManualTradeRequest(BaseModel):
    symbol:    str
    direction: str   # "LONG" | "SHORT" | "BUY" | "SELL"


@app.post("/api/trade/manual")
async def manual_trade(req: ManualTradeRequest):
    trade_data = {
        "symbol":           req.symbol,
        "direction":        req.direction,
        "risk_percentage":  bot.risk_percent,
        "setup_reason":     "Manual Execution from Web Terminal",
    }
    res = await broker.execute_trade(trade_data)
    if res.get("success"):
        trade = TradeRecord(
            id=res["order_id"],
            symbol=req.symbol,
            direction=res["side"],
            entry_price=res["price"],
            stop_loss=0,
            take_profit=0,
            risk_percent=bot.risk_percent,
            setup="Manual UI Order",
            ai_reasoning="Manual execution triggered by trader",
            ai_confidence=100,
            status="EXECUTED",
            timestamp=res["timestamp"],
            amount=res.get("amount", 0.0),
            cost=res.get("cost", 0.0),
            order_id=res["order_id"],
        )
        bot.trade_history.insert(0, trade)
        bot.daily_trades_count += 1
        bot.total_trades       += 1
        bot.add_log(
            f"MANUAL EXECUTED ON BINANCE [{req.symbol}] {res['side']} "
            f"{res['amount']} @ ${res['price']:.2f} (Order ID: {res['order_id']})"
        )
        if res.get("tp_order_id"):
            bot.add_log(
                f"OPEN TP ORDER [{req.symbol}] SELL {res['amount']} "
                f"@ ${res['tp_price']:.2f} (ID: {res['tp_order_id']})"
            )
        return {
            "status": "sent",
            "order_id": res["order_id"],
            "tp_order_id": res.get("tp_order_id"),
            "message": f"Successfully executed {res['side']} {res['amount']} {req.symbol} on Binance Demo!",
        }
    
    err = res.get("error", "Unknown error")
    bot.add_log(f"MANUAL ORDER FAILED [{req.symbol}]: {err}")
    return {"status": "failed", "message": f"Binance rejected: {err}"}


class CancelOrderRequest(BaseModel):
    order_id: str
    symbol:   str


@app.post("/api/order/cancel")
async def cancel_order_api(req: CancelOrderRequest):
    success = await broker.cancel_order(req.order_id, req.symbol)
    if success:
        bot.add_log(f"CANCELED OPEN ORDER on Binance: ID {req.order_id} ({req.symbol})")
        return {"status": "success", "message": f"Order {req.order_id} canceled successfully"}
    return {"status": "failed", "message": f"Failed to cancel order {req.order_id} on Binance"}


@app.get("/api/balance")
async def get_balance():
    bal = await broker.get_balance()
    return {"balances": bal}


@app.get("/api/backtest")
async def get_backtest_results():
    import json, os
    json_path = os.path.join(os.path.dirname(__file__), "data", "backtest_results.json")
    if os.path.exists(json_path):
        with open(json_path, "r") as f:
            return json.load(f)
    return {"summary": None, "trades": []}


# ─── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    logger.info("[SYSTEM] Agent Nexus V2 starting up...")
    asyncio.create_task(autonomous_trading_loop())
    logger.info("[SYSTEM] Trading loop spawned. Engine is IDLE — start from frontend.")


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)
