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

def run_chain_of_choch(
    symbol: str = "XAUUSD",
    path_15m: str = "trading-agent/data_cache/PAXG_15m.pkl",
    start_date: str = "2026-08-01",
    end_date: str = "2026-10-15 23:59:59",
    starting_balance: float = 10000.0,
    risk_percent: float = 1.0,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    print("=" * 70)
    print(f"  RUNNING CHAIN-OF-CHOCH ENGINE: {symbol}")
    print(f"  PERIOD: {start_date} TO {end_date}")
    print(f"  TIMEFRAME: PURE 15M (BOS CONTINUATION + CHOCH REVERSAL)")
    print(f"  RULE #8 C1 SL & RULE #9 1:2 TP & STRICT BODY CHOCH BREAK")
    print("=" * 70)

    # 1. Load 15M Data
    df_raw = pd.read_pickle(path_15m).reset_index(drop=True)
    df_raw['dt'] = pd.to_datetime(df_raw['timestamp'])
    
    # Slice strictly to period
    df = df_raw[(df_raw['dt'] >= start_date) & (df_raw['dt'] <= end_date)].reset_index(drop=True)
    print(f"Loaded {len(df)} 15M candles for {symbol}")

    # 2. Detect 15M Fractal Swing Points (p=3)
    p = 3
    df['sh'] = np.nan
    df['sl'] = np.nan
    for i in range(p, len(df) - p):
        wh = df['high'].iloc[i - p : i + p + 1]
        wl = df['low'].iloc[i - p : i + p + 1]
        if df['high'].iloc[i] == wh.max():
            df.loc[i, 'sh'] = df['high'].iloc[i]
        if df['low'].iloc[i] == wl.min():
            df.loc[i, 'sl'] = df['low'].iloc[i]

    swing_highs = [(idx, float(df['high'].iloc[idx])) for idx in df[df['sh'].notna()].index]
    swing_lows = [(idx, float(df['low'].iloc[idx])) for idx in df[df['sl'].notna()].index]
    print(f"Precomputed {len(swing_highs)} swing highs, {len(swing_lows)} swing lows")

    # 3. State Tracking
    trend = 'BULLISH'
    current_choch = None # dict: { 'price', 'idx', 'type': 'BEARISH_CHOCH' or 'BULLISH_CHOCH' }
    
    active_pos = None
    pending_fvg = None
    balance = starting_balance
    trades = []
    trade_candles_dict = {}

    for i in range(20, len(df) - 1):
        bar = df.iloc[i]
        prev = df.iloc[i - 1]
        c_open = float(bar['open'])
        c_high = float(bar['high'])
        c_low = float(bar['low'])
        c_close = float(bar['close'])
        ts = bar['timestamp']

        # ── Step A: Manage Active Trade ──
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

                trade_num = len(trades) + 1
                trade_record = {
                    "trade_num": trade_num,
                    "symbol": symbol,
                    "asset_name": "Gold (XAU/USD)" if "XAU" in symbol or "PAXG" in symbol else "Bitcoin (BTC/USDT)",
                    "timeframe": "15m",
                    "trade_type": pos['type'],
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
                    "setup_reason": f"Chain-of-CHoCH: {pos['type']} ({pos['direction']}) -> 15M FVG Retrace Touch [SL: C1 Extreme]",
                    # Structural coordinates
                    "sh_idx": pos['sh_idx'],
                    "sh_price": pos['sh_price'],
                    "idm_idx": pos['idm_idx'],
                    "idm_price": pos['idm_price'],
                    "bos_idx": pos['bos_idx'],
                    "bos_price": pos['bos_price'],
                    "bos_level": pos['bos_level'],
                    "idm_level": pos['idm_level'],
                    "choch_idx": pos.get('choch_idx', pos['sh_idx']),
                    "choch_price": pos.get('choch_price', pos['bos_level']),
                    "c1_idx": pos['c1_idx'],
                    "c2_idx": pos['c2_idx'],
                    "c3_idx": pos['c3_idx'],
                    "fvg_top": round(pos['fvg_top'], 2),
                    "fvg_bottom": round(pos['fvg_bottom'], 2),
                    "entry_idx": pos['entry_idx'],
                    "exit_idx": i,
                }
                trades.append(trade_record)

                # Canonical Chart Window Slicing
                w_start = max(0, min(pos['sh_idx'], pos['idm_idx'], pos['bos_idx'], pos.get('choch_idx', pos['sh_idx']), pos['c1_idx']) - 12)
                w_end = min(len(df), i + 12)
                window_df = df.iloc[w_start:w_end]
                candles_list = [
                    [str(row['timestamp']), round(float(row['open']), 2), round(float(row['high']), 2), round(float(row['low']), 2), round(float(row['close']), 2)]
                    for _, row in window_df.iterrows()
                ]
                trade_key = f"{symbol}_{trade_num}"
                trade_candles_dict[trade_key] = {
                    "window_start_global": w_start,
                    "window_end_global": w_end,
                    "local_sh_idx": pos['sh_idx'] - w_start,
                    "local_idm_idx": pos['idm_idx'] - w_start,
                    "local_sweep_idx": pos.get('sweep_idx', pos['idm_idx']) - w_start,
                    "local_bos_idx": pos['bos_idx'] - w_start,
                    "local_choch_idx": (pos.get('choch_idx', pos['sh_idx']) - w_start) if pos.get('choch_idx') else (pos['sh_idx'] - w_start),
                    "local_c1_idx": pos['c1_idx'] - w_start,
                    "local_c2_idx": pos['c2_idx'] - w_start,
                    "local_c3_idx": pos['c3_idx'] - w_start,
                    "local_entry_idx": pos['entry_idx'] - w_start,
                    "local_exit_idx": i - w_start,
                    "sh_price": pos['sh_price'],
                    "idm_price": pos['idm_price'],
                    "sweep_price": pos.get('sweep_price', pos['idm_price']),
                    "bos_price": pos['bos_price'],
                    "bos_level": pos['bos_level'],
                    "idm_level": pos['idm_level'],
                    "choch_price": pos.get('choch_price', pos['bos_level']),
                    "trade_type": pos['type'],
                    "fvg_top": round(pos['fvg_top'], 2),
                    "fvg_bottom": round(pos['fvg_bottom'], 2),
                    "entry_price": round(pos['entry_price'], 2),
                    "stop_loss": round(pos['stop_loss'], 2),
                    "take_profit": round(pos['take_profit'], 2),
                    "exit_price": round(exit_price, 2),
                    "direction": pos['direction'],
                    "result": outcome,
                    "candles": candles_list,
                }
                active_pos = None

        # ── Step B: Check Pending FVG Retrace Touch ──
        if active_pos is None and pending_fvg is not None:
            f = pending_fvg
            if i > f['c3_idx']:
                if f['direction'] == 'LONG':
                    # Invalidation: C1 extreme (SL) breached before FVG touch
                    if c_low <= f['c1_low']:
                        pending_fvg = None
                    elif c_low <= f['fvg_top'] and c_high >= f['fvg_bottom']:
                        entry_p = min(f['fvg_top'], c_open)
                        sl = f['c1_low']
                        risk_d = entry_p - sl
                        if risk_d > 0.05:
                            tp = round(entry_p + 2.0 * risk_d, 2)
                            active_pos = {
                                'type': f['type'],
                                'direction': 'LONG',
                                'entry_time': ts,
                                'entry_price': entry_p,
                                'stop_loss': sl,
                                'take_profit': tp,
                                'risk_distance': risk_d,
                                'sh_idx': f['sh_idx'],
                                'sh_price': f['sh_price'],
                                'idm_idx': f['idm_idx'],
                                'idm_price': f['idm_price'],
                                'sweep_idx': f.get('sweep_idx', f['idm_idx']),
                                'sweep_price': f.get('sweep_price', f['idm_price']),
                                'bos_idx': f['bos_idx'],
                                'bos_price': f['bos_price'],
                                'bos_level': f['bos_level'],
                                'idm_level': f['idm_level'],
                                'choch_idx': f.get('choch_idx', f['sh_idx']),
                                'choch_price': f.get('choch_price', f['bos_level']),
                                'c1_idx': f['c1_idx'],
                                'c2_idx': f['c2_idx'],
                                'c3_idx': f['c3_idx'],
                                'fvg_top': f['fvg_top'],
                                'fvg_bottom': f['fvg_bottom'],
                                'entry_idx': i,
                            }
                            pending_fvg = None

                elif f['direction'] == 'SHORT':
                    # Invalidation: C1 extreme (SL) breached before FVG touch
                    if c_high >= f['c1_high']:
                        pending_fvg = None
                    elif c_high >= f['fvg_bottom'] and c_low <= f['fvg_top']:
                        entry_p = max(f['fvg_bottom'], c_open)
                        sl = f['c1_high']
                        risk_d = sl - entry_p
                        if risk_d > 0.05:
                            tp = round(entry_p - 2.0 * risk_d, 2)
                            active_pos = {
                                'type': f['type'],
                                'direction': 'SHORT',
                                'entry_time': ts,
                                'entry_price': entry_p,
                                'stop_loss': sl,
                                'take_profit': tp,
                                'risk_distance': risk_d,
                                'sh_idx': f['sh_idx'],
                                'sh_price': f['sh_price'],
                                'idm_idx': f['idm_idx'],
                                'idm_price': f['idm_price'],
                                'sweep_idx': f.get('sweep_idx', f['idm_idx']),
                                'sweep_price': f.get('sweep_price', f['idm_price']),
                                'bos_idx': f['bos_idx'],
                                'bos_price': f['bos_price'],
                                'bos_level': f['bos_level'],
                                'idm_level': f['idm_level'],
                                'choch_idx': f.get('choch_idx', f['sh_idx']),
                                'choch_price': f.get('choch_price', f['bos_level']),
                                'c1_idx': f['c1_idx'],
                                'c2_idx': f['c2_idx'],
                                'c3_idx': f['c3_idx'],
                                'fvg_top': f['fvg_top'],
                                'fvg_bottom': f['fvg_bottom'],
                                'entry_idx': i,
                            }
                            pending_fvg = None

        # ── Step C: CHoCH Break (Trend Reversal) Detection ──
        # Rule 3: Body Close beyond active CHoCH level flips trend!
        # Candle i is C2 (the breakout candle)
        if current_choch is not None:
            if trend == 'BULLISH' and c_close < current_choch['price']:
                # Bearish CHoCH Breakout!
                trend = 'BEARISH'
                choch_data = current_choch
                current_choch = None

                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c2 = df.iloc[i]
                    c3 = df.iloc[c3_idx]
                    gap = float(c1['low']) - float(c3['high'])
                    if gap > 0:  # PDF: "any non-zero FVG qualifies"
                        if active_pos is None and pending_fvg is None:
                            pending_fvg = {
                                'type': 'REVERSAL_CHOCH',
                                'direction': 'SHORT',
                                'sh_idx': choch_data['idx'],
                                'sh_price': choch_data['price'],
                                'idm_idx': c1_idx,
                                'idm_price': float(c1['high']),
                                'bos_idx': i,
                                'bos_price': c_close,
                                'bos_level': choch_data['price'],
                                'idm_level': float(c1['high']),
                                'choch_idx': choch_data['idx'],
                                'choch_price': choch_data['price'],
                                'c1_idx': c1_idx,
                                'c2_idx': i,
                                'c3_idx': c3_idx,
                                'c1_high': float(c1['high']),
                                'c1_low': float(c1['low']),
                                'fvg_top': float(c1['low']),
                                'fvg_bottom': float(c3['high']),
                                'gap_size': gap,
                            }

            elif trend == 'BEARISH' and c_close > current_choch['price']:
                # Bullish CHoCH Breakout!
                trend = 'BULLISH'
                choch_data = current_choch
                current_choch = None

                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c2 = df.iloc[i]
                    c3 = df.iloc[c3_idx]
                    gap = float(c3['low']) - float(c1['high'])
                    if gap > 0:  # PDF: "any non-zero FVG qualifies"
                        if active_pos is None and pending_fvg is None:
                            pending_fvg = {
                                'type': 'REVERSAL_CHOCH',
                                'direction': 'LONG',
                                'sh_idx': choch_data['idx'],
                                'sh_price': choch_data['price'],
                                'idm_idx': c1_idx,
                                'idm_price': float(c1['low']),
                                'bos_idx': i,
                                'bos_price': c_close,
                                'bos_level': choch_data['price'],
                                'idm_level': float(c1['low']),
                                'choch_idx': choch_data['idx'],
                                'choch_price': choch_data['price'],
                                'c1_idx': c1_idx,
                                'c2_idx': i,
                                'c3_idx': c3_idx,
                                'c1_high': float(c1['high']),
                                'c1_low': float(c1['low']),
                                'fvg_top': float(c3['low']),
                                'fvg_bottom': float(c1['high']),
                                'gap_size': gap,
                            }

        # ── Step D: Trend Continuation (BOS) & CHoCH Computation ──
        if trend == 'BULLISH':
            recent_shs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx < i - 1 and sh_idx >= i - 60]
            for (sh_idx, sh_p) in reversed(recent_shs):
                if c_close > sh_p and prev['close'] <= sh_p:
                    pullback_lows = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sl_idx > sh_idx and sl_idx < i and sl_p < sh_p]
                    if not pullback_lows:
                        continue
                    idm_idx, idm_p = pullback_lows[0]

                    bars_between = df.iloc[idm_idx + 1 : i]
                    if bars_between.empty:
                        continue

                    idm_swept = False
                    sweep_idx = None
                    sweep_price = None
                    for b_idx, b_row in bars_between.iterrows():
                        if b_row['low'] <= idm_p:
                            idm_swept = True
                            sweep_idx = int(b_idx)
                            sweep_price = float(b_row['low'])
                            break

                    if idm_swept:
                        # NEW_BOS confirmed!
                        # Calculate CHoCH: Lowest point between old BOS candle (sh_idx) and candle i:
                        range_bars = df.iloc[sh_idx : i + 1]
                        min_low = range_bars['low'].min()
                        min_idx = range_bars['low'].idxmin()

                        current_choch = {
                            'price': float(min_low),
                            'idx': int(min_idx),
                            'created_at': i,
                            'type': 'BEARISH_CHOCH'
                        }

                        # Continuation FVG setup: C2 is candle i
                        c1_idx = i - 1
                        c3_idx = i + 1
                        if c1_idx >= 0 and c3_idx < len(df):
                            c1 = df.iloc[c1_idx]
                            c2 = df.iloc[i]
                            c3 = df.iloc[c3_idx]
                            gap = float(c3['low']) - float(c1['high'])
                            if gap > 0:  # PDF: "any non-zero FVG qualifies"
                                if active_pos is None and pending_fvg is None:
                                    pending_fvg = {
                                        'type': 'CONTINUATION_BOS',
                                        'direction': 'LONG',
                                        'sh_idx': int(sh_idx),
                                        'sh_price': round(float(sh_p), 2),
                                        'idm_idx': int(idm_idx),
                                        'idm_price': round(float(idm_p), 2),
                                        'sweep_idx': int(sweep_idx) if sweep_idx else int(idm_idx),
                                        'sweep_price': round(float(sweep_price), 2) if sweep_price else round(float(idm_p), 2),
                                        'bos_idx': i,
                                        'bos_price': round(float(c_close), 2),
                                        'bos_level': round(float(sh_p), 2),
                                        'idm_level': round(float(idm_p), 2),
                                        'choch_idx': int(min_idx),
                                        'choch_price': round(float(min_low), 2),
                                        'c1_idx': c1_idx,
                                        'c2_idx': i,
                                        'c3_idx': c3_idx,
                                        'c1_high': float(c1['high']),
                                        'c1_low': float(c1['low']),
                                        'fvg_top': float(c3['low']),
                                        'fvg_bottom': float(c1['high']),
                                        'gap_size': gap,
                                    }
                        break

        elif trend == 'BEARISH':
            recent_sls = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sl_idx < i - 1 and sl_idx >= i - 60]
            for (sl_idx, sl_p) in reversed(recent_sls):
                if c_close < sl_p and prev['close'] >= sl_p:
                    pullback_highs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx > sl_idx and sh_idx < i and sh_p > sl_p]
                    if not pullback_highs:
                        continue
                    idm_idx, idm_p = pullback_highs[0]

                    bars_between = df.iloc[idm_idx + 1 : i]
                    if bars_between.empty:
                        continue

                    idm_swept = False
                    sweep_idx = None
                    sweep_price = None
                    for b_idx, b_row in bars_between.iterrows():
                        if b_row['high'] >= idm_p:
                            idm_swept = True
                            sweep_idx = int(b_idx)
                            sweep_price = float(b_row['high'])
                            break

                    if idm_swept:
                        # NEW_BOS confirmed!
                        range_bars = df.iloc[sl_idx : i + 1]
                        max_high = range_bars['high'].max()
                        max_idx = range_bars['high'].idxmax()

                        current_choch = {
                            'price': float(max_high),
                            'idx': int(max_idx),
                            'created_at': i,
                            'type': 'BULLISH_CHOCH'
                        }

                        # Continuation FVG setup: C2 is candle i
                        c1_idx = i - 1
                        c3_idx = i + 1
                        if c1_idx >= 0 and c3_idx < len(df):
                            c1 = df.iloc[c1_idx]
                            c2 = df.iloc[i]
                            c3 = df.iloc[c3_idx]
                            gap = float(c1['low']) - float(c3['high'])
                            if gap > 0:  # PDF: "any non-zero FVG qualifies"
                                if active_pos is None and pending_fvg is None:
                                    pending_fvg = {
                                        'type': 'CONTINUATION_BOS',
                                        'direction': 'SHORT',
                                        'sh_idx': int(sl_idx),
                                        'sh_price': round(float(sl_p), 2),
                                        'idm_idx': int(idm_idx),
                                        'idm_price': round(float(idm_p), 2),
                                        'sweep_idx': int(sweep_idx) if sweep_idx else int(idm_idx),
                                        'sweep_price': round(float(sweep_price), 2) if sweep_price else round(float(idm_p), 2),
                                        'bos_idx': i,
                                        'bos_price': round(float(c_close), 2),
                                        'bos_level': round(float(sl_p), 2),
                                        'idm_level': round(float(idm_p), 2),
                                        'choch_idx': int(max_idx),
                                        'choch_price': round(float(max_high), 2),
                                        'c1_idx': c1_idx,
                                        'c2_idx': i,
                                        'c3_idx': c3_idx,
                                        'c1_high': float(c1['high']),
                                        'c1_low': float(c1['low']),
                                        'fvg_top': float(c1['low']),
                                        'fvg_bottom': float(c3['high']),
                                        'gap_size': gap,
                                    }
                        break

    # 4. Summary & Performance Metrics
    total = len(trades)
    wins = len([t for t in trades if t['result'] == 'WIN'])
    losses = len([t for t in trades if t['result'] == 'LOSS'])
    wr = (wins / total * 100) if total > 0 else 0
    pnl = balance - starting_balance
    ret = (pnl / starting_balance) * 100

    # Profit Factor
    gross_profits = sum([t['pnl_dollar'] for t in trades if t['pnl_dollar'] > 0])
    gross_losses = abs(sum([t['pnl_dollar'] for t in trades if t['pnl_dollar'] < 0]))
    pf = round(gross_profits / gross_losses, 2) if gross_losses > 0 else 999.0

    # Max Drawdown
    peak = starting_balance
    max_dd = 0.0
    for t in trades:
        bal = t['running_balance']
        if bal > peak:
            peak = bal
        dd = (peak - bal) / peak * 100.0
        if dd > max_dd:
            max_dd = dd

    # Monthly Breakdown
    monthly_map = {}
    for t in trades:
        m = t['entry_time'][:7]
        if m not in monthly_map:
            monthly_map[m] = {'month': m, 'symbol': symbol, 'trades': 0, 'wins': 0, 'losses': 0, 'net_return_pct': 0.0}
        monthly_map[m]['trades'] += 1
        if t['result'] == 'WIN':
            monthly_map[m]['wins'] += 1
            monthly_map[m]['net_return_pct'] += 2.0 * risk_percent
        else:
            monthly_map[m]['losses'] += 1
            monthly_map[m]['net_return_pct'] -= risk_percent
    
    monthly_breakdown = []
    for m in sorted(monthly_map.keys()):
        item = monthly_map[m]
        item['win_rate'] = round(item['wins'] / item['trades'] * 100, 1) if item['trades'] > 0 else 0
        item['net_return_pct'] = round(item['net_return_pct'], 1)
        monthly_breakdown.append(item)

    reversals = len([t for t in trades if t['trade_type'] == 'REVERSAL_CHOCH'])
    continuations = len([t for t in trades if t['trade_type'] == 'CONTINUATION_BOS'])

    summary = {
        "name": f"{'Gold (XAU/USD)' if 'XAU' in symbol or 'PAXG' in symbol else 'Bitcoin (BTC/USDT)'} [1 Aug - 15 Oct 2026 · 15M Chain-of-CHoCH]",
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
        "monthly_breakdown": monthly_breakdown
    }

    print(f"\nRESULTS FOR {symbol}:")
    print(f"Total Trades: {total} ({wins}W / {losses}L)")
    print(f"Win Rate: {wr:.2f}% | Profit Factor: {pf}")
    print(f"Net PnL: ${pnl:.2f} ({ret:+.2f}%) | Max Drawdown: {max_dd:.2f}%")
    print(f"Breakdown: {continuations} Continuations (BOS) | {reversals} Reversals (CHoCH)")

    return summary, trades, trade_candles_dict

def export_all():
    # 1. Run Gold
    g_sum, g_trades, g_candles = run_chain_of_choch(
        symbol="XAUUSD",
        path_15m="trading-agent/data_cache/PAXG_15m.pkl",
        start_date="2026-08-01",
        end_date="2026-10-15 23:59:59",
    )

    # 2. Run BTC
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

    # Load existing main results to preserve any non-gold/btc data if present
    main_data = {}
    if os.path.exists(frontend_results_path):
        with open(frontend_results_path, "r") as f:
            main_data = json.load(f)

    # Combine trades
    other_trades = [t for t in main_data.get("trades", []) if t.get("symbol") not in ("XAUUSD", "BTCUSDT")]
    combined_trades = g_trades + b_trades + other_trades

    # Combined summary
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
        "rr_ratio": "1:2 (Rule #8 First Candle Extreme SL)"
    }
    main_data["trades"] = combined_trades

    # Update monthly breakdown
    merged_monthly = g_sum["monthly_breakdown"] + b_sum["monthly_breakdown"]
    other_monthly = [m for m in main_data.get("monthly_breakdown", []) if m.get("symbol") not in ("XAUUSD", "BTCUSDT")]
    main_data["monthly_breakdown"] = merged_monthly + other_monthly

    # Save results to frontend and backend
    with open(frontend_results_path, "w") as f:
        json.dump(main_data, f, indent=2)
    with open(backend_results_path, "w") as f:
        json.dump(main_data, f, indent=2)
    print(f"Exported backtest results to {frontend_results_path} and {backend_results_path}")

    # Load existing candles map and update with new Gold & BTC candle windows
    candles_map = {}
    if os.path.exists(frontend_candles_path):
        with open(frontend_candles_path, "r") as f:
            candles_map = json.load(f)

    # Merge new candle windows
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
