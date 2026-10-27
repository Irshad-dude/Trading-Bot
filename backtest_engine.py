import pandas as pd
import numpy as np
import datetime
from typing import List, Dict, Any


def run_smc_backtest(
    symbol: str,
    df_exec_path: str,
    df_macro_path: str,
    pivot_length: int = 3,
    risk_per_trade_percent: float = 1.0,
    starting_balance: float = 10000.0,
) -> Dict[str, Any]:
    print(f"\n==========================================")
    print(f"  RUNNING SMC BACKTEST FOR {symbol} (Jan 1 - Oct 1, 2026)")
    print(f"==========================================")

    df_exec = pd.read_pickle(df_exec_path).reset_index(drop=True)
    df_macro = pd.read_pickle(df_macro_path).reset_index(drop=True)

    # 1. Precalculate 4H Trend (EMA50 + EMA200)
    df_macro["ema50"] = df_macro["close"].ewm(span=50, adjust=False).mean()
    df_macro["ema200"] = df_macro["close"].ewm(span=200, adjust=False).mean()
    df_macro["macro_trend"] = np.where(
        (df_macro["close"] >= df_macro["ema200"]) & (df_macro["ema50"] >= df_macro["ema50"].shift(3)),
        "BULLISH",
        np.where(
            (df_macro["close"] <= df_macro["ema200"]) & (df_macro["ema50"] <= df_macro["ema50"].shift(3)),
            "BEARISH",
            np.where(df_macro["close"] >= df_macro["ema200"], "BULLISH", "BEARISH")
        )
    )

    # Merge macro trend onto execution candles by asof timestamp
    df_macro_lookup = df_macro[["timestamp", "macro_trend"]].sort_values("timestamp")
    df_exec = pd.merge_asof(
        df_exec.sort_values("timestamp"),
        df_macro_lookup,
        on="timestamp",
        direction="backward"
    ).fillna({"macro_trend": "BULLISH"})

    # 2. Identify Fractal Swing Points on Execution Timeframe
    n = pivot_length
    df_exec["swing_high"] = np.nan
    df_exec["swing_low"] = np.nan

    for i in range(n, len(df_exec) - n):
        wh = df_exec["high"].iloc[i - n : i + n + 1]
        wl = df_exec["low"].iloc[i - n : i + n + 1]
        if df_exec["high"].iloc[i] == wh.max():
            df_exec.iloc[i, df_exec.columns.get_loc("swing_high")] = df_exec["high"].iloc[i]
        if df_exec["low"].iloc[i] == wl.min():
            df_exec.iloc[i, df_exec.columns.get_loc("swing_low")] = df_exec["low"].iloc[i]

    df_exec["last_sh"] = df_exec["swing_high"].ffill()
    df_exec["last_sl"] = df_exec["swing_low"].ffill()

    # 3. Detect BOS & FVGs
    df_exec["bos_type"] = None
    for i in range(1, len(df_exec)):
        c = df_exec.iloc[i]
        p = df_exec.iloc[i - 1]
        if pd.notna(c["last_sh"]) and c["close"] > c["last_sh"] and p["close"] <= c["last_sh"]:
            df_exec.iloc[i, df_exec.columns.get_loc("bos_type")] = "BULLISH_BOS"
        elif pd.notna(c["last_sl"]) and c["close"] < c["last_sl"] and p["close"] >= c["last_sl"]:
            df_exec.iloc[i, df_exec.columns.get_loc("bos_type")] = "BEARISH_BOS"

    # Calculate ATR
    h, l, c = df_exec["high"], df_exec["low"], df_exec["close"]
    prev_c = c.shift(1)
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    df_exec["atr"] = tr.rolling(14).mean().fillna(10.0)

    # 4. Simulation Walk-forward Loop
    trades: List[Dict[str, Any]] = []
    active_position: Optional[Dict[str, Any]] = None
    balance = starting_balance
    equity_curve = [starting_balance]

    # Pre-find all FVGs
    fvgs: List[Dict[str, Any]] = []
    for i in range(2, len(df_exec)):
        c1, c3 = df_exec.iloc[i - 2], df_exec.iloc[i]
        if c3["low"] > c1["high"]:
            fvgs.append({"index": i, "timestamp": c3["timestamp"], "type": "BULLISH", "top": float(c3["low"]), "bottom": float(c1["high"]), "mitigated": False})
        elif c3["high"] < c1["low"]:
            fvgs.append({"index": i, "timestamp": c3["timestamp"], "type": "BEARISH", "top": float(c1["low"]), "bottom": float(c3["high"]), "mitigated": False})

    fvg_idx = 0
    num_fvgs = len(fvgs)

    for i in range(30, len(df_exec)):
        bar = df_exec.iloc[i]
        ts = bar["timestamp"]
        cur_price = float(bar["close"])
        cur_high = float(bar["high"])
        cur_low = float(bar["low"])
        trend = bar["macro_trend"]
        atr = float(bar["atr"])

        # Advance FVGs up to current candle
        while fvg_idx < num_fvgs and fvgs[fvg_idx]["index"] <= i:
            fvg_idx += 1
        
        # Consider unmitigated FVGs created in the last 20 candles
        active_fvgs = [f for f in fvgs[:fvg_idx] if not f["mitigated"] and (i - f["index"]) <= 20]

        # ── Check active position exit ──────────────────────────────────────────
        if active_position is not None:
            pos = active_position
            hit_tp = False
            hit_sl = False

            if pos["direction"] == "LONG":
                if cur_high >= pos["take_profit"]:
                    hit_tp = True
                elif cur_low <= pos["stop_loss"]:
                    hit_sl = True
            elif pos["direction"] == "SHORT":
                if cur_low <= pos["take_profit"]:
                    hit_tp = True
                elif cur_high >= pos["stop_loss"]:
                    hit_sl = True

            if hit_tp or hit_sl:
                outcome = "WIN" if hit_tp else "LOSS"
                exit_price = pos["take_profit"] if hit_tp else pos["stop_loss"]
                
                # Risk-Reward 1:2 calculation:
                # Risk = 1R (e.g. 1.0% of balance), Win = 2R (e.g. +2.0% of balance)
                risk_amount = balance * (risk_per_trade_percent / 100.0)
                pnl_dollars = (risk_amount * 2.0) if hit_tp else (-risk_amount)
                pnl_percent = 2.0 * risk_per_trade_percent if hit_tp else (-risk_per_trade_percent)
                balance += pnl_dollars
                equity_curve.append(balance)

                trades.append({
                    "trade_num": len(trades) + 1,
                    "symbol": symbol,
                    "direction": pos["direction"],
                    "entry_time": pos["entry_time"],
                    "entry_price": pos["entry_price"],
                    "exit_time": ts,
                    "exit_price": exit_price,
                    "stop_loss": pos["stop_loss"],
                    "take_profit": pos["take_profit"],
                    "risk_distance": pos["risk_distance"],
                    "rr_ratio": "1:2",
                    "result": outcome,
                    "pnl_percent": round(pnl_percent, 2),
                    "pnl_dollar": round(pnl_dollars, 2),
                    "running_balance": round(balance, 2),
                    "setup_reason": pos["setup_reason"],
                })
                active_position = None

        # ── Check for new entry if no active position ───────────────────────────
        if active_position is None:
            # Bullish Entry: 4H Bullish + Price Retraces into Bullish FVG
            if trend == "BULLISH":
                bullish_fvgs = [f for f in active_fvgs if f["type"] == "BULLISH"]
                for fvg in reversed(bullish_fvgs):
                    # Price dips into FVG zone
                    if cur_low <= fvg["top"] and cur_price >= fvg["bottom"]:
                        swing_low = float(bar["last_sl"]) if pd.notna(bar["last_sl"]) else fvg["bottom"]
                        sl = round(min(swing_low, fvg["bottom"]) - 0.2 * atr, 2)
                        risk_dist = cur_price - sl

                        if risk_dist > (0.1 * atr): # Ensure meaningful risk distance
                            tp = round(cur_price + (2.0 * risk_dist), 2)
                            fvg["mitigated"] = True
                            active_position = {
                                "symbol": symbol,
                                "direction": "LONG",
                                "entry_time": ts,
                                "entry_price": cur_price,
                                "stop_loss": sl,
                                "take_profit": tp,
                                "risk_distance": round(risk_dist, 2),
                                "setup_reason": f"SMC 1:2: 4H Bullish + FVG Mitigation [{fvg['bottom']:.2f} - {fvg['top']:.2f}]",
                            }
                            break

            # Bearish Entry: 4H Bearish + Price Retraces into Bearish FVG
            elif trend == "BEARISH":
                bearish_fvgs = [f for f in active_fvgs if f["type"] == "BEARISH"]
                for fvg in reversed(bearish_fvgs):
                    # Price rises into FVG zone
                    if cur_high >= fvg["bottom"] and cur_price <= fvg["top"]:
                        swing_high = float(bar["last_sh"]) if pd.notna(bar["last_sh"]) else fvg["top"]
                        sl = round(max(swing_high, fvg["top"]) + 0.2 * atr, 2)
                        risk_dist = sl - cur_price

                        if risk_dist > (0.1 * atr):
                            tp = round(cur_price - (2.0 * risk_dist), 2)
                            fvg["mitigated"] = True
                            active_position = {
                                "symbol": symbol,
                                "direction": "SHORT",
                                "entry_time": ts,
                                "entry_price": cur_price,
                                "stop_loss": sl,
                                "take_profit": tp,
                                "risk_distance": round(risk_dist, 2),
                                "setup_reason": f"SMC 1:2: 4H Bearish + FVG Mitigation [{fvg['bottom']:.2f} - {fvg['top']:.2f}]",
                            }
                            break

    # Metrics computation
    total_trades = len(trades)
    if total_trades == 0:
        print(f"No trades triggered for {symbol}.")
        return {"total_trades": 0, "trades": []}

    wins = [t for t in trades if t["result"] == "WIN"]
    losses = [t for t in trades if t["result"] == "LOSS"]
    win_count = len(wins)
    loss_count = len(losses)
    win_rate = (win_count / total_trades) * 100.0

    total_profit_dollars = sum(t["pnl_dollar"] for t in wins)
    total_loss_dollars = abs(sum(t["pnl_dollar"] for t in losses)) if loss_count > 0 else 0.001
    profit_factor = round(total_profit_dollars / total_loss_dollars, 2)

    net_profit_dollar = balance - starting_balance
    net_profit_percent = ((balance - starting_balance) / starting_balance) * 100.0

    # Max Drawdown
    equity_arr = np.array(equity_curve)
    peaks = np.maximum.accumulate(equity_arr)
    drawdowns = (equity_arr - peaks) / peaks
    max_drawdown_pct = round(abs(drawdowns.min()) * 100.0, 2)

    summary = {
        "symbol": symbol,
        "period": "January 1, 2026 - October 1, 2026 (9 Months)",
        "starting_balance": starting_balance,
        "ending_balance": round(balance, 2),
        "net_profit_dollar": round(net_profit_dollar, 2),
        "net_profit_percent": round(net_profit_percent, 2),
        "total_trades": total_trades,
        "wins": win_count,
        "losses": loss_count,
        "win_rate_accuracy": round(win_rate, 2),
        "profit_factor": profit_factor,
        "max_drawdown_pct": max_drawdown_pct,
        "rr_ratio": "1:2 Strict",
        "trades": trades,
    }

    print(f"\n--- {symbol} SMC BACKTEST RESULTS ---")
    print(f"Total Trades: {total_trades}")
    print(f"Wins: {win_count} | Losses: {loss_count}")
    print(f"Win Rate (Accuracy): {win_rate:.2f}%")
    print(f"Profit Factor: {profit_factor}")
    print(f"Max Drawdown: {max_drawdown_pct}%")
    print(f"Net Return: {net_profit_percent:+.2f}% (${net_profit_dollar:+,.2f})")
    print(f"Final Balance: ${balance:,.2f} (from ${starting_balance:,.2f})")
    print(f"----------------------------------------\n")

    return summary
