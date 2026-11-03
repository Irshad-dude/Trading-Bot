"""
Testing Chain-of-CHoCH with 40-45 degree Trend Angle & Sideways Filter.
"""
import pandas as pd
import numpy as np

def run_trending_choch(
    symbol="XAUUSD",
    path_15m="data_cache/PAXG_15m_full.pkl",
    start_date="2025-11-01",
    end_date="2026-11-02 23:59:59",
    min_trend_angle=40.0,
    starting_balance=10000.0,
    risk_percent=1.0,
):
    df_raw = pd.read_pickle(path_15m).reset_index(drop=True)
    df_raw['dt'] = pd.to_datetime(df_raw['timestamp'])
    df = df_raw[(df_raw['dt'] >= start_date) & (df_raw['dt'] <= end_date)].reset_index(drop=True)
    
    # Calculate ATR
    high = df['high']
    low = df['low']
    close = df['close']
    prev_c = close.shift(1)
    tr = pd.concat([high - low, (high - prev_c).abs(), (low - prev_c).abs()], axis=1).max(axis=1)
    df['atr'] = tr.rolling(14).mean().bfill()
    
    # Calculate normalized chart angle over 3 to 6 bars
    # Visual chart angle: 1 bar = 1 unit X. Y normalized by ATR.
    # slope = delta_price / (bars * atr)
    # angle = arctan(slope) in degrees
    def get_impulse_angle(idx, lookback=4):
        if idx < lookback: return 0.0
        dp = abs(df['close'].iloc[idx] - df['close'].iloc[idx - lookback])
        atr_val = df['atr'].iloc[idx]
        if atr_val <= 0: return 0.0
        slope = dp / (lookback * atr_val)
        return float(np.degrees(np.arctan(slope)))

    # Detect Fractal Swing Points (using p=4 for cleaner structure, avoiding 1-candle micro noise)
    p = 4
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
    
    print(f"{symbol}: Precomputed {len(swing_highs)} swing highs, {len(swing_lows)} swing lows (p={p})")
    
    trend = 'BULLISH'
    current_choch = None
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

        # Step A: Manage Active Trade
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
            else:
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

        # Check Trend Angle at candle i: Must be trending (angle >= min_trend_angle), not sideways (< 35-40 deg)
        impulse_angle_4 = get_impulse_angle(i, lookback=4)
        impulse_angle_6 = get_impulse_angle(i, lookback=6)
        max_angle = max(impulse_angle_4, impulse_angle_6)
        
        # If angle is flat / sideways (under min_trend_angle), skip forming new setups!
        is_trending = max_angle >= min_trend_angle

        # Step C: CHoCH Breakout Detection
        if current_choch is not None and is_trending:
            if trend == 'BULLISH' and c_close < current_choch['price']:
                trend = 'BEARISH'
                current_choch = None
                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c3 = df.iloc[c3_idx]
                    gap = float(c1['low']) - float(c3['high'])
                    if gap > 0 and active_pos is None and pending_fvg is None:
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
                            'angle': max_angle,
                        }
            elif trend == 'BEARISH' and c_close > current_choch['price']:
                trend = 'BULLISH'
                current_choch = None
                c1_idx = i - 1
                c3_idx = i + 1
                if c1_idx >= 0 and c3_idx < len(df):
                    c1 = df.iloc[c1_idx]
                    c3 = df.iloc[c3_idx]
                    gap = float(c3['low']) - float(c1['high'])
                    if gap > 0 and active_pos is None and pending_fvg is None:
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
                            'angle': max_angle,
                        }

        # Step D: Trend Continuation (BOS)
        if trend == 'BULLISH' and is_trending:
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

                    idm_swept = any(b_row['low'] <= idm_p for _, b_row in bars_between.iterrows())
                    if idm_swept:
                        range_bars = df.iloc[sh_idx : i + 1]
                        current_choch = {
                            'price': float(range_bars['low'].min()),
                            'idx': int(range_bars['low'].idxmin()),
                            'type': 'BEARISH_CHOCH',
                        }
                        c1_idx = i - 1
                        c3_idx = i + 1
                        if c1_idx >= 0 and c3_idx < len(df):
                            c1 = df.iloc[c1_idx]
                            c3 = df.iloc[c3_idx]
                            gap = float(c3['low']) - float(c1['high'])
                            if gap > 0 and active_pos is None and pending_fvg is None:
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
                                    'angle': max_angle,
                                }
                        break

        elif trend == 'BEARISH' and is_trending:
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

                    idm_swept = any(b_row['high'] >= idm_p for _, b_row in bars_between.iterrows())
                    if idm_swept:
                        range_bars = df.iloc[sl_idx : i + 1]
                        current_choch = {
                            'price': float(range_bars['high'].max()),
                            'idx': int(range_bars['high'].idxmax()),
                            'type': 'BULLISH_CHOCH',
                        }
                        c1_idx = i - 1
                        c3_idx = i + 1
                        if c1_idx >= 0 and c3_idx < len(df):
                            c1 = df.iloc[c1_idx]
                            c3 = df.iloc[c3_idx]
                            gap = float(c1['low']) - float(c3['high'])
                            if gap > 0 and active_pos is None and pending_fvg is None:
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
                                    'angle': max_angle,
                                }
                        break

    # Stats
    wins = sum(1 for t in trades if t['result'] == 'WIN')
    losses = sum(1 for t in trades if t['result'] == 'LOSS')
    total = len(trades)
    wr = round((wins / total * 100), 2) if total > 0 else 0
    pnl = round(balance - starting_balance, 2)
    pnl_pct = round((pnl / starting_balance) * 100, 2)
    
    # Drawdown
    peak = starting_balance
    max_dd = 0.0
    for t in trades:
        rb = t['running_balance']
        if rb > peak: peak = rb
        dd = (peak - rb) / peak * 100
        if dd > max_dd: max_dd = dd
        
    print(f"\nRESULTS for {symbol} (Min Angle = {min_trend_angle} deg):")
    print(f"Total Trades: {total} ({wins}W / {losses}L)")
    print(f"Win Rate: {wr}% | Net PnL: ${pnl} ({pnl_pct}%) | Max DD: {round(max_dd, 2)}%")
    return trades

if __name__ == "__main__":
    for ang in [0, 30, 35, 40, 45]:
        print(f"\n--- Testing Angle >= {ang} deg ---")
        run_trending_choch(symbol="XAUUSD", min_trend_angle=ang)
