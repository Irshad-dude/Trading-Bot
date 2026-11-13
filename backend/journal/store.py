from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "trading_journal.db",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JournalStore:
    """
    SQLite-backed durable state store for:
      - Structured StrategySignals (detected, rejected, triggered)
      - Active & Closed PaperTrades (entry/SL/TP, live price, unrealized PnL, MFE, MAE, exit)
      - Incremental Strategy Coordinator state (ChainState & last closed bar timestamps)
      - Reliability/Lifecycle Events (disconnects, gaps, errors, signal suppressions)
    Survives backend restarts safely.
    """

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL;")
            self._conn.execute("PRAGMA synchronous=NORMAL;")
            self._init_schema()

    def _init_schema(self) -> None:
        cur = self._conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS signals (
                signal_id TEXT PRIMARY KEY,
                strategy_name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                market_trend TEXT,
                direction TEXT NOT NULL,
                action_label TEXT NOT NULL,
                idm_level REAL,
                bos_level REAL,
                bos_confirmed INTEGER DEFAULT 0,
                fvg_top REAL,
                fvg_bottom REAL,
                entry_price REAL DEFAULT 0.0,
                stop_loss REAL DEFAULT 0.0,
                take_profit REAL DEFAULT 0.0,
                risk_reward_ratio REAL DEFAULT 2.0,
                signal_timestamp TEXT NOT NULL,
                setup_status TEXT NOT NULL,
                reasoning TEXT,
                rejection_reason TEXT,
                spread_at_signal REAL DEFAULT 0.0,
                ai_decision TEXT,
                ai_confidence INTEGER,
                ai_reasoning TEXT,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(signal_timestamp DESC)"
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS paper_trades (
                trade_id TEXT PRIMARY KEY,
                signal_id TEXT UNIQUE NOT NULL,
                strategy_name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                direction TEXT NOT NULL,
                action_label TEXT NOT NULL,
                entry_price REAL NOT NULL,
                stop_loss REAL NOT NULL,
                take_profit REAL NOT NULL,
                risk_amount REAL DEFAULT 50.0,
                position_size REAL DEFAULT 0.0,
                current_price REAL DEFAULT 0.0,
                unrealized_pnl REAL DEFAULT 0.0,
                realized_pnl REAL DEFAULT 0.0,
                mfe REAL DEFAULT 0.0,
                mae REAL DEFAULT 0.0,
                max_favorable_price REAL DEFAULT 0.0,
                max_adverse_price REAL DEFAULT 0.0,
                status TEXT NOT NULL,
                exit_condition TEXT,
                exit_price REAL,
                final_result TEXT,
                reasoning TEXT,
                payload_json TEXT NOT NULL,
                opened_at TEXT NOT NULL,
                closed_at TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_trades_status ON paper_trades(status, opened_at DESC)"
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS strategy_state (
                state_key TEXT PRIMARY KEY,
                state_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS bot_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                symbol TEXT,
                message TEXT NOT NULL,
                payload_json TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ── Signals ──────────────────────────────────────────────────────────
    def has_signal(self, signal_id: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM signals WHERE signal_id = ?", (signal_id,)
            ).fetchone()
            return row is not None

    def save_signal(self, sig: Dict[str, Any]) -> bool:
        """Inserts a signal if `signal_id` does not already exist. Returns True if inserted."""
        with self._lock:
            if self.has_signal(sig["signal_id"]):
                return False
            self._conn.execute(
                """
                INSERT INTO signals (
                    signal_id, strategy_name, symbol, timeframe, market_trend,
                    direction, action_label, idm_level, bos_level, bos_confirmed,
                    fvg_top, fvg_bottom, entry_price, stop_loss, take_profit,
                    risk_reward_ratio, signal_timestamp, setup_status, reasoning,
                    rejection_reason, spread_at_signal, ai_decision, ai_confidence,
                    ai_reasoning, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sig["signal_id"],
                    sig["strategy_name"],
                    sig["symbol"],
                    sig["timeframe"],
                    sig.get("market_trend"),
                    sig["direction"],
                    sig["action_label"],
                    sig.get("idm_level"),
                    sig.get("bos_level"),
                    1 if sig.get("bos_confirmed") else 0,
                    sig.get("fvg_top"),
                    sig.get("fvg_bottom"),
                    float(sig.get("entry_price") or 0.0),
                    float(sig.get("stop_loss") or 0.0),
                    float(sig.get("take_profit") or 0.0),
                    float(sig.get("risk_reward_ratio") or 2.0),
                    sig["signal_timestamp"],
                    sig["setup_status"],
                    sig.get("reasoning", ""),
                    sig.get("rejection_reason"),
                    float(sig.get("spread_at_signal") or 0.0),
                    sig.get("ai_decision"),
                    sig.get("ai_confidence"),
                    sig.get("ai_reasoning"),
                    json.dumps(sig, default=str),
                    _utc_now(),
                ),
            )
            self._conn.commit()
            return True

    def list_signals(self, limit: int = 50, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._lock:
            if symbol:
                rows = self._conn.execute(
                    "SELECT payload_json FROM signals WHERE symbol = ? ORDER BY signal_timestamp DESC, created_at DESC LIMIT ?",
                    (symbol.upper(), limit),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT payload_json FROM signals ORDER BY signal_timestamp DESC, created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            return [json.loads(r["payload_json"]) for r in rows]

    # ── Paper Trades ─────────────────────────────────────────────────────
    def upsert_paper_trade(self, trade: Dict[str, Any]) -> None:
        with self._lock:
            now = _utc_now()
            self._conn.execute(
                """
                INSERT INTO paper_trades (
                    trade_id, signal_id, strategy_name, symbol, timeframe,
                    direction, action_label, entry_price, stop_loss, take_profit,
                    risk_amount, position_size, current_price, unrealized_pnl,
                    realized_pnl, mfe, mae, max_favorable_price, max_adverse_price,
                    status, exit_condition, exit_price, final_result, reasoning,
                    payload_json, opened_at, closed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(trade_id) DO UPDATE SET
                    current_price = excluded.current_price,
                    unrealized_pnl = excluded.unrealized_pnl,
                    realized_pnl = excluded.realized_pnl,
                    mfe = excluded.mfe,
                    mae = excluded.mae,
                    max_favorable_price = excluded.max_favorable_price,
                    max_adverse_price = excluded.max_adverse_price,
                    status = excluded.status,
                    exit_condition = excluded.exit_condition,
                    exit_price = excluded.exit_price,
                    final_result = excluded.final_result,
                    payload_json = excluded.payload_json,
                    closed_at = excluded.closed_at,
                    updated_at = excluded.updated_at
                """,
                (
                    trade["trade_id"],
                    trade["signal_id"],
                    trade["strategy_name"],
                    trade["symbol"],
                    trade["timeframe"],
                    trade["direction"],
                    trade["action_label"],
                    float(trade["entry_price"]),
                    float(trade["stop_loss"]),
                    float(trade["take_profit"]),
                    float(trade.get("risk_amount", 50.0)),
                    float(trade.get("position_size", 0.0)),
                    float(trade.get("current_price", trade["entry_price"])),
                    float(trade.get("unrealized_pnl", 0.0)),
                    float(trade.get("realized_pnl", 0.0)),
                    float(trade.get("mfe", 0.0)),
                    float(trade.get("mae", 0.0)),
                    float(trade.get("max_favorable_price", trade["entry_price"])),
                    float(trade.get("max_adverse_price", trade["entry_price"])),
                    trade["status"],
                    trade.get("exit_condition"),
                    trade.get("exit_price"),
                    trade.get("final_result"),
                    trade.get("reasoning", ""),
                    json.dumps(trade, default=str),
                    trade["opened_at"],
                    trade.get("closed_at"),
                    now,
                ),
            )
            self._conn.commit()

    def get_open_paper_trades(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload_json FROM paper_trades WHERE status = 'OPEN' ORDER BY opened_at DESC"
            ).fetchall()
            return [json.loads(r["payload_json"]) for r in rows]

    def get_closed_paper_trades(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload_json FROM paper_trades WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [json.loads(r["payload_json"]) for r in rows]

    def has_trade_for_signal(self, signal_id: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM paper_trades WHERE signal_id = ?", (signal_id,)
            ).fetchone()
            return row is not None

    # ── Coordinator / Account State ──────────────────────────────────────
    def save_state(self, state_key: str, data: Dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO strategy_state (state_key, state_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at
                """,
                (state_key, json.dumps(data, default=str), _utc_now()),
            )
            self._conn.commit()

    def load_state(self, state_key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT state_json FROM strategy_state WHERE state_key = ?", (state_key,)
            ).fetchone()
            if not row:
                return None
            return json.loads(row["state_json"])

    # ── Events ───────────────────────────────────────────────────────────
    def log_event(
        self,
        event_type: str,
        message: str,
        symbol: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO bot_events (event_type, symbol, message, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    event_type,
                    symbol,
                    message,
                    json.dumps(payload or {}, default=str),
                    _utc_now(),
                ),
            )
            self._conn.commit()
