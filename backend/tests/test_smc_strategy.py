import sys
import unittest
from unittest.mock import Mock


import pandas as pd

sys.path.insert(0, "backend")
from strategy.smc import SMCEngine


class TestFVGAfterBOS(unittest.TestCase):
    def setUp(self):
        self.engine = SMCEngine()

    def make_df(self):
        return pd.DataFrame([
            {"open": 10, "high": 11, "low": 9, "close": 10},
            {"open": 10, "high": 11, "low": 9, "close": 10},
            {"open": 10, "high": 11, "low": 9, "close": 10},
            {"open": 10, "high": 11, "low": 9, "close": 10},
            {"open": 10, "high": 11, "low": 9, "close": 10},
        ]).astype(float)

    def test_bullish_primary_pattern(self):
        df = self.make_df()
        df.loc[2] = [10, 10, 9, 9.5]
        df.loc[3] = [10, 12, 9, 12]
        df.loc[4] = [12, 13, 11, 12]

        result = self.engine.find_fvg_after_bos(df, 3, "BULLISH")

        self.assertIsNotNone(result)
        self.assertEqual(result["index"], 4)
        self.assertEqual(result["sl_price"], 9)

    def test_bearish_primary_pattern(self):
        df = self.make_df()
        df.loc[2] = [10, 11, 10, 10.5]
        df.loc[3] = [12, 13, 9, 9]
        df.loc[4] = [8, 9, 7, 8]

        result = self.engine.find_fvg_after_bos(df, 3, "BEARISH")

        self.assertIsNotNone(result)
        self.assertEqual(result["index"], 4)
        self.assertEqual(result["sl_price"], 11)

    def test_bullish_backward_fallback(self):
        df = self.make_df()
        df.loc[1] = [10, 10, 9, 9.5]
        df.loc[2] = [10, 13, 9, 12]
        df.loc[3] = [12, 13, 11, 12]
        df.loc[4] = [10, 11, 9, 10]

        result = self.engine.find_fvg_after_bos(df, 3, "BULLISH")

        self.assertIsNotNone(result)
        self.assertEqual(result["index"], 3)
        self.assertEqual(result["sl_price"], 9)

    def test_bearish_backward_fallback(self):
        df = self.make_df()
        df.loc[1] = [10, 11, 10, 10.5]
        df.loc[2] = [12, 13, 9, 9]
        df.loc[3] = [8, 9, 7, 8]
        df.loc[4] = [10, 11, 9, 10]

        result = self.engine.find_fvg_after_bos(df, 3, "BEARISH")

        self.assertIsNotNone(result)
        self.assertEqual(result["index"], 3)
        self.assertEqual(result["sl_price"], 11)

    def test_waits_until_b_plus_1_exists(self):
        df = self.make_df().iloc[:4].copy()
        df.loc[1] = [10, 10, 9, 9.5]
        df.loc[2] = [10, 13, 9, 12]
        df.loc[3] = [12, 13, 11, 12]

        result = self.engine.find_fvg_after_bos(df, 3, "BULLISH")

        self.assertIsNone(result)

    def test_pre_bos_only_fvg_is_rejected(self):
        df = self.make_df()
        df.loc[0] = [10, 10, 9, 9.5]
        df.loc[1] = [10, 12, 9, 12]
        df.loc[2] = [12, 13, 11, 12]

        result = self.engine.find_fvg_after_bos(df, 3, "BULLISH")

        self.assertIsNone(result)


class TestMacroTimeframeAuthority(unittest.TestCase):
    def setUp(self):
        self.engine = SMCEngine()

    def test_4h_controls_bias_and_15m_runs_execution_pipeline(self):
        df_4h = pd.DataFrame(
            [{"open": 100, "high": 105, "low": 95, "close": 100}] * 30
        )
        df_15m = pd.DataFrame(
            [{"open": 90, "high": 95, "low": 85, "close": 90}] * 20
        )

        expected_4h = df_4h.reset_index(drop=True)
        expected_15m = df_15m.reset_index(drop=True)

        self.engine.calculate_atr = Mock(return_value=0.0)
        self.engine.determine_macro_trend = Mock(return_value="BEARISH")
        self.engine._find_swings = Mock(
            return_value=([{"index": 5}], [{"index": 8}])
        )
        self.engine.find_inducement = Mock(
            return_value={"idm_price": 95.0}
        )
        self.engine.find_bos = Mock(
            return_value={
                "direction": "BEARISH",
                "bos_index": 10,
                "anchor_price": 100.0,
            }
        )
        self.engine.find_fvg_after_bos = Mock(
            return_value={
                "top": 99.0,
                "bottom": 98.0,
                "sl_price": 100.0,
                "c1_high": 100.0,
                "c1_low": 97.0,
                "c2_high": 99.0,
                "c2_low": 98.0,
            }
        )
        self.engine.is_fvg_touched = Mock(return_value=True)
        self.engine.find_entry_confirmation = Mock(return_value=0)

        result = self.engine.scan_for_setups(
            "TEST", df_4h, df_15m
        )

        self.engine.determine_macro_trend.assert_called_once()
        pd.testing.assert_frame_equal(
            self.engine.determine_macro_trend.call_args.args[0],
            expected_4h,
        )

        self.engine.find_inducement.assert_called_once()
        inducement_args = self.engine.find_inducement.call_args.args
        pd.testing.assert_frame_equal(inducement_args[0], expected_15m)
        self.assertEqual(inducement_args[1], "BEARISH")

        self.engine.find_bos.assert_called_once()
        bos_args = self.engine.find_bos.call_args.args
        pd.testing.assert_frame_equal(bos_args[0], expected_15m)
        self.assertEqual(bos_args[1], "BEARISH")

        self.assertIsNotNone(result)
        self.assertEqual(result["macro_trend"], "BEARISH")
        self.assertEqual(result["direction"], "BEARISH")


if __name__ == "__main__":
    unittest.main()
