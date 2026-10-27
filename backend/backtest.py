import pandas as pd
import yfinance as yf
import json
import os
from datetime import timedelta
import sys

# Ensure we can import from backend modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.strategy.smc import SMCEngine

def download_data():
    print("Downloading XAUUSD (Gold) Historical Data...")
    # yfinance allows max 60 days for 15m interval
    gold_15m = yf.download("GC=F", period="60d", interval="15m", progress=False)
    gold_4h = yf.download("GC=F", period="60d", interval="1h", progress=False) # 1h used as HTF proxy if 4h is unavailable
    
    # Clean up column names (yfinance multiindex flattening)
    if isinstance(gold_15m.columns, pd.MultiIndex):
        gold_15m.columns = gold_15m.columns.droplevel(1)
        gold_4h.columns = gold_4h.columns.droplevel(1)
        
    gold_15m = gold_15m.rename(columns=str.lower)
    gold_4h = gold_4h.rename(columns=str.lower)
    
    return gold_15m, gold_4h

def run_backtest():
    df_15m, df_4h = download_data()
    engine = SMCEngine()
    
    trades = []
    initial_balance = 5000.0
    balance = initial_balance
    risk_per_trade = 0.005 # 0.5%
    
    print(f"Starting Backtest on {len(df_15m)} 15m candles...")
    
    # We will simulate stepping through time
    # To be efficient and simple for this demo, we will batch calculate 
    # the structures and then extract the signals.
    
    # Calculate 4H trend
    df_4h['ema_50'] = df_4h['close'].ewm(span=50, adjust=False).mean()
    df_4h['trend'] = df_4h.apply(lambda row: 'BULLISH' if row['close'] > row['ema_50'] else 'BEARISH', axis=1)
    
    # Find Sweeps and FVGs on 15m
    df_15m = engine.detect_liquidity_sweeps(df_15m, )
    df_15m = engine.detect_fvg(df_15m)
    
    in_trade = False
    trade_details = None
    
    for i in range(20, len(df_15m)):
        current_time = df_15m.index[i]
        row = df_15m.iloc[i]
        
        # Check if we hit SL or TP if in a trade
        if in_trade and trade_details:
            if trade_details['direction'] == 'LONG':
                if row['low'] <= trade_details['sl']:
                    trade_details['exit_price'] = trade_details['sl']
                    trade_details['exit_time'] = str(current_time)
                    trade_details['pnl'] = -trade_details['risk_amount']
                    trade_details['status'] = 'LOSS'
                    balance += trade_details['pnl']
                    trades.append(trade_details)
                    in_trade = False
                elif row['high'] >= trade_details['tp']:
                    trade_details['exit_price'] = trade_details['tp']
                    trade_details['exit_time'] = str(current_time)
                    trade_details['pnl'] = trade_details['risk_amount'] * 2 # 1:2 RR
                    trade_details['status'] = 'WIN'
                    balance += trade_details['pnl']
                    trades.append(trade_details)
                    in_trade = False
            else: # SHORT
                if row['high'] >= trade_details['sl']:
                    trade_details['exit_price'] = trade_details['sl']
                    trade_details['exit_time'] = str(current_time)
                    trade_details['pnl'] = -trade_details['risk_amount']
                    trade_details['status'] = 'LOSS'
                    balance += trade_details['pnl']
                    trades.append(trade_details)
                    in_trade = False
                elif row['low'] <= trade_details['tp']:
                    trade_details['exit_price'] = trade_details['tp']
                    trade_details['exit_time'] = str(current_time)
                    trade_details['pnl'] = trade_details['risk_amount'] * 2 # 1:2 RR
                    trade_details['status'] = 'WIN'
                    balance += trade_details['pnl']
                    trades.append(trade_details)
                    in_trade = False
            continue

        # Look for new setups if not in trade
        if not in_trade:
            # Map 15m time to nearest 4H trend
            nearest_4h = df_4h[df_4h.index <= current_time]
            if nearest_4h.empty: continue
            current_trend = nearest_4h.iloc[-1]['trend']
            
            # Simplified Logic: Sweep + FVG aligning with Trend
            sweep = row.get('sweep_type', None)
            fvg = row.get('fvg_type', None)
            
            if current_trend == 'BULLISH' and sweep == 'SELL_SIDE_SWEEP' and fvg == 'BULLISH':
                entry = row['close']
                sl = row['low'] - 1.0 # 10 pips below swing low for Gold
                if entry <= sl: continue
                tp = entry + ((entry - sl) * 2) # 1:2 RR
                risk_amount = balance * risk_per_trade
                
                trade_details = {
                    'id': f"BT-{len(trades)+1}",
                    'symbol': 'XAUUSD',
                    'direction': 'LONG',
                    'entry': float(entry),
                    'sl': float(sl),
                    'tp': float(tp),
                    'entry_time': str(current_time),
                    'risk_amount': float(risk_amount),
                    'setup': 'Sweep + Bullish FVG',
                    'status': 'OPEN'
                }
                in_trade = True
                
            elif current_trend == 'BEARISH' and sweep == 'BUY_SIDE_SWEEP' and fvg == 'BEARISH':
                entry = row['close']
                sl = row['high'] + 1.0 # 10 pips above swing high
                if entry >= sl: continue
                tp = entry - ((sl - entry) * 2) # 1:2 RR
                risk_amount = balance * risk_per_trade
                
                trade_details = {
                    'id': f"BT-{len(trades)+1}",
                    'symbol': 'XAUUSD',
                    'direction': 'SHORT',
                    'entry': float(entry),
                    'sl': float(sl),
                    'tp': float(tp),
                    'entry_time': str(current_time),
                    'risk_amount': float(risk_amount),
                    'setup': 'Sweep + Bearish FVG',
                    'status': 'OPEN'
                }
                in_trade = True

    # Compile results
    wins = [t for t in trades if t['status'] == 'WIN']
    losses = [t for t in trades if t['status'] == 'LOSS']
    win_rate = (len(wins) / len(trades) * 100) if trades else 0
    net_pnl = balance - initial_balance
    
    results = {
        "summary": {
            "total_trades": len(trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(win_rate, 2),
            "starting_balance": initial_balance,
            "final_balance": round(balance, 2),
            "net_pnl": round(net_pnl, 2)
        },
        "trades": trades
    }
    
    os.makedirs('data', exist_ok=True)
    with open('data/backtest_results.json', 'w') as f:
        json.dump(results, f, indent=4)
        
    print(f"Backtest Complete! {len(trades)} trades executed. Net PnL: ${net_pnl:.2f}")

if __name__ == "__main__":
    run_backtest()
