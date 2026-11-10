import json
import os
from loguru import logger
from typing import Dict
from backend import config
from backend.ai.graph_rag import TradeKnowledgeGraph

try:
    from langchain_google_genai import ChatGoogleGenerativeAI
    _GENAI_AVAILABLE = True
except ImportError:
    _GENAI_AVAILABLE = False


class AIAnalyst:
    """
    Uses Gemini + Graph RAG (Knowledge Graph Memory) to evaluate SMC trade setups.
    Retrieves structurally similar past trades to identify winning DNA vs losing traps.
    If no API key is set OR if Gemini errors, leverages deterministic Graph RAG rules.
    """

    def __init__(self):
        self.llm = None
        self.kg = TradeKnowledgeGraph()
        if _GENAI_AVAILABLE and config.GEMINI_API_KEY:
            for model_name in ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"]:
                try:
                    self.llm = ChatGoogleGenerativeAI(
                        model=model_name,
                        google_api_key=config.GEMINI_API_KEY,
                        temperature=0.0,
                        max_output_tokens=300,
                    )
                    logger.info(f"[AI] Gemini model '{model_name}' initialized successfully.")
                    break
                except Exception as e:
                    logger.warning(f"[AI] Gemini init with {model_name} failed: {e}")
        else:
            logger.warning("[AI] No Gemini API key. AI validation powered by deterministic Graph RAG.")

    def validate_setup(self, candidate: Dict, trend: str) -> Dict:
        if "TESTING MODE" in candidate.get("setup_reason", ""):
            candidate["ai_decision"]   = "APPROVE"
            candidate["ai_confidence"] = 100
            candidate["ai_reasoning"]  = "Auto-approved: Force Testing Mode."
            return candidate

        # ─── Graph RAG Retrieval ──────────────────────────────────────────────
        rag_retrieval = self.kg.retrieve_similar_trades(candidate, top_k=6)
        candidate["graph_rag"] = {
            "neighborhood_win_rate": rag_retrieval["neighborhood_win_rate"],
            "sample_size": rag_retrieval["neighborhood_sample_size"],
            "recommendation": rag_retrieval["recommendation"],
            "top_matches": rag_retrieval["top_matches"][:3],
        }
        rag_prompt = self.kg.generate_rag_reasoning_prompt(candidate)

        if not self.llm:
            # Deterministic Graph RAG evaluation
            wr = rag_retrieval["neighborhood_win_rate"]
            if wr >= 60.0:
                candidate["ai_decision"]   = "APPROVE"
                candidate["ai_confidence"] = int(min(95, wr + 15))
                candidate["ai_reasoning"]  = f"Graph RAG Approved: High-win cluster ({wr}% win rate across {rag_retrieval['neighborhood_sample_size']} twin trades)."
            elif wr <= 25.0 and rag_retrieval["neighborhood_sample_size"] >= 4:
                candidate["ai_decision"]   = "REJECT"
                candidate["ai_confidence"] = 80
                candidate["ai_reasoning"]  = f"Graph RAG Filter: Low-win trap detected ({wr}% win rate across similar trades; e.g. London open fakeout / late NY chop)."
            else:
                candidate["ai_decision"]   = "APPROVE"
                candidate["ai_confidence"] = 75
                candidate["ai_reasoning"]  = f"Graph RAG Approved: Balanced structural setup ({wr}% cluster win rate)."
            return candidate

        rr = abs(candidate["take_profit"] - candidate["entry_price"]) / max(
            abs(candidate["stop_loss"] - candidate["entry_price"]), 0.0001
        )
        prompt = (
            f"You are a senior SMC quantitative analyst. Evaluate this trade strictly using Knowledge Graph memory.\n\n"
            f"Symbol: {candidate['symbol']}\n"
            f"Direction: {candidate['direction']}\n"
            f"4H Trend: {trend}\n"
            f"Setup: {candidate['setup_reason']}\n"
            f"Entry: {candidate['entry_price']}\n"
            f"Stop Loss: {candidate['stop_loss']}\n"
            f"Take Profit: {candidate['take_profit']}\n"
            f"ATR: {candidate.get('atr', 'N/A')}\n"
            f"Risk/Reward: {rr:.2f}\n\n"
            f"{rag_prompt}\n"
            f"Rules:\n"
            f"- APPROVE only if direction aligns with 4H trend\n"
            f"- APPROVE only if RR >= 1.5\n"
            f"- REJECT if this looks like a fakeout, news trap, or low-win historical cluster (<30% WR)\n\n"
            f"Respond ONLY in this exact JSON, no markdown:\n"
            f'{{\"decision\": \"APPROVE\" or \"REJECT\", \"confidence\": 0-100, \"reasoning\": \"one concise sentence\"}}'
        )

        try:
            response = self.llm.invoke(prompt)
            content = response.content
            if isinstance(content, list):
                text = "".join([part.get("text", "") if isinstance(part, dict) else str(part) for part in content])
            else:
                text = str(content)

            text = text.strip()
            if "```json" in text:
                text = text.split("```json", 1)[1].split("```", 1)[0].strip()
            elif "```" in text:
                text = text.split("```", 1)[1].split("```", 1)[0].strip()

            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                text = text[start:end+1]

            data = json.loads(text)
            candidate["ai_decision"]   = data.get("decision", "REJECT")
            candidate["ai_confidence"] = int(data.get("confidence", 0))
            candidate["ai_reasoning"]  = data.get("reasoning", "")
            logger.info(f"[AI+GraphRAG] {candidate['symbol']} → {candidate['ai_decision']} ({candidate['ai_confidence']}%): {candidate['ai_reasoning']}")
        except Exception as e:
            logger.warning(f"[AI] Gemini error (falling back to Graph RAG auto-decision): {e}")
            wr = rag_retrieval["neighborhood_win_rate"]
            if wr >= 60.0:
                candidate["ai_decision"]   = "APPROVE"
                candidate["ai_confidence"] = int(min(95, wr + 15))
                candidate["ai_reasoning"]  = f"Graph RAG fallback: High-win cluster ({wr}% win rate across {rag_retrieval['neighborhood_sample_size']} twin trades)."
            elif wr <= 25.0 and rag_retrieval["neighborhood_sample_size"] >= 4:
                candidate["ai_decision"]   = "REJECT"
                candidate["ai_confidence"] = 80
                candidate["ai_reasoning"]  = f"Graph RAG fallback: Low-win trap detected ({wr}% win rate across similar trades)."
            else:
                candidate["ai_decision"]   = "APPROVE"
                candidate["ai_confidence"] = 75
                candidate["ai_reasoning"]  = f"Graph RAG fallback: Balanced structural setup ({wr}% cluster win rate)."

        return candidate
