# Phase 1 Technical Documentation: Graph RAG Dashboard & Telemetry Improvement

**Repository**: `https://github.com/Irshad-dude/Trading-Bot.git`  
**Working Directory**: `trading-agent`  
**Git Branch**: `phase-1/graph-rag-dashboard-improvement`  
**Execution Standard**: Production Grade  

---

## 1. Executive Summary

Phase 1 improves the existing **Graph RAG (Retrieval-Augmented Generation)** dashboard, neural visualization, backend telemetry, and API synchronization across the Trading Bot platform.

### Core Objectives Delivered:
1. **Zero-Overlap Constellation Graph Visualization**: Replaced the chaotic, overlapping hairball simulation with a deterministic constellation layout (concentric orbital rings, Retina-ready 2D canvas, and 3 interactive layout modes).
2. **Graph RAG Telemetry & Precedents Retrieval**: Added real-time setup similarity scoring, sample size guarding, cluster classification, and a ranked historical precedents table.
3. **Backend-to-Frontend API Synchronization**: Unified `/api/graph-rag` and `/api/graph/latest-candidate` endpoints with fast proxy timeout guards (`AbortSignal.timeout(4000)`).
4. **Deterministic Retrieval Validation**: Built unit test suites verifying Jaccard similarity ordering, feature extraction, cluster aggregation, and schema integrity.
5. **Absolute Strategy Protection**: Maintained **100% read-only integrity** of all existing SMC strategy rules, impulse angles, and broker execution modules.

---

## 2. Absolute Strategy Protection Guarantee

All strategy, risk management, and broker execution code was **strictly protected as read-only**. Zero modifications were made to the core trading rules.

### Protected Files (Zero Lines Modified):
- `backend/strategy/smc.py` — SMC strategy engine (IDM, BOS, CHoCH, FVG)
- `chain_of_choch_trending.py` — 4H macro trend & 15M execution logic
- `chain_of_choch_backtest.py` — Canonical backtesting engine
- `backend/risk/manager.py` — Risk-to-reward ratio (strict 1:2) and position sizing
- `backend/execution/broker.py` — Broker order execution and slippage protection
- `backend/ai/analyst.py` — AI decision thresholds and confidence scoring

### Verification Proof:
```bash
git diff origin/main -- \
  backend/strategy/smc.py \
  chain_of_choch_trending.py \
  chain_of_choch_backtest.py \
  backend/risk/manager.py \
  backend/execution/broker.py \
  backend/ai/analyst.py
# Result: Empty diff (0 lines changed)
```

---

## 3. What Changed in Phase 1

### A. Backend Architecture & Engine (`backend/`)

#### 1. `backend/ai/graph_rag.py`
- **Null-Safety Guard**: Enhanced `_categorize_risk()` to safely handle `None` and `NaN` risk metrics, eliminating runtime `TypeError` crashes during edge-case candidate queries.
- **Enhanced `retrieve_similar_trades()`**:
  - Computes `avg_pnl_dollar` and `total_pnl_dollar` across nearest twin trades.
  - Implemented sample size guard: flags `insufficient_data = True` if retrieved sample size is below 3 trades.
  - Derives dynamic cluster classification:
    - `WINNING_DNA_CLUSTER` (Neighborhood Win Rate $\ge 55\%$)
    - `LOSING_TRAP` (Neighborhood Win Rate $\le 30\%$)
    - `INSUFFICIENT_DATA` (Sample size $< 3$)
    - `NEUTRAL` (Standard SMC execution)
  - Enriches match payloads with `rr_ratio`, `pnl_percent`, `risk_tier`, `cluster_status`, and `cluster_name`.
- **Export Schema Versioning in `export_graph_for_frontend()`**:
  - Adds `schema_version: "2.0.0"`, `is_static: True`, and `exported_at` ISO-8601 timestamps.
  - Generates synchronized `trade_knowledge_graph.json` with 190 nodes and 1,265 synapses.

#### 2. `backend/state.py`
- Added `last_candidate_graph_rag: Optional[Dict[str, Any]] = None` to `BotState` to persist candidate telemetry in memory across scanner cycles.

#### 3. `backend/main.py`
- Added `GET /api/graph-rag`: Unified endpoint returning the complete graph network, cluster data, winning DNA rules, and candidate evaluation.
- Added `GET /api/graph/latest-candidate`: Direct endpoint exposing the latest analyzed candidate setup and top twin precedents.
- Updated `GET /api/status`: Includes `last_candidate_graph_rag` in the system state response.
- Injected live candidate evaluation in `autonomous_trading_loop` upon candidate validation.

#### 4. `backend/tests/test_graph_rag.py` (New File)
- 8 automated unit tests covering Jaccard math, feature extraction, top-K ordering, cluster stats, sample size guarding, empty graph resilience, and schema compliance.

---

### B. Frontend Architecture & Visualizer (`frontend/`)

#### 1. `frontend/src/app/api/backend/[...path]/route.ts`
- Added `AbortSignal.timeout(4000)`: Eliminates indefinite browser hangs if the backend is cold restarting.
- Implemented structured HTTP 504 (Gateway Timeout) and HTTP 502 (Bad Gateway) error payloads.
- Added query parameter preservation when proxying requests to FastAPI.

#### 2. `frontend/src/app/components/TradeGraphVisualizer.tsx` (Major Overhaul)
- **Retina High-DPI 2D Canvas**: Scales canvas by `window.devicePixelRatio` for razor-sharp rendering on MacBook Retina displays.
- **Deterministic Constellation Clusters (Zero Overlap)**:
  - Replaced chaotic physics hairball with mathematical spatial zoning:
    - **Center Stage `(0, -20)`**: Target Candidate Setup Radar.
    - **Top-Left `(-320, -200)`**: London/NY Overlap Hub (83.3% WR, Winning DNA).
    - **Top-Right `(320, -200)`**: London Morning Continuation Hub (66.7% WR).
    - **Bottom-Right `(320, 220)`**: Asian Liquidity Expansion Hub (71.4% WR).
    - **Bottom-Left `(-320, 220)`**: Consolidation & Late NY Traps (Avoided Traps).
  - Concentric orbital rings with 38px spacing buffer ensure zero node overlap.
- **Three Interactive Layout Modes**:
  - `🌌 Constellations`: Clean, partitioned clusters with visual ambiance perimeters.
  - `🎯 Target Focus`: Isolates the candidate setup and positions top 5 twin precedents in an orbital arc with laser links.
  - `⚛️ Force Network`: Dynamic organic physics with hub-decoupling so high-degree nodes never crush the graph.
- **Auto-Fit & Viewport Tools (`fitView`)**:
  - Automatically centers and scales the graph bounding box on load and layout switch.
  - `Target` button: Centers immediately on the candidate setup.
  - `Fit All` button: Auto-frames all 190 nodes with 70px padding.
- **De-Cluttered Typography & HUD Tooltip**:
  - Trade numbers rendered inside node circles.
  - Labels only shown for candidate, top twins, cluster titles, or on hover/selection.
  - Dark-glass HUD tooltip on hover displaying Trade #, Asset, Side, P&L, Win/Loss, Impulse Angle, and Cluster status.
- **Integrated Dark Terminal Side Inspector**:
  - Styled in obsidian slate (`#0c101d` with `border-slate-800`), matching Bloomberg and TradingView terminals.
  - **Default View**: Displays the Target Setup Dossier, Neighborhood Win Rate, Expected Return, Impulse Angle, and Interactive Top Twins list with 1-click canvas focus.
  - **Selected Node View**: Displays trade details, IST entry/exit times, C1 Stop Loss, 1:2 Take Profit, neural explanation, and "Inspect in Candlestick Chart" button.

#### 3. `frontend/src/app/page.tsx`
- **Candidate Scenario Selector**: Switch between Live Scanner Feed and 4 canonical benchmark setups (Gold Overlap Long, Gold Asian Short, BTC London Short, Exhaustion Trap).
- **Candidate Setup & Telemetry Card**: High-visibility metrics for Neighborhood Win Rate %, Average Return ($), Cluster Status, and Strict 1:2 R:R.
- **Retrieved Historical Precedents Table**: Ranked similarity table showing Trade ID, Outcome, Similarity Bar (0-100%), Shared Features badges, P&L ($), R:R, and a "Focus Node" button that auto-centers the node on the canvas.
- **Historical Disclaimer**: Explicit disclosure that Graph RAG reflects backtested similarities across 169 verified setups and past performance does not guarantee future results.

---

## 4. API Endpoints Reference

| Endpoint | Method | Response Payload | Description |
| :--- | :--- | :--- | :--- |
| `/api/graph-rag` | `GET` | `{ nodes, links, graph_summary, latest_candidate, schema_version }` | Unified knowledge graph payload for dashboard |
| `/api/graph/latest-candidate`| `GET` | `{ candidate_setup, graph_rag, timestamp }` | Latest evaluated candidate setup & twin matches |
| `/api/graph/network` | `GET` | `{ nodes, links }` | Raw node and edge graph network |
| `/api/graph/clusters` | `GET` | `[ { cluster_name, win_rate, trades, ... } ]` | High-win clusters ($WR \ge 55\%$) and trap clusters |
| `/api/graph/dna` | `GET` | `{ winning_dna: { total_trades, core_rules, ... } }` | Golden rule combinations extracted from winning trades |
| `/api/graph/query` | `POST` | `{ neighborhood_win_rate, top_matches, ... }` | Query candidate features against the Knowledge Graph |
| `/api/status` | `GET` | `{ is_running, last_candidate_graph_rag, ... }` | Complete system state including active trade & RAG |

---

## 5. Knowledge Graph Schemas & Data Model

### Node Schema (`GraphNode`)
```typescript
interface GraphNode {
  id: string;                                   // e.g., "TRADE_1_XAUUSD", "Session: London/NY Overlap", "CANDIDATE_SETUP"
  node_type: 'trade' | 'feature' | 'candidate'; // Categorical node type
  trade_num?: number;                           // Historical trade index (1 to 169)
  symbol?: string;                              // "XAUUSD" or "BTCUSDT"
  direction?: 'LONG' | 'SHORT';                 // Trade direction
  result?: 'WIN' | 'LOSS';                      // Outcome
  pnl_dollar?: number;                          // P&L in USD
  pnl_percent?: number;                         // P&L in percentage
  angle?: number;                               // Impulse angle (e.g., 42.3°)
  session?: string;                             // Trading session name
  entry_time_ist?: string;                      // Formatted IST entry timestamp
  setup_reason?: string;                        // SMC pattern description
  features?: string[];                          // Array of feature node IDs
  isHighWinCluster?: boolean;                   // Belongs to WR >= 55% cluster
  isLosingTrap?: boolean;                       // Belongs to WR <= 30% trap cluster
  clusterZone?: string;                         // "OVERLAP" | "LONDON" | "ASIAN" | "TRAPS" | "NEUTRAL"
  
  // Spatial Coordinates
  x?: number;
  y?: number;
  targetX?: number;
  targetY?: number;
  radius?: number;
}
```

### Link Schema (`GraphLink`)
```typescript
interface GraphLink {
  source: string;        // Source node ID
  target: string;        // Target node ID
  relation: string;      // "EXHIBITS" | "SYNAPSE_SIMILARITY" | "CANDIDATE_SIMILARITY"
  weight: number;        // Jaccard similarity score (0.0 to 1.0)
  shared_features?: string[]; // Overlapping feature IDs
}
```

---

## 6. Mathematical Formulations

### A. Jaccard Similarity Coefficient
For a candidate trade $C$ with categorical feature set $F_C$ and a historical trade $T$ with feature set $F_T$:
$$J(C, T) = \frac{|F_C \cap F_T|}{|F_C \cup F_T|}$$

### B. Neighborhood Win Rate
Computed across the top $K$ nearest historical precedents ($K=5$):
$$\text{Win Rate}_{\text{neighborhood}} = \left( \frac{\sum_{i=1}^{K} \mathbb{I}(\text{Result}_i = \text{WIN})}{K} \right) \times 100\%$$

### C. Expected Historical Return
$$\overline{\text{PnL}} = \frac{1}{K} \sum_{i=1}^{K} \text{PnL}_i$$

### D. Sample Size Guard
$$\text{If } K < 3 \implies \text{insufficient\_data} = \text{True}, \quad \text{Status} = \text{"INSUFFICIENT\_DATA"}$$

---

## 7. Complete Verification & Testing Guide

### 1. Graph RAG Unit Tests
Execute the determinism and edge-case unit test suite:
```bash
cd /Users/irshadsheikh/Downloads/TraderBot/trading-agent
./backend/venv/bin/python -m unittest backend/tests/test_graph_rag.py
```
**Expected Result**:
```
Ran 8 tests in 0.053s
OK
```

### 2. Full Application Regression Suite
Execute the 7-phase end-to-end platform regression suite:
```bash
cd /Users/irshadsheikh/Downloads/TraderBot/trading-agent
./backend/venv/bin/python test_full_app.py
```
**Expected Result**:
```
======================================================================
  TEST RESULTS: 25 PASSED, 0 FAILED
======================================================================
```

### 3. Frontend Production Build
Verify TypeScript compilation and Next.js static page generation:
```bash
cd /Users/irshadsheikh/Downloads/TraderBot/trading-agent/frontend
npm run build
```
**Expected Result**:
```
✓ Compiled successfully in 1.4s
✓ Finished TypeScript
✓ Generating static pages (6/6)
```

---

## 8. Git Branch Information & Commit History

- **Base Branch**: `origin/main` (commit `18e335f`)
- **Feature Branch**: `phase-1/graph-rag-dashboard-improvement`
- **Remote URL**: [https://github.com/Irshad-dude/Trading-Bot/tree/phase-1/graph-rag-dashboard-improvement](https://github.com/Irshad-dude/Trading-Bot/tree/phase-1/graph-rag-dashboard-improvement)

### Commit Log on Feature Branch:
1. `3b9b5df` — `feat(graph-rag): improve graph visualization, telemetry, api sync, and retrieval validation (phase 1)`
2. `2beb817` — `fix(ui): overhaul graph rag visualizer with constellation layout, retina canvas, and dark terminal side inspector`

---

## 9. Scope Boundaries & Phase 2 Roadmap

### Strictly Excluded from Phase 1 (Queued for Phase 2):
1. **Reinforcement Learning**: PPO, Stable-Baselines3, Gymnasium environments.
2. **Relational Database**: PostgreSQL / SQLAlchemy trade persistence.
3. **Automated Trade Auditor**: Automated classification of execution error vs market loss.
4. **Live Broker Order Mutation**: Graph RAG operates strictly as an intelligence advisory layer without altering broker execution logic.
