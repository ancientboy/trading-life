"""
新币Agent - 打新策略

策略：
1. 只看上线≤7天的币
2. 首日放量上涨 → 追入
3. 首日砸盘后企稳 → 抄底
4. 社区热度高的优先
5. 杠杆 5x（新币波动极大）
6. 止损宽一些 5-8%
"""

import logging
import asyncio
import aiohttp
from datetime import datetime, timezone
from typing import Dict, List

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.base_agent import BaseAgent
from config import DATA_DIR

logger = logging.getLogger("NewcoinAgent")


class NewcoinAgent(BaseAgent):
    """新币打新Agent"""
    
    def __init__(self, capital: float):
        super().__init__(
            agent_type="newcoin",
            capital=capital,
            max_positions=2,
            max_single_risk_pct=0.03,
            max_position_pct=0.05,     # 新币保证金5%
            circuit_break_limit=4,     # 连亏4笔就停
        )
    
    async def scan_new_coins(self, session: aiohttp.ClientSession) -> list:
        """扫描新币机会"""
        from squeeze_detector import detect_new_coins
        
        results = []
        new_coins = await detect_new_coins(session)
        
        for nc in new_coins:
            if nc.symbol in self.positions:
                continue
            if not self.can_open():
                break
            
            if nc.new_coin_score < 40:
                continue
            
            price = 0
            try:
                url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={nc.symbol}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    price = float((await resp.json()).get('price', 0))
            except:
                continue
            
            if price <= 0:
                continue
            
            # 新币策略：宽止损，低杠杆
            stop_loss_pct = 0.06 if nc.days_listed <= 1 else 0.05
            stop_loss = price * (1 - stop_loss_pct)
            leverage = 20  # 新币统一20x
            
            # 入场类型
            if nc.price_action == "surge":
                logger.info(f"[newcoin] 跳过追涨信号 {nc.symbol} ({nc.detail})")
                continue
                # entry_type = "newcoin_surge"  # 已禁用：回测11.5%胜率纯亏
            elif nc.price_action == "dump_and_stable":
                entry_type = "newcoin_bottom"
            else:
                entry_type = "newcoin_stable"
            
            opened = self.open_position(
                symbol=nc.symbol, direction="LONG",
                entry_price=price, stop_loss=stop_loss,
                leverage=leverage, entry_type=entry_type,
                take_profit=[price * 1.15, price * 1.30, price * 1.50],
                reasoning=f"打新({nc.days_listed}天): {nc.detail}",
                klines_4h=klines if 'klines' in dir() else None,
            )
            if opened:
                results.append({
                    "symbol": nc.symbol, "action": "LONG",
                    "price": price, "leverage": leverage,
                    "score": nc.new_coin_score,
                    "entry_type": entry_type,
                    "days": nc.days_listed,
                })
        
        return results
    
    async def check_positions(self, session: aiohttp.ClientSession):
        """检查持仓"""
        for sym in list(self.positions.keys()):
            try:
                url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sym}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    price = float((await resp.json()).get('price', 0))
                
                if price <= 0:
                    continue
                
                pos = self.positions.get(sym)
                if not pos:
                    continue
                
                # 止损检查
                if pos.direction == "LONG" and price <= pos.stop_loss:
                    self.close_position(sym, price, "止损", klines_4h=klines)
                    continue
                elif pos.direction == "SHORT" and price >= pos.stop_loss:
                    self.close_position(sym, price, "止损", klines_4h=klines)
                    continue
                
                # 结构止盈检查（新币用1h K线更敏感）
                kline_url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=1h&limit=30"
                async with session.get(kline_url, timeout=aiohttp.ClientTimeout(total=5)) as kresp:
                    raw = await kresp.json()
                klines = [{"open": k[1], "high": k[2], "low": k[3], "close": k[4], "volume": k[5]} for k in raw]
                
                structure = self.check_structure_exit(klines, pos.direction, price)
                if structure["exit"]:
                    self.close_position(sym, price, f"结构止盈: {structure['reason']}", klines_4h=klines)
                    logger.info(f"[newcoin] {sym} 结构止盈: {structure['reason']} @ {price}")
            except Exception as e:
                logger.debug(f"[newcoin] check {sym} error: {e}")
