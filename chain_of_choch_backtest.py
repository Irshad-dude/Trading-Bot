import os
import sys
import json
import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple

# Ensure backend package is importable when executed from repo root or scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backend.strategy.chain_of_choch import ChainOfChochEngine, get_session_name, IST


def run_chain_of_choch(
    symbol: str = "XAUUSD",
    path_15m: str = "trading-agent/data_cache/PAXG_15m.pkl",
    start_date: str = "2026-08-01",
    end_date: str = "2026-10-15 23:59:59",
    min_trend_angle: float = 35.0,
    starting_balance: float = 10000.0,
    risk_percent: float = 1.0,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Historical backtest wrapper that executes the canonical ChainOfChochEngine
    shared identically with the live trading engine.
    """
    print("=" * 70)
    print(f"  RUNNING UNIFIED CHAIN-OF-CHOCH ENGINE: {symbol}")
    print(f"  PERIOD: {start_date} TO {end_date}")
    print(f"  TIMEFRAME: PURE 15M (BOS CONTINUATION + CHOCH REVERSAL)")
    print(f"  FILTER: TRENDING IMPULSE (ANGLE >= {min_trend_angle}°, NO SIDEWAYS CHOP)")
    print(f"  RULE #8 C1 SL & RULE #9 1:2 TP & STRICT BODY CHOCH BREAK")
    print("=" * 70)

    df_raw = pd.read_pickle(path_15m).reset_index(drop=True)
    df_raw["dt"] = pd.to_datetime(df_raw["timestamp"])
    df = df_raw[(df_raw["dt"] >= start_date) & (df_raw["dt"] <= end_date)].reset_index(drop=True)
    print(f"Loaded {len(df)} 15M candles for {symbol}")

    engine = ChainOfChochEngine()
    trades, trade_candles_dict, balance, _ = engine.run_backtest_dataframe(
        df_raw=df,
        symbol=symbol,
        min_trend_angle=min_trend_angle,
        starting_balance=starting_balance,
        risk_percent=risk_percent,
        capture_windows=True,
    )

    total = len(trades)
    wins = len([t for t in trades if t["result"] == "WIN"])
    losses = len([t for t in trades if t["result"] == "LOSS"])
    wr = (wins / total * 100) if total > 0 else 0
    pnl = balance - starting_balance
    ret = (pnl / starting_balance) * 100

    gross_profits = sum([t["pnl_dollar"] for t in trades if t["pnl_dollar"] > 0])
    gross_losses = abs(sum([t["pnl_dollar"] for t in trades if t["pnl_dollar"] < 0]))
    pf = round(gross_profits / gross_losses, 2) if gross_losses > 0 else 999.0

    peak = starting_balance
    max_dd = 0.0
    for t in trades:
        bal = t["running_balance"]
        if bal > peak:
            peak = bal
        dd = (peak - bal) / peak * 100.0
        if dd > max_dd:
            max_dd = dd

    monthly_map = {}
    for t in trades:
        m = t["entry_time"][:7]
        if m not in monthly_map:
            monthly_map[m] = {"month": m, "symbol": symbol, "trades": 0, "wins": 0, "losses": 0, "net_return_pct": 0.0}
        monthly_map[m]["trades"] += 1
        if t["result"] == "WIN":
            monthly_map[m]["wins"] += 1
            monthly_map[m]["net_return_pct"] += 2.0 * risk_percent
        else:
            monthly_map[m]["losses"] += 1
            monthly_map[m]["net_return_pct"] -= risk_percent

    monthly_breakdown = []
    for m in sorted(monthly_map.keys()):
        item = monthly_map[m]
        item["win_rate"] = round(item["wins"] / item["trades"] * 100, 1) if item["trades"] > 0 else 0
        item["net_return_pct"] = round(item["net_return_pct"], 1)
        monthly_breakdown.append(item)

    reversals = len([t for t in trades if t["trade_type"] == "REVERSAL_CHOCH"])
    continuations = len([t for t in trades if t["trade_type"] == "CONTINUATION_BOS"])

    summary = {
        "name": f"{'Gold (XAU/USD)' if ('XAU' in symbol or 'PAXG' in symbol) else ('US30 (Dow Jones)' if ('US30' in symbol or 'DJI' in symbol or 'YM' in symbol) else 'Bitcoin (BTC/USDT)')} [15M Trending SMC · Mar 2026 – Nov 2026]",
        "symbol": symbol,
        "period": f"{start_date} - {end_date[:10]}",
        "total_trades": total,
        "wins": wins,
        "losses": losses,
        "win_rate": round(wr, 2),
        "profit_factor": pf,
        "net_pnl_dollars": round(pnl, 2),
        "net_pnl_pct": round(ret, 2),
        "starting_balance": starting_balance,
        "ending_balance": round(balance, 2),
        "rr_ratio": "1:2 (Rule #8 First Candle Extreme SL)",
        "max_drawdown_pct": round(max_dd, 2),
        "trade_breakdown": f"{continuations} Continuations (BOS) | {reversals} Reversals (CHoCH)",
        "trend_timeframe": "15-Minute (15M Dynamic CHoCH)",
        "execution_timeframe": "15-Minute (15M)",
        "strategy_model": "Irshad SMC: 15M IDM -> 15M BOS -> Chain-of-CHoCH -> 3-Candle FVG Retrace Touch",
        "monthly_breakdown": monthly_breakdown,
    }

    print(f"\nRESULTS FOR {symbol}:")
    print(f"Total Trades: {total} ({wins}W / {losses}L)")
    print(f"Win Rate: {wr:.2f}% | Profit Factor: {pf}")
    print(f"Net PnL: ${pnl:.2f} ({ret:+.2f}%) | Max Drawdown: {max_dd:.2f}%")
    print(f"Breakdown: {continuations} Continuations (BOS) | {reversals} Reversals (CHoCH)")

    return summary, trades, trade_candles_dict


def export_all():
    g_sum, g_trades, g_candles = run_chain_of_choch(
        symbol="XAUUSD",
        path_15m="trading-agent/data_cache/PAXG_15m.pkl",
        start_date="2026-08-01",
        end_date="2026-10-15 23:59:59",
    )

    b_sum, b_trades, b_candles = run_chain_of_choch(
        symbol="BTCUSDT",
        path_15m="trading-agent/data_cache/BTC_15m.pkl",
        start_date="2026-08-01",
        end_date="2026-10-15 23:59:59",
    )

    frontend_results_path = "trading-agent/frontend/public/backtest_results_2026.json"
    backend_results_path = "trading-agent/backend/data/backtest_results.json"
    frontend_candles_path = "trading-agent/frontend/public/trade_candles.json"
    backend_candles_path = "trading-agent/backend/data/trade_candles.json"

    main_data = {}
    if os.path.exists(frontend_results_path):
        with open(frontend_results_path, "r") as f:
            main_data = json.load(f)

    other_trades = [t for t in main_data.get("trades", []) if t.get("symbol") not in ("XAUUSD", "BTCUSDT")]
    combined_trades = g_trades + b_trades + other_trades

    total_trades_count = len(g_trades) + len(b_trades)
    total_wins_count = g_sum["wins"] + b_sum["wins"]
    combined_pnl = g_sum["net_pnl_dollars"] + b_sum["net_pnl_dollars"]
    combined_starting = g_sum["starting_balance"] + b_sum["starting_balance"]

    main_data["gold_summary"] = g_sum
    main_data["btc_summary"] = b_sum
    main_data["summary"] = {
        "name": "Combined Multi-Asset Portfolio [15M Chain-of-CHoCH]",
        "total_trades": total_trades_count,
        "wins": total_wins_count,
        "losses": total_trades_count - total_wins_count,
        "win_rate": round(total_wins_count / total_trades_count * 100, 2) if total_trades_count > 0 else 0,
        "profit_factor": round((g_sum["profit_factor"] + b_sum["profit_factor"]) / 2, 2),
        "net_pnl_dollars": round(combined_pnl, 2),
        "net_pnl_pct": round(combined_pnl / combined_starting * 100, 2),
        "starting_balance": combined_starting,
        "ending_balance": round(combined_starting + combined_pnl, 2),
        "rr_ratio": "1:2 (Rule #8 First Candle Extreme SL)",
    }
    main_data["trades"] = combined_trades

    merged_monthly = g_sum["monthly_breakdown"] + b_sum["monthly_breakdown"]
    other_monthly = [m for m in main_data.get("monthly_breakdown", []) if m.get("symbol") not in ("XAUUSD", "BTCUSDT")]
    main_data["monthly_breakdown"] = merged_monthly + other_monthly

    with open(frontend_results_path, "w") as f:
        json.dump(main_data, f, indent=2)
    with open(backend_results_path, "w") as f:
        json.dump(main_data, f, indent=2)
    print(f"Exported backtest results to {frontend_results_path} and {backend_results_path}")

    candles_map = {}
    if os.path.exists(frontend_candles_path):
        with open(frontend_candles_path, "r") as f:
            candles_map = json.load(f)

    candles_map.update(g_candles)
    candles_map.update(b_candles)

    with open(frontend_candles_path, "w") as f:
        json.dump(candles_map, f)
    if os.path.exists(os.path.dirname(backend_candles_path)):
        with open(backend_candles_path, "w") as f:
            json.dump(candles_map, f)
    print(f"Exported {len(g_candles)} Gold + {len(b_candles)} BTC trade windows to {frontend_candles_path}")


if __name__ == "__main__":
    export_all()
