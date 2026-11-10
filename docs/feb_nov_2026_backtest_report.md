# Institutional SMC Backtest & Strategy Report: Gold & Bitcoin (Feb 1 – Nov 10, 2026)

**Evaluation Period:** 1 February 2026 – 10 November 2026 (Today)  
**Execution Resolution:** Pure 15-Minute (15M) Dynamic Market Structure with 4H Trend Bias  
**Strategy Model:** Irshad SMC / ICT (v1.4 Exact Rulebook)  
**Risk & Money Management:** 1% Risk per Trade · Rule #8 Candle 1 Extreme Stop Loss · Rule #9 1:2 R:R Take Profit Target  
**Runner:** `run_feb_nov_backtest.py`  
**Live Platform:** `http://localhost:3000/#backtest`  

---

## 1. Executive Summary & Core Results

From **1 February 2026 to 10 November 2026**, the system evaluated continuous closed 15-minute candles across **Gold (XAU/USD)**, **Bitcoin (BTC/USDT)**, and **US30 (Dow Jones)**.

### Performance Highlights:
- **Combined Portfolio Net Return:** **+13.38% (+$4,014.60)** on a $30,000 starting portfolio ($10,000 baseline per asset) with a **39.41% Win Rate** (203 trades: 80 Wins / 123 Losses), **Profit Factor of 1.30**, and **3.42% Maximum Drawdown**.
- **🥇 Gold (`XAUUSD`) — Dominant Outperformer:**  
  Delivered **+35.98% Net Profit (+$3,597.55)** across 112 trades with a **42.86% Win Rate**, **1.50 Profit Factor**, and **5.85% Maximum Drawdown**.
- **₿ Bitcoin (`BTCUSDT`) — Strong Net Profit:**  
  Delivered **+4.50% Net Profit (+$449.75)** across 58 trades with a **36.21% Win Rate**, **1.12 Profit Factor**, and **8.78% Maximum Drawdown**. Bitcoin gained significantly in February (+6.0% net on 55.6% WR) and August (+4.0% net on 45.5% WR).
- **🏛️ US30 (`US30`) — Preserved Capital:**  
  Delivered **-0.33% Net (-$32.73)** across 33 trades with a **33.33% Win Rate** and **0.99 Profit Factor**.

---

## 2. Multi-Asset Performance Comparison

| Performance Metric | Combined Portfolio (All 3) | Gold (`XAUUSD`) | Bitcoin (`BTCUSDT`) | US30 (`US30 / YM`) |
| :--- | :---: | :---: | :---: | :---: |
| **Evaluated 15M Candles** | **72,007** | 27,102 | 27,102 | 17,803 |
| **Total Completed Trades** | **203** | **112** | **58** | **33** |
| **Wins / Losses** | **80W / 123L** | **48W / 64L** | **21W / 37L** | **11W / 22L** |
| **Win Rate (%)** | **39.41%** | **42.86%** | **36.21%** | **33.33%** |
| **Risk-to-Reward (R:R)** | **1:2** | **1:2** | **1:2** | **1:2** |
| **Starting Balance** | **$30,000.00** | $10,000.00 | $10,000.00 | $10,000.00 |
| **Ending Balance** | **$34,014.60** | **$13,597.55** | **$10,449.75** | **$9,967.27** |
| **Net Return ($)** | **+$4,014.60** | **+$3,597.55** | **+$449.75** | **-$32.73** |
| **Net Return (%)** | **+13.38%** | **+35.98%** | **+4.50%** | **-0.33%** |
| **Profit Factor** | **1.30** | **1.50** | **1.12** | **0.99** |
| **Maximum Drawdown (%)** | **3.42%** | **5.85%** | **8.78%** | **9.59%** |
| **BOS Continuations** | **143 (70.4%)** | 77 (68.8%) | 41 (70.7%) | 25 (75.8%) |
| **CHoCH Reversals** | **60 (29.6%)** | 35 (31.2%) | 17 (29.3%) | 8 (24.2%) |

---

## 3. Monthly Performance Breakdown (Feb – Nov 2026)

| Month | Gold (`XAUUSD`) | Bitcoin (`BTCUSDT`) | US30 (`US30`) | Portfolio Net |
| :--- | :---: | :---: | :---: | :---: |
| **2026-02 (February)** | 7T · 28.6% WR · **-1.0%** | 9T · 55.6% WR · **+6.0%** | 3T · 0.0% WR · **-3.0%** | **+2.0% (Profitable)** |
| **2026-03 (March)** | 16T · 43.8% WR · **+5.0%** | 7T · 28.6% WR · **-1.0%** | 1T · 100% WR · **+2.0%** | **+6.0% (Profitable)** |
| **2026-04 (April)** | 15T · 40.0% WR · **+3.0%** | 2T · 50.0% WR · **+1.0%** | 2T · 50.0% WR · **+1.0%** | **+5.0% (Profitable)** |
| **2026-05 (May)** | 16T · 37.5% WR · **+2.0%** | 0T · — · **0.0%** | 2T · 50.0% WR · **+1.0%** | **+3.0% (Profitable)** |
| **2026-06 (June)** | 16T · 43.8% WR · **+5.0%** | 11T · 18.2% WR · **-5.0%** | 1T · 100% WR · **+2.0%** | **+2.0% (Profitable)** |
| **2026-07 (July)** | 15T · 53.3% WR · **+9.0%** | 18T · 33.3% WR · **0.0%** | 0T · — · **0.0%** | **+9.0% (Peak Month)** |
| **2026-08 (August)** | 17T · 47.1% WR · **+7.0%** | 11T · 45.5% WR · **+4.0%** | 2T · 100% WR · **+4.0%** | **+15.0% (Peak Month)** |
| **2026-09 (September)**| 10T · 40.0% WR · **+2.0%** | 0T · — · **0.0%** | 9T · 33.3% WR · **0.0%** | **+2.0% (Profitable)** |
| **2026-10 (October)** | 0T · — · **0.0%** | 0T · — · **0.0%** | 11T · 9.1% WR · **-8.0%** | **-8.0% (Consolidation)** |
| **2026-11 (November)**| 0T · — · **0.0%** | 0T · — · **0.0%** | 2T · 0.0% WR · **-2.0%** | **-2.0%** |

---

## 4. Exact Strategy Mechanics for Gold & Bitcoin (v1.4 Rulebook)

### 1. 4H Macro Trend Bias (Structural Alignment)
- High-timeframe market structure on the 4-Hour chart determines directional bias.
- **Bullish Bias:** Sequence of Higher Highs (HH) + Higher Lows (HL) with price respecting or trading above the 50 EMA. Only LONG positions are permitted on 15M.
- **Bearish Bias:** Sequence of Lower Lows (LL) + Lower Highs (LH) with price trading below the 50 EMA. Only SHORT positions are permitted on 15M.

### 2. Retracement-Verified Inducement (IDM) Sweep
- On the 15-Minute chart, a candidate structural anchor is identified (Higher High for Bullish, Lower Low for Bearish).
- The engine identifies the first counter-trend swing pullback (Inducement / IDM).
- **The Retracement Verification Rule:** Before an IDM sweep can be validated, the market must print at least one completed retracement candle (`close > open` in Bullish, `close < open` in Bearish).
- A subsequent candle must sweep the IDM level (wick sweep is sufficient).
- The original structural anchor (HH/LL) **must remain intact** without being breached early.

### 3. Break of Structure (BOS)
- Once the IDM is swept, the structural anchor is officially validated.
- The market must break through the structural anchor with a **decisive candle body close** (`close > anchor` for Bullish, `close < anchor` for Bearish).
- A wick-only break does NOT confirm a BOS. The candle that closes beyond the anchor is designated candle index $B$.

### 4. BOS-Based 3-Candle FVG Gap & Invalidation
- **$B+1$ Fully-Closed Candle Requirement:** The engine waits for candle $B+1$ to completely close before evaluating the FVG.
- **Primary Attempt:** $C1 = B-1, C2 = B, C3 = B+1$.
  - Bullish: $C1\text{ high} < C3\text{ low}$ (unfilled fair value gap).
  - Bearish: $C1\text{ low} > C3\text{ high}$ (unfilled fair value gap).
- **Fallback Attempt:** If the primary does not form an FVG, check $C1 = B-2, C2 = B-1, C3 = B$.
- **Displacement Check:** Candle 2 ($C2$) must be a strong displacement candle with real body occupying $\ge 30\%$ of total candle range:
  $$\frac{|\text{Close} - \text{Open}|}{\text{High} - \text{Low}} \ge 0.30$$
- Completely pre-BOS older FVGs are strictly rejected.

### 5. Rule #8 Zero-Buffer Stop Loss
- Stop loss is anchored directly to Candle 1's extreme:
  - **Bullish:** $SL = C1\text{ Low}$
  - **Bearish:** $SL = C1\text{ High}$
- Zero buffer or artificial padding is added.

### 6. Mitigation Touch & Rule #9 Strict 1:2 R:R
- Price must retrace and touch the FVG zone.
- **Invalidation:** If price violates the $C1$ extreme (SL) *before* touching the FVG zone, the setup is immediately cancelled.
- **Take Profit Target:** Placed at exactly $2 \times$ risk distance from entry:
  $$\text{Target} = \text{Entry} \pm (2 \times |\text{Entry} - SL|)$$

---

## 5. Output Verification
- **Web App API:** `GET http://localhost:3000/api/backtest` (HTTP 200)
- **JSON Dataset:** `frontend/public/backtest_results_2026.json` & `backend/data/backtest_results.json`
- **Visualizer Candles:** `frontend/public/trade_candles.json` (315 mapped windows, 0 missing keys)
- **CSV Data:** `frontend/public/backtest_trades_feb_nov_2026.csv`
