from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.config import PAPER_TRADING_ONLY, RISK_PERCENT, SCAN_INTERVAL_SECONDS


@dataclass
class TradeRecord:
    id: str
    symbol: str
    direction: str
    entry_price: float
    stop_loss: float
    take_profit: float
    setup: str
    ai_confidence: int
    status: str  # OPEN | CLOSED | CANCELLED | EXECUTED
    timestamp: str
    amount: Optional[float] = 0.0
    cost: Optional[float] = 0.0
    order_id: Optional[str] = None
    pnl: Optional[float] = None
    risk_percent: Optional[float] = 0.5
    ai_reasoning: Optional[str] = ""


@dataclass
class ScanResult:
    symbol: str
    trend: str
    sweep_detected: bool
    fvg_type: Optional[str]
    setup_score: int
    status: str  # WATCHING | SIGNAL | EXECUTED | IDLE
    last_price: float
    bid: float = 0.0
    ask: float = 0.0
    spread: float = 0.0
    strategy_monitor: Optional[Dict[str, Any]] = None
    chain_monitor: Optional[Dict[str, Any]] = None


class BotState:
    def __init__(self) -> None:
        self.is_running: bool = False
        self.paper_trading_only: bool = PAPER_TRADING_ONLY
        self.scan_interval: int = SCAN_INTERVAL_SECONDS
        self.risk_percent: float = RISK_PERCENT
        self.daily_trades_count: int = 0
        self.daily_realized_pnl: float = 0.0
        self.total_trades: int = 0
        self.wins: int = 0
        self.losses: int = 0
        self.last_scan_at: Optional[str] = None
        self.engine_log: List[str] = []
        self.scanner_results: List[ScanResult] = []
        self.trade_history: List[TradeRecord] = []
        self.open_orders: List[Dict[str, Any]] = []
        self.open_positions: List[Dict[str, Any]] = []
        self.live_tickers: Dict[str, Dict[str, Any]] = {}
        self.connection_status: Dict[str, Any] = {}
        self.last_error: Optional[str] = None
        self.last_graph_rag_candidate: Optional[Dict[str, Any]] = None
        self.last_candidate_graph_rag: Optional[Dict[str, Any]] = None

    def log(self, msg: str) -> None:
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self.engine_log.insert(0, f"[{ts}] {msg}")
        if len(self.engine_log) > 150:
            self.engine_log.pop()

    def add_log(self, msg: str) -> None:
        self.log(msg)


bot = BotState()
