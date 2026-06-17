"""
启动前信号检测器 v21

检测币种启动前的三个关键信号：
1. 量价背离（吸筹）— 连续放量但价格不动
2. 均线粘合 — 多均线收窄到极致，变盘前夜
3. 缩量极值 — 成交量缩到极致，洗盘结束

完整启动链条：
吸筹（量增价平）→ 洗盘（缩量极值）→ 均线粘合 → 突破放量 → 入场
"""

import logging
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger("PreLaunchDetector")


@dataclass
class PreLaunchSignal:
    """启动前信号"""
    symbol: str
    signal_type: str  # "accumulation" / "ma_squeeze" / "volume_dry"
    score: int        # 0-100
    detail: str
    phase: str        # "吸筹" / "洗盘" / "变盘前夜"


def calc_ema(values: List[float], period: int) -> float:
    """计算EMA"""
    if len(values) < period:
        return values[-1] if values else 0
    k = 2 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def calc_sma(values: List[float], period: int) -> float:
    if len(values) < period:
        return sum(values) / len(values) if values else 0
    return sum(values[-period:]) / period


# =============================================
# 1. 量价背离检测（吸筹信号）
# =============================================
def detect_accumulation(
    klines_4h: List[dict],
    min_bars: int = 18,  # 至少18根4h = 3天
) -> Optional[PreLaunchSignal]:
    """
    量价背离 = 吸筹信号
    
    条件：
    - 后半段成交量 > 前半段（放量）
    - 但价格涨幅很小（<3%）
    - K线实体小（上下影线多）
    
    Args:
        klines_4h: 4h K线数据
    """
    if len(klines_4h) < min_bars:
        return None
    
    closes = [float(k.get('close', 0)) for k in klines_4h]
    highs = [float(k.get('high', 0)) for k in klines_4h]
    lows = [float(k.get('low', 0)) for k in klines_4h]
    volumes = [float(k.get('volume', 0)) for k in klines_4h]
    
    if any(c == 0 for c in closes):
        return None
    
    # 取最近N根分析
    n = min(len(closes), 30)
    recent_c = closes[-n:]
    recent_h = highs[-n:]
    recent_l = lows[-n:]
    recent_v = volumes[-n:]
    
    half = n // 2
    
    # 1. 后半段量 > 前半段（放量）
    vol_first = sum(recent_v[:half])
    vol_second = sum(recent_v[half:])
    if vol_first == 0:
        return None
    vol_ratio = vol_second / vol_first
    
    # 2. 价格变化小
    price_change_pct = (recent_c[-1] / recent_c[0] - 1) * 100
    
    # 3. K线实体大小（平均实体占比）
    body_ratios = []
    for i in range(n):
        total_range = recent_h[i] - recent_l[i]
        if total_range > 0:
            body = abs(recent_c[i] - float(klines_4h[-n+i].get('open', recent_c[i])))
            body_ratios.append(body / total_range)
    avg_body_ratio = sum(body_ratios) / len(body_ratios) if body_ratios else 1
    
    # 4. 下影线多（支撑强）
    lower_wick_count = 0
    for i in range(n):
        o = float(klines_4h[-n+i].get('open', recent_c[i]))
        c = recent_c[i]
        low = recent_l[i]
        body_low = min(o, c)
        total_range = recent_h[i] - low
        if total_range > 0:
            lower_wick = (body_low - low) / total_range
            if lower_wick > 0.4:  # 下影线占比>40%
                lower_wick_count += 1
    
    # === 评分 ===
    score = 0
    
    # 放量程度
    if vol_ratio >= 2.0:
        score += 35
    elif vol_ratio >= 1.5:
        score += 25
    elif vol_ratio >= 1.2:
        score += 15
    
    # 价格稳定度（越稳分越高）
    if abs(price_change_pct) <= 1.0:
        score += 30
    elif abs(price_change_pct) <= 3.0:
        score += 20
    elif abs(price_change_pct) <= 5.0:
        score += 10
    
    # K线实体小（十字星/小阳小阴多）
    if avg_body_ratio <= 0.3:
        score += 20
    elif avg_body_ratio <= 0.5:
        score += 10
    
    # 下影线多
    if lower_wick_count >= n * 0.4:
        score += 15
    elif lower_wick_count >= n * 0.3:
        score += 8
    
    if score < 30:
        return None
    
    detail = (
        f"量价背离{min(n,30)}根4h: "
        f"量比={vol_ratio:.1f}x "
        f"价变={price_change_pct:+.1f}% "
        f"实体比={avg_body_ratio:.2f} "
        f"下影线={lower_wick_count}/{n}"
    )
    
    return PreLaunchSignal(
        symbol="",
        signal_type="accumulation",
        score=score,
        detail=detail,
        phase="吸筹",
    )


# =============================================
# 2. 均线粘合检测（变盘前夜）
# =============================================
def detect_ma_squeeze(
    klines_4h: List[dict],
) -> Optional[PreLaunchSignal]:
    """
    均线粘合 = 变盘前夜
    
    条件：
    - EMA5/10/20/50 四条均线距离收窄
    - 距离越窄 → 越接近变盘
    - 价格在均线束附近
    """
    closes = [float(k.get('close', 0)) for k in klines_4h if float(k.get('close', 0)) > 0]
    if len(closes) < 55:
        return None
    
    price = closes[-1]
    ema5 = calc_ema(closes, 5)
    ema10 = calc_ema(closes, 10)
    ema20 = calc_ema(closes, 20)
    ema50 = calc_ema(closes, 50)
    
    emas = [ema5, ema10, ema20, ema50]
    
    # 均线束的最大距离（相对价格）
    max_ema = max(emas)
    min_ema = min(emas)
    if price == 0:
        return None
    
    spread_pct = (max_ema - min_ema) / price * 100  # 均线束宽度%
    
    # 价格与均线束的关系
    avg_ema = sum(emas) / len(emas)
    price_vs_ema = (price / avg_ema - 1) * 100
    
    # 均线趋势：短期在上还是长期在上
    bullish_align = ema5 > ema10 > ema20  # 部分多头排列
    
    # === 评分 ===
    score = 0
    
    # 粘合程度（越窄越好）
    if spread_pct <= 1.0:
        score += 40  # 极度粘合
    elif spread_pct <= 2.0:
        score += 30
    elif spread_pct <= 3.0:
        score += 20
    elif spread_pct <= 5.0:
        score += 10
    else:
        return None  # 太分散不算粘合
    
    # 价格在均线束内或刚站上
    if abs(price_vs_ema) <= 1.0:
        score += 25
    elif abs(price_vs_ema) <= 2.0:
        score += 15
    elif price_vs_ema > 0 and price_vs_ema <= 3.0:
        score += 10  # 刚站上均线束
    
    # 短期均线开始拐头
    if bullish_align:
        score += 20  # 短期在上，准备发散
    elif ema5 > ema10:
        score += 10
    
    # 均线束在收窄（对比前10根）
    if len(closes) >= 65:
        prev_closes = closes[:-10]
        prev_ema5 = calc_ema(prev_closes, 5)
        prev_ema10 = calc_ema(prev_closes, 10)
        prev_ema20 = calc_ema(prev_closes, 20)
        prev_ema50 = calc_ema(prev_closes, 50)
        prev_spread = (max(prev_ema5, prev_ema10, prev_ema20, prev_ema50) - 
                       min(prev_ema5, prev_ema10, prev_ema20, prev_ema50)) / prev_closes[-1] * 100
        if spread_pct < prev_spread * 0.8:
            score += 15  # 正在收窄
    
    if score < 30:
        return None
    
    detail = (
        f"均线粘合: 束宽={spread_pct:.1f}% "
        f"EMA5={ema5:.4f} EMA10={ema10:.4f} EMA20={ema20:.4f} EMA50={ema50:.4f} "
        f"价格偏离={price_vs_ema:+.1f}%"
    )
    
    return PreLaunchSignal(
        symbol="",
        signal_type="ma_squeeze",
        score=score,
        detail=detail,
        phase="变盘前夜",
    )


# =============================================
# 3. 缩量极值检测（洗盘结束）
# =============================================
def detect_volume_dry(
    klines_4h: List[dict],
) -> Optional[PreLaunchSignal]:
    """
    缩量极值 = 洗盘结束
    
    条件：
    - 最近成交量远低于20期均量
    - 缩量持续 ≥ 3根K线
    - 价格在缩量期间波动极小（没人卖了）
    """
    volumes = [float(k.get('volume', 0)) for k in klines_4h]
    closes = [float(k.get('close', 0)) for k in klines_4h]
    
    if len(volumes) < 25:
        return None
    
    # 20期均量（排除最近5根）
    avg_vol_20 = sum(volumes[-25:-5]) / 20 if len(volumes) >= 25 else sum(volumes[:-5]) / max(len(volumes)-5, 1)
    if avg_vol_20 == 0:
        return None
    
    # 最近5根的量比
    recent_vols = volumes[-5:]
    recent_ratio = sum(recent_vols) / 5 / avg_vol_20
    
    # 检查连续缩量
    consecutive_low = 0
    for v in reversed(volumes[-8:]):
        if v < avg_vol_20 * 0.6:
            consecutive_low += 1
        else:
            break
    
    # 最近价格波动
    recent_closes = closes[-5:]
    if min(recent_closes) == 0:
        return None
    price_range_pct = (max(recent_closes) - min(recent_closes)) / min(recent_closes) * 100
    
    # === 评分 ===
    score = 0
    
    # 缩量程度
    if recent_ratio <= 0.3:
        score += 40  # 极度缩量
    elif recent_ratio <= 0.5:
        score += 30
    elif recent_ratio <= 0.7:
        score += 20
    elif recent_ratio <= 0.85:
        score += 10
    else:
        return None  # 没缩量
    
    # 连续缩量
    if consecutive_low >= 5:
        score += 25
    elif consecutive_low >= 3:
        score += 15
    elif consecutive_low >= 2:
        score += 8
    
    # 价格波动小（没人卖了=洗盘结束）
    if price_range_pct <= 1.5:
        score += 20
    elif price_range_pct <= 3.0:
        score += 15
    elif price_range_pct <= 5.0:
        score += 8
    
    if score < 30:
        return None
    
    detail = (
        f"缩量极值: 量比={recent_ratio:.2f}x均量 "
        f"连续缩量{consecutive_low}根 "
        f"价波={price_range_pct:.1f}%"
    )
    
    return PreLaunchSignal(
        symbol="",
        signal_type="volume_dry",
        score=score,
        detail=detail,
        phase="洗盘结束",
    )


# =============================================
# 综合检测：启动前信号评分
# =============================================
def detect_prelaunch_signals(
    klines_4h: List[dict],
    symbol: str = "",
    oi_change: float = 0.0,       # OI变化百分比
    funding_rate: float = 0.0,     # 当前资金费率
    long_short_ratio: float = 0.0, # 大户多空比
) -> Dict:
    """
    综合检测所有启动前信号
    
    Returns:
        {
            "score": int,           # 综合分数 0-100
            "signals": [...],       # 检测到的信号列表
            "phase": str,           # 最接近启动的阶段
            "detail": str,          # 综合描述
        }
    """
    signals = []
    
    # 1. 吸筹检测
    acc = detect_accumulation(klines_4h)
    if acc:
        acc.symbol = symbol
        signals.append(acc)
    
    # 2. 均线粘合
    squeeze = detect_ma_squeeze(klines_4h)
    if squeeze:
        squeeze.symbol = symbol
        signals.append(squeeze)
    
    # 3. 缩量极值
    dry = detect_volume_dry(klines_4h)
    if dry:
        dry.symbol = symbol
        signals.append(dry)
    
    if not signals:
        return {
            "score": 0,
            "signals": [],
            "phase": "",
            "detail": "",
        }
    
    # ★ v21: 链上数据加分（OI + 资金费率 + 大户多空比）
    onchain_bonus = 0
    onchain_signals = []
    
    # 1. OI增加 + 价格不动 = 大资金在建仓
    if oi_change > 5:  # OI增加>5%
        onchain_bonus += 15
        onchain_signals.append(f"OI增加{oi_change:+.1f}%")
    elif oi_change > 2:
        onchain_bonus += 8
        onchain_signals.append(f"OI微增{oi_change:+.1f}%")
    
    # 2. 资金费率为负 = 散户在空大户在多
    if funding_rate < -0.001:
        onchain_bonus += 12
        onchain_signals.append(f"费率{funding_rate*100:.3f}%空头拥挤")
    elif funding_rate < 0:
        onchain_bonus += 5
    
    # 3. 大户多空比 > 1.2 = 大户偏多
    if long_short_ratio > 1.5:
        onchain_bonus += 15
        onchain_signals.append(f"大户多空比{long_short_ratio:.2f}(强烈偏多)")
    elif long_short_ratio > 1.2:
        onchain_bonus += 8
        onchain_signals.append(f"大户偏多({long_short_ratio:.2f})")
    elif long_short_ratio > 0 and long_short_ratio < 0.8:
        onchain_bonus -= 10  # 大户在做空，减分
        onchain_signals.append(f"大户偏空({long_short_ratio:.2f})")
    
    if onchain_bonus > 0:
        # 生成链上信号
        signals.append(PreLaunchSignal(
            symbol=symbol,
            signal_type="onchain",
            score=min(40, onchain_bonus),
            detail=" | ".join(onchain_signals),
            phase="链上吸筹",
        ))
    
    # 综合评分
    total_score = sum(s.score for s in signals)
    # 多信号共振加分
    if len(signals) >= 3:
        total_score = int(total_score * 1.3)  # 三个信号全中 → 强共振
    elif len(signals) >= 2:
        total_score = int(total_score * 1.15)
    
    total_score = min(100, total_score)
    
    # 确定最接近启动的阶段
    phase_priority = {"洗盘结束": 3, "变盘前夜": 2, "吸筹": 1}
    best_phase = max(signals, key=lambda s: phase_priority.get(s.phase, 0)).phase
    
    detail = " | ".join(f"{s.phase}({s.score}分)" for s in signals)
    
    return {
        "score": total_score,
        "signals": [{"type": s.signal_type, "score": s.score, "phase": s.phase, "detail": s.detail} for s in signals],
        "phase": best_phase,
        "detail": detail,
    }
