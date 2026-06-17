#!/usr/bin/env python3
"""
因子引擎 v1.0 - 不同数据因子适应不同策略

核心理念：
- Quick策略：用短期动量因子（1h surge, volume spike, order flow）
- Wave策略：用趋势突破因子（breakout, EMA alignment, volume pattern）
import aiohttp
- Newcoin策略：用上线初期因子（listing age, initial volume, price discovery）

每个策略有独立的因子权重体系，因子间有交互效应。
"""

import math
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from harness import calc_ema, calc_atr

logger = logging.getLogger("FactorEngine")


# ================================================================
# 因子定义
# ================================================================

@dataclass
class FactorResult:
    """单个因子计算结果"""
    name: str
    value: float          # 原始值
    normalized: float     # 归一化到0-100
    weight: float         # 在策略中的权重
    contribution: float   # 加权贡献值
    signal: str = "neutral"  # bullish/bearish/neutral


@dataclass
class FactorScore:
    """综合因子评分"""
    total_score: float     # 总分 0-100
    factors: List[FactorResult]
    strategy: str          # 适用策略
    regime: str            # 市场环境
    confidence: float      # 置信度 0-1
    recommendation: str    # buy/sell/hold


class FactorEngine:
    """因子引擎 - 不同因子组合驱动不同策略"""

    # ===== 策略-因子权重映射 =====
    STRATEGY_FACTORS = {
        "quick": {
            # 短期动量因子
            "surge_1h": 0.30,        # 1h涨幅
            "vol_surge_ratio": 0.15,  # 成交量放大比
            "vol_pattern": 0.10,      # 成交量形态
            "btc_regime": 0.05,       # BTC环境（降低权重，不因微跌停手）
            "price_position": 0.08,   # 价格位置（相对近期高低）
            "momentum_rsi": 0.07,     # 短期RSI
            "spread": 0.05,           # 波动率（日内振幅）
            "hour_of_day": 0.05,      # 交易时段
            "recent_win_rate": 0.05,  # 近期同策略胜率
            "volume_decay": 0.05,     # 量能衰减
            "consecutive_green": 0.05,# 连续阳线
        },
        "wave": {
            # 趋势突破因子
            "breakout_strength": 0.25,  # 突破强度
            "ema_alignment": 0.15,      # EMA排列
            "volume_breakout": 0.12,    # 突破放量
            "btc_regime": 0.05,         # BTC环境（降低权重）
            "atr_ratio": 0.08,          # ATR/价格比（波动率）
            "trend_duration": 0.08,     # 趋势持续时间
            "support_distance": 0.07,   # 距支撑位距离
            "higher_lows": 0.05,        # 更高低点数
            "volume_pattern": 0.05,     # 成交量形态
            "correlation_btc": 0.05,    # 与BTC相关性
            "spread": 0.05,             # 波动率
        },
        "newcoin": {
            # 上线初期因子
            "listing_age": 0.20,       # 上线天数
            "initial_volume": 0.15,    # 首日成交量
            "price_discovery": 0.15,   # 价格发现程度
            "volume_trend": 0.12,      # 成交量趋势
            "holder_growth": 0.10,     # 持仓量增长（proxy）
            "btc_regime": 0.08,        # BTC环境
            "listing_high_drop": 0.08, # 距上市高点回撤
            "recent_surge": 0.07,      # 近期异动
            "spread": 0.05,            # 波动率
        },
    }

    def __init__(self):
        self._recent_trades: Dict[str, List[dict]] = {}  # sym → 最近交易
        self._factor_cache: Dict[str, Tuple[float, dict]] = {}  # sym → (timestamp, factors)

    # ================================================================
    # 因子计算
    # ================================================================

    def calc_surge_1h(self, closes_1h: List[float]) -> FactorResult:
        """1h涨幅"""
        if len(closes_1h) < 6:
            return FactorResult("surge_1h", 0, 50, 0, 0)
        n = min(5, len(closes_1h) - 1)
        surge = (closes_1h[-1] / closes_1h[-(n+1)] - 1) * 100
        # 归一化：0%→50, 3%→70, 5%→80, 10%→95
        norm = min(50 + surge * 8, 100)
        signal = "bullish" if surge > 3 else ("bearish" if surge < -2 else "neutral")
        return FactorResult("surge_1h", round(surge, 2), round(norm, 1),
                          0, 0, signal)

    def calc_vol_surge_ratio(self, vols: List[float]) -> FactorResult:
        """成交量放大比"""
        if len(vols) < 15:
            return FactorResult("vol_surge_ratio", 1.0, 50, 0, 0)
        recent = sum(vols[-3:]) / 3
        older = sum(vols[-15:-3]) / 12
        ratio = recent / older if older > 0 else 1.0
        # 归一化：1x→50, 2x→70, 5x→90, 10x→100
        norm = min(50 + math.log2(max(ratio, 0.1)) * 15, 100)
        signal = "bullish" if ratio > 2 else ("bearish" if ratio < 0.5 else "neutral")
        return FactorResult("vol_surge_ratio", round(ratio, 2), round(norm, 1),
                          0, 0, signal)

    def calc_vol_pattern(self, vols: List[float]) -> FactorResult:
        """成交量形态：surge/climax/exhaustion/normal"""
        if len(vols) < 8:
            return FactorResult("vol_pattern", 0, 50, 0, 0)
        recent = sum(vols[-3:]) / 3
        older = sum(vols[-8:-3]) / 5 if len(vols) >= 8 else 1
        ratio = recent / older if older > 0 else 1

        if ratio > 5:
            pattern, norm, signal = "climax", 30, "bearish"  # 天量=见顶
        elif ratio > 2:
            pattern, norm, signal = "surge", 80, "bullish"   # 放量=健康
        elif ratio < 0.5:
            pattern, norm, signal = "exhaustion", 20, "bearish"  # 缩量=衰竭
        else:
            pattern, norm, signal = "normal", 50, "neutral"

        return FactorResult("vol_pattern", round(ratio, 2), norm,
                          0, 0, signal)

    def calc_btc_regime(self, btc_24h_change: float,
                        btc_4h_trend: str = "neutral") -> FactorResult:
        """BTC环境"""
        # 结合24h涨跌和4h趋势
        if btc_24h_change > 3:
            norm, signal = 90, "bullish"
        elif btc_24h_change > 1:
            norm, signal = 75, "bullish"
        elif btc_24h_change > 0:
            norm, signal = 60, "neutral"
        elif btc_24h_change > -1:
            norm, signal = 45, "neutral"
        elif btc_24h_change > -2:
            norm, signal = 30, "bearish"
        else:
            norm, signal = 15, "bearish"

        # 4h趋势加成
        if btc_4h_trend == "up":
            norm = min(norm + 10, 100)
        elif btc_4h_trend == "down":
            norm = max(norm - 10, 0)

        return FactorResult("btc_regime", round(btc_24h_change, 2),
                          norm, 0, 0, signal)

    def calc_price_position(self, closes: List[float]) -> FactorResult:
        """价格位置：在近期高低区间的位置"""
        if len(closes) < 20:
            return FactorResult("price_position", 0, 50, 0, 0)
        high = max(closes[-20:])
        low = min(closes[-20:])
        price = closes[-1]
        if high == low:
            pos = 50
        else:
            pos = (price - low) / (high - low) * 100
        # 归一化：价格在高位更bullish（对追涨策略）
        # 但太高（>95%）要警惕
        if pos > 95:
            norm, signal = 40, "bearish"  # 太高了
        elif pos > 80:
            norm, signal = 85, "bullish"  # 突破区间
        elif pos > 50:
            norm, signal = 70, "bullish"
        else:
            norm, signal = 30, "bearish"

        return FactorResult("price_position", round(pos, 1), norm,
                          0, 0, signal)

    def calc_momentum_rsi(self, closes: List[float], period: int = 14) -> FactorResult:
        """短期RSI"""
        if len(closes) < period + 1:
            return FactorResult("momentum_rsi", 50, 50, 0, 0)

        gains, losses = [], []
        for i in range(1, len(closes)):
            change = closes[i] - closes[i-1]
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))

        if len(gains) < period:
            return FactorResult("momentum_rsi", 50, 50, 0, 0)

        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period

        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))

        # 对于追涨策略：RSI 50-70最好（强势但没超买）
        if 50 <= rsi <= 70:
            norm, signal = 80, "bullish"
        elif 70 < rsi <= 80:
            norm, signal = 50, "neutral"  # 超买区
        elif rsi > 80:
            norm, signal = 25, "bearish"  # 严重超买
        elif 30 <= rsi < 50:
            norm, signal = 40, "neutral"
        else:
            norm, signal = 20, "bearish"

        return FactorResult("momentum_rsi", round(rsi, 1), norm,
                          0, 0, signal)

    def calc_spread(self, closes: List[float]) -> FactorResult:
        """波动率（日内振幅比）"""
        if len(closes) < 10:
            return FactorResult("spread", 0, 50, 0, 0)
        returns = [(closes[i] - closes[i-1]) / closes[i-1]
                   for i in range(1, len(closes)) if closes[i-1] > 0]
        if not returns:
            return FactorResult("spread", 0, 50, 0, 0)

        vol = math.sqrt(sum(r**2 for r in returns) / len(returns)) * 100

        # 适中波动率最好（2-5%）
        if 2 <= vol <= 5:
            norm = 80
        elif 1 <= vol < 2:
            norm = 60  # 波动太低
        elif 5 < vol <= 8:
            norm = 50  # 波动偏高
        else:
            norm = 30  # 波动太高或太低

        return FactorResult("spread", round(vol, 2), norm, 0, 0,
                          "bullish" if 2 <= vol <= 5 else "neutral")

    def calc_hour_of_day(self, hour_utc: int) -> FactorResult:
        """交易时段因子"""
        # 亚盘(0-8): 低活跃 → 40
        # 欧盘(8-14): 中活跃 → 60
        # 美盘(14-21): 高活跃 → 80
        # 美盘收盘(21-24): 中活跃 → 60
        if 14 <= hour_utc < 21:
            norm = 80
            label = "US"
        elif 8 <= hour_utc < 14:
            norm = 60
            label = "EU"
        elif 21 <= hour_utc:
            norm = 55
            label = "US-close"
        else:
            norm = 40
            label = "Asia"

        return FactorResult("hour_of_day", hour_utc, norm, 0, 0,
                          "bullish" if norm >= 60 else "neutral")

    def calc_breakout_strength(self, closes: List[float],
                                n: int = 20) -> FactorResult:
        """突破强度"""
        if len(closes) <= n:
            return FactorResult("breakout_strength", 0, 50, 0, 0)
        high_n = max(closes[-(n+1):-1])
        price = closes[-1]
        breakout_pct = (price / high_n - 1) * 100

        # 归一化：0%→30, 1%→60, 3%→80, 5%→95
        norm = min(30 + breakout_pct * 15, 100)
        signal = "bullish" if breakout_pct > 1 else "neutral"
        return FactorResult("breakout_strength", round(breakout_pct, 2),
                          round(norm, 1), 0, 0, signal)

    def calc_ema_alignment(self, closes: List[float]) -> FactorResult:
        """EMA排列（多头/空头排列）"""
        if len(closes) < 50:
            return FactorResult("ema_alignment", 0, 50, 0, 0)
        ema10 = calc_ema(closes, 10)
        ema20 = calc_ema(closes, 20)
        ema50 = calc_ema(closes, 50)
        price = closes[-1]

        # 多头排列：price > ema10 > ema20 > ema50
        if price > ema10 > ema20 > ema50:
            norm, signal = 90, "bullish"
        elif price > ema10 > ema20:
            norm, signal = 75, "bullish"
        elif price > ema10:
            norm, signal = 60, "neutral"
        elif price < ema10 < ema20 < ema50:
            norm, signal = 15, "bearish"
        elif price < ema10 < ema20:
            norm, signal = 25, "bearish"
        else:
            norm, signal = 40, "neutral"

        return FactorResult("ema_alignment", round(ema10 - ema20, 4),
                          norm, 0, 0, signal)

    def calc_atr_ratio(self, closes: List[float],
                       highs: List[float], lows: List[float]) -> FactorResult:
        """ATR/价格比"""
        if len(closes) < 14:
            return FactorResult("atr_ratio", 0, 50, 0, 0)
        # 简化ATR计算
        trs = []
        for i in range(1, min(14, len(closes))):
            tr = max(highs[i] - lows[i],
                    abs(highs[i] - closes[i-1]),
                    abs(lows[i] - closes[i-1]))
            trs.append(tr)
        atr = sum(trs) / len(trs) if trs else 0
        atr_pct = atr / closes[-1] * 100 if closes[-1] > 0 else 0

        # ATR 2-5%适中
        if 2 <= atr_pct <= 5:
            norm = 80
        elif 1 <= atr_pct < 2:
            norm = 55
        elif 5 < atr_pct <= 8:
            norm = 40
        else:
            norm = 25

        return FactorResult("atr_ratio", round(atr_pct, 2), norm,
                          0, 0, "bullish" if 2 <= atr_pct <= 5 else "neutral")

    def calc_consecutive_green(self, closes: List[float]) -> FactorResult:
        """连续阳线"""
        count = 0
        for i in range(len(closes)-1, 0, -1):
            if closes[i] > closes[i-1]:
                count += 1
            else:
                break

        # 3-5根最好（趋势中），>7根过热
        if 3 <= count <= 5:
            norm = 80
        elif 6 <= count <= 7:
            norm = 50
        elif count > 7:
            norm = 25  # 过热
        elif count >= 1:
            norm = 60
        else:
            norm = 30

        return FactorResult("consecutive_green", count, norm, 0, 0,
                          "bullish" if 3 <= count <= 5 else "neutral")

    def calc_volume_decay(self, vols: List[float]) -> FactorResult:
        """量能衰减"""
        if len(vols) < 10:
            return FactorResult("volume_decay", 0, 50, 0, 0)
        recent = sum(vols[-3:]) / 3
        mid = sum(vols[-6:-3]) / 3 if len(vols) >= 6 else recent
        decay = recent / mid if mid > 0 else 1

        # 衰减<0.7=量缩（不好），>1.2=放量（好）
        if decay > 1.5:
            norm = 85
        elif decay > 1.0:
            norm = 65
        elif decay > 0.7:
            norm = 40
        else:
            norm = 20  # 严重缩量

        return FactorResult("volume_decay", round(decay, 2), norm,
                          0, 0, "bullish" if decay > 1.2 else "neutral")

    def calc_support_distance(self, closes: List[float]) -> FactorResult:
        """距支撑位距离"""
        if len(closes) < 20:
            return FactorResult("support_distance", 0, 50, 0, 0)
        low_20 = min(closes[-20:])
        price = closes[-1]
        dist = (price / low_20 - 1) * 100

        # 距支撑3-10%最好（有空间但不太远）
        if 3 <= dist <= 10:
            norm = 75
        elif 1 <= dist < 3:
            norm = 85  # 接近支撑=安全
        elif 10 < dist <= 20:
            norm = 50
        else:
            norm = 30

        return FactorResult("support_distance", round(dist, 1), norm,
                          0, 0, "bullish" if dist < 10 else "neutral")

    def calc_higher_lows(self, closes: List[float]) -> FactorResult:
        """更高低点数"""
        if len(closes) < 10:
            return FactorResult("higher_lows", 0, 50, 0, 0)
        # 找最近5个低点
        lows = []
        for i in range(max(0, len(closes)-20), len(closes)-1):
            if closes[i] < closes[i-1] and closes[i] < closes[i+1]:
                lows.append(closes[i])

        if len(lows) < 2:
            return FactorResult("higher_lows", 0, 50, 0, 0)

        higher = sum(1 for i in range(1, len(lows)) if lows[i] > lows[i-1])
        ratio = higher / (len(lows) - 1) * 100

        norm = 40 + ratio * 0.5
        return FactorResult("higher_lows", round(ratio, 1), round(norm, 1),
                          0, 0, "bullish" if ratio > 60 else "neutral")

    def calc_listing_age(self, listing_date, now=None) -> FactorResult:
        """上线天数"""
        from datetime import datetime, timezone
        if now is None:
            now = datetime.now(timezone.utc)
        if listing_date is None:
            return FactorResult("listing_age", 999, 30, 0, 0)
        days = (now - listing_date).days

        # 3-30天最活跃
        if 3 <= days <= 30:
            norm = 90
        elif 30 < days <= 60:
            norm = 70
        elif 1 <= days < 3:
            norm = 50  # 太新
        elif 60 < days <= 90:
            norm = 40
        else:
            norm = 25

        return FactorResult("listing_age", days, norm, 0, 0,
                          "bullish" if 3 <= days <= 60 else "neutral")

    def calc_listing_high_drop(self, closes: List[float]) -> FactorResult:
        """距上市高点回撤"""
        if len(closes) < 5:
            return FactorResult("listing_high_drop", 0, 50, 0, 0)
        high = max(closes)
        price = closes[-1]
        drop = (1 - price / high) * 100

        # 回撤20-50%是好的买入区间
        if 20 <= drop <= 50:
            norm = 80
        elif 50 < drop <= 70:
            norm = 60
        elif 10 <= drop < 20:
            norm = 65
        elif drop < 10:
            norm = 85  # 还在高位/新高
        else:
            norm = 30  # 跌太多

        return FactorResult("listing_high_drop", round(drop, 1), norm,
                          0, 0, "bullish" if drop < 50 else "neutral")

    # ================================================================
    # 综合评分
    # ================================================================

    def score_quick(self, closes_1h: List[float], vols_1h: List[float],
                    btc_24h_change: float, btc_4h_trend: str = "neutral",
                    hour_utc: int = 12) -> FactorScore:
        """快钱模式因子评分"""
        factors = []
        weights = self.STRATEGY_FACTORS["quick"]

        # 计算各因子
        factor_calcs = {
            "surge_1h": self.calc_surge_1h(closes_1h),
            "vol_surge_ratio": self.calc_vol_surge_ratio(vols_1h),
            "vol_pattern": self.calc_vol_pattern(vols_1h),
            "btc_regime": self.calc_btc_regime(btc_24h_change, btc_4h_trend),
            "price_position": self.calc_price_position(closes_1h),
            "momentum_rsi": self.calc_momentum_rsi(closes_1h),
            "spread": self.calc_spread(closes_1h),
            "hour_of_day": self.calc_hour_of_day(hour_utc),
            "volume_decay": self.calc_volume_decay(vols_1h),
            "consecutive_green": self.calc_consecutive_green(closes_1h),
        }

        # 加权求和
        total = 0
        total_weight = 0
        for name, factor in factor_calcs.items():
            w = weights.get(name, 0)
            factor.weight = w
            factor.contribution = factor.normalized * w
            total += factor.contribution
            total_weight += w
            factors.append(factor)

        score = total / total_weight if total_weight > 0 else 50

        # 置信度：因子一致性
        bullish = sum(1 for f in factors if f.signal == "bullish")
        bearish = sum(1 for f in factors if f.signal == "bearish")
        confidence = (bullish + (len(factors) - bearish)) / len(factors) if factors else 0.5

        rec = "buy" if score > 65 and confidence > 0.6 else (
              "sell" if score < 35 else "hold")

        return FactorScore(
            total_score=round(score, 1),
            factors=factors,
            strategy="quick",
            regime=btc_4h_trend,
            confidence=round(confidence, 2),
            recommendation=rec,
        )

    def score_wave(self, closes_4h: List[float], vols_4h: List[float],
                    highs_4h: List[float], lows_4h: List[float],
                    btc_24h_change: float, btc_4h_trend: str = "neutral",
                    breakout_bars: int = 20) -> FactorScore:
        """波段模式因子评分"""
        factors = []
        weights = self.STRATEGY_FACTORS["wave"]

        factor_calcs = {
            "breakout_strength": self.calc_breakout_strength(closes_4h, breakout_bars),
            "ema_alignment": self.calc_ema_alignment(closes_4h),
            "volume_breakout": self.calc_vol_surge_ratio(vols_4h),
            "btc_regime": self.calc_btc_regime(btc_24h_change, btc_4h_trend),
            "atr_ratio": self.calc_atr_ratio(closes_4h, highs_4h, lows_4h),
            "support_distance": self.calc_support_distance(closes_4h),
            "higher_lows": self.calc_higher_lows(closes_4h),
            "volume_pattern": self.calc_vol_pattern(vols_4h),
            "spread": self.calc_spread(closes_4h),
        }

        total = 0
        total_weight = 0
        for name, factor in factor_calcs.items():
            w = weights.get(name, 0)
            factor.weight = w
            factor.contribution = factor.normalized * w
            total += factor.contribution
            total_weight += w
            factors.append(factor)

        score = total / total_weight if total_weight > 0 else 50

        bullish = sum(1 for f in factors if f.signal == "bullish")
        bearish = sum(1 for f in factors if f.signal == "bearish")
        confidence = (bullish + (len(factors) - bearish)) / len(factors) if factors else 0.5

        rec = "buy" if score > 65 and confidence > 0.6 else (
              "sell" if score < 35 else "hold")

        return FactorScore(
            total_score=round(score, 1),
            factors=factors,
            strategy="wave",
            regime=btc_4h_trend,
            confidence=round(confidence, 2),
            recommendation=rec,
        )

    def score_newcoin(self, closes_4h: List[float], vols_4h: List[float],
                      listing_date, btc_24h_change: float) -> FactorScore:
        """新币模式因子评分"""
        factors = []
        weights = self.STRATEGY_FACTORS["newcoin"]

        from datetime import datetime, timezone
        factor_calcs = {
            "listing_age": self.calc_listing_age(listing_date),
            "initial_volume": self.calc_vol_surge_ratio(vols_4h),
            "price_discovery": self.calc_price_position(closes_4h),
            "volume_trend": self.calc_volume_decay(vols_4h),
            "btc_regime": self.calc_btc_regime(btc_24h_change),
            "listing_high_drop": self.calc_listing_high_drop(closes_4h),
            "spread": self.calc_spread(closes_4h),
        }

        total = 0
        total_weight = 0
        for name, factor in factor_calcs.items():
            w = weights.get(name, 0)
            factor.weight = w
            factor.contribution = factor.normalized * w
            total += factor.contribution
            total_weight += w
            factors.append(factor)

        score = total / total_weight if total_weight > 0 else 50

        bullish = sum(1 for f in factors if f.signal == "bullish")
        bearish = sum(1 for f in factors if f.signal == "bearish")
        confidence = (bullish + (len(factors) - bearish)) / len(factors) if factors else 0.5

        rec = "buy" if score > 65 and confidence > 0.6 else (
              "sell" if score < 35 else "hold")

        return FactorScore(
            total_score=round(score, 1),
            factors=factors,
            strategy="newcoin",
            regime="neutral",
            confidence=round(confidence, 2),
            recommendation=rec,
        )

    # ================================================================
    # 市场微观结构因子（订单簿/资金费率/OI/多空比/聪明钱）
    # ================================================================

    def calc_orderbook_imbalance(self, depth: dict) -> FactorResult:
        """订单簿失衡因子"""
        bids = depth.get("bids", [])
        asks = depth.get("asks", [])
        if not bids or not asks:
            return FactorResult("orderbook_imbalance", 0, 50, 0, 0)
        bid_vol = sum(float(b[1]) for b in bids[:5])
        ask_vol = sum(float(a[1]) for a in asks[:5])
        total = bid_vol + ask_vol
        if total == 0:
            return FactorResult("orderbook_imbalance", 0, 50, 0, 0)
        imbalance = (bid_vol - ask_vol) / total
        norm = 50 + imbalance * 40
        norm = max(10, min(90, norm))
        signal = "bullish" if imbalance > 0.15 else ("bearish" if imbalance < -0.15 else "neutral")
        return FactorResult("orderbook_imbalance", round(imbalance, 3), round(norm, 1), 0, 0, signal)

    def calc_funding_rate_factor(self, funding_rate: float) -> FactorResult:
        """资金费率因子"""
        if funding_rate >= 0.001:
            norm, signal = 20, "bearish"
        elif funding_rate >= 0.0005:
            norm, signal = 35, "neutral"
        elif funding_rate >= 0.0001:
            norm, signal = 60, "neutral"
        elif funding_rate >= -0.0001:
            norm, signal = 50, "neutral"
        elif funding_rate >= -0.0005:
            norm, signal = 65, "bullish"
        elif funding_rate >= -0.001:
            norm, signal = 75, "bullish"
        else:
            norm, signal = 85, "bullish"
        return FactorResult("funding_rate", round(funding_rate, 6), norm, 0, 0, signal)

    def calc_oi_change_factor(self, oi_change_pct: float, price_change_pct: float) -> FactorResult:
        """持仓量变化因子"""
        if oi_change_pct > 5 and price_change_pct > 2:
            norm, signal = 80, "bullish"
        elif oi_change_pct > 5 and price_change_pct < -2:
            norm, signal = 25, "bearish"
        elif oi_change_pct < -5 and price_change_pct > 2:
            norm, signal = 55, "neutral"
        elif oi_change_pct < -5 and price_change_pct < -2:
            norm, signal = 65, "bullish"
        elif oi_change_pct > 2:
            norm, signal = 60, "neutral"
        elif oi_change_pct < -2:
            norm, signal = 45, "neutral"
        else:
            norm, signal = 50, "neutral"
        return FactorResult("oi_change", round(oi_change_pct, 1), norm, 0, 0, signal)

    def calc_smart_money_factor(self, ls_ratio: float, top_ratio: float, taker_ratio: float) -> FactorResult:
        """聪明钱因子"""
        smart_score = 0
        if top_ratio > 1.3: smart_score += 30
        elif top_ratio > 1.0: smart_score += 10
        elif top_ratio < 0.7: smart_score -= 30
        elif top_ratio < 1.0: smart_score -= 10
        if ls_ratio > 2.0: smart_score -= 20
        elif ls_ratio > 1.5: smart_score -= 10
        elif ls_ratio < 0.7: smart_score += 20
        elif ls_ratio < 1.0: smart_score += 10
        if taker_ratio > 1.2: smart_score += 10
        elif taker_ratio < 0.8: smart_score -= 10
        norm = max(10, min(90, 50 + smart_score))
        signal = "bullish" if smart_score > 15 else ("bearish" if smart_score < -15 else "neutral")
        return FactorResult("smart_money", round((ls_ratio + top_ratio + taker_ratio) / 3, 2), norm, 0, 0, signal)

    # ================================================================
    # 异步数据拉取
    # ================================================================

    async def fetch_orderbook(self, session, symbol: str, limit: int = 10) -> Optional[dict]:
        try:
            url = f"https://fapi.binance.com/fapi/v1/depth?symbol={symbol}&limit={limit}"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                return await resp.json()
        except:
            return None

    async def fetch_funding_rate(self, session, symbol: str) -> Optional[float]:
        try:
            url = f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbol}&limit=1"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                data = await resp.json()
            if data and len(data) > 0:
                return float(data[0].get("fundingRate", 0))
        except:
            pass
        return None

    async def fetch_oi_history(self, session, symbol: str, period: str = "4h", limit: int = 6) -> Optional[list]:
        try:
            url = f"https://fapi.binance.com/futures/data/openInterestHist?symbol={symbol}&period={period}&limit={limit}"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                return await resp.json()
        except:
            return None

    async def fetch_long_short_ratio(self, session, symbol: str, period: str = "4h", limit: int = 3) -> Optional[dict]:
        try:
            import asyncio as _aio
            ls_url = f"https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol={symbol}&period={period}&limit={limit}"
            top_url = f"https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol={symbol}&period={period}&limit={limit}"
            taker_url = f"https://fapi.binance.com/futures/data/takerlongshortRatio?symbol={symbol}&period={period}&limit={limit}"
            ls_resp, top_resp, taker_resp = await _aio.gather(
                session.get(ls_url, timeout=aiohttp.ClientTimeout(total=3)),
                session.get(top_url, timeout=aiohttp.ClientTimeout(total=3)),
                session.get(taker_url, timeout=aiohttp.ClientTimeout(total=3)),
            )
            ls_data, top_data, taker_data = await ls_resp.json(), await top_resp.json(), await taker_resp.json()
            ls_ratio = float(ls_data[0]["longShortRatio"]) if ls_data and len(ls_data) > 0 else 1.0
            top_ratio = float(top_data[0]["longShortRatio"]) if top_data and len(top_data) > 0 else 1.0
            taker_ratio = float(taker_data[0]["buySellRatio"]) if taker_data and len(taker_data) > 0 else 1.0
            return {"ls_ratio": ls_ratio, "top_ratio": top_ratio, "taker_ratio": taker_ratio}
        except:
            return None

    async def fetch_market_microstructure(self, session, symbol: str) -> Optional[dict]:
        """一键拉取所有微观结构数据"""
        try:
            import asyncio as _aio
            results = await _aio.gather(
                self.fetch_orderbook(session, symbol),
                self.fetch_funding_rate(session, symbol),
                self.fetch_oi_history(session, symbol),
                self.fetch_long_short_ratio(session, symbol),
                return_exceptions=True,
            )
            depth = results[0] if not isinstance(results[0], Exception) else None
            funding = results[1] if not isinstance(results[1], Exception) else None
            oi_hist = results[2] if not isinstance(results[2], Exception) else None
            ls_data = results[3] if not isinstance(results[3], Exception) else None
            oi_change = 0
            if oi_hist and len(oi_hist) >= 2:
                try:
                    latest = float(oi_hist[-1].get("sumOpenInterest", 0))
                    older = float(oi_hist[0].get("sumOpenInterest", 0))
                    if older > 0: oi_change = (latest - older) / older * 100
                except: pass
            return {
                "depth": depth, "funding_rate": funding, "oi_change_pct": oi_change,
                "ls_ratio": ls_data.get("ls_ratio", 1.0) if ls_data else 1.0,
                "top_ratio": ls_data.get("top_ratio", 1.0) if ls_data else 1.0,
                "taker_ratio": ls_data.get("taker_ratio", 1.0) if ls_data else 1.0,
            }
        except:
            return None

    # ================================================================
    # 增强评分（含微观结构）
    # ================================================================

    def _blend_score(self, base: FactorScore, extra_factors: List[FactorResult],
                     ms_blend: float = 0.25) -> FactorScore:
        """混合基础+微观结构评分"""
        if not extra_factors:
            return base
        ms_total = sum(f.normalized * f.weight for f in extra_factors)
        ms_weight_sum = sum(f.weight for f in extra_factors)
        ms_score = ms_total / ms_weight_sum if ms_weight_sum > 0 else 50
        final_score = base.total_score * (1 - ms_blend) + ms_score * ms_blend
        all_factors = base.factors + extra_factors
        bullish = sum(1 for f in all_factors if f.signal == "bullish")
        bearish = sum(1 for f in all_factors if f.signal == "bearish")
        confidence = (bullish + (len(all_factors) - bearish)) / len(all_factors) if all_factors else 0.5
        rec = "buy" if final_score > 65 and confidence > 0.6 else ("sell" if final_score < 35 else "hold")
        return FactorScore(
            total_score=round(final_score, 1), factors=all_factors,
            strategy=base.strategy, regime=base.regime,
            confidence=round(confidence, 2), recommendation=rec,
        )

    def score_quick_enhanced(self, closes_1h, vols_1h, btc_24h_change,
                              btc_4h_trend="neutral", hour_utc=12,
                              microstructure=None) -> FactorScore:
        base = self.score_quick(closes_1h, vols_1h, btc_24h_change, btc_4h_trend, hour_utc)
        if microstructure is None: return base
        ms = microstructure
        extras = []
        if ms.get("depth"):
            f = self.calc_orderbook_imbalance(ms["depth"]); f.weight = 0.08; extras.append(f)
        if ms.get("funding_rate") is not None:
            f = self.calc_funding_rate_factor(ms["funding_rate"]); f.weight = 0.06; extras.append(f)
        if ms.get("oi_change_pct") is not None:
            pchg = (closes_1h[-1]/closes_1h[max(0,len(closes_1h)-4)]-1)*100 if len(closes_1h)>3 else 0
            f = self.calc_oi_change_factor(ms["oi_change_pct"], pchg); f.weight = 0.06; extras.append(f)
        if ms.get("ls_ratio"):
            f = self.calc_smart_money_factor(ms["ls_ratio"], ms.get("top_ratio",1), ms.get("taker_ratio",1))
            f.weight = 0.05; extras.append(f)
        return self._blend_score(base, extras, 0.25)

    def score_wave_enhanced(self, closes_4h, vols_4h, highs_4h, lows_4h,
                             btc_24h_change, btc_4h_trend="neutral", breakout_bars=20,
                             microstructure=None) -> FactorScore:
        base = self.score_wave(closes_4h, vols_4h, highs_4h, lows_4h, btc_24h_change, btc_4h_trend, breakout_bars)
        if microstructure is None: return base
        ms = microstructure
        extras = []
        if ms.get("depth"):
            f = self.calc_orderbook_imbalance(ms["depth"]); f.weight = 0.06; extras.append(f)
        if ms.get("funding_rate") is not None:
            f = self.calc_funding_rate_factor(ms["funding_rate"]); f.weight = 0.07; extras.append(f)
        if ms.get("oi_change_pct") is not None:
            pchg = (closes_4h[-1]/closes_4h[max(0,len(closes_4h)-4)]-1)*100 if len(closes_4h)>3 else 0
            f = self.calc_oi_change_factor(ms["oi_change_pct"], pchg); f.weight = 0.07; extras.append(f)
        if ms.get("ls_ratio"):
            f = self.calc_smart_money_factor(ms["ls_ratio"], ms.get("top_ratio",1), ms.get("taker_ratio",1))
            f.weight = 0.05; extras.append(f)
        return self._blend_score(base, extras, 0.25)

    def format_score(self, score: FactorScore) -> str:
        """格式化因子评分报告"""
        lines = [f"📊 Factor Score [{score.strategy}] = {score.total_score:.1f} "
                f"(confidence={score.confidence:.0%}) recommend={score.recommendation}"]
        for f in sorted(score.factors, key=lambda x: -x.contribution):
            bar = "🟢" if f.signal == "bullish" else ("🔴" if f.signal == "bearish" else "⚪")
            lines.append(f"  {bar} {f.name:20s}: {f.value:>8} → {f.normalized:5.0f} ×{f.weight:.2f} = {f.contribution:5.1f}")
        return "\n".join(lines)
