"""
主流币Agent - BTC/ETH 趋势跟踪策略

核心逻辑：
1. EMA20 > EMA50 → 趋势向上
2. 价格回调到 EMA20 附近 → 入场机会
3. StochRSI 超卖金叉 → 时机确认
4. 止损 = EMA50 下方
5. 杠杆 10-20x（波动率低）

不做：启动前信号、逼空、打新、横盘突破
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
from config import DATA_DIR

logger = logging.getLogger("MajorAgent")

SYMBOLS = ["BTCUSDT", "ETHUSDT"]


def calc_ema(values: list, period: int) -> float:
    if len(values) < period:
        return values[-1] if values else 0
    k = 2 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def calc_stochrsi(closes: list, period: int = 14, k_smooth: int = 3, d_smooth: int = 3) -> dict:
    """简化StochRSI"""
    if len(closes) < period + k_smooth + d_smooth:
        return {"valid": False}
    
    # RSI
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(0, diff))
        losses.append(max(0, -diff))
    
    if len(gains) < period:
        return {"valid": False}
    
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    rsi_values = []
    if avg_loss == 0:
        rsi_values.append(100)
    else:
        rs = avg_gain / avg_loss
        rsi_values.append(100 - 100 / (1 + rs))
    
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            rsi_values.append(100)
        else:
            rs = avg_gain / avg_loss
            rsi_values.append(100 - 100 / (1 + rs))
    
    if len(rsi_values) < period:
        return {"valid": False}
    
    # StochRSI
    stoch_rsi = []
    for i in range(period - 1, len(rsi_values)):
        window = rsi_values[i - period + 1:i + 1]
        min_rsi = min(window)
        max_rsi = max(window)
        if max_rsi == min_rsi:
            stoch_rsi.append(50)
        else:
            stoch_rsi.append((rsi_values[i] - min_rsi) / (max_rsi - min_rsi) * 100)
    
    if len(stoch_rsi) < k_smooth + d_smooth:
        return {"valid": False}
    
    # K and D
    k_values = []
    for i in range(k_smooth - 1, len(stoch_rsi)):
        k_values.append(sum(stoch_rsi[i - k_smooth + 1:i + 1]) / k_smooth)
    
    d_values = []
    for i in range(d_smooth - 1, len(k_values)):
        d_values.append(sum(k_values[i - d_smooth + 1:i + 1]) / d_smooth)
    
    if not k_values or not d_values:
        return {"valid": False}
    
    k = k_values[-1]
    d = d_values[-1]
    prev_k = k_values[-2] if len(k_values) >= 2 else k
    
    zone = "neutral"
    if k < 20:
        zone = "oversold"
    elif k > 80:
        zone = "overbought"
    
    signal = "none"
    if prev_k <= d_values[-2] if len(d_values) >= 2 else d and k > d_values[-1]:
        if zone == "oversold":
            signal = "GOLDEN_CROSS_OVERSOLD"
        else:
            signal = "GOLDEN_CROSS"
    
    return {"valid": True, "k": round(k, 1), "d": round(d, 1), "zone": zone, "signal": signal}


class MajorAgent(BaseAgent):
    """主流币趋势跟踪Agent"""
    
    @staticmethod
    def _calc_rsi(closes: list, period: int = 14) -> float:
        """计算RSI"""
        if len(closes) < period + 1:
            return 50
        gains, losses = [], []
        for i in range(1, len(closes)):
            d = closes[i] - closes[i-1]
            gains.append(max(0, d))
            losses.append(max(0, -d))
        if len(gains) < period: return 50
        ag = sum(gains[:period]) / period
        al = sum(losses[:period]) / period
        for i in range(period, len(gains)):
            ag = (ag*(period-1)+gains[i])/period
            al = (al*(period-1)+losses[i])/period
        if al == 0: return 100
        return 100 - 100/(1+ag/al)
    
    @staticmethod
    def _calc_macd(closes: list, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
        """计算MACD"""
        def ema(data, p):
            if len(data) < p: return data[-1] if data else 0
            k = 2/(p+1)
            e = sum(data[:p])/p
            for v in data[p:]: e = v*k + e*(1-k)
            return e
        
        fast_ema = [ema(closes[:i+1], fast) for i in range(slow-1, len(closes))]
        slow_ema = [ema(closes[:i+1], slow) for i in range(slow-1, len(closes))]
        
        macd_line = [f - s for f, s in zip(fast_ema, slow_ema)]
        if len(macd_line) < signal:
            return {'macd': 0, 'signal': 0, 'histogram': 0}
        
        signal_line = ema(macd_line, signal)
        histogram = macd_line[-1] - signal_line
        
        return {'macd': macd_line[-1], 'signal': signal_line, 'histogram': histogram}
    
    def __init__(self, capital: float):
        super().__init__(
            agent_type="major",
            capital=capital,
            max_positions=2,
            max_single_risk_pct=0.03,
            max_position_pct=0.05,  # 主流币保证金5%
            circuit_break_limit=5,
        )
    
    async def run_cycle(self, session: aiohttp.ClientSession):
        """执行一轮扫描 - 支持做多+做空"""
        if not self.can_open():
            return []
        
        signals = []
        
        for sym in SYMBOLS:
            if sym in self.positions:
                continue
            
            try:
                url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=100"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    raw = await resp.json()
                
                klines = [{"open": k[1], "high": k[2], "low": k[3], "close": k[4], "volume": k[5]} for k in raw]
                closes = [float(k[4]) for k in raw]
                if len(closes) < 60:
                    continue
                
                price = closes[-1]
                ema20 = calc_ema(closes, 20)
                ema50 = calc_ema(closes, 50)
                ema200 = calc_ema(closes, 200)
                srsi = calc_stochrsi(closes)
                
                # ===== 做多分支 =====
                bullish_trend = ema20 > ema50 and price > ema20
                if bullish_trend:
                    distance = (price / ema20 - 1) * 100
                    near_ema20 = -3 < distance < 2
                    
                    # StochRSI触发
                    stochrsi_trigger = False
                    if srsi.get("valid"):
                        if srsi["signal"] in ["GOLDEN_CROSS_OVERSOLD", "GOLDEN_CROSS"]:
                            stochrsi_trigger = True
                        elif srsi.get("zone") == "oversold" and srsi["k"] > srsi["d"]:
                            stochrsi_trigger = True
                    
                    # RSI条件（新增：放宽触发条件）
                    rsi_ok = False
                    if len(closes) >= 15:
                        rsi_val = self._calc_rsi(closes)
                        if 30 < rsi_val < 55:  # RSI在30-55之间（偏低但没超卖）
                            rsi_ok = True
                    
                    # MACD条件（新增）
                    macd_ok = False
                    if len(closes) >= 26:
                        macd_result = self._calc_macd(closes)
                        if macd_result['histogram'] > 0 or macd_result['macd'] > macd_result['signal']:
                            macd_ok = True
                    
                    score = 0
                    if bullish_trend: score += 25
                    if near_ema20: score += 20
                    if stochrsi_trigger: score += 20
                    if rsi_ok: score += 15  # 新增
                    if macd_ok: score += 10  # 新增
                    if price > ema200: score += 10
                    
                    if score >= 55:  # 降到55（新增指标后更容易触发）
                        stop_loss = self.calc_atr_stop_loss(klines, price, "LONG", atr_mult=2.5)
                        reasoning = f"做多: EMA20>EMA50 dist={distance:+.1f}% StochRSI={srsi.get('zone','?')} RSI={rsi_val if 'rsi_val' in dir() else '?'} 得分={score}"
                        
                        opened = self.open_position(
                            symbol=sym, direction="LONG",
                            entry_price=price, stop_loss=stop_loss,
                            leverage=20, entry_type="trend_pullback_long",
                            take_profit=[price*1.03, price*1.05, price*1.10],
                            reasoning=reasoning,
                            klines_4h=klines,
                        )
                        if opened:
                            signals.append({"symbol": sym, "action": "LONG", "price": price, "leverage": 20, "score": score})
                            logger.info(f"📈 [major] 做多: {sym} @{price:.2f} 20x (得分{score})")
                
                # ===== 做空分支 =====
                bearish_trend = ema20 < ema50 and price < ema20
                if bearish_trend:
                    distance = (price / ema20 - 1) * 100
                    near_ema20 = -2 < distance < 3
                    
                    stochrsi_trigger = False
                    if srsi.get("valid"):
                        k, d = srsi["k"], srsi["d"]
                        zone = srsi["zone"]
                        if zone == "overbought" and k < d:
                            stochrsi_trigger = True
                        elif k > 75 and k < d:
                            stochrsi_trigger = True
                    
                    # RSI条件
                    rsi_ok = False
                    if len(closes) >= 15:
                        rsi_val = self._calc_rsi(closes)
                        if 45 < rsi_val < 70:  # RSI偏高但没超买
                            rsi_ok = True
                    
                    # MACD条件
                    macd_ok = False
                    if len(closes) >= 26:
                        macd_result = self._calc_macd(closes)
                        if macd_result['histogram'] < 0 or macd_result['macd'] < macd_result['signal']:
                            macd_ok = True
                    
                    score = 0
                    if bearish_trend: score += 25
                    if near_ema20: score += 20
                    if stochrsi_trigger: score += 20
                    if rsi_ok: score += 15
                    if macd_ok: score += 10
                    if price < ema200: score += 10
                    
                    if score >= 55:
                        stop_loss = self.calc_atr_stop_loss(klines, price, "SHORT", atr_mult=2.5)
                        reasoning = f"做空: EMA20<EMA50 dist={distance:+.1f}% StochRSI={srsi.get('zone','?')} RSI={rsi_val if 'rsi_val' in dir() else '?'} 得分={score}"
                        
                        opened = self.open_position(
                            symbol=sym, direction="SHORT",
                            entry_price=price, stop_loss=stop_loss,
                            leverage=15, entry_type="trend_rejection_short",
                            take_profit=[price*0.97, price*0.95, price*0.90],
                            reasoning=reasoning,
                            klines_4h=klines,
                        )
                        if opened:
                            signals.append({"symbol": sym, "action": "SHORT", "price": price, "leverage": 15, "score": score})
                            logger.info(f"📉 [major] 做空: {sym} @{price:.2f} 15x (得分{score})")
                
                if not bullish_trend and not bearish_trend:
                    logger.debug(f"[major] {sym} 震荡 EMA20={ema20:.1f} EMA50={ema50:.1f}")
                
            except Exception as e:
                logger.debug(f"[major] {sym} 分析失败: {e}")
            
            await asyncio.sleep(0.3)
        
        return signals
    
    async def check_positions(self, session: aiohttp.ClientSession):
        """检查持仓止损/止盈（支持多空）"""
        for sym in list(self.positions.keys()):
            try:
                url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sym}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    price = float((await resp.json()).get('price', 0))
                
                # 拉4h K线用于反馈分类
                klines = None
                try:
                    kurl = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=30"
                    async with session.get(kurl, timeout=aiohttp.ClientTimeout(total=5)) as kresp:
                        kraw = await kresp.json()
                    klines = [{"open": k[1], "high": k[2], "low": k[3], "close": k[4], "volume": k[5]} for k in kraw]
                except:
                    pass
                
                if price <= 0:
                    continue
                
                pos = self.positions.get(sym)
                if not pos:
                    continue
                
                if pos.direction == "LONG":
                    if price <= pos.stop_loss:
                        self.close_position(sym, price, "止损", klines_4h=klines)
                    elif pos.take_profit and price >= pos.take_profit[0]:
                        self.close_position(sym, price, f"止盈@{price:.2f}", klines_4h=klines)
                
                elif pos.direction == "SHORT":
                    # 做空止损：价格涨到stop_loss
                    if price >= pos.stop_loss:
                        self.close_position(sym, price, "止损", klines_4h=klines)
                    # 做空止盈：价格跌到take_profit
                    elif pos.take_profit and price <= pos.take_profit[0]:
                        self.close_position(sym, price, f"止盈@{price:.2f}", klines_4h=klines)
                    
            except Exception as e:
                logger.debug(f"[major] 检查 {sym} 失败: {e}")
