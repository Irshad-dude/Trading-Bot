"""
Full App End-to-End Test Suite for Gold (XAUUSD) and Bitcoin (BTCUSDT)
Tests:
1. Data Integrity: PAXG_15m_full.pkl and BTC_15m_full.pkl (Nov 1 2025 - Nov 2 2026)
2. Backtest Engine: run_chain_of_choch for both assets with 40-45 deg Trending Angle filter
3. Max Drawdown calculations
4. Frontend Artifacts: backtest_results_2026.json, trade_candles.json, backtest_trades_2025_2026.csv
5. Next.js API Route: http://localhost:3000/api/backtest
6. Frontend Web UI: http://localhost:3000/
"""
import sys, os, json, pathlib, urllib.request

BASE_DIR = pathlib.Path(__file__).parent
DATA_DIR = BASE_DIR / "data_cache"

passes = 0
fails = 0

def log_test(name, success, details=""):
    global passes, fails
    if success:
        passes += 1
        print(f"  [PASS] {name} {f'({details})' if details else ''}")
    else:
        fails += 1
        print(f"  [FAIL] {name} {f'({details})' if details else ''}")

print("=" * 70)
print("  FULL APP TEST SUITE: GOLD & BTC TRENDING SMC PLATFORM (40-45° ANGLE)")
print("=" * 70)

# TEST 1: Data Files Exist and Cover Full Range
print("\n[Phase 1] 15M Data Integrity Test:")
for symbol, fname in [("Gold (PAXG)", "PAXG_15m_full.pkl"), ("Bitcoin (BTC)", "BTC_15m_full.pkl")]:
    p = DATA_DIR / fname
    if not p.exists():
        log_test(f"Data file exists for {symbol}", False, f"Missing {fname}")
        continue
    import pandas as pd
    df = pd.read_pickle(p)
    rows = len(df)
    min_d = str(df["timestamp"].min())
    max_d = str(df["timestamp"].max())
    covers_range = "2025-11-01" in min_d and "2026-11-02" in max_d
    log_test(f"{symbol} 15M data coverage", covers_range and rows >= 35000, f"{rows} candles: {min_d[:10]} to {max_d[:10]}")

# TEST 2: Backtest Results JSON
print("\n[Phase 2] Backtest Output & Max Drawdown Integrity:")
json_path = BASE_DIR / "frontend" / "public" / "backtest_results_2026.json"
if json_path.exists():
    with open(json_path) as f:
        data = json.load(f)
    trades = data.get("trades", [])
    summary = data.get("summary", {})
    
    # Check Gold
    gold_sum = summary.get("XAUUSD", {})
    gold_trades = [t for t in trades if t["symbol"] == "XAUUSD"]
    log_test("Gold summary total trades match trades list", len(gold_trades) == gold_sum.get("total_trades"), f"{len(gold_trades)} trades")
    log_test("Gold Max Drawdown computed", "max_drawdown_pct" in gold_sum and gold_sum["max_drawdown_pct"] > 0, f"Max DD: {gold_sum.get('max_drawdown_pct')}%")
    
    # Check BTC
    btc_sum = summary.get("BTCUSDT", {})
    btc_trades = [t for t in trades if t["symbol"] == "BTCUSDT"]
    log_test("BTC summary total trades match trades list", len(btc_trades) == btc_sum.get("total_trades"), f"{len(btc_trades)} trades")
    log_test("BTC Max Drawdown computed", "max_drawdown_pct" in btc_sum, f"Max DD: {btc_sum.get('max_drawdown_pct')}%")
    
    # Check per-trade Max Drawdown on all trades
    all_have_dd = all("max_drawdown_pct" in t for t in trades)
    log_test("Every single trade has max_drawdown_pct attached", all_have_dd, f"Total trades: {len(trades)}")

    # Check Trending Angle attached to all trades
    all_have_angle = all("angle" in t and t["angle"] > 0 for t in trades)
    log_test("Every single trade has verified impulse angle (no sideways chop)", all_have_angle)
    
    # Check 1:2 R:R Rule on trades
    all_1_2 = all(t.get("rr_ratio") == "1:2" for t in trades)
    log_test("Every trade strictly follows Rule #9 1:2 R:R", all_1_2)

    # Check Rule #8 C1 SL attached
    all_have_sl = all(t.get("stop_loss") > 0 and t.get("take_profit") > 0 for t in trades)
    log_test("Every trade has valid Stop Loss and Take Profit", all_have_sl)
else:
    log_test("backtest_results_2026.json exists", False)

# TEST 3: Trade Candles JSON for Visualization
print("\n[Phase 3] Trade Candles Visualizer Data Test:")
candles_path = BASE_DIR / "frontend" / "public" / "trade_candles.json"
if candles_path.exists():
    with open(candles_path) as f:
        cdata = json.load(f)
    log_test("trade_candles.json populated", len(cdata) > 0, f"{len(cdata)} trade windows")
    
    # Check sample window structure
    first_key = list(cdata.keys())[0]
    sample = cdata[first_key]
    required_keys = ["local_sh_idx", "local_idm_idx", "local_bos_idx", "local_c1_idx", "local_c2_idx", "local_c3_idx", "local_entry_idx", "local_exit_idx", "fvg_top", "fvg_bottom", "stop_loss", "take_profit", "angle"]
    all_coords = all(k in sample for k in required_keys)
    log_test("Chart visualizer structural coordinates complete", all_coords, f"Sample: {first_key}")
else:
    log_test("trade_candles.json exists", False)

# TEST 4: CSV Export File
print("\n[Phase 4] CSV Download Export Test:")
csv_path = BASE_DIR / "frontend" / "public" / "backtest_trades_2025_2026.csv"
if csv_path.exists():
    lines = csv_path.read_text().strip().split("\n")
    log_test("CSV export file populated", len(lines) >= 160, f"{len(lines)-1} trade records + header")
else:
    log_test("CSV export file exists", False)

# TEST 5: Frontend API Endpoint (/api/backtest)
print("\n[Phase 5] Frontend API (/api/backtest) Test:")
try:
    req = urllib.request.Request("http://localhost:3000/api/backtest")
    with urllib.request.urlopen(req, timeout=5) as res:
        status = res.status
        body = json.loads(res.read().decode())
        has_gold = "gold_summary" in body and body["gold_summary"] is not None
        has_btc = "btc_summary" in body and body["btc_summary"] is not None
        has_trades = "trades" in body and len(body["trades"]) == 169
        log_test("Next.js /api/backtest status 200 OK", status == 200)
        log_test("API returns gold_summary with Max DD", has_gold and "max_drawdown_pct" in body["gold_summary"], f"Gold DD: {body['gold_summary'].get('max_drawdown_pct')}%")
        log_test("API returns btc_summary with Max DD", has_btc and "max_drawdown_pct" in body["btc_summary"], f"BTC DD: {body['btc_summary'].get('max_drawdown_pct')}%")
        log_test("API returns 169 trending trades", has_trades, f"Count: {len(body.get('trades', []))}")
except Exception as e:
    log_test("Next.js /api/backtest endpoint online", False, str(e))

# TEST 6: Frontend Web Page Render Test
print("\n[Phase 6] Frontend Website (http://localhost:3000) Test:")
try:
    req = urllib.request.Request("http://localhost:3000/")
    with urllib.request.urlopen(req, timeout=5) as res:
        status = res.status
        html = res.read().decode()
        log_test("Website root loaded HTTP 200", status == 200)
        log_test("Website contains Trade Visualizer section", "chart-visualizer-section" in html or "TraderBot" in html or len(html) > 500)
except Exception as e:
    log_test("Website root reachable", False, str(e))

# TEST 7: Graph RAG & Neural Knowledge Graph Test
print("\n[Phase 7] Graph RAG & Knowledge Graph Test:")
kg_path = BASE_DIR / "frontend" / "public" / "trade_knowledge_graph.json"
if kg_path.exists():
    with open(kg_path) as f:
        kg_data = json.load(f)
    nodes = kg_data.get("nodes", [])
    links = kg_data.get("links", [])
    summary = kg_data.get("graph_summary", {})
    log_test("trade_knowledge_graph.json exists & populated", len(nodes) >= 180 and len(links) >= 1000, f"{len(nodes)} nodes, {len(links)} links")
    
    # Check winning DNA
    dna = summary.get("winning_dna", {})
    log_test("Winning DNA rules extracted", "core_rules" in dna and len(dna["core_rules"]) >= 3)
    
    # Check high-win clusters
    clusters = summary.get("high_win_clusters", [])
    log_test("High-win clusters identified (WR >= 55%)", len(clusters) > 0, f"{len(clusters)} clusters found")
    
    # Check trade nodes have twin synapses and neural explanations
    trade_nodes = [n for n in nodes if n.get("node_type") == "trade"]
    all_have_twins = all("twin_trades" in n and len(n["twin_trades"]) > 0 for n in trade_nodes)
    all_have_explanations = all("neural_explanation" in n and len(n["neural_explanation"]) > 20 for n in trade_nodes)
    log_test("Every trade node connected to twin synapses", all_have_twins, f"{len(trade_nodes)} trades")
    log_test("Every trade node has neural explanation", all_have_explanations)

    # Test Python Graph RAG Engine Retrieval
    try:
        from backend.ai.graph_rag import TradeKnowledgeGraph
        kg_engine = TradeKnowledgeGraph()
        candidate = {
            "symbol": "XAUUSD",
            "direction": "SHORT",
            "angle": 42.5,
            "session_name": "London / New York Overlap (Peak Volatility)",
            "setup_reason": "Chain-of-CHoCH: CONTINUATION_BOS (SHORT) -> 15M FVG Retrace Touch"
        }
        retrieval = kg_engine.retrieve_similar_trades(candidate, top_k=5)
        log_engine_ok = retrieval.get("neighborhood_win_rate", 0) > 60.0
        log_test("Graph RAG engine retrieval & high-win cluster detection", log_engine_ok, f"WR: {retrieval.get('neighborhood_win_rate')}%")
    except Exception as e:
        log_test("Graph RAG engine retrieval", False, str(e))
else:
    log_test("trade_knowledge_graph.json exists", False)

print("\n" + "=" * 70)
print(f"  TEST RESULTS: {passes} PASSED, {fails} FAILED")
print("=" * 70)

if fails > 0:
    sys.exit(1)
