import json
import os
from loguru import logger
from typing import Dict
from backend import config

try:
    from langchain_google_genai import ChatGoogleGenerativeAI
    _GENAI_AVAILABLE = True
except ImportError:
    _GENAI_AVAILABLE = False


class AIAnalyst:
    """
    Uses Gemini to evaluate SMC trade setups before execution.
    If no API key is set OR if Gemini errors, auto-approves all valid setups.
    """

    def __init__(self):
        self.llm = None
        if _GENAI_AVAILABLE and config.GEMINI_API_KEY:
            try:
                self.llm = ChatGoogleGenerativeAI(
                    model="gemini-2.0-flash",
                    google_api_key=config.GEMINI_API_KEY,
                    temperature=0.0,
                    max_output_tokens=300,
                )
                logger.info("[AI] Gemini 2.0 Flash initialized successfully.")
            except Exception as e:
                logger.warning(f"[AI] Gemini init failed: {e}. Running in bypass mode.")
        else:
            logger.warning("[AI] No Gemini API key. AI validation bypassed.")

    def validate_setup(self, candidate: Dict, trend: str) -> Dict:
        if "TESTING MODE" in candidate.get("setup_reason", ""):
            candidate["ai_decision"]   = "APPROVE"
            candidate["ai_confidence"] = 100
            candidate["ai_reasoning"]  = "Auto-approved: Force Testing Mode."
            return candidate

        if not self.llm:
            candidate["ai_decision"]   = "APPROVE"
            candidate["ai_confidence"] = 75
            candidate["ai_reasoning"]  = "Auto-approved: No Gemini API key configured."
            return candidate

        rr = abs(candidate["take_profit"] - candidate["entry_price"]) / max(
            abs(candidate["stop_loss"] - candidate["entry_price"]), 0.0001
        )
        prompt = (
            f"You are a senior SMC quantitative analyst. Evaluate this trade strictly.\n\n"
            f"Symbol: {candidate['symbol']}\n"
            f"Direction: {candidate['direction']}\n"
            f"4H Trend: {trend}\n"
            f"Setup: {candidate['setup_reason']}\n"
            f"Entry: {candidate['entry_price']}\n"
            f"Stop Loss: {candidate['stop_loss']}\n"
            f"Take Profit: {candidate['take_profit']}\n"
            f"ATR: {candidate.get('atr', 'N/A')}\n"
            f"Risk/Reward: {rr:.2f}\n\n"
            f"Rules:\n"
            f"- APPROVE only if direction aligns with 4H trend\n"
            f"- APPROVE only if RR >= 1.5\n"
            f"- REJECT if this looks like a fakeout or news trap\n\n"
            f"Respond ONLY in this exact JSON, no markdown:\n"
            f'{{\"decision\": \"APPROVE\" or \"REJECT\", \"confidence\": 0-100, \"reasoning\": \"one concise sentence\"}}'
        )

        try:
            response = self.llm.invoke(prompt)
            text = response.content.strip().replace("```json", "").replace("```", "")
            data = json.loads(text)
            candidate["ai_decision"]   = data.get("decision", "REJECT")
            candidate["ai_confidence"] = int(data.get("confidence", 0))
            candidate["ai_reasoning"]  = data.get("reasoning", "")
            logger.info(f"[AI] {candidate['symbol']} → {candidate['ai_decision']} ({candidate['ai_confidence']}%): {candidate['ai_reasoning']}")
        except Exception as e:
            logger.warning(f"[AI] Gemini error (falling back to auto-approve): {e}")
            # ── CRITICAL FIX: Never hard-reject on API error — fallback to approve ──
            candidate["ai_decision"]   = "APPROVE"
            candidate["ai_confidence"] = 72
            candidate["ai_reasoning"]  = "Auto-approved: Gemini API unavailable, setup passed SMC structural checks."

        return candidate
