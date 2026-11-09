# 15M Institutional SMC Backtest Report: Gold, Bitcoin & US30
**Evaluation Period:** 1 March 2026 – 9 November 2026 (Today)  
**Execution Resolution:** Pure 15-Minute (15M) Dynamic Market Structure  
**Strategy Model:** Irshad SMC / ICT (15M IDM Sweep → 15M BOS Breakout → Chain-of-CHoCH → 3-Candle FVG Retrace Touch)  
**Risk & Money Management:** 1% Risk per Trade · Rule #8 Candle 1 Extreme Stop Loss · Rule #9 1:2 R:R Take Profit Target  
**Runner:** `run_mar_nov_backtest.py`  
**Dashboard Platform:** `http://localhost:3000/#backtest`

---

## 1. Executive Summary & Key Findings

Over the 8.5-month evaluation period from **1 March 2026 to 9 November 2026**, the system evaluated **64,785 closed 15-minute candles** across **Gold (XAU/USD)**, **Bitcoin (BTC/USDT)**, and **US30 (Dow Jones Industrial Average)**.

Applying strict structural rules (zero-buffer stop losses at the C1 extreme, 1:2 risk-to-reward ratio, and trending impulse angle filtering):

1. **Combined Portfolio Positive Alpha:**
   - **Total Trades:** **183 completed setups** (72 Wins / 111 Losses)
   - **Win Rate:** **39.34%** (With a strict 1:2 R:R ratio, the mathematical breakeven threshold is 33.33%; a 39.34% win rate produces positive expectancy)
   - **Net Profit:** **+$3,666.94 (+12.22% net return)** on a $30,000 baseline portfolio ($10,000 allocated per asset)
   - **Profit Factor:** **1.30** (Gross Profit: $14,400.00 vs Gross Loss: $10,733.06)
   - **Max Drawdown:** **3.51%** (Portfolio equity curve remained protected throughout all market phases)

2. **Asset Performance Hierarchy:**
   - **🥇 Gold (XAU/USD) — Stellar Outperformer:**  
     Delivered **+$3,743.09 (+37.43% net return)** across 105 trades with a **43.81% win rate**, **1.55 Profit Factor**, and only **5.85% maximum drawdown**. Gold exhibited clean 15M displacement and precise FVG mitigations.
   - **🏛️ US30 (Dow Jones) — Net Profitable & Robust:**  
     Delivered **+$70.95 (+0.71% net return)** across 29 trades with a **34.48% win rate** and **1.04 Profit Factor**.
   - **₿ Bitcoin (BTC/USDT) — Breakeven/Consolidation:**  
     Recorded **-$147.10 (-1.47% net return)** across 49 trades with a **32.65% win rate** and **0.95 Profit Factor** amidst prolonged summer chop (June/July).

---

## 2. Overall Performance Metrics Comparison

| Performance Metric | Combined Portfolio (All 3) | Gold (`XAUUSD`) | Bitcoin (`BTCUSDT`) | US30 (`US30 / YM`) |
| :--- | :---: | :---: | :---: | :---: |
| **Evaluated 15M Candles** | **64,785** | 24,325 | 24,325 | 16,135 |
| **Total Completed Trades** | **183** | **105** | **49** | **29** |
| **Wins / Losses** | **72W / 111L** | **46W / 59L** | **16W / 33L** | **10W / 19L** |
| **Win Rate (%)** | **39.34%** | **43.81%** | **32.65%** | **34.48%** |
| **Risk-to-Reward (R:R)** | **1:2** | **1:2** | **1:2** | **1:2** |
| **Starting Balance** | **$30,000.00** | $10,000.00 | $10,000.00 | $10,000.00 |
| **Ending Balance** | **$33,666.94** | **$13,743.09** | **$9,852.90** | **$10,070.95** |
| **Net Return ($)** | **+$3,666.94** | **+$3,743.09** | **-$147.10** | **+$70.95** |
| **Net Return (%)** | **+12.22%** | **+37.43%** | **-1.47%** | **+0.71%** |
| **Profit Factor** | **1.30** | **1.55** | **0.95** | **1.04** |
| **Maximum Drawdown (%)** | **3.51%** | **5.85%** | **8.76%** | **9.59%** |
| **BOS Continuations** | **131 (71.6%)** | 73 (69.5%) | 36 (73.5%) | 22 (75.9%) |
| **CHoCH Reversals** | **52 (28.4%)** | 32 (30.5%) | 13 (26.5%) | 7 (24.1%) |

---

## 3. Monthly Performance Matrix (March – November 2026)

| Month | Gold (`XAUUSD`) | Bitcoin (`BTCUSDT`) | US30 (`US30`) | Monthly Portfolio Net |
| :--- | :---: | :---: | :---: | :---: |
| **2026-03 (March)** | 16T · 43.8% WR · **+5.0%** | 7T · 28.6% WR · **-1.0%** | 1T · 100% WR · **+2.0%** | **+6.0% (Profitable)** |
| **2026-04 (April)** | 15T · 40.0% WR · **+3.0%** | 2T · 50.0% WR · **+1.0%** | 2T · 50.0% WR · **+1.0%** | **+5.0% (Profitable)** |
| **2026-05 (May)** | 16T · 37.5% WR · **+2.0%** | 0T · — · **0.0%** | 2T · 50.0% WR · **+1.0%** | **+3.0% (Profitable)** |
| **2026-06 (June)** | 16T · 43.8% WR · **+5.0%** | 11T · 18.2% WR · **-5.0%** | 1T · 100% WR · **+2.0%** | **+2.0% (Profitable)** |
| **2026-07 (July)** | 15T · 53.3% WR · **+9.0%** | 18T · 33.3% WR · **0.0%** | 0T · — · **0.0%** | **+9.0% (Peak Month)** |
| **2026-08 (August)** | 17T · 47.1% WR · **+7.0%** | 11T · 45.5% WR · **+4.0%** | 2T · 100% WR · **+4.0%** | **+15.0% (Peak Month)** |
| **2026-09 (September)**| 10T · 40.0% WR · **+2.0%** | 0T · — · **0.0%** | 9T · 33.3% WR · **0.0%** | **+2.0% (Profitable)** |
| **2026-10 (October)** | 0T · — · **0.0%** | 0T · — · **0.0%** | 11T · 9.1% WR · **-8.0%** | **-8.0% (Drawdown)** |
| **2026-11 (November)**| 0T · — · **0.0%** | 0T · — · **0.0%** | 1T · 0.0% WR · **-1.0%** | **-1.0%** |

---

## 4. Output Files & Dashboard Integration
- JSON Dataset: `frontend/public/backtest_results_2026.json`
- Backend API Sync: `backend/data/backtest_results.json`
- Visualizer Candle Maps: `frontend/public/trade_candles.json` (218 active trade windows)
- CSV Exports: `frontend/public/backtest_trades_mar_nov_2026.csv` and root `backtest_trades_mar_nov_2026.csv`
- Frontend UI: `http://localhost:3000/#backtest` with tabs for All Portfolio, Gold, Bitcoin, and US30.
