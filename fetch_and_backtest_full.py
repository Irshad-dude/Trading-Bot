"""
Fetch 15m candles for PAXG/USDT and BTC/USDT from Nov 1 2025 to Nov 2 2026,
then run the Chain-of-CHoCH backtest and write results for the frontend.
"""
import ccxt
import pandas as pd
import numpy as np
import time
import json
import pathlib
import sys
from datetime import datetime, timezone

BASE_DIR = pathlib.Path(__file__).parent
DATA_DIR = BASE_DIR / "data_cache"

# ── Step 1: Fetch 15m candles ──────────────────────────────────────────────

def fetch_15m_candles(symbol: str, since_str: str, until_str: str) -> pd.DataFrame:
    """Fetch all 15m candles between two ISO dates from Binance."""
    exchange = ccxt.binance({"enableRateLimit": True, "options": {"defaultType": "spot"}})
    
    since_ms = exchange.parse8601(since_str + "T00:00:00Z")
    until_ms = exchange.parse8601(until_str + "T23:59:59Z")
    
    all_ohlcv = []
    cursor = since_ms
    batch = 0
    
    while cursor < until_ms:
        batch += 1
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe="15m", since=cursor, limit=1000)
        except Exception as e:
            print(f"  Fetch error at batch {batch}: {e}, retrying in 5s...")
            time.sleep(5)
            continue
        
        if not ohlcv:
            break
        
        all_ohlcv.extend(ohlcv)
        last_ts = ohlcv[-1][0]
        
        if last_ts <= cursor:
            break
        cursor = last_ts + 1  # next ms after last candle
        
        if batch % 10 == 0:
            print(f"  ... fetched {len(all_ohlcv)} candles so far (batch {batch})")
        
        time.sleep(0.2)  # respect rate limits
    
    df = pd.DataFrame(all_ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    
    # Filter strictly to range
    df = df[(df["timestamp"] >= since_str) & (df["timestamp"] <= until_str + " 23:59:59+00:00")]
    df = df.reset_index(drop=True)
    
    return df


def fetch_and_save():
    """Fetch fresh data and save to pickle."""
    pairs = [
        ("PAXG/USDT", "PAXG_15m_full.pkl"),
        ("BTC/USDT",  "BTC_15m_full.pkl"),
    ]
    
    for symbol, filename in pairs:
        out_path = DATA_DIR / filename
        print(f"\n{'='*60}")
        print(f"Fetching {symbol} 15m candles: 2025-11-01 to 2026-11-02")
        print(f"{'='*60}")
        
        df = fetch_15m_candles(symbol, "2025-11-01", "2026-11-02")
        print(f"Total candles fetched: {len(df)}")
        print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
        
        df.to_pickle(str(out_path))
        print(f"Saved to {out_path}")
    
    return True


# ── Step 2: Run backtest ──────────────────────────────────────────────────

def run_full_backtest():
    """Run backtest for both symbols and write JSON for frontend."""
    sys.path.insert(0, str(BASE_DIR))
    from chain_of_choch_backtest import run_chain_of_choch
    
    configs = [
        ("XAUUSD", str(DATA_DIR / "PAXG_15m_full.pkl"), 35.0),
        ("BTCUSDT", str(DATA_DIR / "BTC_15m_full.pkl"), 30.0),
    ]
    
    all_results = {}
    all_trades = []
    all_trade_candles = {}
    
    for symbol, data_path, min_angle in configs:
        print(f"\n{'='*60}")
        print(f"Running Chain-of-CHoCH backtest: {symbol} (Min Angle = {min_angle}\u00b0)")
        print(f"{'='*60}")
        
        try:
            result = run_chain_of_choch(
                symbol=symbol,
                path_15m=data_path,
                start_date="2025-11-01",
                end_date="2026-11-02 23:59:59",
                min_trend_angle=min_angle,
            )
            
            if isinstance(result, tuple):
                stats, trades, meta = result
            else:
                stats = result
                trades = []
                meta = {}
            
            # Compute per-trade max drawdown
            peak_balance = 10000.0
            for t in trades:
                rb = t.get("running_balance", 10000.0)
                if rb > peak_balance:
                    peak_balance = rb
                dd_pct = round((peak_balance - rb) / peak_balance * 100, 2) if peak_balance > 0 else 0
                t["max_drawdown_pct"] = dd_pct
            
            # Compute overall max drawdown
            peak = 10000.0
            max_dd = 0.0
            for t in trades:
                rb = t.get("running_balance", 10000.0)
                if rb > peak:
                    peak = rb
                dd = (peak - rb) / peak * 100
                if dd > max_dd:
                    max_dd = dd
            
            stats["max_drawdown_pct"] = round(max_dd, 2)
            
            all_results[symbol] = stats
            all_trades.extend(trades)
            
            # Collect trade candle windows from meta
            if isinstance(meta, dict) and "trade_candles" in meta:
                all_trade_candles.update(meta["trade_candles"])
            elif isinstance(meta, dict):
                all_trade_candles.update(meta)
            
            print(f"\n{symbol} Results:")
            print(f"  Total Trades: {stats.get('total_trades', len(trades))}")
            print(f"  Win Rate: {stats.get('win_rate', 'N/A')}")
            print(f"  Max Drawdown: {stats.get('max_drawdown_pct', 'N/A')}%")
            print(f"  Final Balance: {stats.get('final_balance', 'N/A')}")
            
        except Exception as e:
            print(f"ERROR running {symbol}: {e}")
            import traceback
            traceback.print_exc()
    
    # ── Write JSON for frontend ──
    frontend_public = BASE_DIR / "frontend" / "public"
    frontend_public.mkdir(parents=True, exist_ok=True)
    
    # Main results file
    output = {
        "summary": all_results,
        "trades": all_trades,
        "period": {"start": "2025-11-01", "end": "2026-11-02"},
    }
    
    results_path = frontend_public / "backtest_results_2026.json"
    with open(results_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\nResults written to {results_path}")
    
    # Also write to backend/data for API
    backend_data = BASE_DIR / "backend" / "data"
    backend_data.mkdir(parents=True, exist_ok=True)
    with open(backend_data / "backtest_results.json", "w") as f:
        json.dump(output, f, indent=2, default=str)
    
    # Trade candles file
    candles_path = frontend_public / "trade_candles.json"
    with open(candles_path, "w") as f:
        json.dump(all_trade_candles, f, indent=2, default=str)
    print(f"Trade candles written to {candles_path}")

    # Export CSV files
    if all_trades:
        df_trades = pd.DataFrame(all_trades)
        df_trades.to_csv(frontend_public / "backtest_trades_2025_2026.csv", index=False)
        df_trades.to_csv(frontend_public / "backtest_trades_jan_oct_2026.csv", index=False)
        print(f"CSV files exported with {len(df_trades)} trades")
    
    # Also write markdown report
    report_path = BASE_DIR / "backtest_2025_2026_report.md"
    with open(report_path, "w") as f:
        f.write("# Backtest Report: Chain-of-CHoCH Strategy\n")
        f.write(f"**Period:** Nov 1, 2025 → Nov 2, 2026\n\n")
        for sym, stats in all_results.items():
            f.write(f"## {sym}\n")
            for k, v in stats.items():
                f.write(f"- **{k}**: {v}\n")
            f.write("\n")
        f.write(f"\n## Trade Details\n\n")
        f.write(f"| # | Symbol | Direction | Entry Time | Entry Price | Exit Price | Angle | Result | PnL% | DD% |\n")
        f.write(f"|---|--------|-----------|------------|-------------|------------|-------|--------|------|-----|\n")
        for t in all_trades:
            f.write(f"| {t.get('trade_num','')} | {t.get('symbol','')} | {t.get('direction','')} | {t.get('entry_time','')} | {t.get('entry_price','')} | {t.get('exit_price','')} | {t.get('angle','')}\u00b0 | {t.get('result','')} | {t.get('pnl_percent','')}% | {t.get('max_drawdown_pct','')}% |\n")
    print(f"Report written to {report_path}")
    
    return all_results, all_trades


# ── Main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    paxg_file = DATA_DIR / "PAXG_15m_full.pkl"
    btc_file = DATA_DIR / "BTC_15m_full.pkl"
    if not paxg_file.exists() or not btc_file.exists():
        print("STEP 1: Fetching fresh 15m data from Binance...")
        fetch_and_save()
    else:
        print("Existing 15m data found in data_cache! Skipping download.")
    
    print("\n\nSTEP 2: Running backtest with 40-45 deg Trend Angle & Sideways Filter...")
    run_full_backtest()
    
    print("\n\nDONE! All results written to frontend/public/ and backend/data/")
