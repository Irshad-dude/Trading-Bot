import json
import os

def update_platform():
    gold_file = "trading-agent/gold_backtest_jul_oct_2026.json"
    frontend_file = "trading-agent/frontend/public/backtest_results_2026.json"
    backend_file = "trading-agent/backend/data/backtest_results.json"

    with open(gold_file, "r") as f:
        gold_data = json.load(f)

    with open(frontend_file, "r") as f:
        main_data = json.load(f)

    print("Current total trades in main_data:", len(main_data["trades"]))

    gold_summary = {
        "name": "Gold (XAU/USD) [1 Jul - 1 Oct 2026 · 4H Trend + 15M SMC]",
        "symbol": "XAUUSD",
        "period": "1 July 2026 - 1 October 2026",
        "total_trades": gold_data["summary"]["total_trades"],
        "wins": gold_data["summary"]["wins"],
        "losses": gold_data["summary"]["losses"],
        "win_rate": gold_data["summary"]["win_rate"],
        "profit_factor": gold_data["summary"]["profit_factor"],
        "net_pnl_dollars": gold_data["summary"]["net_pnl_dollars"],
        "net_pnl_pct": gold_data["summary"]["net_pnl_pct"],
        "starting_balance": gold_data["summary"]["starting_balance"],
        "ending_balance": gold_data["summary"]["ending_balance"],
        "rr_ratio": "1:2 (Rule #8 First Candle Extreme SL)",
        "max_drawdown_pct": gold_data["summary"]["max_drawdown_pct"],
        "trend_timeframe": "4-Hour (4H)",
        "execution_timeframe": "15-Minute (15M)",
        "strategy_model": "Irshad SMC: 4H Trend -> 15M IDM Sweep -> 15M BOS -> 3-Candle FVG Mitigation",
    }

    # Separate non-gold trades
    non_gold_trades = [t for t in main_data["trades"] if t.get("symbol") != "XAUUSD"]
    print("Non-gold trades count:", len(non_gold_trades))

    gold_trades = gold_data["trades"]
    for t in gold_trades:
        trend_4h = t.get("4h_trend", "BULLISH")
        sl_val = t.get("stop_loss", 0.0)
        tp_val = t.get("take_profit", 0.0)
        direction = t.get("direction", "LONG")
        fvg_top = t.get("fvg_top", 0.0)
        fvg_bot = t.get("fvg_bottom", 0.0)

        t["setup_reason"] = (
            f"Irshad SMC: 4H {trend_4h} + 15M IDM Swept + 15M BOS Break + 15M FVG Touch "
            f"[SL: First Candle Extreme ${sl_val}]"
        )
        t["pattern_type"] = f"4H Trend ({trend_4h}) + 15M FVG Mitigation"
        if t.get("result") == "WIN":
            t["why_outcome"] = (
                f"Target Hit (+2R): Price tested the {direction} FVG zone [${fvg_bot} - ${fvg_top}], "
                f"held first candle extreme (${sl_val}), and expanded cleanly to 1:2 R:R target (${tp_val})."
            )
        else:
            t["why_outcome"] = (
                f"Stop Loss Hit (-1R): Market retraced through the FVG and breached the first candle structural boundary (${sl_val})."
            )

    all_updated_trades = gold_trades + non_gold_trades
    print(f"Updated total trades count: {len(all_updated_trades)} ({len(gold_trades)} Gold trades + {len(non_gold_trades)} other trades)")

    # Update monthly breakdown for XAUUSD
    new_monthly = [m for m in main_data.get("monthly_breakdown", []) if m.get("symbol") != "XAUUSD"]
    for m_stat in gold_data["summary"]["monthly_breakdown"]:
        new_monthly.append({
            "month": m_stat["month"],
            "symbol": "XAUUSD",
            "trades": m_stat["trades"],
            "wins": m_stat["wins"],
            "losses": m_stat["losses"],
            "win_rate": m_stat["win_rate"],
            "net_return_pct": m_stat["net_return_pct"],
        })

    main_data["gold_summary"] = gold_summary
    main_data["trades"] = all_updated_trades
    main_data["monthly_breakdown"] = new_monthly

    with open(frontend_file, "w") as f:
        json.dump(main_data, f, indent=2)

    with open(backend_file, "w") as f:
        json.dump(main_data, f, indent=2)

    print("Successfully updated both files!")

if __name__ == "__main__":
    update_platform()
