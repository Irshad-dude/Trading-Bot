"""
Complete SMC Institutional Engine with 40-45 deg Trend Angle & Dynamic CHoCH.
"""
import pandas as pd
import numpy as np

def run_smc_complete(
    symbol="XAUUSD",
    path_15m="data_cache/PAXG_15m_full.pkl",
    start_date="2025-11-01",
    end_date="2026-11-02 23:59:59",
    min_angle=35.0, # around 40-45 degrees trending filter
    p=4, # clean fractal swings
    starting_balance=10000.0,
    risk_percent=1.0,
):
    df_raw = pd.read_pickle(path_15m).reset_index(drop=True)
    df_raw['dt'] = pd.to_datetime(df_raw['timestamp'])
    df = df_raw[(df_raw['dt'] >= start_date) & (df_raw['dt'] <= end_date)].reset_index(drop=True)
    
    # 1. ATR calculation
    high = df['high']
    low = df['low']
    close = df['close']
    prev_c = close.shift(1)
    tr = pd.concat([high - low, (high - prev_c).abs(), (low - prev_c).abs()], axis=1).max(axis=1)
    df['atr'] = tr.rolling(14).mean().bfill()
    
    # 2. Angle function: slope = delta_p / (bars * atr) -> arctan(slope) in degrees
    def get_angle(idx, lookback=4):
        if idx < lookback: return 0.0
        dp = abs(df['close'].iloc[idx] - df['close'].iloc[idx - lookback])
        atr_val = df['atr'].iloc[idx]
        if atr_val <= 0: return 0.0
        slope = dp / (lookback * atr_val)
        return float(np.degrees(np.arctan(slope)))

    # 3. Fractal Swings (p=4)
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
    
    trend = 'BULLISH'
    active_pos = None
    pending_fvg = None
    balance = starting_balance
    trades = []
    
    for i in range(25, len(df) - 1):
        bar = df.iloc[i]
        prev = df.iloc[i - 1]
        c_open = float(bar['open'])
        c_high = float(bar['high'])
        c_low = float(bar['low'])
        c_close = float(bar['close'])
        ts = bar['timestamp']

        # Step A: Manage Active Position
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

                trade_record = {
                    "trade_num": len(trades) + 1,
                    "symbol": symbol,
                    "direction": pos['direction'],
                    "entry_time": str(pos['entry_time']),
                    "entry_price": round(pos['entry_price'], 2),
                    "exit_time": str(ts),
                    "exit_price": round(exit_price, 2),
                    "stop_loss": round(pos['stop_loss'], 2),
                    "take_profit": round(pos['take_profit'], 2),
                    "result": outcome,
                    "pnl_percent": round(pnl_percent, 1),
                    "pnl_dollar": round(pnl_dollars, 2),
                    "running_balance": round(balance, 2),
                    "angle": pos.get('angle', 0.0),
                    "type": pos.get('type', 'BOS'),
                }
                trades.append(trade_record)
                active_pos = None

        # Step B: Pending FVG Retrace Touch
        if active_pos is None and pending_fvg is not None:
            f = pending_fvg
            if i > f['c3_idx']:
                if f['direction'] == 'LONG':
                    if c_low <= f['c1_low']:
                        pending_fvg = None  # Invalidation: C1 low breached
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
                                'angle': f.get('angle', 0.0),
                            }
                            pending_fvg = None
                elif f['direction'] == 'SHORT':
                    if c_high >= f['c1_high']:
                        pending_fvg = None  # Invalidation: C1 high breached
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
                                'angle': f.get('angle', 0.0),
                            }
                            pending_fvg = None

        # Angle & Trending Filter (reject sideways drift around 20-30 deg)
        ang_4 = get_angle(i, 4)
        ang_6 = get_angle(i, 6)
        max_ang = max(ang_4, ang_6)
        is_trending = max_ang >= min_angle

        if not is_trending or active_pos is not None or pending_fvg is not None:
            continue

        # Step C: Dynamic Structure Evaluation
        # Find the most recent confirmed swing high and swing low prior to candle i
        recent_shs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx < i - 1 and sh_idx >= i - 80]
        recent_sls = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sl_idx < i - 1 and sl_idx >= i - 80]

        if not recent_shs or not recent_sls:
            continue

        last_sh_idx, last_sh_p = recent_shs[-1]
        last_sl_idx, last_sl_p = recent_sls[-1]

        # ── BULLISH REGIME ──
        if trend == 'BULLISH':
            # Check 1: Bullish Continuation BOS (Body closes above last swing high)
            if c_close > last_sh_p and prev['close'] <= last_sh_p:
                # Check for 3-candle FVG at candle i
                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c3 = df.iloc[c3_idx]
                    gap = float(c3['low']) - float(c1['high'])
                    if gap > 0:
                        pending_fvg = {
                            'type': 'CONTINUATION_BOS',
                            'direction': 'LONG',
                            'c1_idx': c1_idx,
                            'c2_idx': i,
                            'c3_idx': c3_idx,
                            'c1_high': float(c1['high']),
                            'c1_low': float(c1['low']),
                            'fvg_top': float(c3['low']),
                            'fvg_bottom': float(c1['high']),
                            'angle': max_ang,
                        }
            # Check 2: Bearish Reversal CHoCH (Body closes below last structural swing low)
            elif c_close < last_sl_p and prev['close'] >= last_sl_p:
                trend = 'BEARISH' # Trend flip!
                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c3 = df.iloc[c3_idx]
                    gap = float(c1['low']) - float(c3['high'])
                    if gap > 0:
                        pending_fvg = {
                            'type': 'REVERSAL_CHOCH',
                            'direction': 'SHORT',
                            'c1_idx': c1_idx,
                            'c2_idx': i,
                            'c3_idx': c3_idx,
                            'c1_high': float(c1['high']),
                            'c1_low': float(c1['low']),
                            'fvg_top': float(c1['low']),
                            'fvg_bottom': float(c3['high']),
                            'angle': max_ang,
                        }

        # ── BEARISH REGIME ──
        elif trend == 'BEARISH':
            # Check 1: Bearish Continuation BOS (Body closes below last swing low)
            if c_close < last_sl_p and prev['close'] >= last_sl_p:
                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c3 = df.iloc[c3_idx]
                    gap = float(c1['low']) - float(c3['high'])
                    if gap > 0:
                        pending_fvg = {
                            'type': 'CONTINUATION_BOS',
                            'direction': 'SHORT',
                            'c1_idx': c1_idx,
                            'c2_idx': i,
                            'c3_idx': c3_idx,
                            'c1_high': float(c1['high']),
                            'c1_low': float(c1['low']),
                            'fvg_top': float(c1['low']),
                            'fvg_bottom': float(c3['high']),
                            'angle': max_ang,
                        }
            # Check 2: Bullish Reversal CHoCH (Body closes above last structural swing high)
            elif c_close > last_sh_p and prev['close'] <= last_sh_p:
                trend = 'BULLISH' # Trend flip!
                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c3 = df.iloc[c3_idx]
                    gap = float(c3['low']) - float(c1['high'])
                    if gap > 0:
                        pending_fvg = {
                            'type': 'REVERSAL_CHOCH',
                            'direction': 'LONG',
                            'c1_idx': c1_idx,
                            'c2_idx': i,
                            'c3_idx': c3_idx,
                            'c1_high': float(c1['high']),
                            'c1_low': float(c1['low']),
                            'fvg_top': float(c3['low']),
                            'fvg_bottom': float(c1['high']),
                            'angle': max_ang,
                        }

    # Output stats
    wins = sum(1 for t in trades if t['result'] == 'WIN')
    losses = sum(1 for t in trades if t['result'] == 'LOSS')
    total = len(trades)
    wr = round((wins / total * 100), 2) if total > 0 else 0
    pnl = round(balance - starting_balance, 2)
    pnl_pct = round((pnl / starting_balance) * 100, 2)
    
    # Peak DD
    peak = starting_balance
    max_dd = 0.0
    for t in trades:
        rb = t['running_balance']
        if rb > peak: peak = rb
        dd = (peak - rb) / peak * 100
        if dd > max_dd: max_dd = dd
        
    print(f"\n=======================================================")
    print(f"RESULTS FOR {symbol} (Min Angle = {min_angle} deg):")
    print(f"Total Trades: {total} ({wins}W / {losses}L)")
    print(f"Win Rate: {wr}% | Net PnL: ${pnl} (+{pnl_pct}%) | Max DD: {round(max_dd, 2)}%")
    print(f"=======================================================")
    return trades

if __name__ == "__main__":
    for sym, pth in [("XAUUSD", "data_cache/PAXG_15m_full.pkl"), ("BTCUSDT", "data_cache/BTC_15m_full.pkl")]:
        run_smc_complete(symbol=sym, path_15m=pth, min_angle=35.0)
