"""
Unit Test Suite for TradeKnowledgeGraph (Graph RAG Engine)
Phase 1E: Retrieval Validation

Validates:
1. Mathematical correctness of Jaccard similarity.
2. Feature extraction consistency (Angle, Session, Risk, Pattern, Asset, Direction).
3. Top-K retrieval behavior and sorting.
4. Cluster mining calculations (Wins, Losses, Win Rate %, PnL).
5. Safe handling of empty graphs (zero trades).
6. Safe handling of incomplete / malformed candidate objects (None, empty, missing keys).
7. Non-duplication of retrieved trades.
8. Serialization schema for frontend exports.
"""

import unittest
import math
import tempfile
import json
import os
from backend.ai.graph_rag import TradeKnowledgeGraph


class TestTradeKnowledgeGraph(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Load standard knowledge graph built from default backtest trades
        cls.kg = TradeKnowledgeGraph()

    def test_jaccard_similarity_calculation(self):
        """Validates that Jaccard similarity formula |A ∩ B| / |A ∪ B| is mathematically exact."""
        candidate = {
            "symbol": "XAUUSD",
            "direction": "LONG",
            "angle": 42.0,
            "session_name": "London/NY Overlap (Peak Volume)",
            "setup_reason": "CONTINUATION_BOS"
        }
        res = self.kg.retrieve_similar_trades(candidate, top_k=5)
        self.assertIn("top_matches", res)
        self.assertGreater(len(res["top_matches"]), 0)

        query_set = set(res["query_features"])
        for match in res["top_matches"]:
            # Find the original trade to extract its exact features
            trade = next(t for t in self.kg.trades if t["trade_num"] == match["trade_num"])
            trade_features = {
                self.kg._categorize_angle(trade.get("angle", 40.0)),
                self.kg._clean_session(trade.get("session_name", "")),
                f"Asset: {trade.get('symbol', 'XAUUSD')}",
                f"Direction: {trade.get('direction', 'LONG')}",
                f"Pattern: {trade.get('trade_type', 'CONTINUATION_BOS')}"
            }
            intersection = query_set.intersection(trade_features)
            union = query_set.union(trade_features)
            expected_score = round(len(intersection) / len(union), 3)
            self.assertEqual(match["similarity_score"], expected_score)
            self.assertEqual(set(match["common_features"]), intersection)

    def test_feature_extraction_consistency(self):
        """Verifies deterministic mapping of trading traits into concept categories."""
        # Angle categorization
        self.assertEqual(self.kg._categorize_angle(None), "Angle: 35°-40° (Standard)")
        self.assertEqual(self.kg._categorize_angle(float("nan")), "Angle: 35°-40° (Standard)")
        self.assertEqual(self.kg._categorize_angle(38.5), "Angle: 35°-40° (Trending Base)")
        self.assertEqual(self.kg._categorize_angle(43.2), "Angle: 40°-45° (Golden Impulse)")
        self.assertEqual(self.kg._categorize_angle(47.0), "Angle: 45°-50° (Aggressive Expansion)")
        self.assertEqual(self.kg._categorize_angle(52.1), "Angle: 50°+ (Parabolic Momentum)")

        # Session cleaning
        self.assertEqual(self.kg._clean_session(""), "Session: Unknown")
        self.assertEqual(self.kg._clean_session(None), "Session: Unknown")
        self.assertEqual(self.kg._clean_session("London/NY Overlap Session"), "Session: London/NY Overlap (Peak Volume)")
        self.assertEqual(self.kg._clean_session("London Opening Session"), "Session: London Morning")
        self.assertEqual(self.kg._clean_session("Asian Session"), "Session: Asian Liquidity")
        self.assertEqual(self.kg._clean_session("New York Afternoon Session"), "Session: NY Afternoon")

        # Risk categorization with None/NaN safety
        self.assertEqual(self.kg._categorize_risk(None, "XAUUSD"), "Risk: Medium SL ($3-$5.5)")
        self.assertEqual(self.kg._categorize_risk(2.5, "XAUUSD"), "Risk: Tight SL (<$3.0)")
        self.assertEqual(self.kg._categorize_risk(6.0, "XAUUSD"), "Risk: Wide SL (>$5.5)")
        self.assertEqual(self.kg._categorize_risk(150.0, "BTCUSDT"), "Risk: Tight SL (<$200)")
        self.assertEqual(self.kg._categorize_risk(300.0, "BTCUSDT"), "Risk: Medium SL ($200-$450)")
        self.assertEqual(self.kg._categorize_risk(600.0, "BTCUSDT"), "Risk: Wide SL (>$450)")

    def test_top_k_retrieval(self):
        """Verifies top-K filtering respects K bounds and descending sort order."""
        candidate = {"symbol": "BTCUSDT", "direction": "SHORT", "angle": 43.5}
        for k in [1, 3, 6, 12]:
            res = self.kg.retrieve_similar_trades(candidate, top_k=k)
            matches = res["top_matches"]
            self.assertLessEqual(len(matches), k)
            # Check descending sort order
            scores = [m["similarity_score"] for m in matches]
            self.assertEqual(scores, sorted(scores, reverse=True))

    def test_cluster_mining_statistics(self):
        """Verifies cluster mining math: wins + losses == trade_count and win_rate matches."""
        clusters = self.kg.clusters
        self.assertGreater(len(clusters), 0)
        for cl in clusters:
            self.assertEqual(cl["wins"] + cl["losses"], cl["trade_count"])
            expected_wr = round(cl["wins"] / cl["trade_count"] * 100, 1)
            self.assertEqual(cl["win_rate"], expected_wr)
            if cl["win_rate"] >= 55.0:
                self.assertEqual(cl["status"], "HIGH_WIN_CLUSTER")
            elif cl["win_rate"] <= 30.0:
                self.assertEqual(cl["status"], "LOSING_TRAP")

    def test_empty_graph_handling(self):
        """Validates that an empty graph does not crash and returns insufficient data safely."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
            json.dump({"summary": {}, "trades": []}, tf)
            temp_path = tf.name

        try:
            empty_kg = TradeKnowledgeGraph(trades_file=temp_path)
            res = empty_kg.retrieve_similar_trades({"symbol": "XAUUSD"}, top_k=5)
            self.assertEqual(res["neighborhood_sample_size"], 0)
            self.assertEqual(res["neighborhood_win_rate"], 0.0)
            self.assertEqual(res["top_matches"], [])
            self.assertEqual(res["recommendation"], "INSUFFICIENT_DATA")
            self.assertTrue(res["insufficient_data"])
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_incomplete_candidate_handling(self):
        """Validates that candidate objects with missing, None, or malformed fields are handled safely."""
        malformed_candidates = [
            {},
            {"symbol": None, "direction": None, "angle": None},
            {"angle": float("nan"), "session_name": None},
            {"symbol": "XAUUSD", "angle": -999.0, "setup_reason": None},
        ]
        for cand in malformed_candidates:
            res = self.kg.retrieve_similar_trades(cand, top_k=5)
            self.assertIn("neighborhood_win_rate", res)
            self.assertIn("top_matches", res)
            self.assertIn("recommendation", res)
            self.assertIsInstance(res["query_features"], list)

    def test_no_duplicate_trades(self):
        """Verifies that retrieved top matches never contain duplicate trade numbers."""
        candidate = {"symbol": "XAUUSD", "direction": "LONG", "angle": 41.5}
        res = self.kg.retrieve_similar_trades(candidate, top_k=20)
        trade_nums = [m["trade_num"] for m in res["top_matches"]]
        self.assertEqual(len(trade_nums), len(set(trade_nums)), "Retrieved trades should not have duplicates")

    def test_export_graph_for_frontend(self):
        """Verifies that graph export produces correct schema for Next.js visualizer."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
            temp_path = tf.name

        try:
            export = self.kg.export_graph_for_frontend(output_path=temp_path)
            self.assertIn("graph_summary", export)
            self.assertIn("nodes", export)
            self.assertIn("links", export)

            summary = export["graph_summary"]
            self.assertTrue(summary.get("is_static"))
            self.assertIn("exported_at", summary)
            self.assertEqual(summary["total_trades"], len(self.kg.trades))

            # Validate node structure
            for node in export["nodes"][:10]:
                self.assertIn("id", node)
                self.assertIn("node_type", node)
                if node["node_type"] == "trade":
                    self.assertIn("result", node)
                    self.assertIn("trade_num", node)

            # Validate link structure
            for link in export["links"][:10]:
                self.assertIn("source", link)
                self.assertIn("target", link)
                self.assertIn("relation", link)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)


if __name__ == "__main__":
    unittest.main()
