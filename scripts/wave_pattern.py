"""
小风交易系统 - 波浪形态分析模块 (Wave Pattern Analysis)

核心思路:
1. 底部形态识别 — 双底/头肩底/多重底
2. 颈线突破判断 — 底部确认后的启动信号
3. 波浪定位 — 一浪突破→二浪回调→三浪启动
4. 斐波那契回调位 — 二浪最佳入场区间(50%/61.8%)

多周期共振:
- 4h: 底部结构形成
- 1h: 颈线突破确认(一浪完成) / 二浪回调到位
- 15m: 精确入场点配合StochRSI

最佳入场 = 底部形态 + 一浪已突破 + 二浪回调到Fib50/61.8% + 颈线守住
→ 三浪主升浪启动点

独立模块，不复用SMC。
"""

import logging
from typing import List, Optional
from dataclasses import dataclass

logger = logging.getLogger("WavePattern")


# ============================================
# 数据结构
# ============================================
@dataclass
class SwingPt:
    """轻量级波段点"""
    index: int
    price: float
    type: str  # 'high' or 'low'


@dataclass
class BottomPattern:
    """底部形态"""
    pattern_type: str  # 'double_bottom' / 'head_shoulders_bottom' / 'multiple_bottom'
    lows: list         # SwingPt 列表
    neckline: float    # 颈线价格
    confidence: float  # 0-1 置信度
    depth_pct: float   # 底部深度%

@dataclass
class TopPattern:
    """顶部形态（底部形态的镜像）"""
    pattern_type: str  # 'double_top' / 'head_shoulders_top' / 'multiple_top'
    highs: list        # SwingPt 列表
    neckline: float    # 颈线价格
    confidence: float  # 0-1 置信度
    depth_pct: float   # 顶部深度%（高点到颈线的距离）


# ============================================
# 1. Swing Point 检测（独立实现）
# ============================================
def find_swings(klines: list, left: int = 3, right: int = 3) -> List[SwingPt]:
    """检测波段高低点"""
    n = len(klines)
    if n < left + right + 1:
        return []

    swings = []
    for i in range(left, n - right):
        # Swing High
        is_h = True
        for j in range(i - left, i):
            if klines[j]["high"] >= klines[i]["high"]:
                is_h = False
                break
        if is_h:
            for j in range(i + 1, i + right + 1):
                if klines[j]["high"] >= klines[i]["high"]:
                    is_h = False
                    break
        if is_h:
            swings.append(SwingPt(i, klines[i]["high"], "high"))
            continue

        # Swing Low
        is_l = True
        for j in range(i - left, i):
            if klines[j]["low"] <= klines[i]["low"]:
                is_l = False
                break
        if is_l:
            for j in range(i + 1, i + right + 1):
                if klines[j]["low"] <= klines[i]["low"]:
                    is_l = False
                    break
        if is_l:
            swings.append(SwingPt(i, klines[i]["low"], "low"))

    return swings


# ============================================
# 2. 斐波那契工具
# ============================================
def calc_fib(low: float, high: float) -> dict:
    """计算斐波那契回调位"""
    diff = high - low
    if diff <= 0:
        return {}
    return {
        "0.0": round(high, 6),
        "0.236": round(high - diff * 0.236, 6),
        "0.382": round(high - diff * 0.382, 6),
        "0.5": round(high - diff * 0.5, 6),
        "0.618": round(high - diff * 0.618, 6),
        "0.786": round(high - diff * 0.786, 6),
        "1.0": round(low, 6),
    }


def _fmt(price: float) -> str:
    """价格格式化"""
    if price <= 0:
        return "$0"
    if price >= 1000:
        return f"${price:,.1f}"
    if price >= 1:
        return f"${price:.2f}"
    if price >= 0.01:
        return f"${price:.4f}"
    return f"${price:.6f}"


# ============================================
# 3. 底部形态识别
# ============================================
def detect_bottom_pattern(klines: list, tolerance_pct: float = 3.0) -> Optional[BottomPattern]:
    """
    检测底部形态

    - 双底: 两个swing low价格相近，中间有一个swing high（颈线）
    - 头肩底: 三个low，中间最低，两边对称
    - 多重底: 3个以上相近的low

    tolerance_pct: 低点价格偏差容忍度（默认3%）
    """
    swings = find_swings(klines, left=3, right=3)
    if len(swings) < 3:
        return None

    swing_lows = [s for s in swings if s.type == "low"]
    swing_highs = [s for s in swings if s.type == "high"]

    if len(swing_lows) < 2 or len(swing_highs) < 1:
        return None

    current_price = klines[-1]["close"]

    # 只看最近60%的K线中的低点（忽略太旧的数据）
    min_idx = int(len(klines) * 0.35)
    recent_lows = [s for s in swing_lows if s.index >= min_idx and s.price < current_price]

    if len(recent_lows) < 2:
        return None

    recent_lows.sort(key=lambda s: s.index)

    best_pattern = None
    best_confidence = 0.0

    # ---- 双底检测 ----
    for i in range(len(recent_lows)):
        for j in range(i + 1, len(recent_lows)):
            low1, low2 = recent_lows[i], recent_lows[j]

            # 价格相似度
            price_diff_pct = abs(low1.price - low2.price) / min(low1.price, low2.price) * 100
            if price_diff_pct > tolerance_pct:
                continue

            # 找两个低点之间的最高swing high = 颈线
            highs_between = [h for h in swing_highs if low1.index < h.index < low2.index]
            if not highs_between:
                continue

            neckline_pt = max(highs_between, key=lambda h: h.price)
            neckline = neckline_pt.price

            # 颈线必须高于低点
            if min(low1.price, low2.price) >= neckline:
                continue

            # 底部深度
            depth_pct = (neckline - min(low1.price, low2.price)) / neckline * 100
            if depth_pct < 3:  # 太浅不算
                continue

            # 计算置信度
            confidence = 0.5
            confidence += (1.0 - price_diff_pct / tolerance_pct) * 0.2  # 对称性
            confidence += min(depth_pct / 20, 1.0) * 0.15               # 深度
            confidence += (low2.index - min_idx) / (len(klines) - min_idx) * 0.15  # 时效性

            if confidence > best_confidence:
                best_confidence = confidence
                best_pattern = BottomPattern(
                    pattern_type="double_bottom",
                    lows=[low1, low2],
                    neckline=neckline,
                    confidence=min(confidence, 1.0),
                    depth_pct=depth_pct,
                )

    # ---- 头肩底检测 ----
    if len(recent_lows) >= 3:
        for i in range(len(recent_lows) - 2):
            # 取连续三个低点
            for k in range(i + 2, min(i + 6, len(recent_lows))):
                candidates_3 = recent_lows[i:k + 1]
                if len(candidates_3) < 3:
                    continue

                # 取最后三个
                group = candidates_3[-3:]
                prices = [l.price for l in group]

                # 中间最低 = 头肩底
                if not (prices[1] < prices[0] and prices[1] < prices[2]):
                    continue

                # 两肩对称
                shoulder_diff = abs(prices[0] - prices[2]) / min(prices[0], prices[2]) * 100
                if shoulder_diff > tolerance_pct * 1.5:
                    continue

                # 找颈线
                idx_min = min(l.index for l in group)
                idx_max = max(l.index for l in group)
                highs_between = [h for h in swing_highs if idx_min < h.index < idx_max]
                if not highs_between:
                    continue

                neckline = max(h.price for h in highs_between)
                neckline_pt = max(highs_between, key=lambda h: h.price)

                depth_pct = (neckline - prices[1]) / neckline * 100
                if depth_pct < 5:
                    continue

                confidence = 0.7
                confidence += (1.0 - shoulder_diff / (tolerance_pct * 1.5)) * 0.1
                confidence += min(depth_pct / 15, 1.0) * 0.1
                confidence += (idx_max - min_idx) / (len(klines) - min_idx) * 0.1

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_pattern = BottomPattern(
                        pattern_type="head_shoulders_bottom",
                        lows=group,
                        neckline=neckline,
                        confidence=min(confidence, 1.0),
                        depth_pct=depth_pct,
                    )

    # ---- 多重底检测 (3+次触及同一支撑) ----
    if len(recent_lows) >= 3:
        # 从最近往回找连续的相近低点
        for start in range(len(recent_lows) - 2):
            group = [recent_lows[start]]
            for j in range(start + 1, len(recent_lows)):
                diff = abs(group[0].price - recent_lows[j].price) / min(group[0].price, recent_lows[j].price) * 100
                if diff <= tolerance_pct:
                    group.append(recent_lows[j])

            if len(group) >= 3:
                idx_min_g = min(l.index for l in group)
                idx_max_g = max(l.index for l in group)
                highs_between = [h for h in swing_highs if idx_min_g < h.index < idx_max_g]
                if not highs_between:
                    continue

                neckline = max(h.price for h in highs_between)
                depth_pct = (neckline - min(l.price for l in group)) / neckline * 100

                # 多重底比双底强
                confidence = 0.6 + min((len(group) - 2) * 0.1, 0.3)
                confidence += min(depth_pct / 20, 1.0) * 0.1

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_pattern = BottomPattern(
                        pattern_type="multiple_bottom",
                        lows=group,
                        neckline=neckline,
                        confidence=min(confidence, 1.0),
                        depth_pct=depth_pct,
                    )

    return best_pattern


# ============================================
# 3b. 顶部形态识别（底部形态的镜像）
# ============================================
def detect_top_pattern(klines: list, tolerance_pct: float = 3.0) -> Optional[TopPattern]:
    """
    检测顶部形态 — 底部形态的镜像

    - 双顶(M顶): 两个swing high价格相近，中间有一个swing low（颈线），价格已跌破颈线
    - 头肩顶: 三个high，中间最高，两边对称，价格已跌破颈线
    - 多重顶: 3个以上相近的高点

    tolerance_pct: 高点价格偏差容忍度（默认3%）
    返回: TopPattern 或 None
    """
    swings = find_swings(klines, left=3, right=3)
    if len(swings) < 3:
        return None

    swing_highs = [s for s in swings if s.type == "high"]
    swing_lows = [s for s in swings if s.type == "low"]

    if len(swing_highs) < 2 or len(swing_lows) < 1:
        return None

    current_price = klines[-1]["close"]

    # 只看最近60%的K线中的高点
    min_idx = int(len(klines) * 0.35)
    recent_highs = [s for s in swing_highs if s.index >= min_idx and s.price > current_price]

    if len(recent_highs) < 2:
        return None

    recent_highs.sort(key=lambda s: s.index)

    best_pattern = None
    best_confidence = 0.0

    # ---- 双顶检测 ----
    for i in range(len(recent_highs)):
        for j in range(i + 1, len(recent_highs)):
            high1, high2 = recent_highs[i], recent_highs[j]

            # 价格相似度（tolerance_pct百分比容忍度）
            price_diff_pct = abs(high1.price - high2.price) / min(high1.price, high2.price) * 100
            if price_diff_pct > tolerance_pct:
                continue

            # 找两个高点之间的最低swing low = 颈线
            lows_between = [l for l in swing_lows if high1.index < l.index < high2.index]
            if not lows_between:
                continue

            neckline_pt = min(lows_between, key=lambda l: l.price)
            neckline = neckline_pt.price

            # 颈线必须低于高点
            if max(high1.price, high2.price) <= neckline:
                continue

            # 顶部深度（高点到颈线的距离%）
            depth_pct = (max(high1.price, high2.price) - neckline) / max(high1.price, high2.price) * 100
            if depth_pct < 3:  # 太浅不算
                continue

            # ★ 关键确认：当前价格必须跌破颈线（双顶确认信号）
            if current_price >= neckline:
                continue

            # 颈线跌破验证：最近3根K线收盘价至少2根在颈线下方
            recent_closes = [k["close"] for k in klines[-3:]]
            below_count = sum(1 for c in recent_closes if c < neckline)
            if below_count < 2:
                continue

            # 计算置信度
            confidence = 0.5
            confidence += (1.0 - price_diff_pct / tolerance_pct) * 0.2  # 对称性
            confidence += min(depth_pct / 20, 1.0) * 0.15               # 深度
            confidence += (high2.index - min_idx) / (len(klines) - min_idx) * 0.15  # 时效性

            if confidence > best_confidence:
                best_confidence = confidence
                best_pattern = TopPattern(
                    pattern_type="double_top",
                    highs=[high1, high2],
                    neckline=neckline,
                    confidence=min(confidence, 1.0),
                    depth_pct=depth_pct,
                )

    # ---- 头肩顶检测 ----
    if len(recent_highs) >= 3:
        for i in range(len(recent_highs) - 2):
            for k in range(i + 2, min(i + 6, len(recent_highs))):
                candidates_3 = recent_highs[i:k + 1]
                if len(candidates_3) < 3:
                    continue

                group = candidates_3[-3:]
                prices = [h.price for h in group]

                # 中间最高 = 头肩顶
                if not (prices[1] > prices[0] and prices[1] > prices[2]):
                    continue

                # 两肩对称
                shoulder_diff = abs(prices[0] - prices[2]) / min(prices[0], prices[2]) * 100
                if shoulder_diff > tolerance_pct * 1.5:
                    continue

                # 找颈线（两个谷底的平均）
                idx_min = min(h.index for h in group)
                idx_max = max(h.index for h in group)
                lows_between = [l for l in swing_lows if idx_min < l.index < idx_max]
                if not lows_between:
                    continue

                neckline = min(l.price for l in lows_between)

                depth_pct = (prices[1] - neckline) / prices[1] * 100
                if depth_pct < 5:
                    continue

                # ★ 颈线跌破确认
                if current_price >= neckline:
                    continue

                recent_closes = [kk["close"] for kk in klines[-3:]]
                below_count = sum(1 for c in recent_closes if c < neckline)
                if below_count < 2:
                    continue

                confidence = 0.7
                confidence += (1.0 - shoulder_diff / (tolerance_pct * 1.5)) * 0.1
                confidence += min(depth_pct / 15, 1.0) * 0.1
                confidence += (idx_max - min_idx) / (len(klines) - min_idx) * 0.1

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_pattern = TopPattern(
                        pattern_type="head_shoulders_top",
                        highs=group,
                        neckline=neckline,
                        confidence=min(confidence, 1.0),
                        depth_pct=depth_pct,
                    )

    # ---- 多重顶检测 (3+次触及同一阻力) ----
    if len(recent_highs) >= 3:
        for start in range(len(recent_highs) - 2):
            group = [recent_highs[start]]
            for j in range(start + 1, len(recent_highs)):
                diff = abs(group[0].price - recent_highs[j].price) / min(group[0].price, recent_highs[j].price) * 100
                if diff <= tolerance_pct:
                    group.append(recent_highs[j])

            if len(group) >= 3:
                idx_min_g = min(h.index for h in group)
                idx_max_g = max(h.index for h in group)
                lows_between = [l for l in swing_lows if idx_min_g < l.index < idx_max_g]
                if not lows_between:
                    continue

                neckline = min(l.price for l in lows_between)
                depth_pct = (max(h.price for h in group) - neckline) / max(h.price for h in group) * 100

                # 颈线跌破确认
                if current_price >= neckline:
                    continue

                recent_closes = [kk["close"] for kk in klines[-3:]]
                below_count = sum(1 for c in recent_closes if c < neckline)
                if below_count < 2:
                    continue

                confidence = 0.6 + min((len(group) - 2) * 0.1, 0.3)
                confidence += min(depth_pct / 20, 1.0) * 0.1

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_pattern = TopPattern(
                        pattern_type="multiple_top",
                        highs=group,
                        neckline=neckline,
                        confidence=min(confidence, 1.0),
                        depth_pct=depth_pct,
                    )

    return best_pattern


# ============================================
# 4. 波浪定位
# ============================================
def detect_wave_position(klines: list, bottom: BottomPattern) -> Optional[dict]:
    """
    判断当前处于哪个波浪阶段

    一浪: 颈线突破 → 新高（第一波上涨）
    二浪: 从一浪高点回调（38.2%~78.6%斐波那契回调）
    三浪: 突破一浪高点（主升浪）

    最佳入场: 二浪回调到50%/61.8%且颈线守住 → 三浪启动前
    """
    current_price = klines[-1]["close"]
    neckline = bottom.neckline

    # 从底部形态最后一个低点开始看后续走势
    last_low_idx = max(l.index for l in bottom.lows)

    if last_low_idx >= len(klines) - 5:
        return None  # 底部刚形成，数据不够

    after = klines[last_low_idx + 1:]
    if len(after) < 5:
        return None

    # 检查是否突破了颈线（收盘价确认，非最高价刺破）
    closes_above = [k["close"] for k in after if k["close"] > neckline]
    broke_neckline = len(closes_above) >= 2  # 至少2根K线收盘在颈线上方

    if not broke_neckline:
        # 还没突破颈线，底部形成中
        return {
            "wave": 0,
            "signal": "bottom_forming",
            "neckline": neckline,
            "current_price": current_price,
            "summary": f"底部形态形成中，颈线{_fmt(neckline)}未突破",
        }

    # 找一浪高点（突破颈线后的最高点）
    # 用swing检测找更精确的高点
    swings_after = find_swings(after, left=2, right=2)
    highs_after = [s for s in swings_after if s.type == "high" and s.price > neckline]

    if highs_after:
        wave1_high_pt = max(highs_after, key=lambda s: s.price)
        wave1_high = wave1_high_pt.price
    else:
        wave1_high = max_after

    # 一浪低点 = 底部形态的最低点
    wave1_low = min(l.price for l in bottom.lows)

    # 斐波那契回调位
    fib = calc_fib(wave1_low, wave1_high)
    wave1_range = wave1_high - wave1_low
    if wave1_range <= 0:
        return None

    # 回调幅度（占一浪的百分比）
    pullback_pct = (wave1_high - current_price) / wave1_range * 100

    # ---- 判断波浪位置 ----

    if pullback_pct < 10:
        # 价格在一浪高点附近 → 一浪仍在冲高 或 三浪刚启动
        # 检查是否已经创新高（三浪）
        if current_price >= wave1_high * 0.99:
            return {
                "wave": 3,
                "signal": "wave3_starting",
                "wave1_low": wave1_low,
                "wave1_high": wave1_high,
                "fib": fib,
                "current_price": current_price,
                "pullback_pct": pullback_pct,
                "summary": f"🔥 三浪启动中！突破一浪高点{_fmt(wave1_high)}",
            }
        return {
            "wave": 1,
            "signal": "wave1_climax",
            "wave1_low": wave1_low,
            "wave1_high": wave1_high,
            "fib": fib,
            "current_price": current_price,
            "pullback_pct": pullback_pct,
            "summary": f"一浪冲高中 {_fmt(wave1_high)} (涨{(wave1_high / wave1_low - 1) * 100:.1f}%)",
        }

    elif pullback_pct < 38.2:
        # 浅回调，二浪刚开始
        return {
            "wave": 2,
            "signal": "wave2_shallow",
            "wave1_low": wave1_low,
            "wave1_high": wave1_high,
            "fib": fib,
            "current_price": current_price,
            "pullback_pct": pullback_pct,
            "neckline": neckline,
            "summary": f"二浪浅回调{pullback_pct:.1f}% → 等待Fib50/61.8%入场",
        }

    elif pullback_pct <= 78.6:
        # 二浪回调黄金区域
        holding_neckline = current_price > neckline * 0.98  # 2%容忍

        # 距离斐波那契关键位的接近程度
        near_50 = abs(current_price - fib["0.5"]) / wave1_range * 100 < 8
        near_618 = abs(current_price - fib["0.618"]) / wave1_range * 100 < 8

        if holding_neckline and (near_50 or near_618):
            signal = "wave2_buy_zone"
            confidence = 0.95 if near_618 else 0.85
        elif holding_neckline:
            signal = "wave2_pulling_back"
            confidence = 0.6
        else:
            signal = "wave2_below_neckline"
            confidence = 0.25

        fib_hit = ""
        if near_618:
            fib_hit = "🎯Fib61.8%"
        elif near_50:
            fib_hit = "🎯Fib50%"

        return {
            "wave": 2,
            "signal": signal,
            "confidence": confidence,
            "wave1_low": wave1_low,
            "wave1_high": wave1_high,
            "fib": fib,
            "current_price": current_price,
            "pullback_pct": pullback_pct,
            "neckline": neckline,
            "holding_neckline": holding_neckline,
            "summary": (
                f"{'✅' if signal == 'wave2_buy_zone' else '⏳'} 二浪回调{pullback_pct:.1f}% "
                f"{fib_hit} | 颈线{'守住' if holding_neckline else '失守⚠️'}"
            ),
        }

    else:
        # 回调过深，可能形态失败
        return {
            "wave": 2,
            "signal": "wave2_deep",
            "wave1_low": wave1_low,
            "wave1_high": wave1_high,
            "fib": fib,
            "current_price": current_price,
            "pullback_pct": pullback_pct,
            "neckline": neckline,
            "summary": f"二浪回调过深({pullback_pct:.1f}%) → 形态可能失败",
        }


# ============================================
# 5. 多周期综合分析（主入口）
# ============================================
def analyze_wave_breakout(klines_by_interval: dict) -> Optional[dict]:
    """
    多周期波浪+底部形态综合分析

    4h: 底部结构识别
    1h: 颈线突破 / 波浪定位
    → 组合产生交易信号

    返回: {
        'signal': 'strong_buy' | 'buy' | 'watch' | None,
        'bottom_4h': BottomPattern,
        'bottom_1h': BottomPattern,
        'wave_4h': dict,
        'wave_1h': dict,
        'summary': str,
        'score': int (0-30 加分),
    }
    """
    # === 4h: 底部形态 ===
    klines_4h = klines_by_interval.get("4h", [])
    bottom_4h = None
    wave_4h = None

    if len(klines_4h) >= 30:
        bottom_4h = detect_bottom_pattern(klines_4h)
        if bottom_4h:
            wave_4h = detect_wave_position(klines_4h, bottom_4h)

    # === 1h: 底部形态 + 波浪定位 ===
    klines_1h = klines_by_interval.get("1h", [])
    bottom_1h = None
    wave_1h = None

    if len(klines_1h) >= 30:
        bottom_1h = detect_bottom_pattern(klines_1h)
        if bottom_1h:
            wave_1h = detect_wave_position(klines_1h, bottom_1h)

    # === 组合信号（严格版：4h颈线必须突破才给高分）===
    result = {
        "signal": None,
        "bottom_4h": bottom_4h,
        "bottom_1h": bottom_1h,
        "wave_4h": wave_4h,
        "wave_1h": wave_1h,
        "summary": "",
        "score": 0,
    }

    # 判断4h颈线是否已突破
    neck_broke_4h = wave_4h and wave_4h.get("wave", 0) > 0

    # ──── 第一梯队：4h颈线已突破 ────

    # 4h突破 + 4h二浪回调到位 → 三浪前最佳入场
    if bottom_4h and neck_broke_4h and wave_4h.get("signal") == "wave2_buy_zone":
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "strong_buy"
        result["score"] = 25
        result["summary"] = (
            f"🔥 4h{pt_cn}突破后二浪回调到位(Fib{wave_4h.get('pullback_pct',0):.0f}%) "
            f"| {wave_4h['summary']}"
        )
        return result

    # 4h突破 + 1h二浪回调到位（精确入场时机）
    if bottom_4h and neck_broke_4h and wave_1h and wave_1h.get("signal") == "wave2_buy_zone":
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "strong_buy"
        result["score"] = 23
        result["summary"] = (
            f"🔥 4h{pt_cn}已突破 + 1h二浪回调到位 "
            f"| {wave_1h['summary']}"
        )
        return result

    # 4h突破 + 三浪启动
    if bottom_4h and neck_broke_4h and wave_4h.get("signal") == "wave3_starting":
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "strong_buy"
        result["score"] = 22
        result["summary"] = f"🔥 4h{pt_cn}突破后三浪启动中"
        return result

    # 4h突破 + 1h三浪启动
    if bottom_4h and neck_broke_4h and wave_1h and wave_1h.get("signal") == "wave3_starting":
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "buy"
        result["score"] = 20
        result["summary"] = f"✅ 4h{pt_cn}已突破 + 1h三浪突破"
        return result

    # 4h突破 + 1h一浪突破中
    if bottom_4h and neck_broke_4h and wave_1h and wave_1h.get("wave") == 1:
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "buy"
        result["score"] = 18
        result["summary"] = (
            f"✅ 4h{pt_cn}已突破 + 1h一浪突破中 | 颈线{_fmt(bottom_4h.neckline)}"
        )
        return result

    # 4h已突破（无特殊小周期信号）
    if bottom_4h and neck_broke_4h:
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "buy"
        result["score"] = 16
        result["summary"] = f"✅ 4h{pt_cn}已突破颈线{_fmt(bottom_4h.neckline)} | {wave_4h['summary']}"
        return result

    # ──── 第二梯队：4h底部形成中（未突破）→ 只给watch ────

    # 4h未突破 + 1h回调到位 → 观察级别，不给buy
    if bottom_4h and not neck_broke_4h and wave_1h and wave_1h.get("signal") == "wave2_buy_zone":
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "watch"
        result["score"] = 6
        result["summary"] = f"👀 4h{pt_cn}未突破颈线 + 1h回调到位 → 等颈线突破再入场"
        return result

    # 4h底部形成中
    if bottom_4h and wave_4h and wave_4h.get("signal") == "bottom_forming":
        pt_cn = _pattern_cn(bottom_4h.pattern_type)
        result["signal"] = "watch"
        result["score"] = 4
        result["summary"] = f"👀 4h{pt_cn}形成中，等颈线突破 {_fmt(bottom_4h.neckline)}"
        return result

    # ──── 第三梯队：只有1h底部 ────

    # 1h底部 + 二浪回调到位
    if bottom_1h and wave_1h and wave_1h.get("signal") == "wave2_buy_zone":
        pt_cn = _pattern_cn(bottom_1h.pattern_type)
        result["signal"] = "buy"
        result["score"] = 12
        result["summary"] = f"✅ 1h{pt_cn} + 二浪回调到位 | {wave_1h['summary']}"
        return result

    # 1h底部 + 三浪启动
    if bottom_1h and wave_1h and wave_1h.get("signal") == "wave3_starting":
        pt_cn = _pattern_cn(bottom_1h.pattern_type)
        result["signal"] = "buy"
        result["score"] = 12
        result["summary"] = f"✅ 1h{pt_cn}三浪启动"
        return result

    # 1h底部形成中
    if bottom_1h and wave_1h and wave_1h.get("signal") == "bottom_forming":
        pt_cn = _pattern_cn(bottom_1h.pattern_type)
        result["signal"] = "watch"
        result["score"] = 3
        result["summary"] = f"👀 1h{pt_cn}形成中"
        return result

    # 无信号
    return None


def _pattern_cn(pt: str) -> str:
    """形态中文名"""
    return {
        "double_bottom": "双底",
        "head_shoulders_bottom": "头肩底",
        "multiple_bottom": "多重底",
    }.get(pt, pt)
