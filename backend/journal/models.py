from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, JSON
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func
import datetime

Base = declarative_base()

class TradeJournal(Base):
    __tablename__ = "trade_journal"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True)
    direction = Column(String)  # 'LONG' or 'SHORT'
    entry_time = Column(DateTime(timezone=True), default=func.now())
    exit_time = Column(DateTime(timezone=True), nullable=True)
    
    entry_price = Column(Float)
    exit_price = Column(Float, nullable=True)
    stop_loss = Column(Float)
    take_profit = Column(Float)
    
    risk_percentage = Column(Float)
    r_multiple = Column(Float, nullable=True)
    win_loss = Column(String, nullable=True)  # 'WIN', 'LOSS', 'BREAKEVEN'
    
    setup_reason = Column(String)  # E.g., 'Sweep -> CHOCH -> OB -> FVG'
    market_condition = Column(String)  # E.g., '4H Bullish'
    
    # Stores JSON data of the AI Analyst's decision logic and scoring
    ai_analysis = Column(JSON, nullable=True)
    
    # Tick-level snapshot at the time of entry
    state_snapshot = Column(JSON, nullable=True)
    
class OpenTrade(Base):
    __tablename__ = "open_trades"

    ticket_id = Column(String, primary_key=True, index=True) # MT5 or Binance ticket ID
    symbol = Column(String, index=True)
    direction = Column(String)
    
    entry_time = Column(DateTime(timezone=True), default=func.now())
    entry_price = Column(Float)
    
    current_sl = Column(Float)
    initial_sl = Column(Float)
    current_tp = Column(Float)
    
    status = Column(String, default="OPEN") # 'OPEN', 'PARTIAL_CLOSED'
    risk_amount = Column(Float)
