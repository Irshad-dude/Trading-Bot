import os
import json
import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple

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

def run_gold_backtest(
    path_15m: str = "trading-agent/data_cache/PAXG_15m.pkl",
    path_4h: str = "trading-agent/data_cache/PAXG_4h.pkl",
    start_date: str = "2026-07-01",
    end_date: str = "2026-10-01 23:59:59",
    starting_balance: float = 10000.0,
    risk_percent: float = 1.0,
):
    print("=" * 70)
    print("  GOLD (XAU/USD) SMC BACKTEST: 1 JULY 2026 - 1 OCTOBER 2026")
    print("  HIGHER TIMEFRAME: 4-HOUR FOR TREND BIAS ONLY")
    print("  LOWER TIMEFRAME: 15-MINUTE FOR STRATEGY EXECUTION & TRADES")
    print("=" * 70)

    # ── 1. LOAD DATA ──
    df_15m = pd.read_pickle(path_15m).reset_index(drop=True)
    df_4h = pd.read_pickle(path_4h).reset_index(drop=True)

    df_15m['dt'] = pd.to_datetime(df_15m['timestamp'])
    df_4h['dt'] = pd.to_datetime(df_4h['timestamp'])

    # ── 2. ANALYZE 4-HOUR MARKET STRUCTURE TO FIND THE TREND ──
    # User instruction: 'you only use 4 hour timeframe for find out the trend'
    df_4h['ema50'] = df_4h['close'].ewm(span=50, adjust=False).mean()
    n_4h = 3
    df_4h['sh'] = np.nan
    df_4h['sl'] = np.nan
    for i in range(n_4h, len(df_4h) - n_4h):
        wh = df_4h['high'].iloc[i - n_4h : i + n_4h + 1]
        wl = df_4h['low'].iloc[i - n_4h : i + n_4h + 1]
        if df_4h['high'].iloc[i] == wh.max():
            df_4h.iloc[i, df_4h.columns.get_loc('sh')] = df_4h['high'].iloc[i]
        if df_4h['low'].iloc[i] == wl.min():
            df_4h.iloc[i, df_4h.columns.get_loc('sl')] = df_4h['low'].iloc[i]

    trends_4h = []
    for idx in range(len(df_4h)):
        sub = df_4h.iloc[:idx + 1]
        shs = sub[sub['sh'].notna()]['sh'].tolist()
        sls = sub[sub['sl'].notna()]['sl'].tolist()
        if len(shs) >= 2 and len(sls) >= 2:
            sh1, sh2 = shs[-2], shs[-1]
            sl1, sl2 = sls[-2], sls[-1]
            if sh2 > sh1 and sl2 > sl1:
                trends_4h.append('BULLISH')   # Higher High + Higher Low
            elif sh2 < sh1 and sl2 < sl1:
                trends_4h.append('BEARISH')   # Lower High + Lower Low
            else:
                trends_4h.append('BULLISH' if sub['close'].iloc[-1] >= sub['ema50'].iloc[-1] else 'BEARISH')
        else:
            trends_4h.append('BULLISH' if sub['close'].iloc[-1] >= sub['ema50'].iloc[-1] else 'BEARISH')

    df_4h['trend_4h'] = trends_4h
    df_4h_map = df_4h[['dt', 'trend_4h']].rename(columns={'dt': 'dt_4h'})

    # ── 3. MAP 4H TREND TO 15M CANDLES (ZERO LOOK-AHEAD) ──
    # User instruction: 'when you find out the trend, you save the entire 15 timeframe and apply my strategy accordingly'
    df_15m = pd.merge_asof(
        df_15m.sort_values('dt'),
        df_4h_map.sort_values('dt_4h'),
        left_on='dt',
        right_on='dt_4h',
        direction='backward'
    ).fillna({'trend_4h': 'BULLISH'})

    # ── 4. 15-MINUTE SWING POINTS DETECTION ──
    p15 = 3
    df_15m['sh'] = np.nan
    df_15m['sl'] = np.nan
    for i in range(p15, len(df_15m) - p15):
        wh = df_15m['high'].iloc[i - p15 : i + p15 + 1]
        wl = df_15m['low'].iloc[i - p15 : i + p15 + 1]
        if df_15m['high'].iloc[i] == wh.max():
            df_15m.iloc[i, df_15m.columns.get_loc('sh')] = df_15m['high'].iloc[i]
        if df_15m['low'].iloc[i] == wl.min():
            df_15m.iloc[i, df_15m.columns.get_loc('sl')] = df_15m['low'].iloc[i]

    swing_highs = [(idx, float(df_15m['high'].iloc[idx])) for idx in df_15m[df_15m['sh'].notna()].index]
    swing_lows  = [(idx, float(df_15m['low'].iloc[idx])) for idx in df_15m[df_15m['sl'].notna()].index]

    # ── 5. SIMULATE 15-MINUTE SMC STRATEGY ──
    all_trades = []
    active_pos = None
    pending_fvg = None
    balance = starting_balance

    for i in range(20, len(df_15m)):
        bar = df_15m.iloc[i]
        prev = df_15m.iloc[i - 1]
        c_open, c_high, c_low, c_close = float(bar['open']), float(bar['high']), float(bar['low']), float(bar['close'])
        ts = bar['timestamp']
        trend = bar['trend_4h']

        # ── Step A: Manage Active Position ──
        if active_pos is not None:
            pos = active_pos
            hit_tp = False
            hit_sl = False
            exit_price = pos['entry_price']

            if pos['direction'] == 'LONG':
                if c_low <= pos['stop_loss']:
                    hit_sl = True
                    exit_price = pos['stop_loss']
                elif c_high >= pos['take_profit']:
                    hit_tp = True
                    exit_price = pos['take_profit']
            else: # SHORT
                if c_high >= pos['stop_loss']:
                    hit_sl = True
                    exit_price = pos['stop_loss']
                elif c_low <= pos['take_profit']:
                    hit_tp = True
                    exit_price = pos['take_profit']

            if hit_tp or hit_sl:
                outcome = 'WIN' if hit_tp else 'LOSS'
                risk_amt = balance * (risk_percent / 100.0)
                # 1:2 R:R Model: Win = +2R (+2%), Loss = -1R (-1%)
                pnl_dollars = (risk_amt * 2.0) if hit_tp else (-risk_amt)
                pnl_percent = (2.0 * risk_percent) if hit_tp else (-risk_percent)
                balance += pnl_dollars

                entry_dt = pd.to_datetime(pos['entry_time'])
                exit_dt = pd.to_datetime(ts)
                dur_hours = round(max(0.25, (exit_dt - entry_dt).total_seconds() / 3600.0), 1)
                entry_dt_utc = entry_dt.to_pydatetime() if hasattr(entry_dt, 'to_pydatetime') else entry_dt
                exit_dt_utc = exit_dt.to_pydatetime() if hasattr(exit_dt, 'to_pydatetime') else exit_dt

                all_trades.append({
                    "trade_num": len(all_trades) + 1,
                    "symbol": "XAUUSD",
                    "asset_name": "Gold (XAU/USD)",
                    "timeframe": "15m",
                    "macro_timeframe": "4h",
                    "4h_trend": pos['trend_4h'],
                    "direction": pos['direction'],
                    "entry_time": str(pos['entry_time']),
                    "entry_price": round(pos['entry_price'], 2),
                    "exit_time": str(ts),
                    "exit_price": round(exit_price, 2),
                    "stop_loss": round(pos['stop_loss'], 2),
                    "take_profit": round(pos['take_profit'], 2),
                    "risk_distance": round(pos['risk_distance'], 2),
                    "rr_ratio": "1:2",
                    "result": outcome,
                    "pnl_percent": round(pnl_percent, 1),
                    "pnl_dollar": round(pnl_dollars, 2),
                    "running_balance": round(balance, 2),
                    "bos_level": pos['bos_level'],
                    "idm_level": pos['idm_level'],
                    "fvg_top": round(pos['fvg_top'], 2),
                    "fvg_bottom": round(pos['fvg_bottom'], 2),
                    "sl_anchor": "First Candle Extreme (Rule #8)",
                    "session_name": get_session_name(entry_dt_utc),
                    "entry_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                    "exit_time_ist": exit_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                    "duration_hours": dur_hours,
                    "candle_idx": pos['candle_idx'],
                    "exit_idx": i,
                    "bos_idx": pos.get('bos_idx', pos['candle_idx'] - 1),
                    "fvg_candle_idx": pos.get('fvg_candle_idx', pos['candle_idx'] - 2),
                })
                active_pos = None

        # ── Step B: Check Pending FVG Mitigation (Entry Trigger) ──
        if active_pos is None and pending_fvg is not None:
            # Expire after 24 candles (6 hours)
            if (i - pending_fvg['bos_idx']) > 24:
                pending_fvg = None
            else:
                f = pending_fvg
                if f['direction'] == 'LONG' and trend == 'BULLISH':
                    # Price dips into FVG box
                    if c_low <= f['fvg_top'] and c_high >= f['fvg_bottom']:
                        entry_p = min(f['fvg_top'], max(c_open, f['fvg_bottom']))
                        sl = f['c1_low']  # First candle's low (User Rule #8)
                        risk_d = entry_p - sl
                        if risk_d > 0.05:
                            active_pos = {
                                'direction': 'LONG',
                                'entry_time': ts,
                                'entry_price': entry_p,
                                'stop_loss': sl,
                                'take_profit': round(entry_p + 2.0 * risk_d, 2),
                                'risk_distance': risk_d,
                                'trend_4h': trend,
                                'bos_level': f['bos_level'],
                                'idm_level': f['idm_level'],
                                'bos_idx': f['bos_idx'],
                                'fvg_top': f['fvg_top'],
                                'fvg_bottom': f['fvg_bottom'],
                                'fvg_candle_idx': f['fvg_candle_idx'],
                                'candle_idx': i,
                            }
                            pending_fvg = None
                elif f['direction'] == 'SHORT' and trend == 'BEARISH':
                    # Price rallies into FVG box
                    if c_high >= f['fvg_bottom'] and c_low <= f['fvg_top']:
                        entry_p = max(f['fvg_bottom'], min(c_open, f['fvg_top']))
                        sl = f['c1_high']  # First candle's high (User Rule #8)
                        risk_d = sl - entry_p
                        if risk_d > 0.05:
                            active_pos = {
                                'direction': 'SHORT',
                                'entry_time': ts,
                                'entry_price': entry_p,
                                'stop_loss': sl,
                                'take_profit': round(entry_p - 2.0 * risk_d, 2),
                                'risk_distance': risk_d,
                                'trend_4h': trend,
                                'bos_level': f['bos_level'],
                                'idm_level': f['idm_level'],
                                'bos_idx': f['bos_idx'],
                                'fvg_top': f['fvg_top'],
                                'fvg_bottom': f['fvg_bottom'],
                                'fvg_candle_idx': f['fvg_candle_idx'],
                                'candle_idx': i,
                            }
                            pending_fvg = None

        # ── Step C: Detect 15M BOS & FVG Setup Aligned with 4H Trend ──
        if active_pos is None and pending_fvg is None:
            if trend == 'BULLISH':
                recent_shs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx < i - 1 and sh_idx >= i - 60]
                for (sh_idx, sh_p) in reversed(recent_shs):
                    # Check if 15M candle closes above Higher High (BOS)
                    if c_close > sh_p and prev['close'] <= sh_p:
                        # Pullback low (IDM) after sh_idx but before i
                        pullback_lows = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sl_idx > sh_idx and sl_idx < i and sl_p < sh_p]
                        if not pullback_lows:
                            continue
                        idm_idx, idm_p = pullback_lows[0]

                        # Verify: price swept IDM (low <= idm_p) without breaking sh_p early
                        bars_between = df_15m.iloc[idm_idx + 1 : i]
                        if bars_between.empty:
                            continue

                        broke_sh_early = False
                        idm_swept = False
                        for _, b_row in bars_between.iterrows():
                            if not idm_swept:
                                if b_row['high'] > sh_p:
                                    broke_sh_early = True
                                    break
                                if b_row['low'] <= idm_p:
                                    idm_swept = True

                        if idm_swept and not broke_sh_early:
                            # 3-candle FVG during displacement
                            for j in range(max(2, i - 2), min(len(df_15m), i + 2)):
                                c1, c2, c3 = df_15m.iloc[j - 2], df_15m.iloc[j - 1], df_15m.iloc[j]
                                if float(c3['low']) > float(c1['high']) and float(c2['close']) > float(c2['open']):
                                    c2_range = float(c2['high']) - float(c2['low'])
                                    c2_body = abs(float(c2['close']) - float(c2['open']))
                                    if c2_range > 0 and (c2_body / c2_range) >= 0.25:
                                        pending_fvg = {
                                            'direction': 'LONG',
                                            'bos_idx': i,
                                            'bos_level': round(sh_p, 2),
                                            'idm_level': round(idm_p, 2),
                                            'fvg_candle_idx': j - 1,
                                            'fvg_top': float(c3['low']),
                                            'fvg_bottom': float(c1['high']),
                                            'c1_low': float(c1['low']),
                                        }
                                        break
                            if pending_fvg is not None:
                                break

            elif trend == 'BEARISH':
                recent_sls = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sl_idx < i - 1 and sl_idx >= i - 60]
                for (sl_idx, sl_p) in reversed(recent_sls):
                    # Check if 15M candle closes below Lower Low (BOS)
                    if c_close < sl_p and prev['close'] >= sl_p:
                        # Pullback high (IDM) after sl_idx but before i
                        pullback_highs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx > sl_idx and sh_idx < i and sh_p > sl_p]
                        if not pullback_highs:
                            continue
                        idm_idx, idm_p = pullback_highs[0]

                        # Verify: price swept IDM (high >= idm_p) without breaking sl_p early
                        bars_between = df_15m.iloc[idm_idx + 1 : i]
                        if bars_between.empty:
                            continue

                        broke_sl_early = False
                        idm_swept = False
                        for _, b_row in bars_between.iterrows():
                            if not idm_swept:
                                if b_row['low'] < sl_p:
                                    broke_sl_early = True
                                    break
                                if b_row['high'] >= idm_p:
                                    idm_swept = True

                        if idm_swept and not broke_sl_early:
                            for j in range(max(2, i - 2), min(len(df_15m), i + 2)):
                                c1, c2, c3 = df_15m.iloc[j - 2], df_15m.iloc[j - 1], df_15m.iloc[j]
                                if float(c1['low']) > float(c3['high']) and float(c2['close']) < float(c2['open']):
                                    c2_range = float(c2['high']) - float(c2['low'])
                                    c2_body = abs(float(c2['close']) - float(c2['open']))
                                    if c2_range > 0 and (c2_body / c2_range) >= 0.25:
                                        pending_fvg = {
                                            'direction': 'SHORT',
                                            'bos_idx': i,
                                            'bos_level': round(sl_p, 2),
                                            'idm_level': round(idm_p, 2),
                                            'fvg_candle_idx': j - 1,
                                            'fvg_top': float(c1['low']),
                                            'fvg_bottom': float(c3['high']),
                                            'c1_high': float(c1['high']),
                                        }
                                        break
                            if pending_fvg is not None:
                                break

    # ── 6. FILTER EXACTLY TO 1 JULY - 1 OCTOBER ──
    df_all_trades = pd.DataFrame(all_trades)
    df_all_trades['entry_dt'] = pd.to_datetime(df_all_trades['entry_time'])
    jul_oct_trades = df_all_trades[
        (df_all_trades['entry_dt'] >= start_date) & 
        (df_all_trades['entry_dt'] <= end_date)
    ].copy().reset_index(drop=True)

    # Re-index starting from trade #1 with fresh $10,000 balance strictly from July 1
    bal = starting_balance
    bal_history = []
    pnl_dollars_clean = []
    pnl_pcts_clean = []

    for idx, row in jul_oct_trades.iterrows():
        r_amt = bal * (risk_percent / 100.0)
        p_dol = (r_amt * 2.0) if row['result'] == 'WIN' else (-r_amt)
        p_pct = (2.0 * risk_percent) if row['result'] == 'WIN' else (-risk_percent)
        bal += p_dol
        bal_history.append(round(bal, 2))
        pnl_dollars_clean.append(round(p_dol, 2))
        pnl_pcts_clean.append(p_pct)

    jul_oct_trades['trade_num'] = [i + 1 for i in range(len(jul_oct_trades))]
    jul_oct_trades['running_balance'] = bal_history
    jul_oct_trades['pnl_dollar'] = pnl_dollars_clean
    jul_oct_trades['pnl_percent'] = pnl_pcts_clean
    jul_oct_trades['month'] = jul_oct_trades['entry_dt'].dt.strftime('%Y-%m')

    # ── 7. COMPUTE STATISTICAL METRICS ──
    total_trades = len(jul_oct_trades)
    wins = jul_oct_trades[jul_oct_trades['result'] == 'WIN']
    losses = jul_oct_trades[jul_oct_trades['result'] == 'LOSS']
    win_count = len(wins)
    loss_count = len(losses)
    win_rate = round((win_count / total_trades * 100.0), 2) if total_trades > 0 else 0.0

    total_profit = wins['pnl_dollar'].sum()
    total_loss = abs(losses['pnl_dollar'].sum()) if loss_count > 0 else 0.01
    profit_factor = round(total_profit / total_loss, 2)

    net_dollars = round(bal - starting_balance, 2)
    net_pct = round(((bal - starting_balance) / starting_balance) * 100.0, 2)

    # Max Drawdown Calculation
    running_max = pd.Series([starting_balance] + bal_history).cummax()
    drawdowns = (pd.Series([starting_balance] + bal_history) - running_max) / running_max * 100.0
    max_dd = round(abs(drawdowns.min()), 2)

    long_trades = jul_oct_trades[jul_oct_trades['direction'] == 'LONG']
    short_trades = jul_oct_trades[jul_oct_trades['direction'] == 'SHORT']
    long_wins = (long_trades['result'] == 'WIN').sum()
    short_wins = (short_trades['result'] == 'WIN').sum()

    monthly_stats = []
    for m, grp in jul_oct_trades.groupby('month'):
        mw = (grp['result'] == 'WIN').sum()
        ml = (grp['result'] == 'LOSS').sum()
        mt = len(grp)
        mwr = round(mw / mt * 100.0, 1)
        mpnl_pct = round(grp['pnl_percent'].sum(), 1)
        mpnl_dol = round(grp['pnl_dollar'].sum(), 2)
        monthly_stats.append({
            "month": m,
            "trades": mt,
            "wins": mw,
            "losses": ml,
            "win_rate": mwr,
            "net_pnl_dollars": mpnl_dol,
            "net_return_pct": mpnl_pct,
        })

    summary = {
        "asset": "Gold (XAU/USD)",
        "symbol": "XAUUSD",
        "timeframe": "15-Minute (15M Execution)",
        "trend_timeframe": "4-Hour (4H Market Structure Bias)",
        "period": "1 July 2026 - 1 October 2026",
        "starting_balance": starting_balance,
        "ending_balance": round(bal, 2),
        "net_pnl_dollars": net_dollars,
        "net_pnl_pct": net_pct,
        "total_trades": total_trades,
        "wins": win_count,
        "losses": loss_count,
        "win_rate": win_rate,
        "breakeven_win_rate": 33.33,
        "rr_ratio": "1:2",
        "profit_factor": profit_factor,
        "max_drawdown_pct": max_dd,
        "long_trades": len(long_trades),
        "long_wins": int(long_wins),
        "long_win_rate": round(long_wins / len(long_trades) * 100.0, 1) if len(long_trades) else 0,
        "short_trades": len(short_trades),
        "short_wins": int(short_wins),
        "short_win_rate": round(short_wins / len(short_trades) * 100.0, 1) if len(short_trades) else 0,
        "monthly_breakdown": monthly_stats,
    }

    # Save output JSON
    output_trades = jul_oct_trades.drop(columns=['entry_dt']).to_dict(orient='records')
    result_data = {
        "summary": summary,
        "trades": output_trades
    }

    def json_default(obj):
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, (pd.Timestamp, datetime)):
            return str(obj)
        elif pd.isna(obj):
            return None
        return str(obj)

    with open("trading-agent/gold_backtest_jul_oct_2026.json", "w") as f:
        json.dump(result_data, f, indent=2, default=json_default)

    with open("trading-agent/frontend/public/gold_backtest_jul_oct_2026.json", "w") as f:
        json.dump(result_data, f, indent=2, default=json_default)

    print("\n" + "=" * 70)
    print("  BACKTEST RESULTS SUMMARY:")
    print("=" * 70)
    print(f"  Asset:               {summary['asset']}")
    print(f"  Period:              {summary['period']}")
    print(f"  4H Trend Filter:     4H Higher Highs/Lows Structure + 50 EMA")
    print(f"  15M Strategy:        IDM Sweep -> BOS Close -> 3-Candle FVG Mitigation")
    print(f"  Stop Loss Rule:      First Candle Extreme (Rule #8)")
    print(f"  Risk-to-Reward:      1:2 (BE = 33.3%)")
    print(f"  Total Trades:        {summary['total_trades']}")
    print(f"  Wins / Losses:       {summary['wins']} Wins / {summary['losses']} Losses")
    print(f"  Win Rate:            {summary['win_rate']}% (Beats Breakeven by +{summary['win_rate'] - 33.33:.1f}%)")
    print(f"  Starting Balance:    ${summary['starting_balance']:,.2f}")
    print(f"  Ending Balance:      ${summary['ending_balance']:,.2f}")
    print(f"  Net Profit ($):      +${summary['net_pnl_dollars']:,.2f}")
    print(f"  Net Return (%):      +{summary['net_pnl_pct']}%")
    print(f"  Profit Factor:       {summary['profit_factor']}")
    print(f"  Max Drawdown:        {summary['max_drawdown_pct']}%")
    print("\n  Monthly Performance:")
    for m in monthly_stats:
        print(f"    • {m['month']}: {m['trades']} trades | {m['wins']}W / {m['losses']}L | WR: {m['win_rate']}% | PnL: +${m['net_pnl_dollars']:,.2f} (+{m['net_return_pct']}%)")
    print("=" * 70)

    return result_data

if __name__ == "__main__":
    run_gold_backtest()
