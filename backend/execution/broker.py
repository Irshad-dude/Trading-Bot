import asyncio
import time
import ccxt.async_support as ccxt
from datetime import datetime
from loguru import logger
from typing import Dict, Any, List, Optional
from backend import config


class BrokerAdapter:
    """
    Executes trades and manages orders on Binance Demo Trading (demo.binance.com) via CCXT,
    with an automatic Paper Trading fallback when API keys are not provided.
    - If API keys provided: places live market & TP limit orders on Binance Demo.
    - If API keys empty: simulates execution seamlessly in Paper Trading mode.
    """

    def __init__(self):
        self.api_key = config.BINANCE_API_KEY
        self.secret = config.BINANCE_SECRET_KEY
        self.is_paper = not bool(self.api_key and self.secret)

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
        self._paper_balance: Dict[str, float] = {
            "USDT": 10000.0,
            "BTC": 0.05,
            "ETH": 1.0,
            "PAXG": 2.0,
        }

        if self.is_paper:
            logger.info("[TRADE] No Binance API keys set — initialized in Paper Trading Mode.")
        else:
            logger.info("[TRADE] Binance Demo API keys loaded.")

    def _normalize_symbol(self, symbol: str) -> str:
        s = symbol.upper().replace("/", "").replace("-", "")
        if s in ["XAUUSD", "GOLD", "PAXG", "PAXGUSDT"]:
            return "PAXG/USDT"
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
        if "PAXG" in unified_symbol or "XAU" in unified_symbol:
            return 0.005    # ~$15.00 USDT
        return 0.01

    async def execute_trade(self, trade: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes trade on Binance Demo if keys exist, or in Paper Trading mode if keys missing.
        If BUY: places market buy, then immediately places a Limit Sell (Take Profit)
        order so it actively sits in the 'Open Orders' tab!
        """
        raw_symbol = trade.get("symbol", "BTCUSDT")
        unified_symbol = self._normalize_symbol(raw_symbol)
        base_asset = unified_symbol.split("/")[0]

        direction = trade.get("direction", "LONG").upper()
        desired_side = "buy" if direction in ["LONG", "BUY"] else "sell"
        amount = trade.get("amount") or self._get_default_amount(unified_symbol)

        if not self.api_key or not self.secret:
            # ── Paper Trading Mode ───────────────────────────────────────────
            fill_price = float(trade.get("entry_price") or trade.get("price") or 0.0)
            if fill_price <= 0:
                try:
                    ticker = await self.exchange.fetch_ticker(unified_symbol)
                    fill_price = float(ticker.get("last") or ticker.get("close") or 100.0)
                except Exception:
                    fill_price = 100.0

            fill_cost = round(fill_price * amount, 2)
            order_id = f"PAPER_{int(time.time() * 1000)}"

            logger.info(
                f"[TRADE] [PAPER MODE] Executing {desired_side.upper()} {amount} {unified_symbol} @ ${fill_price:.2f}"
            )

            # Update simulated balances
            if desired_side == "buy":
                self._paper_balance["USDT"] = max(0.0, self._paper_balance.get("USDT", 10000.0) - fill_cost)
                self._paper_balance[base_asset] = self._paper_balance.get(base_asset, 0.0) + amount
            else:
                self._paper_balance[base_asset] = max(0.0, self._paper_balance.get(base_asset, 0.0) - amount)
                self._paper_balance["USDT"] = self._paper_balance.get("USDT", 10000.0) + fill_cost

            tp_order_id = None
            tp_price = None

            if desired_side == "buy":
                strat_tp = float(trade.get("take_profit") or 0.0)
                tp_price = round(strat_tp, 2) if strat_tp > fill_price else round(fill_price * 1.03, 2)
                tp_order_id = f"PAPER_TP_{int(time.time() * 1000)}"

                paper_tp_order = {
                    "id": tp_order_id,
                    "symbol": raw_symbol,
                    "side": "SELL",
                    "type": "LIMIT",
                    "price": tp_price,
                    "amount": amount,
                    "filled": 0.0,
                    "remaining": amount,
                    "cost": round(tp_price * amount, 2),
                    "status": "OPEN",
                    "timestamp": datetime.utcnow().isoformat(),
                }
                self._cached_orders.insert(0, paper_tp_order)
                logger.success(
                    f"[TRADE] [PAPER MODE] Placed Paper TP Limit Sell: {amount} {base_asset} @ ${tp_price:.2f} (ID: {tp_order_id})"
                )

            return {
                "success": True,
                "order_id": order_id,
                "tp_order_id": tp_order_id,
                "tp_price": tp_price,
                "symbol": raw_symbol,
                "side": desired_side.upper(),
                "price": fill_price,
                "amount": amount,
                "cost": fill_cost,
                "status": "EXECUTED",
                "mode": "PAPER",
                "timestamp": datetime.utcnow().isoformat(),
            }

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
        """Background worker that fetches orders from Binance Demo (or returns paper cache) and updates."""
        if not self.api_key or not self.secret:
            # Paper mode: return locally cached paper orders without calling Binance private endpoints
            return self._cached_orders

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
        """Cancels an open order on demo.binance.com or removes from paper orders."""
        if not self.api_key or not self.secret:
            self._cached_orders = [o for o in self._cached_orders if str(o.get("id")) != str(order_id)]
            logger.info(f"[TRADE] [PAPER MODE] Order {order_id} canceled successfully.")
            return True

        try:
            unified = self._normalize_symbol(symbol)
            await self.exchange.cancel_order(order_id, unified)
            logger.info(f"[TRADE] Order {order_id} canceled successfully on Binance.")
            return True
        except Exception as e:
            logger.error(f"[TRADE] Error canceling order {order_id}: {e}")
            return False

    async def get_balance(self) -> Dict[str, float]:
        """Fetches live wallet balances from demo.binance.com or returns simulated paper balance."""
        if not self.api_key or not self.secret:
            return {coin: round(amt, 4) for coin, amt in self._paper_balance.items() if amt > 0}

        try:
            bal = await self.exchange.fetch_balance()
            return {
                coin: float(amt)
                for coin, amt in bal.get("total", {}).items()
                if float(amt) > 0
            }
        except Exception as e:
            logger.error(f"[TRADE] Failed to fetch balance: {e}")
            return {coin: round(amt, 4) for coin, amt in self._paper_balance.items() if amt > 0}

    async def close(self):
        await self.exchange.close()
