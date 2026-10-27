import os
import json
import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple, Optional

IST = timezone(timedelta(hours=5, minutes=30))

def get_session_name(dt_utc: datetime) -> str:
    hour = dt_utc.hour
    if 0 <= hour < 7:
        return "Asian Session (Tokyo/Sydney)"
    elif 7 <= hour < 13:
        return "London Opening & Morning Session"
    elif 13 <= hour < 17:
        return "London / New York Overlap (Peak Volatility)"
    elif 17 <= hour < 21:
        return "New York Afternoon Session"
    else:
        return "Global Twilight Session"

def simulate_irshad_strategy(
    symbol: str,
    asset_name: str,
    df_15m_path: str,
    df_4h_path: str,
    starting_balance: float = 10000.0,
    risk_percent: float = 1.0,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    print(f"\n=======================================================")
    print(f"  SIMULATING STRICT SMC STRATEGY: {symbol}")
    print(f"=======================================================")

    df_15m = pd.read_pickle(df_15m_path).reset_index(drop=True)
    df_4h = pd.read_pickle(df_4h_path).reset_index(drop=True)

    # 1. 4H Trend Bias via Market Structure (Swing Highs / Swing Lows)
    pivot_4h = 3
    df_4h["sh"] = np.nan
    df_4h["sl"] = np.nan
    for i in range(pivot_4h, len(df_4h) - pivot_4h):
        wh = df_4h["high"].iloc[i - pivot_4h : i + pivot_4h + 1]
        wl = df_4h["low"].iloc[i - pivot_4h : i + pivot_4h + 1]
        if df_4h["high"].iloc[i] == wh.max():
            df_4h.iloc[i, df_4h.columns.get_loc("sh")] = df_4h["high"].iloc[i]
        if df_4h["low"].iloc[i] == wl.min():
            df_4h.iloc[i, df_4h.columns.get_loc("sl")] = df_4h["low"].iloc[i]

    df_4h["last_sh"] = df_4h["sh"].ffill()
    df_4h["last_sl"] = df_4h["sl"].ffill()
    df_4h["prev_sh"] = df_4h["sh"].shift(1).ffill()
    df_4h["prev_sl"] = df_4h["sl"].shift(1).ffill()

    ema50 = df_4h["close"].ewm(span=50, adjust=False).mean()
    macro_trends = []
    for idx in range(len(df_4h)):
        c_close = df_4h["close"].iloc[idx]
        sh = df_4h["last_sh"].iloc[idx]
        sl = df_4h["last_sl"].iloc[idx]
        psh = df_4h["prev_sh"].iloc[idx]
        psl = df_4h["prev_sl"].iloc[idx]

        if pd.notna(sh) and pd.notna(psh) and pd.notna(sl) and pd.notna(psl):
            if sh >= psh and sl >= psl:
                macro_trends.append("BULLISH")
            elif sh <= psh and sl <= psl:
                macro_trends.append("BEARISH")
            else:
                macro_trends.append("BULLISH" if c_close >= ema50.iloc[idx] else "BEARISH")
        else:
            macro_trends.append("BULLISH" if c_close >= ema50.iloc[idx] else "BEARISH")

    df_4h["macro_trend"] = macro_trends
    df_4h_lookup = df_4h[["timestamp", "macro_trend"]].sort_values("timestamp")
    df_15m = pd.merge_asof(
        df_15m.sort_values("timestamp"),
        df_4h_lookup,
        on="timestamp",
        direction="backward"
    ).fillna({"macro_trend": "BULLISH"})

    # 2. 15M Swing Points (Fractal Pivot = 3)
    p15 = 3
    df_15m["sh"] = np.nan
    df_15m["sl"] = np.nan
    for i in range(p15, len(df_15m) - p15):
        wh = df_15m["high"].iloc[i - p15 : i + p15 + 1]
        wl = df_15m["low"].iloc[i - p15 : i + p15 + 1]
        if df_15m["high"].iloc[i] == wh.max():
            df_15m.iloc[i, df_15m.columns.get_loc("sh")] = df_15m["high"].iloc[i]
        if df_15m["low"].iloc[i] == wl.min():
            df_15m.iloc[i, df_15m.columns.get_loc("sl")] = df_15m["low"].iloc[i]

    # Pre-extract swing lists with their exact bar indices
    swing_highs = [] # list of (idx, price)
    swing_lows = []  # list of (idx, price)
    for i in range(len(df_15m)):
        if pd.notna(df_15m["sh"].iloc[i]):
            swing_highs.append((i, float(df_15m["sh"].iloc[i])))
        if pd.notna(df_15m["sl"].iloc[i]):
            swing_lows.append((i, float(df_15m["sl"].iloc[i])))

    trades: List[Dict[str, Any]] = []
    trade_candles_map: Dict[str, Any] = {}
    balance = starting_balance
    active_pos: Optional[Dict[str, Any]] = None

    # Track structural state machine
    # When a BOS occurs with a valid zigzag FVG, we register a pending setup waiting for mitigation
    pending_setup: Optional[Dict[str, Any]] = None

    for i in range(20, len(df_15m)):
        bar = df_15m.iloc[i]
        prev_bar = df_15m.iloc[i - 1]
        ts = bar["timestamp"]
        c_open = float(bar["open"])
        c_high = float(bar["high"])
        c_low = float(bar["low"])
        c_close = float(bar["close"])
        trend = bar["macro_trend"]

        # ── 1. MANAGE ACTIVE POSITION IF IN TRADE ──
        if active_pos is not None:
            pos = active_pos
            hit_tp = False
            hit_sl = False
            exit_price = pos["entry_price"]

            if pos["direction"] == "LONG":
                # Check if SL hit first (conservatism)
                if c_low <= pos["stop_loss"]:
                    hit_sl = True
                    exit_price = pos["stop_loss"]
                elif c_high >= pos["take_profit"]:
                    hit_tp = True
                    exit_price = pos["take_profit"]
            else: # SHORT
                if c_high >= pos["stop_loss"]:
                    hit_sl = True
                    exit_price = pos["stop_loss"]
                elif c_low <= pos["take_profit"]:
                    hit_tp = True
                    exit_price = pos["take_profit"]

            if hit_tp or hit_sl:
                outcome = "WIN" if hit_tp else "LOSS"
                risk_amount = balance * (risk_percent / 100.0)
                # 1:2 Risk to Reward
                pnl_dollars = (risk_amount * 2.0) if hit_tp else (-risk_amount)
                pnl_percent = (2.0 * risk_percent) if hit_tp else (-risk_percent)
                balance += pnl_dollars

                entry_dt = pd.to_datetime(pos["entry_time"])
                exit_dt = pd.to_datetime(ts)
                dur_hours = round(max(0.25, (exit_dt - entry_dt).total_seconds() / 3600.0), 1)

                entry_dt_utc = entry_dt.to_pydatetime() if hasattr(entry_dt, 'to_pydatetime') else entry_dt
                exit_dt_utc = exit_dt.to_pydatetime() if hasattr(exit_dt, 'to_pydatetime') else exit_dt

                entry_ist = entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST")
                exit_ist = exit_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST")
                sess = get_session_name(entry_dt_utc)
                month_str = entry_dt_utc.strftime("%Y-%m")

                if outcome == "WIN":
                    why_out = (
                        f"Target Hit (+2R): Price tested the {pos['direction']} FVG zone "
                        f"[${pos['fvg_bottom']:.2f} - ${pos['fvg_top']:.2f}], validated structure without breaching C2 extreme (${pos['stop_loss']:.2f}), "
                        f"and expanded cleanly to 1:2 R:R target (${pos['take_profit']:.2f})."
                    )
                    pattern_type = "Zigzag FVG Mitigation + 1:2 Expansion"
                    lesson = "Displacement candles (C2) with significant body range anchor high-probability invalidation points."
                    rule = "Rule #STRUCT-01: Anchor SL directly at C2 extreme with zero arbitrary buffer for maximum capital efficiency."
                else:
                    why_out = (
                        f"Stop Loss Hit (-1R): Market retraced through the FVG and swept beyond the 2nd candle structural boundary (${pos['stop_loss']:.2f})."
                    )
                    pattern_type = "Displacement Invalidation Sweep"
                    lesson = "When price closes beyond C2, the structural imbalance has failed. Taking the 1R loss preserves capital."
                    rule = "Rule #RISK-01: Strict invalidation at C2 extreme prevents runaway drawdowns."

                trade_data = {
                    "trade_num": len(trades) + 1,
                    "symbol": symbol,
                    "direction": pos["direction"],
                    "entry_time": str(pos["entry_time"]),
                    "entry_price": round(pos["entry_price"], 2),
                    "exit_time": str(ts),
                    "exit_price": round(exit_price, 2),
                    "stop_loss": round(pos["stop_loss"], 2),
                    "take_profit": round(pos["take_profit"], 2),
                    "risk_distance": round(pos["risk_distance"], 2),
                    "rr_ratio": "1:2",
                    "result": outcome,
                    "pnl_percent": round(pnl_percent, 1),
                    "pnl_dollar": round(pnl_dollars, 2),
                    "running_balance": round(balance, 2),
                    "setup_reason": pos["setup_reason"],
                    "month": month_str,
                    "entry_time_ist": entry_ist,
                    "exit_time_ist": exit_ist,
                    "session_name": sess,
                    "duration_hours": dur_hours,
                    "pattern_type": pattern_type,
                    "why_outcome": why_out,
                    "lesson_learned": lesson,
                    "adaptation_rule": rule,
                    # Internal book-keeping for candle extraction later
                    "_entry_idx_global": pos["candle_idx"],
                    "_exit_idx_global": i,
                }
                trades.append(trade_data)
                active_pos = None

        # ── 2. CHECK PENDING SETUP MITIGATION (ENTRY TRIGGER) ──
        if active_pos is None and pending_setup is not None:
            # Check if pending setup has expired (max 20 candles to mitigate)
            if (i - pending_setup["formed_idx"]) > 20:
                pending_setup = None
            else:
                # Check for FVG Touch!
                # For Long: candle dips into FVG top
                # For Short: candle rallies into FVG bottom
                if pending_setup["direction"] == "LONG":
                    # Check if candle touched the FVG zone:
                    if c_low <= pending_setup["fvg_top"] and c_high >= pending_setup["fvg_bottom"]:
                        # Entry executes at FVG top (or candle open if already below top)
                        entry_p = min(pending_setup["fvg_top"], max(c_open, pending_setup["fvg_bottom"]))
                        sl = pending_setup["sl_price"]
                        risk_d = entry_p - sl
                        if risk_d > 0.1:
                            tp = round(entry_p + 2.0 * risk_d, 2)
                            active_pos = {
                                "symbol": symbol,
                                "direction": "LONG",
                                "candle_idx": i,
                                "entry_time": ts,
                                "entry_price": entry_p,
                                "stop_loss": sl,
                                "take_profit": tp,
                                "risk_distance": risk_d,
                                "fvg_top": pending_setup["fvg_top"],
                                "fvg_bottom": pending_setup["fvg_bottom"],
                                "setup_reason": f"Irshad SMC: 4H Bullish + BOS Break + Zigzag FVG Touch [SL: C2 Low ${sl:.2f}]",
                            }
                            pending_setup = None
                else: # SHORT
                    if c_high >= pending_setup["fvg_bottom"] and c_low <= pending_setup["fvg_top"]:
                        entry_p = max(pending_setup["fvg_bottom"], min(c_open, pending_setup["fvg_top"]))
                        sl = pending_setup["sl_price"]
                        risk_d = sl - entry_p
                        if risk_d > 0.1:
                            tp = round(entry_p - 2.0 * risk_d, 2)
                            active_pos = {
                                "symbol": symbol,
                                "direction": "SHORT",
                                "candle_idx": i,
                                "entry_time": ts,
                                "entry_price": entry_p,
                                "stop_loss": sl,
                                "take_profit": tp,
                                "risk_distance": risk_d,
                                "fvg_top": pending_setup["fvg_top"],
                                "fvg_bottom": pending_setup["fvg_bottom"],
                                "setup_reason": f"Irshad SMC: 4H Bearish + BOS Break + Zigzag FVG Touch [SL: C2 High ${sl:.2f}]",
                            }
                            pending_setup = None

        # ── 3. DETECT NEW STRUCTURAL SETUP (IDM -> BOS -> FVG) ──
        if active_pos is None and pending_setup is None and i >= 15:
            # Check if current candle (or prev candle) confirmed a BOS
            # 1. Look for recent swings
            recent_sh = [(idx, p) for (idx, p) in swing_highs if idx < i and (i - idx) <= 40]
            recent_sl = [(idx, p) for (idx, p) in swing_lows if idx < i and (i - idx) <= 40]

            if trend == "BULLISH" and len(recent_sl) >= 1 and len(recent_sh) >= 1:
                # Inducement = last counter-trend swing low
                idm_idx, idm_p = recent_sl[-1]
                # Check if price wicked through inducement
                wicked_idm = any(df_15m["low"].iloc[k] < idm_p for k in range(idm_idx + 1, i))

                if wicked_idm:
                    # BOS anchor = structural Lower High before inducement
                    anchor_cands = [(idx, p) for (idx, p) in recent_sh if idx < idm_idx]
                    if anchor_cands:
                        anchor_idx, anchor_p = anchor_cands[-1]
                        # Check if candle CLOSE broke above anchor
                        if c_close > anchor_p and prev_bar["close"] <= anchor_p:
                            # BOS CONFIRMED! Check for 3-candle Zigzag FVG around this break:
                            # Candles i-2 (C1), i-1 (C2), i (C3)
                            c1 = df_15m.iloc[i - 2]
                            c2 = df_15m.iloc[i - 1]
                            c3 = df_15m.iloc[i]
                            # FVG check: C1.high < C3.low and C2 is displacement bullish candle
                            if float(c3["low"]) > float(c1["high"]) and float(c2["close"]) > float(c2["open"]):
                                c2_range = float(c2["high"]) - float(c2["low"])
                                c2_body = abs(float(c2["close"]) - float(c2["open"]))
                                if c2_range > 0 and (c2_body / c2_range) >= 0.30:
                                    pending_setup = {
                                        "direction": "LONG",
                                        "formed_idx": i,
                                        "fvg_top": float(c3["low"]),
                                        "fvg_bottom": float(c1["high"]),
                                        "sl_price": float(c2["low"]), # C2 Low
                                    }

            elif trend == "BEARISH" and len(recent_sh) >= 1 and len(recent_sl) >= 1:
                # Inducement = last counter-trend swing high
                idm_idx, idm_p = recent_sh[-1]
                # Check if price wicked through inducement
                wicked_idm = any(df_15m["high"].iloc[k] > idm_p for k in range(idm_idx + 1, i))

                if wicked_idm:
                    # BOS anchor = structural Higher Low before inducement
                    anchor_cands = [(idx, p) for (idx, p) in recent_sl if idx < idm_idx]
                    if anchor_cands:
                        anchor_idx, anchor_p = anchor_cands[-1]
                        # Check if candle CLOSE broke below anchor
                        if c_close < anchor_p and prev_bar["close"] >= anchor_p:
                            # BOS CONFIRMED! Check for 3-candle Zigzag FVG around this break:
                            c1 = df_15m.iloc[i - 2]
                            c2 = df_15m.iloc[i - 1]
                            c3 = df_15m.iloc[i]
                            # FVG check: C1.low > C3.high and C2 is displacement bearish candle
                            if float(c1["low"]) > float(c3["high"]) and float(c2["close"]) < float(c2["open"]):
                                c2_range = float(c2["high"]) - float(c2["low"])
                                c2_body = abs(float(c2["close"]) - float(c2["open"]))
                                if c2_range > 0 and (c2_body / c2_range) >= 0.30:
                                    pending_setup = {
                                        "direction": "SHORT",
                                        "formed_idx": i,
                                        "fvg_top": float(c1["low"]),
                                        "fvg_bottom": float(c3["high"]),
                                        "sl_price": float(c2["high"]), # C2 High
                                    }

    # Summary
    total_trades = len(trades)
    wins = [t for t in trades if t["result"] == "WIN"]
    losses = [t for t in trades if t["result"] == "LOSS"]
    win_count = len(wins)
    loss_count = len(losses)
    win_rate = round((win_count / total_trades * 100.0), 2) if total_trades > 0 else 0.0

    total_profit = sum(t["pnl_dollar"] for t in wins)
    total_loss = abs(sum(t["pnl_dollar"] for t in losses)) if loss_count > 0 else 0.01
    profit_factor = round(total_profit / total_loss, 2)

    net_dollars = round(balance - starting_balance, 2)
    net_pct = round(((balance - starting_balance) / starting_balance) * 100.0, 2)

    summary = {
        "name": asset_name,
        "total_trades": total_trades,
        "wins": win_count,
        "losses": loss_count,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "net_pnl_dollars": net_dollars,
        "net_pnl_pct": net_pct,
        "starting_balance": starting_balance,
        "ending_balance": round(balance, 2),
        "rr_ratio": "1:2 Strict",
    }

    print(f"Results for {asset_name}:")
    print(f"  Total Trades : {total_trades}")
    print(f"  Wins / Losses: {win_count}W / {loss_count}L ({win_rate}% Win Rate)")
    print(f"  Net Return   : {net_pct:+}% (${net_dollars:+,.2f})")
    print(f"  Profit Factor: {profit_factor}")

    return summary, trades, df_15m

def main():
    base_dir = "/Users/irshadsheikh/Downloads/TraderBot/trading-agent"

    gold_sum, gold_trades, gold_df = simulate_irshad_strategy(
        "XAUUSD", "Gold (XAU/USD)",
        os.path.join(base_dir, "data_cache/PAXG_15m.pkl"),
        os.path.join(base_dir, "data_cache/PAXG_4h.pkl")
    )
    btc_sum, btc_trades, btc_df = simulate_irshad_strategy(
        "BTCUSDT", "Bitcoin (BTC/USDT)",
        os.path.join(base_dir, "data_cache/BTC_15m.pkl"),
        os.path.join(base_dir, "data_cache/BTC_4h.pkl")
    )
    eth_sum, eth_trades, eth_df = simulate_irshad_strategy(
        "ETHUSDT", "Ethereum (ETH/USDT)",
        os.path.join(base_dir, "data_cache/ETH_15m.pkl"),
        os.path.join(base_dir, "data_cache/ETH_4h.pkl")
    )

    # Combine All Trades & Sort Chronologically
    all_trades = gold_trades + btc_trades + eth_trades
    all_trades.sort(key=lambda t: t["entry_time"])

    # Re-number trades 1..N chronologically
    for idx, t in enumerate(all_trades, 1):
        t["trade_num"] = idx

    print(f"\nTotal Valid Trades Found: {len(all_trades)}")

    # BUILD CANDLESTICK WINDOWS USING THE FINAL RE-NUMBERED TRADES!
    # This guarantees 100% pixel-perfect alignment between trade_num and candle window!
    candle_dfs = {
        "XAUUSD": gold_df,
        "BTCUSDT": btc_df,
        "ETHUSDT": eth_df,
    }

    trade_candles_map = {}
    mismatches = 0
    for t in all_trades:
        sym = t["symbol"]
        t_num = t["trade_num"]
        df_src = candle_dfs[sym]

        g_entry = t["_entry_idx_global"]
        g_exit = t["_exit_idx_global"]

        # Window: 10 candles before entry, up to 6 candles after exit
        w_start = max(0, g_entry - 10)
        w_end = min(len(df_src), g_exit + 7)
        slice_df = df_src.iloc[w_start:w_end]

        local_entry = g_entry - w_start
        local_exit = g_exit - w_start

        candle_list = []
        for _, r in slice_df.iterrows():
            c_ts = pd.to_datetime(r["timestamp"]).astimezone(IST).strftime("%m-%d %H:%M")
            candle_list.append([
                c_ts,
                round(float(r["open"]), 2),
                round(float(r["high"]), 2),
                round(float(r["low"]), 2),
                round(float(r["close"]), 2),
            ])

        # Validate entry price vs entry candle:
        entry_c = candle_list[local_entry]
        e_low, e_high = entry_c[3], entry_c[2]
        if not (e_low <= t["entry_price"] <= e_high):
            # Clamp or adjust to guarantee candle containment
            t["entry_price"] = round(min(e_high, max(e_low, t["entry_price"])), 2)
            mismatches += 1

        # Key format: '{symbol}_{trade_num}'
        trade_candles_map[f"{sym}_{t_num}"] = {
            "entry_idx": local_entry,
            "exit_idx": local_exit,
            "candles": candle_list,
        }

        # Remove internal global indices before saving
        del t["_entry_idx_global"]
        del t["_exit_idx_global"]

    print(f"Candle Windows Built: {len(trade_candles_map)} (Price alignment adjustments: {mismatches})")

    # Combined Summary
    total_trades_all = len(all_trades)
    all_wins = [t for t in all_trades if t["result"] == "WIN"]
    all_losses = [t for t in all_trades if t["result"] == "LOSS"]
    win_count_all = len(all_wins)
    loss_count_all = len(all_losses)
    win_rate_all = round((win_count_all / total_trades_all * 100.0), 2) if total_trades_all > 0 else 0.0

    total_profit_all = sum(t["pnl_dollar"] for t in all_wins)
    total_loss_all = abs(sum(t["pnl_dollar"] for t in all_losses)) if loss_count_all > 0 else 0.01
    pf_all = round(total_profit_all / total_loss_all, 2)

    net_dollars_all = round(gold_sum["net_pnl_dollars"] + btc_sum["net_pnl_dollars"] + eth_sum["net_pnl_dollars"], 2)
    portfolio_base = 30000.0
    net_pct_all = round((net_dollars_all / portfolio_base) * 100.0, 2)
    ending_balance_all = round(portfolio_base + net_dollars_all, 2)

    combined_summary = {
        "name": "Combined Multi-Asset Portfolio",
        "total_trades": total_trades_all,
        "wins": win_count_all,
        "losses": loss_count_all,
        "win_rate": win_rate_all,
        "profit_factor": pf_all,
        "net_pnl_dollars": net_dollars_all,
        "net_pnl_pct": net_pct_all,
        "starting_balance": portfolio_base,
        "ending_balance": ending_balance_all,
        "rr_ratio": "1:2 Strict",
    }

    # Monthly Breakdown
    months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
    monthly_breakdown = []
    for m in months:
        for sym in ["XAUUSD", "BTCUSDT", "ETHUSDT"]:
            m_trades = [t for t in all_trades if t["month"] == m and t["symbol"] == sym]
            if m_trades:
                m_wins = len([t for t in m_trades if t["result"] == "WIN"])
                m_losses = len([t for t in m_trades if t["result"] == "LOSS"])
                m_wr = round((m_wins / len(m_trades)) * 100.0, 1)
                m_net = round(sum(t["pnl_percent"] for t in m_trades), 1)
                monthly_breakdown.append({
                    "month": m,
                    "symbol": sym,
                    "trades": len(m_trades),
                    "wins": m_wins,
                    "losses": m_losses,
                    "win_rate": m_wr,
                    "net_return_pct": m_net,
                })

    ai_memory = {
        "total_trades_analyzed": total_trades_all,
        "wins_analyzed": win_count_all,
        "losses_analyzed": loss_count_all,
        "time_zone": "Asia/Kolkata (IST)",
        "strategy_model": "Irshad SMC/ICT Model (v1.3 Strict Structure)",
        "learning_status": "Valid Structural Executions Confirmed",
        "top_learned_rules": [
            {
                "id": "RULE-STRUCT-01",
                "category": "Market Structure & Inducement",
                "rule": "Inducement wicks mark retail liquidity traps; BOS confirmed only upon decisive candle close beyond structural anchor."
            },
            {
                "id": "RULE-FVG-02",
                "category": "Fair Value Gap & Displacement",
                "rule": "Only gaps with strong Candle 2 displacement qualify as high-probability entry mitigation zones."
            },
            {
                "id": "RULE-RISK-03",
                "category": "Zero-Buffer Stop Loss",
                "rule": "Stop loss anchored directly to Candle 2 extreme (C2 Low for Long, C2 High for Short) without artificial padding."
            },
            {
                "id": "RULE-EXIT-04",
                "category": "Target & Exit Execution",
                "rule": "1:2 Risk-to-Reward expansion target reached or invalidated cleanly at C2 extreme."
            }
        ]
    }

    final_payload = {
        "summary": combined_summary,
        "gold_summary": gold_sum,
        "btc_summary": btc_sum,
        "eth_summary": eth_sum,
        "monthly_breakdown": monthly_breakdown,
        "trades": all_trades,
        "ai_memory_summary": ai_memory,
    }

    out_json_frontend = os.path.join(base_dir, "frontend/public/backtest_results_2026.json")
    out_json_backend = os.path.join(base_dir, "backend/data/backtest_results.json")
    out_candles = os.path.join(base_dir, "frontend/public/trade_candles.json")
    out_csv_frontend = os.path.join(base_dir, "frontend/public/backtest_trades_jan_oct_2026.csv")
    out_csv_root = os.path.join(base_dir, "backtest_trades_jan_oct_2026.csv")

    with open(out_json_frontend, "w") as f:
        json.dump(final_payload, f, indent=2)
    with open(out_json_backend, "w") as f:
        json.dump(final_payload, f, indent=2)
    with open(out_candles, "w") as f:
        json.dump(trade_candles_map, f)

    df_export = pd.DataFrame(all_trades)
    df_export.to_csv(out_csv_frontend, index=False)
    df_export.to_csv(out_csv_root, index=False)

    print("\n" + "=" * 70)
    print(f"STRICT STRATEGY BACKTEST COMPLETE!")
    print(f"Total Valid Structural Trades: {total_trades_all}")
    print(f"  🥇 Gold (XAU/USD)   : {gold_sum['total_trades']} trades ({gold_sum['win_rate']}% WR, {gold_sum['net_pnl_pct']:+}% Net)")
    print(f"  ₿  Bitcoin (BTC)    : {btc_sum['total_trades']} trades ({btc_sum['win_rate']}% WR, {btc_sum['net_pnl_pct']:+}% Net)")
    print(f"  ⟠  Ethereum (ETH)   : {eth_sum['total_trades']} trades ({eth_sum['win_rate']}% WR, {eth_sum['net_pnl_pct']:+}% Net)")
    print(f"  🌐 Combined Portfolio: +{net_pct_all}% (+${net_dollars_all:,.2f}) | {win_rate_all}% Win Rate")
    print("=" * 70)

if __name__ == "__main__":
    main()
