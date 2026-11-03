"""Backtest runner for Chain-of-CHoCH strategy over Nov 2025 - Nov 2026
Generates summary statistics for XAUUSD (Gold) and BTCUSDT.
"""
import pathlib, sys

def run_backtest(symbol, data_path, start_date, end_date):
    from chain_of_choch_backtest import run_chain_of_choch
    try:
        stats = run_chain_of_choch(
            symbol=symbol,
            path_15m=data_path,
            start_date=start_date,
            end_date=end_date,
        )
        return stats
    except Exception as e:
        print(f"Error running backtest for {symbol}: {e}")
        return None

if __name__ == "__main__":
    results = []
    # Gold - using PAXG proxy file
    gold_path = pathlib.Path(__file__).parent / "data_cache" / "PAXG_15m.pkl"
    btc_path = pathlib.Path(__file__).parent / "data_cache" / "BTC_15m.pkl"
    start = "2025-11-01"
    end = "2026-11-01"
    for sym, p in [("XAUUSD", gold_path), ("BTCUSDT", btc_path)]:
        print(f"\nRunning backtest for {sym} ...")
        stats_tuple = run_backtest(sym, str(p), start, end)
        if stats_tuple:
            stats, trades, _ = stats_tuple
        if stats:
            # Assuming stats is a dict with required fields
            results.append((sym, stats))
            print(f"Summary for {sym}:")
            for k, v in stats.items():
                print(f"  {k}: {v}")
    # Optionally write a summary file
    summary_path = pathlib.Path(__file__).parent / "backtest_2025_2026_report.md"
    with open(summary_path, "w") as f:
        f.write("# Backtest Summary Nov 2025 – Nov 2026\n\n")
        for sym, stats in results:
            f.write(f"## {sym}\n")
            for k, v in stats.items():
                f.write(f"- **{k}**: {v}\n")
            f.write("\n")
    print(f"\nReport written to {summary_path}")
