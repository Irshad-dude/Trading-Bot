from loguru import logger
from typing import Dict
from backend.state import bot
from backend import config


class RiskManager:
    """
    Hard-wired risk rules enforced before every trade.
    No trade passes unless ALL conditions are met.
    """

    def validate_trade(self, trade: Dict) -> bool:
        symbol    = trade.get("symbol", "?")
        direction = trade.get("direction", "?")

        # ── Rule 1: AI must approve ───────────────────────────────
        if trade.get("ai_decision") != "APPROVE":
            reason = trade.get("ai_reasoning", "No reason given")
            logger.warning(f"[RISK] {symbol} REJECTED by AI: {reason}")
            bot.add_log(f"REJECTED [{symbol}] AI: {reason}")
            return False

        # ── Rule 2: Minimum confidence threshold ──────────────────
        confidence = trade.get("ai_confidence", 0)
        if confidence < config.CONFIDENCE_THRESHOLD:
            logger.warning(f"[RISK] {symbol} REJECTED: confidence {confidence}% < {config.CONFIDENCE_THRESHOLD}%")
            bot.add_log(f"REJECTED [{symbol}] Low confidence ({confidence}%)")
            return False

        # ── Rule 3: Max daily trades ──────────────────────────────
        if bot.daily_trades_count >= config.MAX_DAILY_TRADES:
            logger.warning(f"[RISK] Max {config.MAX_DAILY_TRADES} daily trades reached.")
            bot.add_log(f"REJECTED [{symbol}] Daily trade limit ({config.MAX_DAILY_TRADES}) hit")
            return False

        # ── Rule 4: Max concurrent positions ─────────────────────
        if len(bot.open_positions) >= 1:
            logger.warning(f"[RISK] Max 1 concurrent position. Close existing first.")
            bot.add_log(f"REJECTED [{symbol}] Already have an open position")
            return False

        logger.success(f"[RISK] {symbol} {direction} APPROVED (confidence: {confidence}%)")
        bot.add_log(f"APPROVED [{symbol}] {direction} — Confidence {confidence}%")
        return True
