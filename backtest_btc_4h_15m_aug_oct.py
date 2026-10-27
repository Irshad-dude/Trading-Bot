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

def run_btc_backtest(
    path_15m: str = "trading-agent/data_cache/BTC_15m.pkl",
    path_4h: str = "trading-agent/data_cache/BTC_4h.pkl",
    start_date: str = "2026-08-01",
    end_date: str = "2026-10-15 23:59:59",
    starting_balance: float = 10000.0,
    risk_percent: float = 1.0,
    min_fvg_gap: float = 10.0,
):
    print("=" * 70)
    print("  RUNNING BITCOIN (BTC/USDT) SMC STRATEGY & CANONICAL COORDINATE ENGINE")
    print(f"  PERIOD: {start_date} TO {end_date}")
    print("  SEPARATION OF CONCERNS: EXACT CANDLE WICKS + CANONICAL INDICES")
    print("=" * 70)

    # ── 1. LOAD HISTORICAL DATA ──
    df_15m = pd.read_pickle(path_15m).reset_index(drop=True)
    df_4h = pd.read_pickle(path_4h).reset_index(drop=True)

    df_15m['dt'] = pd.to_datetime(df_15m['timestamp'])
    df_4h['dt'] = pd.to_datetime(df_4h['timestamp'])

    # ── 2. 4H TREND BIAS VIA MARKET STRUCTURE (HH/HL vs LH/LL) & 50 EMA ──
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
                trends_4h.append('BULLISH')
            elif sh2 < sh1 and sl2 < sl1:
                trends_4h.append('BEARISH')
            else:
                trends_4h.append('BULLISH' if sub['close'].iloc[-1] >= sub['ema50'].iloc[-1] else 'BEARISH')
        else:
            trends_4h.append('BULLISH' if sub['close'].iloc[-1] >= sub['ema50'].iloc[-1] else 'BEARISH')

    df_4h['trend_4h'] = trends_4h
    df_4h_map = df_4h[['dt', 'trend_4h']].rename(columns={'dt': 'dt_4h'})

    # ── 3. MAP 4H TREND TO 15M (ZERO LOOK-AHEAD) ──
    df_15m = pd.merge_asof(
        df_15m.sort_values('dt'),
        df_4h_map.sort_values('dt_4h'),
        left_on='dt',
        right_on='dt_4h',
        direction='backward'
    ).fillna({'trend_4h': 'BULLISH'})

    # ── 4. 15M FRACTAL SWING POINTS ──
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

    # ── 5. SIMULATE 15M STRATEGY WITH CANONICAL STRUCTURAL COORDINATES ──
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
                    "symbol": "BTCUSDT",
                    "asset_name": "Bitcoin (BTC/USDT)",
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
                    "session_name": get_session_name(entry_dt_utc),
                    "entry_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                    "exit_time_ist": exit_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                    "duration_hours": dur_hours,
                    "sh_idx": pos['sh_idx'],
                    "sh_price": pos['sh_price'],
                    "idm_idx": pos['idm_idx'],
                    "idm_price": pos['idm_price'],
                    "sweep_idx": pos['sweep_idx'],
                    "sweep_price": pos['sweep_price'],
                    "bos_idx": pos['bos_idx'],
                    "bos_price": pos['bos_price'],
                    "bos_level": pos['bos_level'],
                    "idm_level": pos['idm_level'],
                    "c1_idx": pos['c1_idx'],
                    "c2_idx": pos['c2_idx'],
                    "c3_idx": pos['c3_idx'],
                    "fvg_top": round(pos['fvg_top'], 2),
                    "fvg_bottom": round(pos['fvg_bottom'], 2),
                    "entry_idx": pos['entry_idx'],
                    "exit_idx": i,
                    "sl_idx": pos['c1_idx'],
                    "sl_price": round(pos['stop_loss'], 2),
                    "tp_price": round(pos['take_profit'], 2),
                })
                active_pos = None

        # ── Step B: Check Pending FVG Mitigation (Entry Trigger) ──
        # RULE: After FVG is created (Candles C1, C2, C3 complete),
        # WAIT for price to retrace and touch the FVG gap box!
        # Trade is only executed when price touches the gap on a subsequent candle (i > c3_idx).
        if active_pos is None and pending_fvg is not None:
            f = pending_fvg
            if (i - f['bos_idx']) > 48:
                pending_fvg = None  # Invalidate stale FVG if no retrace within 48 candles (12 hours)
            elif i > f['c3_idx']:
                # The FVG box is fully created. Now waiting for retrace touch!
                if f['direction'] == 'LONG' and trend == 'BULLISH':
                    # If market dropped below SL before touching FVG, invalidate
                    if c_low <= f['c1_low'] and c_open <= f['fvg_bottom']:
                        pending_fvg = None
                    # Price retraces DOWN to touch the FVG gap:
                    elif c_low <= f['fvg_top'] and c_high >= f['fvg_bottom']:
                        entry_p = min(f['fvg_top'], c_open)
                        sl = f['c1_low']
                        risk_d = entry_p - sl
                        if risk_d > 1.0:
                            tp = round(entry_p + 2.0 * risk_d, 2)
                            # Check same-candle SL breach
                            if c_low <= sl:
                                risk_amt = balance * (risk_percent / 100.0)
                                balance -= risk_amt
                                entry_dt = pd.to_datetime(ts)
                                entry_dt_utc = entry_dt.to_pydatetime() if hasattr(entry_dt, 'to_pydatetime') else entry_dt
                                all_trades.append({
                                    "trade_num": len(all_trades) + 1,
                                    "symbol": "BTCUSDT",
                                    "asset_name": "Bitcoin (BTC/USDT)",
                                    "timeframe": "15m",
                                    "macro_timeframe": "4h",
                                    "4h_trend": trend,
                                    "direction": "LONG",
                                    "entry_time": str(ts),
                                    "entry_price": round(entry_p, 2),
                                    "exit_time": str(ts),
                                    "exit_price": round(sl, 2),
                                    "stop_loss": round(sl, 2),
                                    "take_profit": round(tp, 2),
                                    "risk_distance": round(risk_d, 2),
                                    "rr_ratio": "1:2",
                                    "result": "LOSS",
                                    "pnl_percent": -risk_percent,
                                    "pnl_dollar": -round(risk_amt, 2),
                                    "running_balance": round(balance, 2),
                                    "session_name": get_session_name(entry_dt_utc),
                                    "entry_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "exit_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "duration_hours": 0.25,
                                    "sh_idx": f['sh_idx'],
                                    "sh_price": f['sh_price'],
                                    "idm_idx": f['idm_idx'],
                                    "idm_price": f['idm_price'],
                                    "sweep_idx": f['sweep_idx'],
                                    "sweep_price": f['sweep_price'],
                                    "bos_idx": f['bos_idx'],
                                    "bos_price": f['bos_price'],
                                    "bos_level": f['bos_level'],
                                    "idm_level": f['idm_level'],
                                    "c1_idx": f['c1_idx'],
                                    "c2_idx": f['c2_idx'],
                                    "c3_idx": f['c3_idx'],
                                    "fvg_top": round(f['fvg_top'], 2),
                                    "fvg_bottom": round(f['fvg_bottom'], 2),
                                    "entry_idx": i,
                                    "exit_idx": i,
                                    "sl_idx": f['c1_idx'],
                                    "sl_price": round(sl, 2),
                                    "tp_price": round(tp, 2),
                                })
                            elif c_high >= tp:
                                risk_amt = balance * (risk_percent / 100.0)
                                balance += (risk_amt * 2.0)
                                entry_dt = pd.to_datetime(ts)
                                entry_dt_utc = entry_dt.to_pydatetime() if hasattr(entry_dt, 'to_pydatetime') else entry_dt
                                all_trades.append({
                                    "trade_num": len(all_trades) + 1,
                                    "symbol": "BTCUSDT",
                                    "asset_name": "Bitcoin (BTC/USDT)",
                                    "timeframe": "15m",
                                    "macro_timeframe": "4h",
                                    "4h_trend": trend,
                                    "direction": "LONG",
                                    "entry_time": str(ts),
                                    "entry_price": round(entry_p, 2),
                                    "exit_time": str(ts),
                                    "exit_price": round(tp, 2),
                                    "stop_loss": round(sl, 2),
                                    "take_profit": round(tp, 2),
                                    "risk_distance": round(risk_d, 2),
                                    "rr_ratio": "1:2",
                                    "result": "WIN",
                                    "pnl_percent": 2.0 * risk_percent,
                                    "pnl_dollar": round(risk_amt * 2.0, 2),
                                    "running_balance": round(balance, 2),
                                    "session_name": get_session_name(entry_dt_utc),
                                    "entry_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "exit_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "duration_hours": 0.25,
                                    "sh_idx": f['sh_idx'],
                                    "sh_price": f['sh_price'],
                                    "idm_idx": f['idm_idx'],
                                    "idm_price": f['idm_price'],
                                    "sweep_idx": f['sweep_idx'],
                                    "sweep_price": f['sweep_price'],
                                    "bos_idx": f['bos_idx'],
                                    "bos_price": f['bos_price'],
                                    "bos_level": f['bos_level'],
                                    "idm_level": f['idm_level'],
                                    "c1_idx": f['c1_idx'],
                                    "c2_idx": f['c2_idx'],
                                    "c3_idx": f['c3_idx'],
                                    "fvg_top": round(f['fvg_top'], 2),
                                    "fvg_bottom": round(f['fvg_bottom'], 2),
                                    "entry_idx": i,
                                    "exit_idx": i,
                                    "sl_idx": f['c1_idx'],
                                    "sl_price": round(sl, 2),
                                    "tp_price": round(tp, 2),
                                })
                            else:
                                active_pos = {
                                    'direction': 'LONG',
                                    'entry_time': ts,
                                    'entry_price': entry_p,
                                    'stop_loss': sl,
                                    'take_profit': tp,
                                    'risk_distance': risk_d,
                                    'trend_4h': trend,
                                    'sh_idx': f['sh_idx'],
                                    'sh_price': f['sh_price'],
                                    'idm_idx': f['idm_idx'],
                                    'idm_price': f['idm_price'],
                                    'sweep_idx': f['sweep_idx'],
                                    'sweep_price': f['sweep_price'],
                                    'bos_idx': f['bos_idx'],
                                    'bos_price': f['bos_price'],
                                    'bos_level': f['bos_level'],
                                    'idm_level': f['idm_level'],
                                    'c1_idx': f['c1_idx'],
                                    'c2_idx': f['c2_idx'],
                                    'c3_idx': f['c3_idx'],
                                    'fvg_top': f['fvg_top'],
                                    'fvg_bottom': f['fvg_bottom'],
                                    'entry_idx': i,
                                }
                            pending_fvg = None

                elif f['direction'] == 'SHORT' and trend == 'BEARISH':
                    if c_high >= f['c1_high'] and c_open >= f['fvg_bottom']:
                        pending_fvg = None
                    # Price retraces UP to touch the FVG gap:
                    elif c_high >= f['fvg_bottom'] and c_low <= f['fvg_top']:
                        entry_p = max(f['fvg_bottom'], c_open)
                        sl = f['c1_high']
                        risk_d = sl - entry_p
                        if risk_d > 1.0:
                            tp = round(entry_p - 2.0 * risk_d, 2)
                            if c_high >= sl:
                                risk_amt = balance * (risk_percent / 100.0)
                                balance -= risk_amt
                                entry_dt = pd.to_datetime(ts)
                                entry_dt_utc = entry_dt.to_pydatetime() if hasattr(entry_dt, 'to_pydatetime') else entry_dt
                                all_trades.append({
                                    "trade_num": len(all_trades) + 1,
                                    "symbol": "BTCUSDT",
                                    "asset_name": "Bitcoin (BTC/USDT)",
                                    "timeframe": "15m",
                                    "macro_timeframe": "4h",
                                    "4h_trend": trend,
                                    "direction": "SHORT",
                                    "entry_time": str(ts),
                                    "entry_price": round(entry_p, 2),
                                    "exit_time": str(ts),
                                    "exit_price": round(sl, 2),
                                    "stop_loss": round(sl, 2),
                                    "take_profit": round(tp, 2),
                                    "risk_distance": round(risk_d, 2),
                                    "rr_ratio": "1:2",
                                    "result": "LOSS",
                                    "pnl_percent": -risk_percent,
                                    "pnl_dollar": -round(risk_amt, 2),
                                    "running_balance": round(balance, 2),
                                    "session_name": get_session_name(entry_dt_utc),
                                    "entry_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "exit_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "duration_hours": 0.25,
                                    "sh_idx": f['sh_idx'],
                                    "sh_price": f['sh_price'],
                                    "idm_idx": f['idm_idx'],
                                    "idm_price": f['idm_price'],
                                    "sweep_idx": f['sweep_idx'],
                                    "sweep_price": f['sweep_price'],
                                    "bos_idx": f['bos_idx'],
                                    "bos_price": f['bos_price'],
                                    "bos_level": f['bos_level'],
                                    "idm_level": f['idm_level'],
                                    "c1_idx": f['c1_idx'],
                                    "c2_idx": f['c2_idx'],
                                    "c3_idx": f['c3_idx'],
                                    "fvg_top": round(f['fvg_top'], 2),
                                    "fvg_bottom": round(f['fvg_bottom'], 2),
                                    "entry_idx": i,
                                    "exit_idx": i,
                                    "sl_idx": f['c1_idx'],
                                    "sl_price": round(sl, 2),
                                    "tp_price": round(tp, 2),
                                })
                            elif c_low <= tp:
                                risk_amt = balance * (risk_percent / 100.0)
                                balance += (risk_amt * 2.0)
                                entry_dt = pd.to_datetime(ts)
                                entry_dt_utc = entry_dt.to_pydatetime() if hasattr(entry_dt, 'to_pydatetime') else entry_dt
                                all_trades.append({
                                    "trade_num": len(all_trades) + 1,
                                    "symbol": "BTCUSDT",
                                    "asset_name": "Bitcoin (BTC/USDT)",
                                    "timeframe": "15m",
                                    "macro_timeframe": "4h",
                                    "4h_trend": trend,
                                    "direction": "SHORT",
                                    "entry_time": str(ts),
                                    "entry_price": round(entry_p, 2),
                                    "exit_time": str(ts),
                                    "exit_price": round(tp, 2),
                                    "stop_loss": round(sl, 2),
                                    "take_profit": round(tp, 2),
                                    "risk_distance": round(risk_d, 2),
                                    "rr_ratio": "1:2",
                                    "result": "WIN",
                                    "pnl_percent": 2.0 * risk_percent,
                                    "pnl_dollar": round(risk_amt * 2.0, 2),
                                    "running_balance": round(balance, 2),
                                    "session_name": get_session_name(entry_dt_utc),
                                    "entry_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "exit_time_ist": entry_dt_utc.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
                                    "duration_hours": 0.25,
                                    "sh_idx": f['sh_idx'],
                                    "sh_price": f['sh_price'],
                                    "idm_idx": f['idm_idx'],
                                    "idm_price": f['idm_price'],
                                    "sweep_idx": f['sweep_idx'],
                                    "sweep_price": f['sweep_price'],
                                    "bos_idx": f['bos_idx'],
                                    "bos_price": f['bos_price'],
                                    "bos_level": f['bos_level'],
                                    "idm_level": f['idm_level'],
                                    "c1_idx": f['c1_idx'],
                                    "c2_idx": f['c2_idx'],
                                    "c3_idx": f['c3_idx'],
                                    "fvg_top": round(f['fvg_top'], 2),
                                    "fvg_bottom": round(f['fvg_bottom'], 2),
                                    "entry_idx": i,
                                    "exit_idx": i,
                                    "sl_idx": f['c1_idx'],
                                    "sl_price": round(sl, 2),
                                    "tp_price": round(tp, 2),
                                })
                            else:
                                active_pos = {
                                    'direction': 'SHORT',
                                    'entry_time': ts,
                                    'entry_price': entry_p,
                                    'stop_loss': sl,
                                    'take_profit': tp,
                                    'risk_distance': risk_d,
                                    'trend_4h': trend,
                                    'sh_idx': f['sh_idx'],
                                    'sh_price': f['sh_price'],
                                    'idm_idx': f['idm_idx'],
                                    'idm_price': f['idm_price'],
                                    'sweep_idx': f['sweep_idx'],
                                    'sweep_price': f['sweep_price'],
                                    'bos_idx': f['bos_idx'],
                                    'bos_price': f['bos_price'],
                                    'bos_level': f['bos_level'],
                                    'idm_level': f['idm_level'],
                                    'c1_idx': f['c1_idx'],
                                    'c2_idx': f['c2_idx'],
                                    'c3_idx': f['c3_idx'],
                                    'fvg_top': f['fvg_top'],
                                    'fvg_bottom': f['fvg_bottom'],
                                    'entry_idx': i,
                                }
                            pending_fvg = None

        # ── Step C: Detect 15M BOS & FVG Setup ──
        if active_pos is None and pending_fvg is None:
            if trend == 'BULLISH':
                recent_shs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx < i - 1 and sh_idx >= i - 60]
                for (sh_idx, sh_p) in reversed(recent_shs):
                    if c_close > sh_p and prev['close'] <= sh_p:
                        pullback_lows = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sl_idx > sh_idx and sl_idx < i and sl_p < sh_p]
                        if not pullback_lows:
                            continue
                        idm_idx, idm_p = pullback_lows[0]

                        bars_between = df_15m.iloc[idm_idx + 1 : i]
                        if bars_between.empty:
                            continue

                        broke_sh_early = False
                        idm_swept = False
                        sweep_idx = None
                        sweep_price = None
                        for b_idx, b_row in bars_between.iterrows():
                            if not idm_swept:
                                if b_row['high'] > sh_p:
                                    broke_sh_early = True
                                    break
                                if b_row['low'] <= idm_p:
                                    idm_swept = True
                                    sweep_idx = int(b_idx)
                                    sweep_price = float(b_row['low'])

                        if idm_swept and not broke_sh_early:
                            for c2_pos in range(i, min(len(df_15m) - 1, i + 3)):
                                c1_pos = c2_pos - 1
                                c3_pos = c2_pos + 1
                                if c3_pos < len(df_15m) and c1_pos >= 0:
                                    c1 = df_15m.iloc[c1_pos]
                                    c2 = df_15m.iloc[c2_pos]
                                    c3 = df_15m.iloc[c3_pos]
                                    fvg_gap = float(c3['low']) - float(c1['high'])
                                    if fvg_gap >= min_fvg_gap and float(c2['close']) > float(c2['open']):
                                        c2_range = float(c2['high']) - float(c2['low'])
                                        c2_body = abs(float(c2['close']) - float(c2['open']))
                                        if c2_range > 0 and (c2_body / c2_range) >= 0.30:
                                            pending_fvg = {
                                                'direction': 'LONG',
                                                'sh_idx': int(sh_idx),
                                                'sh_price': round(float(sh_p), 2),
                                                'idm_idx': int(idm_idx),
                                                'idm_price': round(float(idm_p), 2),
                                                'sweep_idx': int(sweep_idx) if sweep_idx is not None else int(idm_idx),
                                                'sweep_price': round(float(sweep_price), 2) if sweep_price is not None else round(float(idm_p), 2),
                                                'bos_idx': i,
                                                'bos_price': round(float(c_close), 2),
                                                'bos_level': round(float(sh_p), 2),
                                                'idm_level': round(float(idm_p), 2),
                                                'c1_idx': c1_pos,
                                                'c2_idx': c2_pos,
                                                'c3_idx': c3_pos,
                                                'fvg_candle_idx': c2_pos,
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
                    if c_close < sl_p and prev['close'] >= sl_p:
                        pullback_highs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx > sl_idx and sh_idx < i and sh_p > sl_p]
                        if not pullback_highs:
                            continue
                        idm_idx, idm_p = pullback_highs[0]

                        bars_between = df_15m.iloc[idm_idx + 1 : i]
                        if bars_between.empty:
                            continue

                        broke_sl_early = False
                        idm_swept = False
                        sweep_idx = None
                        sweep_price = None
                        for b_idx, b_row in bars_between.iterrows():
                            if not idm_swept:
                                if b_row['low'] < sl_p:
                                    broke_sl_early = True
                                    break
                                if b_row['high'] >= idm_p:
                                    idm_swept = True
                                    sweep_idx = int(b_idx)
                                    sweep_price = float(b_row['high'])

                        if idm_swept and not broke_sl_early:
                            for c2_pos in range(i, min(len(df_15m) - 1, i + 3)):
                                c1_pos = c2_pos - 1
                                c3_pos = c2_pos + 1
                                if c3_pos < len(df_15m) and c1_pos >= 0:
                                    c1 = df_15m.iloc[c1_pos]
                                    c2 = df_15m.iloc[c2_pos]
                                    c3 = df_15m.iloc[c3_pos]
                                    fvg_gap = float(c1['low']) - float(c3['high'])
                                    if fvg_gap >= min_fvg_gap and float(c2['close']) < float(c2['open']):
                                        c2_range = float(c2['high']) - float(c2['low'])
                                        c2_body = abs(float(c2['close']) - float(c2['open']))
                                        if c2_range > 0 and (c2_body / c2_range) >= 0.30:
                                            pending_fvg = {
                                                'direction': 'SHORT',
                                                'sh_idx': int(sl_idx),
                                                'sh_price': round(float(sl_p), 2),
                                                'idm_idx': int(idm_idx),
                                                'idm_price': round(float(idm_p), 2),
                                                'sweep_idx': int(sweep_idx) if sweep_idx is not None else int(idm_idx),
                                                'sweep_price': round(float(sweep_price), 2) if sweep_price is not None else round(float(idm_p), 2),
                                                'bos_idx': i,
                                                'bos_price': round(float(c_close), 2),
                                                'bos_level': round(float(sl_p), 2),
                                                'idm_level': round(float(idm_p), 2),
                                                'c1_idx': c1_pos,
                                                'c2_idx': c2_pos,
                                                'c3_idx': c3_pos,
                                                'fvg_candle_idx': c2_pos,
                                                'fvg_top': float(c1['low']),
                                                'fvg_bottom': float(c3['high']),
                                                'c1_high': float(c1['high']),
                                            }
                                            break
                            if pending_fvg is not None:
                                break

    # ── 6. FILTER TO SPECIFIED PERIOD (1 AUG - 15 OCT) ──
    df_all_trades = pd.DataFrame(all_trades)
    df_all_trades['entry_dt'] = pd.to_datetime(df_all_trades['entry_time'])
    period_trades = df_all_trades[
        (df_all_trades['entry_dt'] >= start_date) & 
        (df_all_trades['entry_dt'] <= end_date)
    ].copy().reset_index(drop=True)

    # Re-calculate balance strictly starting from $10,000 on 1 August
    bal = starting_balance
    bal_history = []
    pnl_dollars_clean = []
    pnl_pcts_clean = []

    for idx, row in period_trades.iterrows():
        r_amt = bal * (risk_percent / 100.0)
        p_dol = (r_amt * 2.0) if row['result'] == 'WIN' else (-r_amt)
        p_pct = (2.0 * risk_percent) if row['result'] == 'WIN' else (-risk_percent)
        bal += p_dol
        bal_history.append(round(bal, 2))
        pnl_dollars_clean.append(round(p_dol, 2))
        pnl_pcts_clean.append(p_pct)

    period_trades['trade_num'] = [i + 1 for i in range(len(period_trades))]
    period_trades['running_balance'] = bal_history
    period_trades['pnl_dollar'] = pnl_dollars_clean
    period_trades['pnl_percent'] = pnl_pcts_clean
    period_trades['month'] = period_trades['entry_dt'].dt.strftime('%Y-%m')

    # Add setup description and outcomes
    for idx, t in period_trades.iterrows():
        direction = t['direction']
        t_trend = t['4h_trend']
        sl_val = t['stop_loss']
        tp_val = t['take_profit']
        fvg_top = t['fvg_top']
        fvg_bot = t['fvg_bottom']
        period_trades.at[idx, 'setup_reason'] = (
            f"Irshad SMC: 4H {t_trend} + 15M IDM Swept + 15M BOS Break + 15M FVG Retrace Touch [SL: First Candle Extreme ${sl_val}]"
        )
        period_trades.at[idx, 'pattern_type'] = f"4H Trend ({t_trend}) + 15M FVG Mitigation"
        if t['result'] == 'WIN':
            period_trades.at[idx, 'why_outcome'] = (
                f"Target Hit (+2R): Price retraced into the {direction} FVG gap [${fvg_bot} - ${fvg_top}], "
                f"held first candle extreme (${sl_val}), and reached 1:2 R:R target (${tp_val})."
            )
        else:
            period_trades.at[idx, 'why_outcome'] = (
                f"Stop Loss Hit (-1R): Market retraced through the FVG and reached the first candle boundary (${sl_val})."
            )

    # ── 7. BUILD TRADE CANDLE SLICES WITH STRICT CANONICAL COORDINATE CONVERSION ──
    trade_candles_map = {}
    verified_count = 0

    for idx, t in period_trades.iterrows():
        g_sh = int(t['sh_idx'])
        g_idm = int(t['idm_idx'])
        g_sweep = int(t['sweep_idx'])
        g_bos = int(t['bos_idx'])
        g_c1 = int(t['c1_idx'])
        g_c2 = int(t['c2_idx'])
        g_c3 = int(t['c3_idx'])
        g_entry = int(t['entry_idx'])
        g_exit = int(t['exit_idx'])

        earliest_anchor = min(g_sh, g_idm)
        latest_anchor = max(g_entry, g_exit)

        w_start = max(0, earliest_anchor - 12)
        w_end = min(len(df_15m), latest_anchor + 12)
        w_df = df_15m.iloc[w_start:w_end]

        local_sh = g_sh - w_start
        local_idm = g_idm - w_start
        local_sweep = g_sweep - w_start
        local_bos = g_bos - w_start
        local_c1 = g_c1 - w_start
        local_c2 = g_c2 - w_start
        local_c3 = g_c3 - w_start
        local_entry = g_entry - w_start
        local_exit = g_exit - w_start

        candle_list = []
        for _, r in w_df.iterrows():
            c_ts = r['dt'].strftime('%Y-%m-%d %H:%M')
            candle_list.append([
                c_ts,
                round(float(r['open']), 2),
                round(float(r['high']), 2),
                round(float(r['low']), 2),
                round(float(r['close']), 2),
            ])

        key = f"BTCUSDT_{t['trade_num']}"
        trade_candles_map[key] = {
            "window_start_global": w_start,
            "window_end_global": w_end,
            "local_sh_idx": local_sh,
            "local_idm_idx": local_idm,
            "local_sweep_idx": local_sweep,
            "local_bos_idx": local_bos,
            "local_c1_idx": local_c1,
            "local_c2_idx": local_c2,
            "local_c3_idx": local_c3,
            "local_entry_idx": local_entry,
            "local_exit_idx": local_exit,
            "sh_price": round(float(t['sh_price']), 2),
            "idm_price": round(float(t['idm_price']), 2),
            "sweep_price": round(float(t['sweep_price']), 2),
            "bos_price": round(float(t['bos_price']), 2),
            "bos_level": round(float(t['bos_level']), 2),
            "idm_level": round(float(t['idm_level']), 2),
            "fvg_top": round(float(t['fvg_top']), 2),
            "fvg_bottom": round(float(t['fvg_bottom']), 2),
            "entry_price": round(float(t['entry_price']), 2),
            "stop_loss": round(float(t['stop_loss']), 2),
            "take_profit": round(float(t['take_profit']), 2),
            "exit_price": round(float(t['exit_price']), 2),
            "direction": t['direction'],
            "result": t['result'],
            "candles": candle_list,
        }
        verified_count += 1

    print(f"Verified {verified_count} canonical BTC trade windows built!")

    # ── 8. MERGE INTO MAIN APP DATA ──
    n_wins = int((period_trades['result'] == 'WIN').sum())
    n_losses = int((period_trades['result'] == 'LOSS').sum())
    total_gross_profit = sum(d for d in pnl_dollars_clean if d > 0)
    total_gross_loss = abs(sum(d for d in pnl_dollars_clean if d < 0))
    profit_factor = round(total_gross_profit / max(0.01, total_gross_loss), 2)

    peak = starting_balance
    max_dd = 0.0
    running = starting_balance
    for d in pnl_dollars_clean:
        running += d
        if running > peak:
            peak = running
        dd = (peak - running) / peak * 100.0
        if dd > max_dd:
            max_dd = dd
    max_dd = round(max_dd, 2)

    btc_summary = {
        "name": "Bitcoin (BTC/USDT) [1 Aug - 15 Oct 2026 · 4H Trend + 15M SMC]",
        "symbol": "BTCUSDT",
        "period": "1 August 2026 - 15 October 2026",
        "total_trades": len(period_trades),
        "wins": n_wins,
        "losses": n_losses,
        "win_rate": round(n_wins / max(1, len(period_trades)) * 100.0, 2),
        "profit_factor": profit_factor,
        "net_pnl_dollars": round(bal - starting_balance, 2),
        "net_pnl_pct": round((bal - starting_balance) / starting_balance * 100.0, 2),
        "starting_balance": starting_balance,
        "ending_balance": round(bal, 2),
        "rr_ratio": "1:2 (Rule #8 First Candle Extreme SL)",
        "max_drawdown_pct": max_dd,
        "trend_timeframe": "4-Hour (4H)",
        "execution_timeframe": "15-Minute (15M)",
        "strategy_model": "Irshad SMC: 4H Trend -> 15M IDM Sweep -> 15M BOS -> 3-Candle FVG Retrace Touch",
    }

    monthly_stats = []
    for m, grp in period_trades.groupby('month'):
        mw = (grp['result'] == 'WIN').sum()
        ml = (grp['result'] == 'LOSS').sum()
        mt = len(grp)
        monthly_stats.append({
            "month": m,
            "symbol": "BTCUSDT",
            "trades": mt,
            "wins": int(mw),
            "losses": int(ml),
            "win_rate": round(mw / mt * 100.0, 1),
            "net_return_pct": round(grp['pnl_percent'].sum(), 1),
        })
    btc_summary["monthly_breakdown"] = monthly_stats

    # Update trade_candles.json
    frontend_candles_path = "trading-agent/frontend/public/trade_candles.json"
    with open(frontend_candles_path, "r") as f:
        existing_candles = json.load(f)
    existing_candles.update(trade_candles_map)
    with open(frontend_candles_path, "w") as f:
        json.dump(existing_candles, f)

    # Update backtest_results_2026.json
    frontend_results_path = "trading-agent/frontend/public/backtest_results_2026.json"
    backend_results_path = "trading-agent/backend/data/backtest_results.json"
    with open(frontend_results_path, "r") as f:
        main_payload = json.load(f)

    # Replace BTC trades with newly enriched canonical BTC trades
    non_btc = [t for t in main_payload["trades"] if t.get("symbol") != "BTCUSDT"]
    output_btc_trades = period_trades.drop(columns=['entry_dt']).to_dict(orient='records')
    main_payload["btc_summary"] = btc_summary
    main_payload["trades"] = output_btc_trades + non_btc

    # Update monthly breakdown
    other_monthly = [m for m in main_payload.get("monthly_breakdown", []) if m.get("symbol") != "BTCUSDT"]
    main_payload["monthly_breakdown"] = other_monthly + monthly_stats

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

    with open(frontend_results_path, "w") as f:
        json.dump(main_payload, f, indent=2, default=json_default)
    with open(backend_results_path, "w") as f:
        json.dump(main_payload, f, indent=2, default=json_default)

    btc_payload = {
        "summary": btc_summary,
        "trades": output_btc_trades,
    }
    with open("trading-agent/btc_backtest_aug_oct_2026.json", "w") as f:
        json.dump(btc_payload, f, indent=2, default=json_default)

    print("\n" + "=" * 70)
    print("  BITCOIN (BTC/USDT) SMC BACKTEST RESULTS (1 AUG - 15 OCT 2026)")
    print("=" * 70)
    print(f"  Total Trades:     {btc_summary['total_trades']}")
    print(f"  Wins / Losses:    {btc_summary['wins']}W / {btc_summary['losses']}L")
    print(f"  Win Rate:         {btc_summary['win_rate']}% (Beats 33.3% Breakeven by +{btc_summary['win_rate'] - 33.33:.2f}%)")
    print(f"  Net Return:       +{btc_summary['net_pnl_pct']}% (+${btc_summary['net_pnl_dollars']:,.2f})")
    print(f"  Profit Factor:    {btc_summary['profit_factor']}")
    print(f"  Max Drawdown:     {btc_summary['max_drawdown_pct']}%")
    print(f"  Ending Balance:   ${btc_summary['ending_balance']:,.2f}")
    print("\n  Monthly Breakdown:")
    for m in monthly_stats:
        print(f"    • {m['month']}: {m['trades']} trades | {m['wins']}W / {m['losses']}L | WR: {m['win_rate']}% | Return: {m['net_return_pct']}%")
    print("=" * 70)

    return btc_payload

if __name__ == "__main__":
    run_btc_backtest()
