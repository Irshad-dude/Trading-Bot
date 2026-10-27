from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
from datetime import datetime


@dataclass
class TradeRecord:
    id: str
    symbol: str
    direction: str        # LONG or SHORT / BUY or SELL
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_percent: float
    setup: str
    ai_reasoning: str
    ai_confidence: int
    status: str           # PENDING, EXECUTED, FAILED
    timestamp: str
    pnl: Optional[float] = None
    amount: Optional[float] = None
    cost: Optional[float] = None
    order_id: Optional[str] = None


@dataclass
class ScanResult:
    symbol: str
    trend: str            # BULLISH, BEARISH, NEUTRAL
    sweep_detected: bool
    fvg_type: Optional[str]
    setup_score: int      # 0-100
    status: str           # WATCHING, SCANNING, IDLE
    last_price: float
    timestamp: str


@dataclass
class BotState:
    is_running: bool = False
    scan_interval: int = 10          # matches config.SCAN_INTERVAL_SECONDS
    risk_percent: float = 0.5        # matches config.RISK_PERCENT
    daily_trades_count: int = 0
    daily_pnl: float = 0.0
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    last_scan_at: Optional[str] = None
    engine_log: List[str] = field(default_factory=list)
    trade_history: List[TradeRecord] = field(default_factory=list)
    scanner_results: List[ScanResult] = field(default_factory=list)
    open_positions: List[Dict[str, Any]] = field(default_factory=list)

    def add_log(self, message: str):
        ts = datetime.utcnow().strftime("%H:%M:%S")
        entry = f"[{ts}] {message}"
        self.engine_log.insert(0, entry)
        if len(self.engine_log) > 50:
            self.engine_log = self.engine_log[:50]


# Global singleton shared across the entire backend
bot = BotState()
