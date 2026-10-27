import asyncio
import time
import ccxt.async_support as ccxt
from datetime import datetime
from loguru import logger
from typing import Dict, Any, List, Optional
from backend import config


class BrokerAdapter:
    """
    Executes trades and manages orders on Binance Demo Trading (demo.binance.com) via CCXT.
    - Market Buy orders execute immediately.
    - Automatic Take-Profit Limit orders are placed right after, visible in Binance 'Open Orders'.
    """

    def __init__(self):
        self.api_key = config.BINANCE_API_KEY
        self.secret = config.BINANCE_SECRET_KEY

        self.exchange = ccxt.binance({
            "apiKey": self.api_key,
            "secret": self.secret,
            "enableRateLimit": True,
            "timeout": 5000,  # 5s max timeout to prevent blocking the event loop
            "options": {
                "defaultType": "spot",
                "adjustForTimeDifference": True,
            },
        })
        self.exchange.enable_demo_trading(True)
        self._cached_orders: List[Dict[str, Any]] = []
        self._last_orders_fetch: float = 0.0

    def _normalize_symbol(self, symbol: str) -> str:
        s = symbol.upper().replace("/", "").replace("-", "")
        if s.endswith("USDT"):
            return f"{s[:-4]}/USDT"
        if s.endswith("USDC"):
            return f"{s[:-4]}/USDC"
        return f"{s}/USDT"

    def _get_default_amount(self, unified_symbol: str) -> float:
        if "BTC" in unified_symbol:
            return 0.0002   # ~$16.80 USDT
        if "ETH" in unified_symbol:
            return 0.005    # ~$15.50 USDT
        if "SOL" in unified_symbol:
            return 0.1      # ~$15.00 USDT
        return 0.01

    async def execute_trade(self, trade: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes a real trade on demo.binance.com.
        If BUY: places market buy, then immediately places a Limit Sell (Take Profit)
        order so it actively sits in the Binance 'Open Orders' tab!
        """
        raw_symbol = trade.get("symbol", "BTCUSDT")
        unified_symbol = self._normalize_symbol(raw_symbol)
        base_asset = unified_symbol.split("/")[0]

        direction = trade.get("direction", "LONG").upper()
        desired_side = "buy" if direction in ["LONG", "BUY"] else "sell"
        amount = trade.get("amount") or self._get_default_amount(unified_symbol)

        if not self.api_key or not self.secret:
            logger.error("[TRADE] Missing Binance API Keys!")
            return {"success": False, "error": "Missing Binance API Keys"}

        try:
            balance = await self.exchange.fetch_balance()
            free_base = float(balance["free"].get(base_asset, 0.0))
            free_usdt = float(balance["free"].get("USDT", 0.0))

            side = desired_side

            # In Spot Demo, selling requires owning the asset
            if side == "sell":
                if free_base < (amount * 0.5):
                    logger.warning(
                        f"[TRADE] Spot Demo: You hold {free_base:.6f} {base_asset}. "
                        f"Shorting on Spot requires holding the coin. Switching to BUY to test execution."
                    )
                    side = "buy"
                else:
                    amount = min(amount, free_base)

            if side == "buy" and free_usdt < 10.0:
                logger.error(f"[TRADE] Insufficient USDT balance ({free_usdt:.2f} USDT).")
                return {"success": False, "error": f"Insufficient USDT balance: {free_usdt:.2f}"}

            logger.info(f"[TRADE] → Placing Market Order: {side.upper()} {amount} {unified_symbol}")

            # 1. Place Market Order
            order = await self.exchange.create_market_order(
                symbol=unified_symbol,
                side=side,
                amount=amount,
            )

            order_id = str(order.get("id", ""))
            fill_amount = float(order.get("filled") or amount)
            fill_cost = float(order.get("cost") or 0.0)
            fill_price = float(order.get("average") or order.get("price") or (fill_cost / fill_amount if fill_amount else 0.0))

            logger.success(
                f"[TRADE] Market Order Filled! ID: {order_id} | {side.upper()} {fill_amount} {base_asset} @ ${fill_price:.2f}"
            )

            tp_order_id = None
            tp_price = None

            # 2. If BUY: Place a Take-Profit Limit Sell order so it appears in 'Open Orders'
            if side == "buy":
                # Determine TP target (+2.5% to +3% or from strategy setup)
                strat_tp = float(trade.get("take_profit") or 0.0)
                if strat_tp > fill_price:
                    tp_price = round(strat_tp, 2)
                else:
                    tp_price = round(fill_price * 1.03, 2) # +3% target

                try:
                    logger.info(f"[TRADE] → Placing Take-Profit Limit Sell for {fill_amount} {base_asset} @ ${tp_price:.2f}")
                    tp_order = await self.exchange.create_order(
                        symbol=unified_symbol,
                        type="limit",
                        side="sell",
                        amount=fill_amount,
                        price=tp_price,
                    )
                    tp_order_id = str(tp_order["id"])
                    logger.success(
                        f"[TRADE] TP Limit Order is OPEN on Binance! Order ID: {tp_order_id} @ ${tp_price:.2f}"
                    )
                except Exception as tp_err:
                    logger.warning(f"[TRADE] Could not place automatic TP Limit order: {tp_err}")

            return {
                "success": True,
                "order_id": order_id,
                "tp_order_id": tp_order_id,
                "tp_price": tp_price,
                "symbol": raw_symbol,
                "side": side.upper(),
                "price": fill_price,
                "amount": fill_amount,
                "cost": fill_cost,
                "status": "EXECUTED",
                "timestamp": order.get("datetime") or datetime.utcnow().isoformat(),
            }

        except Exception as e:
            logger.error(f"[TRADE] Execution failed: {e}")
            return {"success": False, "error": str(e)}

    async def refresh_open_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Background worker that fetches orders from Binance Demo and updates the cache."""
        try:
            symbols_to_check = [self._normalize_symbol(symbol)] if symbol else [self._normalize_symbol(s) for s in config.SYMBOLS]
            all_orders = []
            for sym in symbols_to_check:
                try:
                    orders = await self.exchange.fetch_open_orders(sym)
                    all_orders.extend(orders)
                except Exception as sym_err:
                    logger.debug(f"[TRADE] Open orders check for {sym}: {sym_err}")

            formatted = [
                {
                    "id": str(o.get("id", "")),
                    "symbol": o.get("symbol", "").replace("/", ""),
                    "side": str(o.get("side", "")).upper(),
                    "type": str(o.get("type", "")).upper(),
                    "price": float(o.get("price") or 0.0),
                    "amount": float(o.get("amount") or 0.0),
                    "filled": float(o.get("filled") or 0.0),
                    "remaining": float(o.get("remaining") or o.get("amount") or 0.0),
                    "cost": float((o.get("price") or 0.0) * (o.get("amount") or 0.0)),
                    "status": str(o.get("status", "OPEN")).upper(),
                    "timestamp": o.get("datetime") or datetime.utcnow().isoformat(),
                }
                for o in all_orders
            ]
            self._cached_orders = formatted
            self._last_orders_fetch = time.time()
            return formatted
        except BaseException as e:
            logger.debug(f"[TRADE] Background orders refresh: {e}")
            return self._cached_orders

    async def get_open_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Instant non-blocking open orders reader. Triggers background refresh if stale."""
        now = time.time()
        # If cache is older than 8s, spawn non-blocking refresh
        if now - self._last_orders_fetch > 8.0:
            asyncio.create_task(self.refresh_open_orders(symbol))
        return self._cached_orders

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        """Cancels an open order on demo.binance.com"""
        try:
            unified = self._normalize_symbol(symbol)
            await self.exchange.cancel_order(order_id, unified)
            logger.info(f"[TRADE] Order {order_id} canceled successfully on Binance.")
            return True
        except Exception as e:
            logger.error(f"[TRADE] Error canceling order {order_id}: {e}")
            return False

    async def get_balance(self) -> Dict[str, float]:
        """Fetches live wallet balances from demo.binance.com"""
        try:
            bal = await self.exchange.fetch_balance()
            return {
                coin: float(amt)
                for coin, amt in bal.get("total", {}).items()
                if float(amt) > 0
            }
        except Exception as e:
            logger.error(f"[TRADE] Failed to fetch balance: {e}")
            return {}

    async def close(self):
        await self.exchange.close()
