import os
from dotenv import load_dotenv

load_dotenv()

BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_SECRET_KEY = os.getenv("BINANCE_SECRET_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

SCAN_INTERVAL_SECONDS = int(os.getenv("SCAN_INTERVAL_SECONDS", 10))
RISK_PERCENT = float(os.getenv("RISK_PERCENT", 0.5))
MAX_DAILY_TRADES = int(os.getenv("MAX_DAILY_TRADES", 20))
MAX_DAILY_LOSS_PERCENT = float(os.getenv("MAX_DAILY_LOSS_PERCENT", 5.0))
MAX_CONCURRENT_POSITIONS = int(os.getenv("MAX_CONCURRENT_POSITIONS", 3))
CONFIDENCE_THRESHOLD = int(os.getenv("CONFIDENCE_THRESHOLD", 70))

# Safety Lock: Real-time live market analysis & paper trading ONLY.
# Real order execution on MT5 or Binance remains strictly disabled unless explicitly enabled by user.
PAPER_TRADING_ONLY = os.getenv("PAPER_TRADING_ONLY", "true").lower() in ("1", "true", "yes")

# Monitored canonical symbols & provider mapping (Binance Demo pairs)
SYMBOLS = ["XAUUSD", "BTCUSD", "ETHUSD"]
SYMBOL_PROVIDER_MAP = {
    "XAUUSD": "PAXG/USDT",
    "BTCUSD": "BTC/USDT",
    "ETHUSD": "ETH/USDT",
}

# Strategy Analysis & Execution Timeframes
# User-Configured Testing Resolution: 30M Macro Trend Analysis, 1M Trade Execution
HTF_TIMEFRAME = os.getenv("HTF_TIMEFRAME", "30m")
LTF_TIMEFRAME = os.getenv("LTF_TIMEFRAME", "1m")

CONTEXT_HTF_LIMIT = int(os.getenv("CONTEXT_HTF_LIMIT", 200))
CONTEXT_LTF_LIMIT = int(os.getenv("CONTEXT_LTF_LIMIT", 500))

# Backward compatibility aliases
CONTEXT_4H_LIMIT = CONTEXT_HTF_LIMIT
CONTEXT_15M_LIMIT = CONTEXT_LTF_LIMIT
