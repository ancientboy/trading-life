"""
山寨币Agent - 启动前信号 + 逼空 + 突破

策略：
1. 启动前信号≥80 → 提前埋伏
2. 启动前信号≥60 → 加监控池
3. 监控池 5m/15m/1h 放量突破 → 追入
4. 逼空信号（费率极端负+反弹）→ 入场
5. 杠杆 5-10x

不做：趋势跟踪、打新
"""

import logging
import asyncio
import aiohttp
from datetime import datetime, timezone
from typing import Dict, List, Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.base_agent import BaseAgent
from correlation_matrix import get_matrix, CorrelationMatrix
from config import DATA_DIR

logger = logging.getLogger("AltcoinAgent")

MAJOR_SYMBOLS = ["BTCUSDT", "ETHUSDT"]
PRECIOUS_METALS = ["XAUUSDT", "XAGUSDT"]  # 贵金属由XAU Agent独立管理


class AltcoinAgent(BaseAgent):
    """山寨币Agent"""
    
    def __init__(self, capital: float):
        super().__init__(
            agent_type="altcoin",
            capital=capital,
            max_positions=4,
            max_single_risk_pct=0.03,
            max_position_pct=0.05,  # 山寨币保证金5%
            circuit_break_limit=6,
        )
    
    def _correlation_filter(self, sym: str, btc_trend: str = "neutral") -> dict:
        """关联性过滤：检查目标币是否适合入场"""
        matrix = get_matrix()
        if not matrix.matrix:
            return {"ok": True, "reason": "无关联数据", "btc_corr": 0, "beta": 1.0, "independence": 50}
        return matrix.should_enter(sym, btc_trend)
    
    def _check_portfolio_diversification(self, new_sym: str) -> bool:
        """检查加入新币后组合是否过于集中"""
        matrix = get_matrix()
        if not matrix.matrix:
            return True
        
        current = list(self.positions.keys()) + [new_sym]
        div = matrix.get_portfolio_diversification(current)
        
        if div < 30:
            logger.info(f"[altcoin] 组合分散度{div:.0f}%过低，跳过{new_sym}")
            return False
        return True
    
    async def _get_btc_trend(self, session: aiohttp.ClientSession) -> str:
        """获取BTC当前趋势"""
        try:
            url = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=60"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            closes = [float(k[4]) for k in raw]
            if len(closes) >= 50:
                from agents.major_agent import calc_ema
                ema20 = calc_ema(closes, 20)
                ema50 = calc_ema(closes, 50)
                return "bullish" if ema20 > ema50 else "bearish"
        except:
            pass
        return "neutral"
    
    async def update_correlation_matrix(self, session: aiohttp.ClientSession):
        """更新关联矩阵"""
        matrix = get_matrix()
        await matrix.update(session)
    
    async def scan_prelaunch(self, session: aiohttp.ClientSession) -> list:
        """扫描全市场启动前信号，埋伏+监控池"""
        from prelaunch_detector import detect_prelaunch_signals
        
        results = []
        btc_trend = await self._get_btc_trend(session)
        logger.info(f"[altcoin] prelaunch scan BTC趋势={btc_trend}")
        
        # 获取候选币（排除主流币）
        try:
            async with session.get(
                "https://fapi.binance.com/fapi/v1/ticker/24hr",
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                tickers = await resp.json()
            
            candidates = [
                t for t in tickers
                if t["symbol"].endswith("USDT")
                and float(t.get("quoteVolume", 0)) > 20_000_000
                and t["symbol"] not in MAJOR_SYMBOLS
                and t["symbol"] not in PRECIOUS_METALS
            ]
            # 取Top 30
            candidates.sort(key=lambda t: float(t.get("quoteVolume", 0)), reverse=True)
            candidates = candidates[:30]
        except Exception as e:
            logger.warning(f"[altcoin] 获取候选失败: {e}")
            return []
        
        for t in candidates:
            sym = t["symbol"]
            if sym in self.positions:
                continue
            
            try:
                url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=60"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    raw = await resp.json()
                
                klines = [{"open": k[1], "high": k[2], "low": k[3], "close": k[4], "volume": k[5]} for k in raw]
                if len(klines) < 25:
                    continue
                
                pl = detect_prelaunch_signals(klines, sym)
                
                if pl['score'] >= 80:
                    price = float(klines[-1]['close'])
                    if price > 0 and self.can_open():
                        corr_check = self._correlation_filter(sym, btc_trend)
                        if not corr_check["ok"]:
                            logger.info(f"[altcoin] {sym} 关联过滤拒绝: {corr_check['reason']}")
                            continue
                        
                        # ★ 低位确认：多周期StochRSI超卖确认
                        from agents.major_agent import calc_stochrsi
                        closes_4h = [float(k['close']) for k in klines]
                        srsi_4h = calc_stochrsi(closes_4h)
                        
                        if not srsi_4h.get('valid') or srsi_4h['k'] > 20:
                            logger.info(f"[altcoin] {sym} 4h StochRSI K={srsi_4h.get('k','?')} 未超卖(<20)，跳过埋伏")
                            continue
                        
                        # 再拉1h K线确认小周期极端超卖
                        try:
                            url_1h = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=1h&limit=60"
                            async with session.get(url_1h, timeout=aiohttp.ClientTimeout(total=5)) as resp_1h:
                                raw_1h = await resp_1h.json()
                            closes_1h = [float(k[4]) for k in raw_1h]
                            srsi_1h = calc_stochrsi(closes_1h)
                            if not srsi_1h.get('valid') or srsi_1h['k'] > 10:
                                logger.info(f"[altcoin] {sym} 1h StochRSI K={srsi_1h.get('k','?')} 未到极限(<10)，跳过")
                                continue
                        except Exception as e:
                            logger.debug(f"[altcoin] {sym} 1h数据获取失败: {e}")
                            continue
                        
                        # ★ 组合分散度检查
                        if not self._check_portfolio_diversification(sym):
                            continue
                        
                        # 独立行情优先（加分逻辑已在评分里体现）
                        independence = corr_check["independence"]
                        beta = corr_check["beta"]
                        
                        # 动态杠杆：统一20x
                        leverage = 20
                        
                        # ATR动态止损（替代固定百分比）
                        stop_loss = self.calc_atr_stop_loss(klines, price, "LONG", atr_mult=2.0)
                        
                        reasoning = f"提前埋伏: {pl['detail']} | 独立度={independence:.0f}% Beta={beta:.1f} BTC相关={corr_check['btc_corr']:+.2f}"
                        
                        opened = self.open_position(
                            symbol=sym, direction="LONG",
                            entry_price=price, stop_loss=stop_loss,
                            leverage=leverage, entry_type="prelaunch_ambush",
                            take_profit=[price * 1.10, price * 1.20, price * 1.35],
                            reasoning=reasoning,
                            klines_4h=None,
                        )
                        if opened:
                            results.append({
                                "symbol": sym, "action": "LONG",
                                "price": price, "leverage": leverage,
                                "score": pl['score'],
                                "entry_type": "prelaunch_ambush",
                                "independence": independence,
                                "btc_corr": corr_check["btc_corr"],
                            })
                
                if pl['score'] >= 70:  # 收紧60→70（回测信号太频繁）
                    # 加入监控池
                    try:
                        from watch_pool import add_to_watch_pool
                        add_to_watch_pool(
                            symbol=sym,
                            prelaunch_score=pl['score'],
                            prelaunch_phase=pl['phase'],
                            prelaunch_detail=pl['detail'],
                        )
                    except:
                        pass
                    
            except Exception as e:
                logger.debug(f"[altcoin] {sym} 分析失败: {e}")
            
            await asyncio.sleep(0.2)
        
        return results
    
    async def scan_squeeze(self, session: aiohttp.ClientSession) -> list:
        """扫描逼空机会"""
        from squeeze_detector import detect_short_squeeze
        
        results = []
        squeezes = await detect_short_squeeze(session)
        btc_trend = await self._get_btc_trend(session)
        
        for sq in squeezes:
            if sq.squeeze_score < 60:
                continue
            if sq.symbol in self.positions or sq.symbol in MAJOR_SYMBOLS:
                continue
            if not self.can_open():
                break
            
            price = 0
            try:
                url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sq.symbol}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    price = float((await resp.json()).get('price', 0))
            except:
                continue
            
            if price <= 0:
                continue
            
            corr_check = self._correlation_filter(sq.symbol, btc_trend)
            logger.info(f"[altcoin] 逼空 {sq.symbol} BTC相关={corr_check['btc_corr']:+.2f} 独立度={corr_check['independence']:.0f}%")
            
            stop_loss = price * 0.965  # 3.5% 止损
            leverage = 20  # 逼空统一20x
            
            opened = self.open_position(
                symbol=sq.symbol, direction="LONG",
                entry_price=price, stop_loss=stop_loss,
                leverage=leverage, entry_type="short_squeeze",
                take_profit=[price * 1.08, price * 1.15, price * 1.25],
                reasoning=f"逼空: {sq.detail}",
                klines_4h=None,
            )
            if opened:
                results.append({
                    "symbol": sq.symbol, "action": "LONG",
                    "price": price, "leverage": leverage,
                    "score": sq.squeeze_score,
                    "entry_type": "short_squeeze",
                })
        
        return results
    
    async def scan_watchpool_breakouts(self, session: aiohttp.ClientSession) -> list:
        """扫描监控池突破"""
        from watch_pool import scan_watch_pool_breakouts
        
        results = []
        triggers = await scan_watch_pool_breakouts(session)
        btc_trend = await self._get_btc_trend(session)
        
        for t in triggers:
            if t['symbol'] in self.positions:
                continue
            if not self.can_open():
                break
            
            corr_check = self._correlation_filter(t['symbol'], btc_trend)
            if not self._check_portfolio_diversification(t['symbol']):
                continue
            
            price = t['price']
            independence = corr_check["independence"]
            leverage = 20  # 突破统一20x
            
            opened = self.open_position(
                symbol=t['symbol'], direction="LONG",
                entry_price=price, stop_loss=price * 0.97,
                leverage=leverage, entry_type="watch_pool_breakout",
                take_profit=[price * 1.06, price * 1.12, price * 1.20],
                reasoning=f"监控池{t['tf']}突破",
                klines_4h=None,
            )
            if opened:
                results.append({
                    "symbol": t['symbol'], "action": "LONG",
                    "price": price, "leverage": leverage,
                    "score": t.get('prelaunch_score', 0),
                    "entry_type": "watch_pool_breakout",
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
                    self.close_position(sym, price, "止损", klines_4h=None)
                    continue
                elif pos.direction == "SHORT" and price >= pos.stop_loss:
                    self.close_position(sym, price, "止损", klines_4h=None)
                    continue
                
                # 结构止盈检查（拉4h K线）
                kline_url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=30"
                async with session.get(kline_url, timeout=aiohttp.ClientTimeout(total=5)) as kresp:
                    raw = await kresp.json()
                klines = [{"open": k[1], "high": k[2], "low": k[3], "close": k[4], "volume": k[5]} for k in raw]
                
                structure = self.check_structure_exit(klines, pos.direction, price)
                if structure["exit"]:
                    self.close_position(sym, price, f"结构止盈: {structure['reason']}", klines_4h=None)
                    logger.info(f"[altcoin] {sym} 结构止盈: {structure['reason']} @ {price}")
            except Exception as e:
                logger.debug(f"[altcoin] check {sym} error: {e}")
