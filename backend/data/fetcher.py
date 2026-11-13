from __future__ import annotations

import os
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import ccxt
import pandas as pd
import yfinance as yf
from loguru import logger


TIMEFRAME_MINUTES: Dict[str, int] = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
}

CANONICAL_SYMBOL_ALIASES: Dict[str, str] = {
    "XAUUSD": "XAUUSD",
    "GOLD": "XAUUSD",
    "PAXG": "XAUUSD",
    "PAXGUSDT": "XAUUSD",
    "PAXG/USDT": "XAUUSD",
    "BTCUSD": "BTCUSD",
    "BTC": "BTCUSD",
    "BTCUSDT": "BTCUSD",
    "BTC/USDT": "BTCUSD",
    "ETHUSD": "ETHUSD",
    "ETH": "ETHUSD",
    "ETHUSDT": "ETHUSD",
    "ETH/USDT": "ETHUSD",
}

BINANCE_PAIR_MAP: Dict[str, str] = {
    "XAUUSD": "PAXG/USDT",
    "BTCUSD": "BTC/USDT",
    "ETHUSD": "ETH/USDT",
}


class MarketDataProvider(ABC):
    """Modular live market data provider interface (Binance Demo now, MT5 Bridge pluggable)."""

    name: str = "BASE"

    @abstractmethod
    def connect(self) -> bool:
        ...

    @abstractmethod
    def fetch_ohlcv(self, canonical_symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        ...

    @abstractmethod
    def fetch_ticker(self, canonical_symbol: str) -> Dict[str, Any]:
        ...

    @abstractmethod
    def health_status(self) -> Dict[str, Any]:
        ...


class BinanceLiveProvider(MarketDataProvider):
    """
    Real-time market data feed via Binance Demo CCXT (Public + Demo API).
    Tracks connection health, latency, heartbeat, and automatic reconnection.
    """

    name: str = "BINANCE_DEMO"

    def __init__(self) -> None:
        self.api_key = os.getenv("BINANCE_API_KEY", "").strip()
        self.api_secret = os.getenv("BINANCE_SECRET_KEY", "").strip()
        self.exchange: Optional[ccxt.binance] = None
        self.connected: bool = False
        self.reconnect_count: int = 0
        self.consecutive_failures: int = 0
        self.last_heartbeat: Optional[str] = None
        self.last_error: Optional[str] = None
        self.last_latency_ms: Optional[float] = None
        self.connect()

    def connect(self) -> bool:
        try:
            cfg: Dict[str, Any] = {
                "enableRateLimit": True,
                "timeout": 10000,
            }
            if self.api_key and self.api_secret:
                cfg["apiKey"] = self.api_key
                cfg["secret"] = self.api_secret

            ex = ccxt.binance(cfg)
            ex.enable_demo_trading(True)
            self.exchange = ex
            self.connected = True
            self.consecutive_failures = 0
            self.last_error = None
            self.last_heartbeat = datetime.now(timezone.utc).isoformat()
            return True
        except Exception as e:
            self.connected = False
            self.last_error = str(e)
            logger.error(f"[{self.name}] Connection error: {e}")
            return False

    def reconnect(self) -> bool:
        self.reconnect_count += 1
        logger.warning(f"[{self.name}] Attempting automatic reconnect (#{self.reconnect_count})...")
        return self.connect()

    @staticmethod
    def map_symbol(canonical_symbol: str) -> str:
        norm = DataFetcher.normalize_canonical_symbol(canonical_symbol)
        if norm in BINANCE_PAIR_MAP:
            return BINANCE_PAIR_MAP[norm]
        s = norm.replace("/", "").replace("-", "")
        if s.endswith("USDT"):
            return f"{s[:-4]}/USDT"
        return f"{s}/USDT"

    def fetch_ohlcv(self, canonical_symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        pair = self.map_symbol(canonical_symbol)
        last_exc: Optional[Exception] = None

        for attempt in range(2):
            if self.exchange is None:
                self.reconnect()
            try:
                t0 = time.perf_counter()
                ohlcv = self.exchange.fetch_ohlcv(pair, timeframe=timeframe, limit=limit)
                self.last_latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                self.connected = True
                self.consecutive_failures = 0
                self.last_error = None
                self.last_heartbeat = datetime.now(timezone.utc).isoformat()

                if not ohlcv:
                    return pd.DataFrame()
                df = pd.DataFrame(
                    ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"]
                )
                df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
                return df
            except Exception as e:
                last_exc = e
                self.consecutive_failures += 1
                self.last_error = str(e)
                self.connected = False
                logger.warning(
                    f"[{self.name}] fetch_ohlcv({pair}, {timeframe}) attempt {attempt + 1} failed: {e}"
                )
                if attempt == 0:
                    self.reconnect()

        raise RuntimeError(f"[{self.name}] Failed OHLCV for {pair}: {last_exc}")

    def fetch_ticker(self, canonical_symbol: str) -> Dict[str, Any]:
        pair = self.map_symbol(canonical_symbol)
        last_exc: Optional[Exception] = None

        for attempt in range(2):
            if self.exchange is None:
                self.reconnect()
            try:
                t0 = time.perf_counter()
                ticker = self.exchange.fetch_ticker(pair)
                self.last_latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                self.connected = True
                self.consecutive_failures = 0
                self.last_error = None
                self.last_heartbeat = datetime.now(timezone.utc).isoformat()

                bid = ticker.get("bid")
                ask = ticker.get("ask")
                last = ticker.get("last")
                if bid is None:
                    bid = last
                if ask is None:
                    ask = last
                if last is None:
                    last = bid or ask
                bid_f = float(bid) if bid is not None else 0.0
                ask_f = float(ask) if ask is not None else 0.0
                last_f = float(last) if last is not None else 0.0
                spread = max(0.0, ask_f - bid_f)
                mid = (bid_f + ask_f) / 2.0 if (bid_f and ask_f) else last_f
                spread_pct = (spread / mid * 100.0) if mid > 0 else 0.0

                return {
                    "symbol": DataFetcher.normalize_canonical_symbol(canonical_symbol),
                    "provider_symbol": pair,
                    "bid": bid_f,
                    "ask": ask_f,
                    "last": last_f,
                    "spread": round(spread, 6),
                    "spread_pct": round(spread_pct, 5),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "source": self.name,
                    "connected": True,
                }
            except Exception as e:
                last_exc = e
                self.consecutive_failures += 1
                self.last_error = str(e)
                self.connected = False
                if attempt == 0:
                    self.reconnect()

        return {
            "symbol": DataFetcher.normalize_canonical_symbol(canonical_symbol),
            "provider_symbol": pair,
            "bid": 0.0,
            "ask": 0.0,
            "last": 0.0,
            "spread": 0.0,
            "spread_pct": 0.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": self.name,
            "connected": False,
            "error": str(last_exc),
        }

    def health_status(self) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "connected": self.connected,
            "mode": "DEMO_PUBLIC" if not self.api_key else "DEMO_AUTHENTICATED",
            "reconnect_count": self.reconnect_count,
            "consecutive_failures": self.consecutive_failures,
            "last_heartbeat": self.last_heartbeat,
            "last_latency_ms": self.last_latency_ms,
            "last_error": self.last_error,
            "mt5_bridge_status": "STANDBY_MACOS_UNSUPPORTED",
        }


class MT5BridgeProvider(MarketDataProvider):
    """
    Future MetaTrader 5 Bridge interface (for Windows / ZeroMQ / HTTP EA bridge).
    Currently inactive on macOS since native MetaTrader5 Python package is Windows-only.
    """

    name: str = "MT5_BRIDGE"

    def __init__(self, bridge_url: Optional[str] = None) -> None:
        self.bridge_url = bridge_url or os.getenv("MT5_BRIDGE_URL", "").strip()
        self.connected = False

    def connect(self) -> bool:
        self.connected = False
        return False

    def fetch_ohlcv(self, canonical_symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        raise NotImplementedError("MT5 Bridge is not configured on this macOS host.")

    def fetch_ticker(self, canonical_symbol: str) -> Dict[str, Any]:
        raise NotImplementedError("MT5 Bridge is not configured on this macOS host.")

    def health_status(self) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "connected": False,
            "bridge_url": self.bridge_url or None,
            "reason": "Native MetaTrader5 Python package requires Windows; Binance Demo provider active.",
        }


class DataFetcher:
    """
    Unified, validated live & historical market data service.
    Handles symbol normalization, strict closed-candle enforcement, OHLC integrity checks,
    duplicate & gap detection, newly-closed candle edge detection, and live bid/ask/spread ticks.
    """

    def __init__(self, provider: Optional[MarketDataProvider] = None) -> None:
        self.provider: MarketDataProvider = provider or BinanceLiveProvider()
        self.last_closed_bar_seen: Dict[Tuple[str, str], str] = {}
        self.last_gap_reports: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self.last_tickers: Dict[str, Dict[str, Any]] = {}

    @staticmethod
    def normalize_canonical_symbol(symbol: str) -> str:
        s = (symbol or "").upper().strip()
        if s in CANONICAL_SYMBOL_ALIASES:
            return CANONICAL_SYMBOL_ALIASES[s]
        clean = s.replace("/", "").replace("-", "")
        return CANONICAL_SYMBOL_ALIASES.get(clean, s)

    @staticmethod
    def _normalize_crypto_symbol(symbol: str) -> str:
        return BinanceLiveProvider.map_symbol(symbol)

    @staticmethod
    def _filter_closed_candles(
        df: pd.DataFrame,
        timeframe: str,
        now_utc: Optional[pd.Timestamp] = None,
    ) -> pd.DataFrame:
        """
        Drops any currently forming (incomplete) candle using exact close time:
        candle_close_time = timestamp + timeframe_minutes <= now_utc.
        """
        if df.empty:
            return df
        tf_min = TIMEFRAME_MINUTES.get(timeframe, 15)
        now = now_utc or pd.Timestamp.now(tz="UTC")
        if now.tzinfo is None:
            now = now.tz_localize("UTC")
        out = df.copy()
        out["timestamp"] = pd.to_datetime(out["timestamp"], utc=True)
        close_times = out["timestamp"] + pd.Timedelta(minutes=tf_min)
        closed_df = out.loc[close_times <= now].reset_index(drop=True)
        return closed_df

    @staticmethod
    def validate_ohlcv(df: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
        """
        Validates OHLCV integrity:
          - drops NaN or non-positive OHLC rows
          - drops malformed candles where high < max(open, close) or low > min(open, close) or high < low
          - deduplicates timestamps and sorts ascending
        Returns `(clean_df, rejected_row_count)`.
        """
        if df is None or df.empty:
            return pd.DataFrame(), 0

        out = df.copy()
        initial_len = len(out)
        out["timestamp"] = pd.to_datetime(out["timestamp"], utc=True, errors="coerce")
        for col in ("open", "high", "low", "close"):
            out[col] = pd.to_numeric(out[col], errors="coerce")
        if "volume" not in out.columns:
            out["volume"] = 0.0
        else:
            out["volume"] = pd.to_numeric(out["volume"], errors="coerce").fillna(0.0)

        out = out.dropna(subset=["timestamp", "open", "high", "low", "close"])
        valid_mask = (
            (out["open"] > 0)
            & (out["high"] > 0)
            & (out["low"] > 0)
            & (out["close"] > 0)
            & (out["high"] >= out["low"])
            & (out["high"] >= out[["open", "close"]].max(axis=1) - 1e-9)
            & (out["low"] <= out[["open", "close"]].min(axis=1) + 1e-9)
        )
        out = out.loc[valid_mask]
        out = (
            out.sort_values("timestamp")
            .drop_duplicates(subset=["timestamp"], keep="last")
            .reset_index(drop=True)
        )
        rejected = max(0, initial_len - len(out))
        return out, rejected

    @staticmethod
    def detect_missing_candles(df: pd.DataFrame, timeframe: str) -> Dict[str, Any]:
        """Detects time gaps greater than expected timeframe step."""
        tf_min = TIMEFRAME_MINUTES.get(timeframe, 15)
        if df is None or len(df) < 2:
            return {"timeframe": timeframe, "missing_bars": 0, "gaps": []}

        ts = pd.to_datetime(df["timestamp"], utc=True).sort_values().reset_index(drop=True)
        diffs_min = ts.diff().dt.total_seconds().div(60.0).fillna(tf_min)
        gap_mask = diffs_min > (tf_min * 1.1)
        gaps: List[Dict[str, Any]] = []
        missing_total = 0

        for idx in diffs_min.index[gap_mask]:
            delta_m = float(diffs_min.iloc[idx])
            missed = max(0, int(round(delta_m / tf_min)) - 1)
            missing_total += missed
            gaps.append(
                {
                    "prev_ts": ts.iloc[idx - 1].isoformat(),
                    "next_ts": ts.iloc[idx].isoformat(),
                    "missing_bars": missed,
                }
            )

        return {
            "timeframe": timeframe,
            "missing_bars": missing_total,
            "gaps": gaps[-5:],  # Keep latest 5 gap records
        }

    def is_new_closed_bar(self, symbol: str, timeframe: str, df_closed: pd.DataFrame) -> bool:
        """Returns True iff df_closed ends with a strictly newer closed bar than previously seen."""
        if df_closed is None or df_closed.empty:
            return False
        norm = self.normalize_canonical_symbol(symbol)
        latest_ts = pd.to_datetime(df_closed.iloc[-1]["timestamp"], utc=True).isoformat()
        key = (norm, timeframe)
        prev = self.last_closed_bar_seen.get(key)
        if prev != latest_ts:
            self.last_closed_bar_seen[key] = latest_ts
            return True
        return False

    def get_market_data(
        self,
        symbol: str,
        timeframe: str = "15m",
        limit: int = 100,
        closed_only: bool = False,
    ) -> pd.DataFrame:
        norm = self.normalize_canonical_symbol(symbol)
        fetch_limit = limit + 2 if closed_only else limit
        df = pd.DataFrame()

        try:
            df = self.provider.fetch_ohlcv(norm, timeframe=timeframe, limit=fetch_limit)
        except Exception as e:
            logger.warning(f"[DataFetcher] Primary provider failed for {norm} {timeframe}: {e}")
            df = self._fetch_yfinance_fallback(norm, timeframe=timeframe, limit=fetch_limit)

        if df is None or df.empty:
            return pd.DataFrame()

        df, rejected = self.validate_ohlcv(df)
        if rejected > 0:
            logger.warning(f"[DataFetcher] Dropped {rejected} invalid/duplicate bars for {norm} {timeframe}")

        if closed_only:
            df = self._filter_closed_candles(df, timeframe)

        if len(df) > limit:
            df = df.iloc[-limit:].reset_index(drop=True)

        gap_report = self.detect_missing_candles(df, timeframe)
        self.last_gap_reports[(norm, timeframe)] = gap_report
        if gap_report["missing_bars"] > 0:
            logger.debug(
                f"[DataFetcher] Detected {gap_report['missing_bars']} gap bar(s) in {norm} {timeframe}"
            )

        return df

    def _fetch_yfinance_fallback(
        self, canonical_symbol: str, timeframe: str, limit: int
    ) -> pd.DataFrame:
        yf_map = {
            "XAUUSD": "GC=F",
            "BTCUSD": "BTC-USD",
            "ETHUSD": "ETH-USD",
        }
        ticker = yf_map.get(canonical_symbol, canonical_symbol)
        try:
            period_map = {"1m": "5d", "5m": "1mo", "15m": "1mo", "1h": "3mo", "4h": "6mo"}
            yf_tf = "1h" if timeframe == "4h" else timeframe
            raw = yf.download(
                ticker,
                period=period_map.get(timeframe, "1mo"),
                interval=yf_tf,
                progress=False,
            )
            if raw is None or raw.empty:
                return pd.DataFrame()
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = [str(c[0]).lower() for c in raw.columns]
            else:
                raw.columns = [str(c).lower() for c in raw.columns]
            raw = raw.reset_index()
            ts_col = "datetime" if "datetime" in raw.columns else ("date" if "date" in raw.columns else raw.columns[0])
            raw = raw.rename(columns={ts_col: "timestamp"})
            raw["timestamp"] = pd.to_datetime(raw["timestamp"], utc=True)
            if timeframe == "4h":
                raw = (
                    raw.set_index("timestamp")
                    .resample("4h")
                    .agg(
                        {
                            "open": "first",
                            "high": "max",
                            "low": "min",
                            "close": "last",
                            "volume": "sum",
                        }
                    )
                    .dropna()
                    .reset_index()
                )
            return raw[["timestamp", "open", "high", "low", "close", "volume"]].tail(limit)
        except Exception as e:
            logger.error(f"[DataFetcher] yfinance fallback failed for {canonical_symbol}: {e}")
            return pd.DataFrame()

    def get_live_ticker(self, symbol: str) -> Dict[str, Any]:
        norm = self.normalize_canonical_symbol(symbol)
        ticker = self.provider.fetch_ticker(norm)
        self.last_tickers[norm] = ticker
        return ticker

    def get_connection_status(self) -> Dict[str, Any]:
        base = self.provider.health_status()
        base["gap_reports"] = {
            f"{sym}_{tf}": rep
            for (sym, tf), rep in self.last_gap_reports.items()
            if rep.get("missing_bars", 0) > 0
        }
        base["last_tickers"] = self.last_tickers
        return base
