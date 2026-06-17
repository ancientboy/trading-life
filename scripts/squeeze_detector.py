"""
打新币 + 逼空检测 v21

策略1：新币上线策略
- Binance上线新合约 → 关注
- 等第一波砸盘后企稳 → 入场
- 首日放量大涨 → 追入

策略2：逼空检测
- 资金费率极端为负（空头极度拥挤）
- OI异常高 + 价格开始反弹
- 触发逼空 → 入场做多
"""

import json
import logging
import asyncio
import aiohttp
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR

logger = logging.getLogger("SqueezeDetector")

SQUEEZE_FILE = DATA_DIR / "squeeze_signals.json"


@dataclass
class SqueezeSignal:
    """逼空信号"""
    symbol: str
    funding_rate: float      # 资金费率
    oi_change_24h: float     # OI 24h变化%
    price_change_24h: float  # 价格24h变化%
    squeeze_score: int       # 逼空评分 0-100
    detail: str


@dataclass
class NewCoinSignal:
    """新币信号"""
    symbol: str
    days_listed: int        # 上线天数
    first_day_volume: float # 首日成交额
    price_action: str       # "surge" / "dump_and_stable" / "stable"
    new_coin_score: int     # 评分 0-100
    detail: str


# =============================================
# 逼空检测
# =============================================
async def detect_short_squeeze(session: aiohttp.ClientSession = None) -> List[SqueezeSignal]:
    """
    检测逼空机会
    
    条件：
    1. 资金费率 < -0.05%（空头极度拥挤）
    2. OI在增加（空头还在加仓）
    3. 价格开始反弹（空头开始被爆）
    """
    close_session = False
    if session is None:
        session = aiohttp.ClientSession()
        close_session = True
    
    signals = []
    
    try:
        # 1. 获取资金费率
        async with session.get(
            "https://fapi.binance.com/fapi/v1/premiumIndex",
            timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            premiums = await resp.json()
        
        # 筛选极端负费率
        extreme_neg = []
        for p in premiums:
            sym = p.get('symbol', '')
            if not sym.endswith('USDT'):
                continue
            rate = float(p.get('lastFundingRate', 0))
            if rate < -0.0005:  # < -0.05%
                extreme_neg.append({
                    'symbol': sym,
                    'rate': rate,
                    'price': float(p.get('markPrice', 0)),
                })
        
        # 2. 对每个极端费率币，检查价格和量
        for item in extreme_neg:
            sym = item['symbol']
            try:
                # 24h ticker
                async with session.get(
                    f"https://fapi.binance.com/fapi/v1/ticker/24hr?symbol={sym}",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    ticker = await resp.json()
                
                price_change = float(ticker.get('priceChangePercent', 0))
                volume = float(ticker.get('quoteVolume', 0))
                
                if volume < 5_000_000:  # 成交额太低跳过
                    continue
                
                # 评分
                score = 0
                parts = []
                
                # 费率极端程度
                rate_pct = item['rate'] * 100
                if rate_pct < -0.3:
                    score += 35
                    parts.append(f"极端费率{rate_pct:.2f}%")
                elif rate_pct < -0.1:
                    score += 25
                    parts.append(f"高度负费率{rate_pct:.2f}%")
                elif rate_pct < -0.05:
                    score += 15
                    parts.append(f"负费率{rate_pct:.2f}%")
                
                # 价格开始反弹（逼空启动）
                if price_change > 3:
                    score += 30
                    parts.append(f"价格反弹{price_change:+.1f}%")
                elif price_change > 0:
                    score += 15
                    parts.append(f"价格企稳{price_change:+.1f}%")
                elif price_change < -5:
                    score += 10  # 暴跌后的逼空潜力更大
                    parts.append(f"暴跌后{price_change:+.1f}%")
                
                # 成交量（活跃度高）
                if volume > 100_000_000:
                    score += 15
                    parts.append(f"高成交${volume/1e6:.0f}M")
                elif volume > 50_000_000:
                    score += 10
                
                if score >= 40:
                    signals.append(SqueezeSignal(
                        symbol=sym,
                        funding_rate=item['rate'],
                        oi_change_24h=0,  # OI数据后面补
                        price_change_24h=price_change,
                        squeeze_score=score,
                        detail=" | ".join(parts),
                    ))
                
            except Exception as e:
                logger.debug(f"逼空检测 {sym} 失败: {e}")
                continue
            
            await asyncio.sleep(0.2)
    
    finally:
        if close_session:
            await session.close()
    
    # 按分数排序
    signals.sort(key=lambda s: s.squeeze_score, reverse=True)
    return signals


# =============================================
# 新币检测
# =============================================
async def detect_new_coins(session: aiohttp.ClientSession = None) -> List[NewCoinSignal]:
    """
    检测新上线合约的机会
    
    条件：
    1. 上线 <= 7天
    2. 成交活跃
    3. 价格企稳或上涨
    """
    close_session = False
    if session is None:
        session = aiohttp.ClientSession()
        close_session = True
    
    signals = []
    
    try:
        # 获取交易所信息（含上线时间）
        async with session.get(
            "https://fapi.binance.com/fapi/v1/exchangeInfo",
            timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            info = await resp.json()
        
        now = datetime.now(timezone.utc)
        new_symbols = []
        
        for s in info.get('symbols', []):
            if s.get('status') != 'TRADING':
                continue
            onboard = s.get('onboardDate', 0)
            if not onboard:
                continue
            dt = datetime.fromtimestamp(onboard/1000, timezone.utc)
            days = (now - dt).days
            if 0 < days <= 7:
                new_symbols.append({'symbol': s['symbol'], 'days': days})
        
        # 获取新币的24h数据
        if new_symbols:
            async with session.get(
                "https://fapi.binance.com/fapi/v1/ticker/24hr",
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                tickers = {t['symbol']: t for t in await resp.json()}
            
            for ns in new_symbols:
                sym = ns['symbol']
                t = tickers.get(sym)
                if not t:
                    continue
                
                volume = float(t.get('quoteVolume', 0))
                price_change = float(t.get('priceChangePercent', 0))
                
                if volume < 1_000_000:  # 太不活跃
                    continue
                
                score = 0
                parts = []
                
                # 越新越好
                days = ns['days']
                if days <= 1:
                    score += 30
                    parts.append(f"首日上线")
                elif days <= 3:
                    score += 20
                    parts.append(f"上线{days}天")
                elif days <= 7:
                    score += 10
                    parts.append(f"上线{days}天")
                
                # 成交活跃
                if volume > 100_000_000:
                    score += 25
                    parts.append(f"高成交${volume/1e6:.0f}M")
                elif volume > 20_000_000:
                    score += 15
                    parts.append(f"成交${volume/1e6:.0f}M")
                
                # 价格表现
                if price_change > 10:
                    score += 20
                    parts.append(f"暴涨{price_change:+.1f}%")
                elif price_change > 0:
                    score += 10
                    parts.append(f"上涨{price_change:+.1f}%")
                elif -10 < price_change < 0:
                    score += 15  # 微跌后可能反弹
                    parts.append(f"微跌{price_change:+.1f}%(抄底机会)")
                
                if score >= 30:
                    # 判断价格形态
                    if price_change > 5:
                        action = "surge"
                    elif price_change < -3:
                        action = "dump_and_stable"
                    else:
                        action = "stable"
                    
                    signals.append(NewCoinSignal(
                        symbol=sym,
                        days_listed=days,
                        first_day_volume=volume,
                        price_action=action,
                        new_coin_score=score,
                        detail=" | ".join(parts),
                    ))
    
    finally:
        if close_session:
            await session.close()
    
    signals.sort(key=lambda s: s.new_coin_score, reverse=True)
    return signals


def format_squeeze_report(signals: List[SqueezeSignal]) -> str:
    lines = ["⚡ **逼空机会检测**"]
    if not signals:
        lines.append("暂无逼空信号")
    for s in signals[:5]:
        lines.append(f"🔥 {s.symbol} 评分={s.squeeze_score} | {s.detail}")
    return "\n".join(lines)


def format_newcoin_report(signals: List[NewCoinSignal]) -> str:
    lines = ["🆕 **新币机会**"]
    if not signals:
        lines.append("暂无新币信号")
    for s in signals[:5]:
        lines.append(f"📌 {s.symbol} 上线{s.days_listed}天 评分={s.new_coin_score} | {s.detail}")
    return "\n".join(lines)
