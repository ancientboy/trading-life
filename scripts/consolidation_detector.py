"""
横盘突破检测器 v21

核心逻辑：
1. 识别横盘/收敛区间（不同周期）
2. 判断是否在突破
3. 突破后确认是否站稳

横盘 = 小周期在做底部结构
4h上升趋势 + 1h横盘 = 最强信号（大趋势向上中的小级别回调蓄力）

周期权重：
- 4h横盘突破 → 权重最高（大级别蓄力）
- 1h横盘突破 → 中等（回调底结构）
- 15m横盘突破 → 较低（需大周期配合）
"""

import logging
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger("ConsolidationDetector")


@dataclass
class ConsolidationZone:
    """横盘区间"""
    symbol: str
    timeframe: str            # "15m" / "1h" / "4h"
    start_idx: int            # 开始位置（K线数组索引）
    end_idx: int              # 结束位置
    high: float               # 区间上沿
    low: float                # 区间下沿
    mid: float                # 中轨
    amplitude_pct: float      # 振幅百分比 (high-low)/mid
    duration_hours: float     # 持续时间(小时)
    num_touches_high: int     # 触及上沿次数
    num_touches_low: int      # 触及下沿次数
    is_tightening: bool       # 是否在收敛（后半段振幅 < 前半段）
    volume_trend: str         # "shrinking" / "stable" / "expanding"
    breakout_price: float = 0.0  # 突破价格（0=未突破）
    breakout_confirmed: bool = False  # 突破确认
    bars_since_breakout: int = 0     # 突破后K线数
    score: int = 0                  # 综合评分


def _atr(closes: List[float], highs: List[float], lows: List[float], period: int = 14) -> float:
    """简化ATR计算"""
    if len(closes) < period + 1:
        return 0
    true_ranges = []
    for i in range(1, min(len(closes), period + 1)):
        tr = max(
            highs[-i] - lows[-i],
            abs(highs[-i] - closes[-i-1]),
            abs(lows[-i] - closes[-i-1])
        )
        true_ranges.append(tr)
    return sum(true_ranges) / len(true_ranges) if true_ranges else 0


def detect_consolidation(
    klines: List[dict],
    timeframe: str = "1h",
    min_bars: int = 12,
    max_amplitude_pct: float = 5.0,
) -> Optional[ConsolidationZone]:
    """
    检测最近的横盘区间
    
    Args:
        klines: K线数据 [{open, high, low, close, volume}, ...]
        timeframe: 时间周期
        min_bars: 最少K线数（横盘持续时间）
        max_amplitude_pct: 最大振幅百分比（超过此值不算横盘）
    """
    if len(klines) < min_bars:
        return None
    
    closes = [k["close"] for k in klines]
    highs = [k["high"] for k in klines]
    lows = [k["low"] for k in klines]
    volumes = [k.get("volume", 0) for k in klines]
    
    # 从最新K线往回找横盘区间
    # 策略：从后往前，找到价格波动收敛的区域
    best_zone = None
    best_score = 0
    
    # 检查不同长度的横盘（从短到长）
    for lookback in range(min_bars, min(len(klines), 100)):
        recent_closes = closes[-lookback:]
        recent_highs = highs[-lookback:]
        recent_lows = lows[-lookback:]
        recent_volumes = volumes[-lookback:]
        
        zone_high = max(recent_highs)
        zone_low = min(recent_lows)
        zone_mid = (zone_high + zone_low) / 2
        
        if zone_mid == 0:
            continue
        
        amplitude_pct = (zone_high - zone_low) / zone_mid * 100
        
        # 振幅太大不算横盘
        if amplitude_pct > max_amplitude_pct:
            continue
        
        # 计算触及次数
        threshold = amplitude_pct * 0.1 * zone_mid / 100  # 10%的振幅作为触及阈值
        touches_high = sum(1 for h in recent_highs if h >= zone_high - threshold)
        touches_low = sum(1 for l in recent_lows if l <= zone_low + threshold)
        
        # 判断是否在收敛（前半段 vs 后半段）
        half = lookback // 2
        first_half_range = max(recent_highs[:half]) - min(recent_lows[:half])
        second_half_range = max(recent_highs[half:]) - min(recent_lows[half:])
        is_tightening = second_half_range < first_half_range * 0.9
        
        # 成交量趋势
        if half >= 3:
            vol_first = sum(recent_volumes[:half]) / half
            vol_second = sum(recent_volumes[half:]) / half
            if vol_first > 0:
                vol_ratio = vol_second / vol_first
                if vol_ratio < 0.7:
                    volume_trend = "shrinking"
                elif vol_ratio > 1.3:
                    volume_trend = "expanding"
                else:
                    volume_trend = "stable"
            else:
                volume_trend = "stable"
        else:
            volume_trend = "stable"
        
        # 计算持续时间
        tf_hours = {"15m": 0.25, "1h": 1, "4h": 4, "1d": 24}.get(timeframe, 1)
        duration_hours = lookback * tf_hours
        
        # 评分
        score = _score_consolidation(
            amplitude_pct=amplitude_pct,
            touches_high=touches_high,
            touches_low=touches_low,
            is_tightening=is_tightening,
            volume_trend=volume_trend,
            duration_hours=duration_hours,
            timeframe=timeframe,
            lookback=lookback,
        )
        
        if score > best_score:
            best_score = score
            best_zone = ConsolidationZone(
                symbol="",
                timeframe=timeframe,
                start_idx=len(klines) - lookback,
                end_idx=len(klines) - 1,
                high=zone_high,
                low=zone_low,
                mid=zone_mid,
                amplitude_pct=round(amplitude_pct, 2),
                duration_hours=round(duration_hours, 1),
                num_touches_high=touches_high,
                num_touches_low=touches_low,
                is_tightening=is_tightening,
                volume_trend=volume_trend,
                score=score,
            )
    
    return best_zone


def _score_consolidation(
    amplitude_pct: float,
    touches_high: int,
    touches_low: int,
    is_tightening: bool,
    volume_trend: str,
    duration_hours: float,
    timeframe: str,
    lookback: int,
) -> int:
    """给横盘区间打分"""
    score = 0
    
    # 1. 振幅越小越好（收敛越紧）
    if amplitude_pct <= 1.5:
        score += 30
    elif amplitude_pct <= 3.0:
        score += 20
    elif amplitude_pct <= 5.0:
        score += 10
    
    # 2. 触及次数（越多说明支撑阻力越有效）
    total_touches = touches_high + touches_low
    if total_touches >= 6:
        score += 20
    elif total_touches >= 4:
        score += 15
    elif total_touches >= 3:
        score += 10
    
    # 3. 收敛加分
    if is_tightening:
        score += 15
    
    # 4. 缩量加分（蓄力信号）
    if volume_trend == "shrinking":
        score += 15
    elif volume_trend == "stable":
        score += 5
    
    # 5. 持续时间加分
    if duration_hours >= 48:
        score += 10
    elif duration_hours >= 24:
        score += 8
    elif duration_hours >= 12:
        score += 5
    
    # 6. 周期权重
    tf_bonus = {"4h": 10, "1h": 7, "15m": 3}.get(timeframe, 5)
    score += tf_bonus
    
    return score


def check_breakout(
    zone: ConsolidationZone,
    recent_klines: List[dict],
    confirm_bars: int = 3,
) -> Tuple[bool, float, int]:
    """
    检查是否发生突破并确认（回调站稳模式）
    
    v21: 不再用N根K线站上沿的简单逻辑
    正确的突破确认 = 放量突破 + 回调不破上沿(支撑变阻力) + 再次站住
    
    阶段:
    1. 放量突破区间上沿（必须放量）
    2. 回调测试上沿（价格回到上沿附近但不跌破）
    3. 回调后重新走高（确认上沿变支撑）
    
    Returns:
        (是否确认突破, 突破价格, 确认阶段)
        确认阶段: 0=未突破, 1=刚突破未回调, 2=回调中, 3=回调站稳(确认)
    """
    if not recent_klines or len(recent_klines) < 3:
        return False, 0, 0
    
    # 计算横盘期的平均成交量（作为基准）
    # recent_klines的前面部分应该是横盘区间内的
    half = len(recent_klines) // 2
    avg_vol = sum(k.get("volume", 0) for k in recent_klines[:half]) / max(half, 1)
    
    # ===== 阶段1: 找到放量突破K线 =====
    breakout_idx = -1
    breakout_vol_ratio = 0.0
    
    for i, k in enumerate(recent_klines):
        if k["close"] > zone.high:
            vol = k.get("volume", 0)
            vol_ratio = vol / avg_vol if avg_vol > 0 else 1.0
            
            # v21: 突破必须放量(>=1.3倍均量)
            if vol_ratio >= 1.3:
                breakout_idx = i
                breakout_vol_ratio = vol_ratio
                break
            else:
                # 无量突破 → 标记为假突破候选
                breakout_idx = i
                breakout_vol_ratio = vol_ratio
                break
    
    if breakout_idx < 0:
        return False, 0, 0
    
    breakout_price = recent_klines[breakout_idx]["close"]
    is_volume_breakout = breakout_vol_ratio >= 1.3  # 放量突破标志
    
    # ===== 阶段2-3: 回调确认 =====
    remaining = recent_klines[breakout_idx + 1:]
    
    if len(remaining) < 1:
        # 刚突破，没有后续K线
        # 放量突破至少算"刚突破"
        if is_volume_breakout:
            return False, breakout_price, 1  # 阶段1: 刚突破
        return False, breakout_price, 0
    
    # 在后续K线中找回调
    pulled_back = False      # 是否发生了回调
    pullback_low = float('inf')
    pullback_to_zone = False  # 回调是否触及区间上沿
    
    for k in remaining:
        close = k["close"]
        low = k.get("low", close)
        
        if close < zone.high:
            # 回调到区间上沿以下
            pulled_back = True
            pullback_low = min(pullback_low, low)
            
            if low <= zone.high * 1.005:  # 回调触及上沿附近（±0.5%内）
                pullback_to_zone = True
        else:
            # 回调后重新站上
            if pulled_back:
                # 回调后站住了！
                # 检查回调深度是否合理（不能跌破区间中轨）
                if pullback_low >= zone.mid:
                    # 完美回调：触及上沿 → 站住，上沿变支撑
                    if is_volume_breakout:
                        return True, breakout_price, 3  # ✅ 确认突破
                    else:
                        # 无量突破后的回调站稳，降级
                        return True, breakout_price, 2  # ⚠️ 弱确认
                else:
                    # 回调太深，假突破
                    return False, breakout_price, 0
    
    # 遍历完所有后续K线
    if pulled_back:
        # 还在回调中，没站住
        return False, breakout_price, 1  # 阶段1: 回调中
    else:
        # 突破后一直没回调（直线拉升）
        # 这种情况不确定是否站稳，等回调再说
        bars_above = len(remaining)
        if bars_above >= confirm_bars and is_volume_breakout:
            # 放量突破后连续N根K线都在上沿之上，也算确认（虽然没回调）
            return True, breakout_price, 3
        return False, breakout_price, 1  # 还需要观察


def detect_breakout_setup(
    klines: List[dict],
    symbol: str = "",
) -> Optional[Dict]:
    """
    完整的横盘突破检测流程
    
    多周期检测：4h → 1h → 15m
    返回最佳横盘突破信号
    
    Returns:
        {
            "symbol": str,
            "zone": ConsolidationZone,
            "breakout": bool,
            "breakout_price": float,
            "confirmed": bool,
            "confirm_bars": int,
            "score": int,
            "reasoning": str,
            "timeframe": str,
        }
    """
    if len(klines) < 20:
        return None
    
    best_result = None
    best_total_score = 0
    
    for tf, tf_minutes, min_bars, max_amp, confirm in [
        ("4h", 240, 8, 8.0, 2),    # 4h: 至少8根(32h), 振幅<8%, 2根确认
        ("1h", 60, 12, 5.0, 3),    # 1h: 至少12根(12h), 振幅<5%, 3根确认
        ("15m", 15, 24, 4.0, 5),   # 15m: 至少24根(6h), 振幅<4%, 5根确认
    ]:
        zone = detect_consolidation(klines, tf, min_bars, max_amp)
        if zone is None:
            continue
        
        zone.symbol = symbol
        
        # 检查突破（回调确认模式）
        is_confirmed, breakout_price, confirm_stage = check_breakout(
            zone, klines[-20:], confirm_bars=confirm
        )
        
        zone.breakout_price = breakout_price
        zone.breakout_confirmed = is_confirmed
        zone.bars_since_breakout = confirm_stage
        
        # 综合评分
        total_score = zone.score
        if confirm_stage == 3:
            total_score += 40  # ✅ 回调站稳确认
        elif confirm_stage == 2:
            total_score += 20  # ⚠️ 弱确认（无量但站稳）
        elif confirm_stage == 1:
            total_score += 10  # 刚突破，未回调
        
        reasoning = _build_reasoning(zone, is_confirmed, breakout_price, confirm_stage)
        
        if total_score > best_total_score:
            best_total_score = total_score
            best_result = {
                "symbol": symbol,
                "zone": zone,
                "breakout": breakout_price > 0,
                "breakout_price": breakout_price,
                "confirmed": is_confirmed,
                "confirm_stage": confirm_stage,  # 0=未突破 1=刚突破 2=弱确认 3=确认
                "score": total_score,
                "reasoning": reasoning,
                "timeframe": tf,
                "amplitude_pct": zone.amplitude_pct,
                "duration_hours": zone.duration_hours,
                "is_tightening": zone.is_tightening,
                "volume_trend": zone.volume_trend,
            }
    
    return best_result


def _build_reasoning(zone: ConsolidationZone, confirmed: bool, breakout_price: float, confirm_stage: int) -> str:
    """构建检测理由"""
    parts = []
    parts.append(f"{zone.timeframe}横盘{zone.duration_hours:.0f}h")
    parts.append(f"振幅{zone.amplitude_pct:.1f}%")
    
    if zone.is_tightening:
        parts.append("收敛中")
    
    if zone.volume_trend == "shrinking":
        parts.append("缩量蓄力")
    
    if breakout_price > 0:
        if confirm_stage == 3:
            parts.append("✅放量突破+回调站稳")
        elif confirm_stage == 2:
            parts.append("⚠️无量突破但回调站稳")
        elif confirm_stage == 1:
            parts.append("⚡刚突破待回调确认")
    else:
        parts.append("⏳等待突破")
    
    return " | ".join(parts)


def multi_tf_breakout_analysis(
    klines_by_tf: Dict[str, List[dict]],
    symbol: str = "",
) -> Optional[Dict]:
    """
    多周期联合分析
    
    核心逻辑：大周期趋势向上 + 小周期横盘突破 = 最强信号
    
    Args:
        klines_by_tf: {"15m": [...], "1h": [...], "4h": [...]}
    """
    from direction_rules import calc_swing_structure
    
    # 1. 大周期（4h）趋势判断
    klines_4h = klines_by_tf.get("4h", [])
    big_trend = "neutral"
    if len(klines_4h) >= 20:
        closes_4h = [k["close"] for k in klines_4h]
        highs_4h = [k["high"] for k in klines_4h]
        lows_4h = [k["low"] for k in klines_4h]
        
        # 顶底结构判断趋势
        swing = calc_swing_structure(highs_4h, lows_4h, closes_4h)
        if swing and swing.get("direction") == "uptrend":
            big_trend = "uptrend"
        elif swing and swing.get("direction") == "downtrend":
            big_trend = "downtrend"
    
    # 2. 小周期横盘检测
    best_setup = None
    best_score = 0
    
    for tf in ["1h", "15m"]:
        klines = klines_by_tf.get(tf, [])
        if len(klines) < 20:
            continue
        
        result = detect_breakout_setup(klines, symbol)
        if result is None:
            continue
        
        # 大趋势加分
        if big_trend == "uptrend":
            result["score"] += 25  # 大周期上升 + 小周期横盘 = 回调蓄力
            result["reasoning"] = f"4h上升趋势 + {result['reasoning']}"
        elif big_trend == "downtrend":
            result["score"] -= 20  # 大趋势下跌中的横盘突破容易假突破
            result["reasoning"] = f"⚠️4h下跌趋势 + {result['reasoning']}"
        
        if result["score"] > best_score:
            best_score = result["score"]
            best_setup = result
    
    if best_setup:
        best_setup["big_trend"] = big_trend
    
    return best_setup
