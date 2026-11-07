import ccxt
import yfinance as yf
import pandas as pd
from loguru import logger
from typing import Optional


class DataFetcher:
    """
    High-performance real-time market data fetcher:
    - Primary: Binance Demo API (Direct CCXT) for real-time 1m & 15m crypto candles (Zero rate limits)
    - Fallback: yfinance for forex/stocks
    """

    def __init__(self):
        try:
            self.exchange = ccxt.binance({
                "enableRateLimit": True,
                "options": {"defaultType": "spot"}
            })
            self.exchange.enable_demo_trading(True)
        except Exception as e:
            logger.warning(f"[DATA] CCXT Binance init failed: {e}")
            self.exchange = None

    def _filter_closed_candles(
        self, df: pd.DataFrame, timeframe: str
    ) -> pd.DataFrame:
        """Keep only candles whose full timeframe has elapsed."""
        if df.empty:
            return df

        duration = pd.Timedelta(timeframe)
        now_utc = pd.Timestamp.now(tz="UTC")

        candle_times = pd.DatetimeIndex(df.index)
        if candle_times.tz is None:
            candle_times = candle_times.tz_localize("UTC")
        else:
            candle_times = candle_times.tz_convert("UTC")

        return df.loc[candle_times + duration <= now_utc]

    def _normalize_crypto_symbol(self, symbol: str) -> str:
        s = symbol.upper().replace("/", "").replace("-", "")
        if s.endswith("USDT"):
            return f"{s[:-4]}/USDT"
        if s.endswith("USDC"):
            return f"{s[:-4]}/USDC"
        return f"{s}/USDT"

    def get_market_data(
        self,
        symbol: str,
        timeframe: str = "1m",
        limit: int = 100,
        closed_only: bool = False,
    ) -> pd.DataFrame:
        """
        Fetches OHLCV candles (1m, 15m, etc.)
        """
        # 1. Primary: Binance Direct via CCXT (fast, real-time, no daily limits)
        if self.exchange and ("BTC" in symbol.upper() or "ETH" in symbol.upper() or "SOL" in symbol.upper()):
            try:
                unified = self._normalize_crypto_symbol(symbol)
                # Map timeframe if needed
                tf_map = {"1m": "1m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d"}
                tf = tf_map.get(timeframe, timeframe)
                ohlcv = self.exchange.fetch_ohlcv(unified, timeframe=tf, limit=limit)
                if ohlcv and len(ohlcv) > 0:
                    df = pd.DataFrame(ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
                    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
                    df = df.set_index("timestamp")
                    df = df.rename(columns={"volume": "tick_volume"})
                    df = df.dropna()
                    if closed_only:
                        df = self._filter_closed_candles(df, timeframe)
                    return df
            except Exception as e:
                logger.debug(f"[DATA] CCXT fetch error for {symbol} {timeframe}: {e}, falling back to yfinance")

        # 2. Fallback: yfinance
        try:
            symbol_map = {
                "BTCUSDT": "BTC-USD",
                "ETHUSDT": "ETH-USD",
                "SOLUSDT": "SOL-USD",
                "EURUSD": "EURUSD=X",
                "GBPUSD": "GBPUSD=X",
            }
            ticker = symbol_map.get(symbol, symbol)
            period_map = {"1m": "5d", "5m": "10d", "15m": "30d", "30m": "60d", "1h": "60d", "4h": "60d", "1d": "2y"}
            interval_map = {"4h": "1h", "30m": "30m", "15m": "15m", "1m": "1m"}
            period = period_map.get(timeframe, "30d")
            interval = interval_map.get(timeframe, timeframe)

            df = yf.download(ticker, period=period, interval=interval, progress=False, auto_adjust=True)
            if df.empty:
                return pd.DataFrame()

            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)

            df.columns = [c.lower() for c in df.columns]
            df = df.rename(columns={"volume": "tick_volume"})
            df = df.dropna().tail(limit)
            if closed_only:
                df = self._filter_closed_candles(df, timeframe)
            return df
        except Exception as e:
            logger.error(f"[DATA] yfinance fetch error {symbol} {timeframe}: {e}")
            return pd.DataFrame()
