import pandas as pd
import numpy as np
from typing import Optional, Dict, List, Any, Tuple


class SMCEngine:
    """
    ─────────────────────────────────────────────────────────────────────────
    YOUR PERSONAL SMC/ICT STRATEGY — v1.4  (Irshad's Exact Rulebook)
    ─────────────────────────────────────────────────────────────────────────

    COMPLETE 5-STEP PIPELINE (All on 15-Minute Timeframe):

    STEP 1 — 15M TREND BIAS
        • Read market structure on the 15M chart (with 50 EMA & Swing Points).
        • Bullish  → sequence of Higher Highs (HH) + Higher Lows (HL)
        • Bearish  → sequence of Lower Lows  (LL) + Lower Highs (LH)

    STEP 2 — INDUCEMENT (IDM) & BREAK OF IDM
        • Bullish trend:
            – Market creates a new Higher High (HH).
            – Market makes a pullback low (IDM) under that HH.
            – Without breaking the HH, the market turns and breaks/sweeps below the IDM low.
            – Wick crossing is sufficient to fulfill the inducement.
            – Sweeping the IDM validates the Higher High as the structural BOS anchor.
        • Bearish trend:
            – Market creates a new Lower Low (LL).
            – Market makes a pullback high (IDM) above that LL.
            – Without breaking the LL, the market rallies and breaks/sweeps above the IDM high.
            – Wick crossing is sufficient to fulfill the inducement.
            – Sweeping the IDM validates the Lower Low as the structural BOS anchor.

    STEP 3 — BREAK OF STRUCTURE (BOS)
        • Bullish BOS: Price rallies and CLOSES above the validated Higher High (HH).
        • Bearish BOS: Price drops and CLOSES below the validated Lower Low (LL).
        • A candle close beyond the validated structural anchor confirms the BOS!

    STEP 4 — FAIR VALUE GAP (FVG)
        • The first 3 candles that break through the BOS level must form an FVG gap.
        • Bullish FVG: Candle 1 High < Candle 3 Low (Candle 2 displacement).
        • Bearish FVG: Candle 1 Low  > Candle 3 High (Candle 2 displacement).
        • If the first 3 breakout candles do not form an FVG gap → REJECT SETUP.
        • FVG must then be TOUCHED (price re-enters the gap zone) for entry.

    STEP 5 — ENTRY & RISK EXECUTION
        • Entry: Triggered when price touches the FVG zone on 15M.
        • Stop-Loss (SL): Strictly anchored at Candle 2 (C2) extreme with zero buffer:
            – Bullish: SL = C2 Low
            – Bearish: SL = C2 High
        • Take-Profit (TP): 1:2 Risk-to-Reward ratio (2× risk distance).
    ─────────────────────────────────────────────────────────────────────────
    """

    def __init__(self, pivot_length: int = 3):
        self.pivot_length = pivot_length

    # ─── ATR ─────────────────────────────────────────────────────────────────
    def calculate_atr(self, df: pd.DataFrame, period: int = 14) -> float:
        if len(df) < period + 1:
            return 0.0
        h, l, c = df["high"], df["low"], df["close"]
        prev_c = c.shift(1)
        tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
        atr = tr.rolling(period).mean().iloc[-1]
        return float(atr) if not np.isnan(atr) else 0.0

    # ─── STEP 1: 4H TREND — swing-point market structure ────────────────────
    def determine_macro_trend(self, df_4h: pd.DataFrame) -> str:
        """
        Reads Higher Highs / Higher Lows (Bullish) or
               Lower Lows / Lower Highs (Bearish) from 4H swing structure.
        Requires at least 30 candles for reliable swing detection.
        """
        if df_4h.empty or len(df_4h) < 30:
            return "BULLISH"

        df = df_4h.copy().reset_index(drop=True)
        n = self.pivot_length

        swing_highs: List[Tuple[int, float]] = []
        swing_lows:  List[Tuple[int, float]] = []

        for i in range(n, len(df) - n):
            window_h = df["high"].iloc[i - n: i + n + 1]
            window_l = df["low"].iloc[i - n: i + n + 1]
            if df["high"].iloc[i] == window_h.max():
                swing_highs.append((i, float(df["high"].iloc[i])))
            if df["low"].iloc[i] == window_l.min():
                swing_lows.append((i, float(df["low"].iloc[i])))

        # Need at least 2 swings each to determine structure
        if len(swing_highs) >= 2 and len(swing_lows) >= 2:
            # Check last 2 swing highs and lows
            sh1, sh2 = swing_highs[-2][1], swing_highs[-1][1]
            sl1, sl2 = swing_lows[-2][1],  swing_lows[-1][1]

            if sh2 > sh1 and sl2 > sl1:
                return "BULLISH"   # HH + HL → Bullish
            if sh2 < sh1 and sl2 < sl1:
                return "BEARISH"   # LH + LL → Bearish

        # Fallback: EMA slope
        ema50 = df["close"].ewm(span=50, adjust=False).mean()
        last_price = float(df["close"].iloc[-1])
        ema_val    = float(ema50.iloc[-1])
        return "BULLISH" if last_price >= ema_val else "BEARISH"

    # ─── SWING DETECTION (shared helper) ─────────────────────────────────────
    def _find_swings(self, df: pd.DataFrame) -> Tuple[List[Tuple[int, float]], List[Tuple[int, float]]]:
        """Returns (swing_highs, swing_lows) as list of (index, price) tuples."""
        n = self.pivot_length
        highs, lows = [], []
        for i in range(n, len(df) - n):
            wh = df["high"].iloc[i - n: i + n + 1]
            wl = df["low"].iloc[i - n: i + n + 1]
            if df["high"].iloc[i] == wh.max():
                highs.append((i, float(df["high"].iloc[i])))
            if df["low"].iloc[i] == wl.min():
                lows.append((i, float(df["low"].iloc[i])))
        return highs, lows

    # ─── STEP 2: INDUCEMENT ───────────────────────────────────────────────────
    def find_inducement(
        self,
        df: pd.DataFrame,
        trend: str,
        swing_highs: List[Tuple[int, float]],
        swing_lows:  List[Tuple[int, float]],
        lookback: int = 60,
    ) -> Optional[Dict[str, Any]]:
        """
        Irshad's Exact Rule:
        Bullish Trend:
          1. Identify candidate Higher High (HH) from swing_highs.
          2. Find the first pullback swing low (IDM) formed AFTER the HH.
          3. Verify that price sweeps/breaks below this IDM (wick is enough)
             WITHOUT having broken above HH first.
          4. When swept, this validates the HH as the structural anchor.

        Bearish Trend:
          1. Identify candidate Lower Low (LL) from swing_lows.
          2. Find the first pullback swing high (IDM) formed AFTER the LL.
          3. Verify that price sweeps/breaks above this IDM (wick is enough)
             WITHOUT having broken below LL first.
          4. When swept, this validates the LL as the structural anchor.
        """
        start_idx = max(0, len(df) - lookback)

        if trend == "BEARISH":
            recent_lls = [(i, p) for (i, p) in swing_lows if i >= start_idx and i < len(df) - 1]
            for (ll_idx, ll_p) in reversed(recent_lls):
                pullback_highs = [(sh_idx, sh_p) for (sh_idx, sh_p) in swing_highs if sh_idx > ll_idx and sh_p > ll_p]
                if not pullback_highs:
                    continue
                idm_idx, idm_p = pullback_highs[0]

                idm_swept = False
                broke_ll_early = False
                swept_idx = -1
                for b in range(idm_idx + 1, len(df)):
                    c = df.iloc[b]
                    if not idm_swept:
                        if c["low"] < ll_p:
                            broke_ll_early = True
                            break
                        if c["high"] >= idm_p:
                            idm_swept = True
                            swept_idx = b
                    else:
                        break
                if idm_swept and not broke_ll_early:
                    return {
                        "anchor_idx":   ll_idx,
                        "anchor_price": ll_p,
                        "idm_idx":      idm_idx,
                        "idm_price":    idm_p,
                        "swept_idx":    swept_idx,
                        "direction":    "BEARISH",
                    }
            return None
        else:  # BULLISH
            recent_hhs = [(i, p) for (i, p) in swing_highs if i >= start_idx and i < len(df) - 1]
            for (hh_idx, hh_p) in reversed(recent_hhs):
                pullback_lows = [(sl_idx, sl_p) for (sl_idx, sl_p) in swing_lows if sl_idx > hh_idx and sl_p < hh_p]
                if not pullback_lows:
                    continue
                idm_idx, idm_p = pullback_lows[0]

                idm_swept = False
                broke_hh_early = False
                swept_idx = -1
                for b in range(idm_idx + 1, len(df)):
                    c = df.iloc[b]
                    if not idm_swept:
                        if c["high"] > hh_p:
                            broke_hh_early = True
                            break
                        if c["low"] <= idm_p:
                            idm_swept = True
                            swept_idx = b
                    else:
                        break
                if idm_swept and not broke_hh_early:
                    return {
                        "anchor_idx":   hh_idx,
                        "anchor_price": hh_p,
                        "idm_idx":      idm_idx,
                        "idm_price":    idm_p,
                        "swept_idx":    swept_idx,
                        "direction":    "BULLISH",
                    }
            return None

    # ─── STEP 3: BOS DETECTION ────────────────────────────────────────────────
    def find_bos(
        self,
        df: pd.DataFrame,
        trend: str,
        inducement: Dict[str, Any],
        swing_highs: List[Tuple[int, float]],
        swing_lows:  List[Tuple[int, float]],
    ) -> Optional[Dict[str, Any]]:
        """
        After the Inducement (IDM) has been swept:
        BOS requires a candle CLOSE beyond the validated structural anchor:
          - Bullish: close > anchor_price (Higher High)
          - Bearish: close < anchor_price (Lower Low)

        Returns dict with keys: bos_index, bos_price, anchor_price, idm_price, direction
        """
        swept_idx    = inducement["swept_idx"]
        anchor_price = inducement["anchor_price"]
        direction    = inducement["direction"]

        for i in range(swept_idx + 1, len(df)):
            candle = df.iloc[i]
            if direction == "BEARISH":
                if candle["close"] < anchor_price:
                    return {
                        "bos_index":    i,
                        "bos_price":    anchor_price,
                        "anchor_price": anchor_price,
                        "idm_price":    inducement["idm_price"],
                        "direction":    "BEARISH",
                    }
            else:  # BULLISH
                if candle["close"] > anchor_price:
                    return {
                        "bos_index":    i,
                        "bos_price":    anchor_price,
                        "anchor_price": anchor_price,
                        "idm_price":    inducement["idm_price"],
                        "direction":    "BULLISH",
                    }

        return None

    # ─── STEP 4: FVG DETECTION ───────────────────────────────────────────────
    def find_fvg_after_bos(
        self,
        df: pd.DataFrame,
        bos_index: int,
        direction: str,
        scan_window: int = 3,
    ) -> Optional[Dict[str, Any]]:
        """
        YOUR EXACT RULE:
        When price breaks the Break of Structure (BOS), examine the immediate FIRST THREE CANDLES
        that break through the BOS level.
        Bullish FVG: Candle 1 High < Candle 3 Low (Candle 2 is the displacement candle).
        Bearish FVG: Candle 1 Low > Candle 3 High (Candle 2 is the displacement candle).

        If the first 3 breakout candles do NOT form an FVG gap, the setup is immediately REJECTED.
        No trade can be opened anywhere else.

        SL will be set strictly to Candle 1's extreme (First candle of the FVG pattern, zero buffer):
          Bearish: SL = C1.high
          Bullish: SL = C1.low
        """
        start = max(2, bos_index - 1)
        end   = min(len(df), bos_index + scan_window)

        for i in range(start, end):
            c1 = df.iloc[i - 2]
            c2 = df.iloc[i - 1]   # ← Displacement / zigzag candle
            c3 = df.iloc[i]

            c1_high  = float(c1["high"])
            c1_low   = float(c1["low"])
            c2_open  = float(c2["open"])
            c2_close = float(c2["close"])
            c2_high  = float(c2["high"])
            c2_low   = float(c2["low"])
            c2_body  = abs(c2_close - c2_open)
            c2_range = c2_high - c2_low

            # C2 must have a real body (not a doji) — body ≥ 30% of its range
            if c2_range == 0 or (c2_body / c2_range) < 0.30:
                continue

            if direction == "BEARISH":
                # Gap condition: C1.low > C3.high
                if float(c1["low"]) > float(c3["high"]):
                    # Zigzag: C2 must be a bearish displacement candle
                    if c2_close < c2_open:
                        return {
                            "top":      float(c1["low"]),
                            "bottom":   float(c3["high"]),
                            "midpoint": float((float(c1["low"]) + float(c3["high"])) / 2),
                            "sl_price": c1_high,   # SL = C1 high (First candle high - Rule #8)
                            "c1_high":  c1_high,
                            "c1_low":   c1_low,
                            "c2_high":  c2_high,
                            "c2_low":   c2_low,
                            "index":    i,
                            "type":     "BEARISH",
                        }

            else:  # BULLISH
                # Gap condition: C1.high < C3.low
                if float(c1["high"]) < float(c3["low"]):
                    # Zigzag: C2 must be a bullish displacement candle
                    if c2_close > c2_open:
                        return {
                            "top":      float(c3["low"]),
                            "bottom":   float(c1["high"]),
                            "midpoint": float((float(c3["low"]) + float(c1["high"])) / 2),
                            "sl_price": c1_low,    # SL = C1 low (First candle low - Rule #8)
                            "c1_high":  c1_high,
                            "c1_low":   c1_low,
                            "c2_high":  c2_high,
                            "c2_low":   c2_low,
                            "index":    i,
                            "type":     "BULLISH",
                        }

        return None  # No valid zigzag FVG found → REJECT setup

    # ─── STEP 4b: FVG TOUCH CHECK ────────────────────────────────────────────
    def is_fvg_touched(
        self,
        df: pd.DataFrame,
        fvg: Dict[str, Any],
    ) -> bool:
        """
        Checks if price has ENTERED the FVG zone after the FVG formed.
        A wick touching the zone counts (any candle high/low entering the gap).
        """
        fvg_start = fvg["index"]
        fvg_top   = fvg["top"]
        fvg_bot   = fvg["bottom"]

        for i in range(fvg_start + 1, len(df)):
            candle = df.iloc[i]
            # Price enters the zone if the candle's range overlaps with FVG zone
            if candle["low"] <= fvg_top and candle["high"] >= fvg_bot:
                return True

        return False

    # ─── STEP 5: ENTRY CONFIRMATION ──────────────────────────────────────────
    def find_entry_confirmation(
        self,
        df: pd.DataFrame,
        fvg: Dict[str, Any],
        direction: str,
    ) -> Optional[int]:
        """
        After FVG is touched, wait for a confirmation candle on the 15M chart:

        Bearish confirmation:
          A candle that:
            (a) Enters the FVG zone (low <= fvg.top)
          AND (b) CLOSES back BELOW the FVG zone (close < fvg.bottom)
          OR  (b) Is a bearish engulfing candle inside the FVG zone

        Bullish confirmation:
          A candle that:
            (a) Enters the FVG zone (high >= fvg.bottom)
          AND (b) CLOSES back ABOVE the FVG zone (close > fvg.top)
          OR  (b) Is a bullish engulfing candle inside the FVG zone

        Returns the index of the confirmation candle, or None.
        """
        fvg_start = fvg["index"]
        fvg_top   = fvg["top"]
        fvg_bot   = fvg["bottom"]

        for i in range(fvg_start + 1, len(df)):
            candle = df.iloc[i]
            c_open  = float(candle["open"])
            c_close = float(candle["close"])
            c_high  = float(candle["high"])
            c_low   = float(candle["low"])

            if direction == "BEARISH":
                # Candle entered the FVG zone
                entered = c_low <= fvg_top
                if not entered:
                    continue
                # Confirmation: close below FVG bottom OR bearish engulf
                closed_below = c_close < fvg_bot
                bearish_engulf = c_close < c_open and (c_close < fvg_bot or c_open > fvg_top)
                if closed_below or bearish_engulf:
                    return i

            else:  # BULLISH
                entered = c_high >= fvg_bot
                if not entered:
                    continue
                closed_above = c_close > fvg_top
                bullish_engulf = c_close > c_open and (c_close > fvg_top or c_open < fvg_bot)
                if closed_above or bullish_engulf:
                    return i

        return None

    # ─── LEGACY helper (used by main.py scanner score) ───────────────────────
    def detect_swings_and_bos(self, df_1m: pd.DataFrame) -> pd.DataFrame:
        """Fast BOS labeller used by the scanner score — kept for compatibility."""
        df = df_1m.copy()
        n = self.pivot_length
        df["swing_high"] = np.nan
        df["swing_low"]  = np.nan
        df["bos_type"]   = None

        for i in range(n, len(df) - n):
            wh = df["high"].iloc[i - n: i + n + 1]
            wl = df["low"].iloc[i - n: i + n + 1]
            if df["high"].iloc[i] == wh.max():
                df.iloc[i, df.columns.get_loc("swing_high")] = df["high"].iloc[i]
            if df["low"].iloc[i] == wl.min():
                df.iloc[i, df.columns.get_loc("swing_low")] = df["low"].iloc[i]

        df["last_sh"] = df["swing_high"].ffill()
        df["last_sl"] = df["swing_low"].ffill()

        for i in range(1, len(df)):
            c = df.iloc[i]
            p = df.iloc[i - 1]
            if pd.notna(c["last_sh"]) and c["close"] > c["last_sh"] and p["close"] <= c["last_sh"]:
                df.iloc[i, df.columns.get_loc("bos_type")] = "BULLISH_BOS"
            elif pd.notna(c["last_sl"]) and c["close"] < c["last_sl"] and p["close"] >= c["last_sl"]:
                df.iloc[i, df.columns.get_loc("bos_type")] = "BEARISH_BOS"

        return df

    def detect_fvg(self, df_1m: pd.DataFrame) -> List[Dict[str, Any]]:
        """Quick FVG scanner — kept for compatibility with scanner score."""
        fvgs = []
        for i in range(2, len(df_1m)):
            c1 = df_1m.iloc[i - 2]
            c3 = df_1m.iloc[i]
            if c3["low"] > c1["high"]:
                fvgs.append({"index": i, "type": "BULLISH",
                             "top": float(c3["low"]), "bottom": float(c1["high"]),
                             "midpoint": float((c3["low"] + c1["high"]) / 2)})
            elif c3["high"] < c1["low"]:
                fvgs.append({"index": i, "type": "BEARISH",
                             "top": float(c1["low"]), "bottom": float(c3["high"]),
                             "midpoint": float((c1["low"] + c3["high"]) / 2)})
        return fvgs

    # ─── MASTER PIPELINE: scan_for_setups ─────────────────────────────────────
    def scan_for_setups(
        self,
        symbol: str,
        df_4h: pd.DataFrame,
        df_15m: pd.DataFrame,
    ) -> Optional[Dict[str, Any]]:
        """
        YOUR COMPLETE STRATEGY PIPELINE — Irshad's SMC/ICT Method:

        4H Trend → Inducement → BOS (wick IDM + close BOS anchor)
        → FVG after BOS → FVG Touch → Confirmation candle → Entry

        If ANY step fails → returns None (no trade).
        """
        if df_4h.empty or df_15m.empty or len(df_4h) < 30 or len(df_15m) < 20:
            return None

        df_4h  = df_4h.reset_index(drop=True)
        df_15m = df_15m.reset_index(drop=True)
        atr    = self.calculate_atr(df_15m)

        # ── STEP 1: 15M Trend Bias ───────────────────────────────────────────
        trend = self.determine_macro_trend(df_15m if len(df_15m) >= 30 else df_4h)

        # ── Work on 15M for the tactical pipeline ─────────────────────────────
        swing_highs, swing_lows = self._find_swings(df_15m)

        if not swing_highs or not swing_lows:
            return None

        # ── STEP 2: Inducement ────────────────────────────────────────────────
        inducement = self.find_inducement(df_15m, trend, swing_highs, swing_lows)
        if not inducement:
            return None

        # ── STEP 3: BOS ───────────────────────────────────────────────────────
        bos = self.find_bos(df_15m, trend, inducement, swing_highs, swing_lows)
        if not bos:
            return None

        direction = bos["direction"]  # "BULLISH" or "BEARISH"

        # ── STEP 4: FVG after BOS ─────────────────────────────────────────────
        fvg = self.find_fvg_after_bos(df_15m, bos["bos_index"], direction)
        if not fvg:
            # REJECTION: No FVG → skip
            return None

        # ── STEP 4b: FVG must be TOUCHED ─────────────────────────────────────
        if not self.is_fvg_touched(df_15m, fvg):
            # FVG exists but price hasn't returned to it yet → wait
            return None

        # ── STEP 5: Entry Confirmation candle ────────────────────────────────
        confirm_idx = self.find_entry_confirmation(df_15m, fvg, direction)
        if confirm_idx is None:
            return None

        # ── Sanity: excessive momentum filter ────────────────────────────────
        confirm_candle = df_15m.iloc[confirm_idx]
        body_size = abs(float(confirm_candle["close"]) - float(confirm_candle["open"]))
        if atr > 0 and body_size > 3 * atr:
            return None  # Too fast / news candle — skip

        # ── Build the trade ───────────────────────────────────────────────────
        current_price = float(df_15m["close"].iloc[-1])

        # YOUR RULE #8: SL is set directly to First Candle's extreme (C1 low for Bullish, C1 high for Bearish)
        if direction == "BEARISH":
            entry_price = current_price
            sl          = round(fvg.get("sl_price", fvg.get("c1_high", fvg["c2_high"])), 2)
            risk_dist   = sl - entry_price
            if risk_dist <= 0:
                # If current price is already beyond SL, invalid setup
                return None
            tp_1_2 = round(entry_price - 2.0 * risk_dist, 2)  # 1:2 partial booking

            setup_reason = (
                f"Irshad SMC: 15M Bearish | 15M IDM@{inducement['idm_price']:.2f} (Swept) → "
                f"15M BOS@{bos['anchor_price']:.2f} | 15M FVG [{fvg['bottom']:.2f}–{fvg['top']:.2f}] "
                f"Touched+Confirmed | SL: C1 High @ {sl:.2f}"
            )
        else:  # BULLISH
            entry_price = current_price
            sl          = round(fvg.get("sl_price", fvg.get("c1_low", fvg["c2_low"])), 2)
            risk_dist   = entry_price - sl
            if risk_dist <= 0:
                # If current price is already below SL, invalid setup
                return None
            tp_1_2 = round(entry_price + 2.0 * risk_dist, 2)  # 1:2 partial booking

            setup_reason = (
                f"Irshad SMC: 15M Bullish | 15M IDM@{inducement['idm_price']:.2f} (Swept) → "
                f"15M BOS@{bos['anchor_price']:.2f} | 15M FVG [{fvg['bottom']:.2f}–{fvg['top']:.2f}] "
                f"Touched+Confirmed | SL: C1 Low @ {sl:.2f}"
            )

        return {
            "symbol":           symbol,
            "direction":        direction,
            "setup_reason":     setup_reason,
            "entry_price":      entry_price,
            "stop_loss":        sl,
            "take_profit":      tp_1_2,
            "partial_tp_1_2":   tp_1_2,
            "exit_condition":   "Partial book at 1:2 RR, full exit on opposite BOS",
            "risk_distance":    risk_dist,
            "reward_risk_ratio": "1:2",
            "macro_trend":      trend,
            "fvg_zone":         fvg,
            "c2_candle":        {"high": fvg.get("c2_high"), "low": fvg.get("c2_low")},
            "bos_level":        bos["anchor_price"],
            "idm_level":        inducement["idm_price"],
            "confirm_candle":   confirm_idx,
            "atr":              round(atr, 4),
            "risk_percentage":  0.5,
        }
