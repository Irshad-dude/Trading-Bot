# Phase 1: Graph RAG Dashboard & Telemetry Improvement
**Execution Standard: Production Grade**

## 1. Executive Summary
Phase 1 enhances the existing **Graph RAG (Retrieval-Augmented Generation)** dashboard and backend telemetry in the Trading Bot repository without altering any trading strategies, decision-making thresholds, or risk execution logic.

All SMC strategy files, broker execution rules, and risk management parameters remain **100% read-only and untouched**.

---

## 2. Strategy Protection Guarantee
The following core strategy and execution files have zero modifications:
- `backend/strategy/smc.py` (Unchanged)
- `chain_of_choch_trending.py` (Unchanged)
- `chain_of_choch_backtest.py` (Unchanged)
- `backend/risk/manager.py` (Unchanged)
- `backend/execution/broker.py` (Unchanged)
- `backend/ai/analyst.py` (Unchanged)

Verification command:
```bash
git diff origin/main -- backend/strategy/smc.py chain_of_choch_trending.py chain_of_choch_backtest.py backend/risk/manager.py backend/execution/broker.py backend/ai/analyst.py
# (Outputs zero lines / empty diff)
```

---

## 3. Architecture & File Modifications

### A. Backend Enhancements
1. **`backend/ai/graph_rag.py`**:
   - **Null-Safety Fix**: Guarded `_categorize_risk()` against `None` and `NaN` risk values, falling back safely to standard 3.0 ATR distance.
   - **Enhanced Telemetry in `retrieve_similar_trades()`**:
     - Calculates sample size guard: `insufficient_data = True` when matching trades < 3.
     - Computes cumulative statistics: `avg_pnl_dollar` and `total_pnl_dollar`.
     - Derives cluster classification: `WINNING_DNA_CLUSTER`, `LOSING_TRAP`, `NEUTRAL`, or `INSUFFICIENT_DATA`.
     - Enriches each matched precedent with `rr_ratio`, `pnl_percent`, `risk_tier`, `cluster_status`, and `cluster_name`.
   - **Export Metadata in `export_graph_for_frontend()`**:
     - Includes `schema_version: "2.0.0"`, `is_static: True`, and `exported_at` ISO timestamp.
2. **`backend/state.py`**:
   - Added `last_candidate_graph_rag: Optional[Dict[str, Any]] = None` to `BotState` to persist candidate evaluation telemetry in memory.
3. **`backend/main.py`**:
   - Added endpoint `GET /api/graph-rag` returning full graph structure, cluster intelligence, and latest candidate state.
   - Added endpoint `GET /api/graph/latest-candidate` returning candidate evaluation telemetry.
   - Injected live candidate recording into `autonomous_trading_loop` when candidate setups pass validation.
4. **`backend/tests/test_graph_rag.py`**:
   - Comprehensive test suite covering Jaccard similarity mathematical ordering, feature extraction, top-K retrieval, cluster aggregation, sample size guarding, empty graph edge cases, and schema validation.

### B. Frontend Enhancements
1. **`frontend/src/app/api/backend/[...path]/route.ts`**:
   - Added `AbortSignal.timeout(4000)` to eliminate infinite proxy hangs during backend cold restarts.
   - Returns structured 504 Gateway Timeout or 502 Service Unavailable with actionable error messages.
   - Added full query parameter preservation when forwarding requests to FastAPI.
2. **`frontend/src/app/components/TradeGraphVisualizer.tsx`**:
   - **Visual Node Distinction**: WIN nodes feature an emerald glow halo (`#10b981`) and check indicator; LOSS nodes feature a rose halo (`#f43f5e`).
   - **Cluster Boundaries**: Nodes in High-Win clusters (`WR >= 55%`) have emerald/gold perimeter rings; nodes in Losing Traps have amber/rose warning rings.
   - **Feature Neuron Coding**: Distinct color coding per category (Session = purple, Angle = cyan, Pattern = amber, Asset = pink, Risk = emerald).
   - **Dynamic Candidate Injection**: Live candidate setup is visually injected as a pulsing radar target crosshair (`#38bdf8`) with glowing dashed `CANDIDATE_SIMILARITY` force links to twin historical trades.
   - **Interactive Multi-Inspector**: Tailored panels for Candidate Setup (entry/SL/TP levels, R:R, neighborhood win rate, twin table), Feature Neurons (connected trade counts and win rate), and Trade Neurons (trade telemetry, neural explanation).
   - **Viewport Navigation Controls**: Floating overlay with Zoom In (+), Zoom Out (-), Reset/Fit View, and Physics Simulation Pause/Resume.
   - **Retry & Graceful Degradation**: On-demand retry button when network data fails.
3. **`frontend/src/app/page.tsx`**:
   - **Candidate Scenario Selector**: Switch between Live Scanner Feed and 4 canonical benchmark setups (Gold Overlap Long, Gold Asian Short, BTC London Short, Exhaustion Trap).
   - **Candidate Setup & Telemetry Card**: High-visibility display of candidate Asset, Direction, Neighborhood Win Rate (with sample size), Average P&L Return ($), Cluster Status badge, and Strict 1:2 R:R indicator.
   - **Retrieved Historical Precedents Table**: Ranked similarity table showing Trade ID, Outcome, Similarity Bar (0-100%), Shared Features badges, P&L ($), R:R, and a "Focus Node" button that smoothly scrolls and centers the node in the canvas visualizer.
   - **Prominent Historical Disclaimer**: Clearly states that Graph RAG reflects historical backtested similarities across 169 verified setups and past performance does not guarantee future results.

---

## 4. API Endpoints Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/graph-rag` | `GET` | Unified Graph RAG payload (nodes, links, clusters, winning DNA, latest candidate) |
| `/api/graph/latest-candidate` | `GET` | Latest analyzed candidate setup and top matched twin trades |
| `/api/graph/network` | `GET` | Force graph nodes and link synapses |
| `/api/graph/clusters` | `GET` | High-win clusters (`WR >= 55%`) mined from historical trades |
| `/api/graph/dna` | `GET` | Golden rule combinations extracted from winning trades |
| `/api/graph/query` | `POST` | Query candidate features against the Knowledge Graph |
| `/api/status` | `GET` | Complete system state including active trade, scans, and candidate Graph RAG |

---

## 5. Verification & Testing

### A. Graph RAG Unit Tests
Execute the unit test suite:
```bash
./backend/venv/bin/python -m unittest backend/tests/test_graph_rag.py
```
**Result**: 8 passed, 0 failed in ~0.06s.

### B. Full Application Regression Suite
Execute the end-to-end platform tests:
```bash
./backend/venv/bin/python test_full_app.py
```
**Result**: 25 passed, 0 failed across all 7 testing phases:
- Phase 1: 15M Data Integrity (Gold & BTC)
- Phase 2: Backtest & Max Drawdown Integrity (169 trades, 1:2 R:R, impulse angles)
- Phase 3: Trade Candles Visualizer Data
- Phase 4: CSV Download Export
- Phase 5: Frontend API (`/api/backtest`)
- Phase 6: Frontend Website HTTP 200
- Phase 7: Knowledge Graph & Graph RAG Engine

### C. Frontend Production Build
Execute Next.js static and dynamic compilation:
```bash
cd frontend && npm run build
```
**Result**: Compiled successfully with zero TypeScript or webpack errors.

---

## 6. Git Branch Information
- **Base Branch**: `origin/main` (commit `18e335f`)
- **Working Branch**: `phase-1/graph-rag-dashboard-improvement`
- **Protected Branch**: `main` (no direct commits, no merges without approval)
