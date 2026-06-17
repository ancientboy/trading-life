"""
小风交易系统 - SMC (Smart Money Concepts) 分析模块

基于机构交易理念的核心分析：
1. Swing Points (波段高低点) — 所有SMC分析的基础
2. BOS/CHoCH (结构突破/反转) — 趋势方向判断
3. Order Blocks (订单块) — 关键支撑/阻力入场区
4. Fair Value Gaps (公允价值缺口) — 价格回补入场位
5. Equal Highs/Lows (等高/等低) — 止损猎取目标
6. Premium/Discount Zones (折价/溢价区) — 区间交易判断

数据输入: analyst_data.fetch_klines() 返回的标准K线列表
输出: { bias, score, signals, key_levels }
"""
import logging
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field

logger = logging.getLogger("SMC")


# ============================================
# 数据结构
# ============================================
@dataclass
class SwingPoint:
    """波段高低点"""
    index: int          # K线索引
    price: float        # 价格
    type: str           # 'high' 或 'low'
    strength: int = 1   # 强度(确认的K线数)

@dataclass
class StructureBreak:
    """结构突破 (BOS/CHoCH)"""
    type: str           # 'BOS' 或 'CHoCH'
    direction: str      # 'bullish' 或 'bearish'
    price: float        # 突破价格
    break_index: int    # 突破发生的K线索引
    prev_swing: float   # 被突破的swing point价格

@dataclass
class OrderBlock:
    """订单块"""
    direction: str      # 'bullish' 或 'bearish'
    high: float         # OB区域上界
    low: float          # OB区域下界
    ob_index: int       # OB所在K线索引
    break_index: int    # 突破确认的K线索引
    strength: float = 1.0  # 强度(成交量倍数)

@dataclass
class FairValueGap:
    """公允价值缺口"""
    direction: str      # 'bullish' 或 'bearish'
    high: float         # FVG上界
    low: float          # FVG下界
    index: int          # 中间K线索引
    filled: bool = False  # 是否已回补


# ============================================
# 1. Swing Points 波段高低点检测
# ============================================
def find_swing_points(klines: List[dict], left: int = 3, right: int = 3) -> List[SwingPoint]:
    """
    检测波段高低点 (Swing Highs/Lows)
    
    原理: 如果一根K线的high/low比左右各N根K线都高/低，则为swing point
    - left=3, right=3 表示需要左右各3根K线确认
    - left/right 越大，检测出的 swing point 越少但越重要
    
    参数:
        klines: 标准K线列表 (来自 analyst_data.fetch_klines)
        left: 左侧确认K线数
        right: 右侧确认K线数
    """
    n = len(klines)
    if n < left + right + 1:
        return []
    
    swings = []
    
    for i in range(left, n - right):
        # 检查 Swing High
        is_high = True
        for j in range(i - left, i):
            if klines[j]["high"] >= klines[i]["high"]:
                is_high = False
                break
        if is_high:
            for j in range(i + 1, i + right + 1):
                if klines[j]["high"] >= klines[i]["high"]:
                    is_high = False
                    break
        
        if is_high:
            swings.append(SwingPoint(
                index=i,
                price=klines[i]["high"],
                type="high",
                strength=left
            ))
            continue  # 同一根K线不会同时是high和low
        
        # 检查 Swing Low
        is_low = True
        for j in range(i - left, i):
            if klines[j]["low"] <= klines[i]["low"]:
                is_low = False
                break
        if is_low:
            for j in range(i + 1, i + right + 1):
                if klines[j]["low"] <= klines[i]["low"]:
                    is_low = False
                    break
        
        if is_low:
            swings.append(SwingPoint(
                index=i,
                price=klines[i]["low"],
                type="low",
                strength=left
            ))
    
    return swings


# ============================================
# 2. Premium / Discount Zones 折价/溢价区
# ============================================
def calc_premium_discount(klines: List[dict], lookback: int = 50) -> dict:
    """
    计算当前价格在最近波段区间中的位置
    
    原理 (斐波那契均衡):
    - 0%~50% = Discount Zone (折价区) → 适合做多
    - 50%~100% = Premium Zone (溢价区) → 适合做空
    - 50%附近 = Equilibrium (均衡区) → 观望
    
    参数:
        klines: K线列表
        lookback: 回看多少根K线确定区间
    """
    if len(klines) < 5:
        return {"zone": "neutral", "pct": 50, "range_high": 0, "range_low": 0}
    
    recent = klines[-lookback:] if len(klines) >= lookback else klines
    range_high = max(k["high"] for k in recent)
    range_low = min(k["low"] for k in recent)
    current_price = klines[-1]["close"]
    
    range_size = range_high - range_low
    if range_size == 0:
        return {"zone": "neutral", "pct": 50, "range_high": range_high, "range_low": range_low}
    
    # 当前价格在区间中的百分比位置
    pct = (current_price - range_low) / range_size * 100
    pct = max(0, min(100, pct))
    
    if pct < 40:
        zone = "discount"      # 折价区(低位) → 做多友好
    elif pct > 60:
        zone = "premium"       # 溢价区(高位) → 做空友好
    else:
        zone = "equilibrium"   # 均衡区 → 观望
    
    # 推荐交易方向
    if zone == "discount":
        direction_hint = "LONG"
    elif zone == "premium":
        direction_hint = "SHORT"
    else:
        direction_hint = "WAIT"
    
    return {
        "zone": zone,
        "pct": round(pct, 2),
        "direction_hint": direction_hint,
        "range_high": range_high,
        "range_low": range_low,
        "equilibrium": round((range_high + range_low) / 2, 4),
    }


# ============================================
# 3. BOS / CHoCH 市场结构突破检测
# ============================================
def detect_structure_breaks(klines: List[dict], 
                            swings: List[SwingPoint],
                            lookback: int = 50) -> List[StructureBreak]:
    """
    检测 BOS (Break of Structure) 和 CHoCH (Change of Character)
    
    原理:
    - BOS: 价格延续当前趋势方向突破前一个swing点 → 趋势延续
      上升趋势中: 突破前一个Swing High (Higher High)
      下降趋势中: 跌破前一个Swing Low (Lower Low)
    
    - CHoCH: 价格反向突破前一个swing点 → 趋势可能反转
      上升趋势中: 跌破前一个Swing Low (跌破Higher Low)
      下降趋势中: 突破前一个Swing High (突破Lower High)
    
    参数:
        klines: K线列表
        swings: find_swing_points() 的结果
        lookback: 最多回看多少个swing点
    """
    if len(swings) < 3 or len(klines) < 10:
        return []
    
    breaks = []
    
    # 只取最近的swing点分析
    recent_swings = swings[-lookback:] if len(swings) > lookback else swings
    
    # 先判断当前趋势方向: 看最近的swing high/low序列
    # 如果最近的高点在抬高 + 低点在抬高 = 上升趋势
    recent_highs = [s for s in recent_swings if s.type == "high"]
    recent_lows = [s for s in recent_swings if s.type == "low"]
    
    # 当前价格
    current_price = klines[-1]["close"]
    
    # 检测每个swing点是否被突破
    for i in range(len(recent_swings)):
        sw = recent_swings[i]
        
        # 看这个swing点之后的所有K线，是否有突破
        break_found = None
        for k_idx in range(sw.index + 1, len(klines)):
            k = klines[k_idx]
            
            if sw.type == "high":
                # Swing High 被向上突破
                if k["close"] > sw.price:
                    # 判断是BOS还是CHoCH
                    # 如果最近的趋势是上升的(高点在抬高)，突破HH是BOS
                    # 如果最近的趋势是下降的(高点在降低)，突破LH是CHoCH
                    is_uptrend = _is_uptrend(recent_swings[:i+1])
                    
                    if is_uptrend:
                        # 上升趋势中突破前高 = BOS (趋势延续)
                        break_found = StructureBreak(
                            type="BOS",
                            direction="bullish",
                            price=sw.price,
                            break_index=k_idx,
                            prev_swing=sw.price,
                        )
                    else:
                        # 下降趋势中突破前高 = CHoCH (趋势反转)
                        break_found = StructureBreak(
                            type="CHoCH",
                            direction="bullish",
                            price=sw.price,
                            break_index=k_idx,
                            prev_swing=sw.price,
                        )
                    break  # 找到第一个突破就够了
                
                # 检查是否有K线先跌破了某个swing low (不处理，由low分支处理)
            
            elif sw.type == "low":
                # Swing Low 被向下突破
                if k["close"] < sw.price:
                    is_downtrend = _is_downtrend(recent_swings[:i+1])
                    
                    if is_downtrend:
                        # 下降趋势中跌破前低 = BOS (趋势延续)
                        break_found = StructureBreak(
                            type="BOS",
                            direction="bearish",
                            price=sw.price,
                            break_index=k_idx,
                            prev_swing=sw.price,
                        )
                    else:
                        # 上升趋势中跌破前低 = CHoCH (趋势反转)
                        break_found = StructureBreak(
                            type="CHoCH",
                            direction="bearish",
                            price=sw.price,
                            break_index=k_idx,
                            prev_swing=sw.price,
                        )
                    break
        
        if break_found:
            breaks.append(break_found)
    
    # 去重: 同一个价格只保留最新的突破
    seen = {}
    for b in breaks:
        key = (b.type, b.direction, round(b.price, 4))
        seen[key] = b  # 后出现的覆盖前面的
    
    return list(seen.values())


def _is_uptrend(swings: List[SwingPoint]) -> bool:
    """判断swing序列是否为上升趋势"""
    highs = [s for s in swings if s.type == "high"]
    lows = [s for s in swings if s.type == "low"]
    
    if len(highs) < 2 or len(lows) < 2:
        return False
    
    # 最近两个高点在抬高 + 最近两个低点在抬高
    hh = highs[-1].price > highs[-2].price
    hl = lows[-1].price > lows[-2].price
    
    return hh or hl  # 至少高点在抬高


def _is_downtrend(swings: List[SwingPoint]) -> bool:
    """判断swing序列是否为下降趋势"""
    highs = [s for s in swings if s.type == "high"]
    lows = [s for s in swings if s.type == "low"]
    
    if len(highs) < 2 or len(lows) < 2:
        return False
    
    # 最近两个高点在降低 + 最近两个低点在降低
    lh = highs[-1].price < highs[-2].price
    ll = lows[-1].price < lows[-2].price
    
    return lh or ll


# ============================================
# 4. Order Blocks 订单块检测
# ============================================
def find_order_blocks(klines: List[dict],
                      swings: List[SwingPoint],
                      breaks: List[StructureBreak],
                      max_count: int = 5) -> List[OrderBlock]:
    """
    检测 Order Blocks (订单块)
    
    原理:
    机构建仓时会在某个区域放置大量订单，突破后这个区域成为支撑/阻力
    
    看多OB (Bullish OB):
    - 一段上涨趋势中，突破前最后一根看跌K线(阴线)的区域
    - 价格回踩到这个区域时是做多机会
    
    看空OB (Bearish OB):
    - 一段下跌趋势中，突破前最后一根看涨K线(阳线)的区域  
    - 价格反弹到这个区域时是做空机会
    
    参数:
        klines: K线列表
        swings: swing points
        breaks: 已检测到的结构突破
        max_count: 最多返回多少个OB
    """
    if not breaks or len(klines) < 5:
        return []
    
    obs = []
    
    for brk in breaks:
        # 找到突破发生前，最后一个反向K线
        # bullish突破 → 找突破前最后一根阴线(看跌K线)
        # bearish突破 → 找突破前最后一根阳线(看涨K线)
        
        search_start = max(0, brk.break_index - 10)  # 往前看最多10根
        search_end = brk.break_index
        
        for i in range(search_end - 1, search_start - 1, -1):
            k = klines[i]
            
            if brk.direction == "bullish" and k["body"] < 0:
                # 看多OB: 阴线区域
                ob_high = max(k["open"], k["close"])
                ob_low = k["low"]
                # 用成交量衡量强度
                avg_vol = sum(kk["volume"] for kk in klines[max(0,i-5):i]) / min(i, 5) if i > 0 else k["volume"]
                strength = k["volume"] / avg_vol if avg_vol > 0 else 1.0
                
                obs.append(OrderBlock(
                    direction="bullish",
                    high=ob_high,
                    low=ob_low,
                    ob_index=i,
                    break_index=brk.break_index,
                    strength=round(strength, 2),
                ))
                break
            
            elif brk.direction == "bearish" and k["body"] > 0:
                # 看空OB: 阳线区域
                ob_low = min(k["open"], k["close"])
                ob_high = k["high"]
                avg_vol = sum(kk["volume"] for kk in klines[max(0,i-5):i]) / min(i, 5) if i > 0 else k["volume"]
                strength = k["volume"] / avg_vol if avg_vol > 0 else 1.0
                
                obs.append(OrderBlock(
                    direction="bearish",
                    high=ob_high,
                    low=ob_low,
                    ob_index=i,
                    break_index=brk.break_index,
                    strength=round(strength, 2),
                ))
                break
    
    # 按强度排序，取最强的
    obs.sort(key=lambda x: x.strength, reverse=True)
    
    # 过滤: 去掉价格重叠的OB (合并相近的)
    filtered = []
    for ob in obs:
        overlap = False
        for f in filtered:
            # 如果两个OB的价格区间有重叠且方向相同，跳过
            if ob.direction == f.direction:
                if ob.low <= f.high and ob.high >= f.low:
                    overlap = True
                    break
        if not overlap:
            filtered.append(ob)
    
    return filtered[:max_count]


# ============================================
# 5. FVG (Fair Value Gap) 公允价值缺口
# ============================================
def find_fair_value_gaps(klines: List[dict], min_gap_pct: float = 0.001) -> List[FairValueGap]:
    """
    检测 Fair Value Gaps (公允价值缺口/三根K线缺口)
    
    原理:
    看多FVG: K线[i]的high < K线[i+2]的low → 中间有价格跳空
    看空FVG: K线[i]的low > K线[i+2]的high → 中间有价格跳空
    
    当价格回到FVG区域时，往往会获得支撑/阻力
    
    参数:
        klines: K线列表
        min_gap_pct: 最小缺口大小(占价格的百分比)，过滤噪音
    """
    if len(klines) < 3:
        return []
    
    fvgs = []
    current_price = klines[-1]["close"]
    
    for i in range(len(klines) - 2):
        k1 = klines[i]      # 前一根
        k2 = klines[i + 1]  # 中间一根
        k3 = klines[i + 2]  # 后一根
        
        # 看多FVG: k1.high < k3.low (向上跳空)
        gap_low = k1["high"]
        gap_high = k3["low"]
        
        if gap_high > gap_low:
            gap_size = (gap_high - gap_low) / current_price
            if gap_size >= min_gap_pct:
                # 检查是否已被回补
                filled = False
                for j in range(i + 3, len(klines)):
                    if klines[j]["low"] <= gap_high:
                        filled = True
                        break
                
                fvgs.append(FairValueGap(
                    direction="bullish",
                    high=gap_high,
                    low=gap_low,
                    index=i + 1,
                    filled=filled,
                ))
        
        # 看空FVG: k1.low > k3.high (向下跳空)
        gap_low2 = k3["high"]
        gap_high2 = k1["low"]
        
        if gap_high2 > gap_low2:
            gap_size = (gap_high2 - gap_low2) / current_price
            if gap_size >= min_gap_pct:
                filled = False
                for j in range(i + 3, len(klines)):
                    if klines[j]["high"] >= gap_low2:
                        filled = True
                        break
                
                fvgs.append(FairValueGap(
                    direction="bearish",
                    high=gap_high2,
                    low=gap_low2,
                    index=i + 1,
                    filled=filled,
                ))
    
    return fvgs


# ============================================
# 6. Equal Highs / Equal Lows
# ============================================
def find_equal_levels(swings: List[SwingPoint], tolerance_pct: float = 0.003) -> List[dict]:
    """
    检测 Equal Highs / Equal Lows (等高/等低点)
    
    原理:
    当两个相近的swing high/low价格非常接近时，
    说明该区域堆积了大量止损单。一旦突破，价格会加速运行。
    
    参数:
        swings: swing points
        tolerance_pct: 允许的价格偏差(百分比)
    """
    if len(swings) < 4:
        return []
    
    equals = []
    
    # 分离高低点
    highs = [s for s in swings if s.type == "high"]
    lows = [s for s in swings if s.type == "low"]
    
    # 检查 Equal Highs
    for i in range(len(highs) - 1):
        h1, h2 = highs[i], highs[i + 1]
        avg = (h1.price + h2.price) / 2
        diff = abs(h1.price - h2.price) / avg if avg > 0 else 1
        
        if diff <= tolerance_pct:
            equals.append({
                "type": "equal_highs",
                "price": round(avg, 4),
                "index1": h1.index,
                "index2": h2.index,
                "deviation_pct": round(diff * 100, 3),
            })
    
    # 检查 Equal Lows
    for i in range(len(lows) - 1):
        l1, l2 = lows[i], lows[i + 1]
        avg = (l1.price + l2.price) / 2
        diff = abs(l1.price - l2.price) / avg if avg > 0 else 1
        
        if diff <= tolerance_pct:
            equals.append({
                "type": "equal_lows",
                "price": round(avg, 4),
                "index1": l1.index,
                "index2": l2.index,
                "deviation_pct": round(diff * 100, 3),
            })
    
    return equals


# ============================================
# 统一入口 (Phase 3 完善时添加更多模块)
# ============================================
def analyze_smc(klines_by_interval: dict) -> dict:
    """
    SMC 综合分析入口
    
    参数:
        klines_by_interval: {"15m": [...], "1h": [...], "4h": [...]}
    
    返回:
        {
            "bias": "bullish"/"bearish"/"neutral",
            "score": -100 ~ +100,
            "signals": [str, ...],
            "key_levels": {"supports": [...], "resistances": [...], "order_blocks": [...]},
            "details": {...}
        }
    """
    all_signals = []
    total_score = 0
    all_supports = []
    all_resistances = []
    all_obs = []  # 所有Order Blocks
    all_fvgs_unfilled = []  # 未回补的FVG
    details = {}
    
    current_price = None
    # 用于多周期共振
    bull_count = 0
    bear_count = 0
    total_periods = 0
    
    for interval, klines in klines_by_interval.items():
        if len(klines) < 10:
            continue
        
        total_periods += 1
        current_price = klines[-1]["close"]
        period_score = 0
        
        # 1) Swing Points
        swings = find_swing_points(klines, left=3, right=3)
        
        for sw in swings:
            if sw.type == "low" and sw.price < current_price:
                all_supports.append(sw.price)
            elif sw.type == "high" and sw.price > current_price:
                all_resistances.append(sw.price)
        
        # 2) BOS / CHoCH (核心!)
        breaks = detect_structure_breaks(klines, swings)
        
        bos_bull = sum(1 for b in breaks if b.type == "BOS" and b.direction == "bullish")
        bos_bear = sum(1 for b in breaks if b.type == "BOS" and b.direction == "bearish")
        choch_bull = sum(1 for b in breaks if b.type == "CHoCH" and b.direction == "bullish")
        choch_bear = sum(1 for b in breaks if b.type == "CHoCH" and b.direction == "bearish")
        
        # 评分: BOS=延续信号更强, CHoCH=反转信号也强
        period_score += bos_bull * 20    # 看多BOS +20
        period_score -= bos_bear * 20    # 看空BOS -20
        period_score += choch_bull * 25  # 看多CHoCH +25 (反转信号更强)
        period_score -= choch_bear * 25  # 看空CHoCH -25
        
        # 最近的结构突破(用于信号展示)
        latest_breaks = sorted(breaks, key=lambda b: b.break_index, reverse=True)[:3]
        for b in latest_breaks:
            arrow = "▲" if b.direction == "bullish" else "▼"
            tag = "BOS" if b.type == "BOS" else "CHoCH"
            dist = (current_price - b.price) / current_price * 100
            all_signals.append(f"[{interval}] {arrow} {tag} {b.direction} @ ${b.price:,.1f} ({dist:+.2f}%)")
        
        # 3) Order Blocks
        obs = find_order_blocks(klines, swings, breaks)
        for ob in obs:
            all_obs.append({
                "interval": interval,
                "direction": ob.direction,
                "high": round(ob.high, 4),
                "low": round(ob.low, 4),
                "strength": ob.strength,
            })
            # 价格是否在OB区域内
            if ob.low <= current_price <= ob.high:
                if ob.direction == "bullish":
                    period_score += 15
                    all_signals.append(f"[{interval}] 📌 价格在看多OB内 ${ob.low:,.1f}~${ob.high:,.1f}")
                else:
                    period_score -= 15
                    all_signals.append(f"[{interval}] 📌 价格在看空OB内 ${ob.low:,.1f}~${ob.high:,.1f}")
            # OB作为关键价位
            elif ob.direction == "bullish" and ob.low < current_price:
                all_supports.append((ob.high + ob.low) / 2)
            elif ob.direction == "bearish" and ob.high > current_price:
                all_resistances.append((ob.high + ob.low) / 2)
        
        # 4) FVG
        fvgs = find_fair_value_gaps(klines)
        unfilled = [f for f in fvgs if not f.filled]
        for f in unfilled[-3:]:  # 只展示最近3个
            all_fvgs_unfilled.append({
                "interval": interval,
                "direction": f.direction,
                "high": round(f.high, 4),
                "low": round(f.low, 4),
            })
            # 价格接近FVG时的评分
            fvg_mid = (f.high + f.low) / 2
            dist_pct = abs(current_price - fvg_mid) / current_price
            if dist_pct < 0.005:  # 距离<0.5%
                if f.direction == "bullish":
                    period_score += 10
                else:
                    period_score -= 10
        
        # 5) Equal H/L
        equals = find_equal_levels(swings)
        for eq in equals:
            if eq["type"] == "equal_highs" and eq["price"] > current_price:
                all_resistances.append(eq["price"])
                all_signals.append(f"[{interval}] ⚡ 等高(EH) ${eq['price']:,.1f} 止损堆积")
            elif eq["type"] == "equal_lows" and eq["price"] < current_price:
                all_supports.append(eq["price"])
                all_signals.append(f"[{interval}] ⚡ 等低(EL) ${eq['price']:,.1f} 止损堆积")
        
        # 6) Premium/Discount
        pd_zone = calc_premium_discount(klines)
        if pd_zone["zone"] == "discount":
            period_score += 10
            all_signals.append(f"[{interval}] 折价区({pd_zone['pct']:.0f}%) → 利多")
        elif pd_zone["zone"] == "premium":
            period_score -= 10
            all_signals.append(f"[{interval}] 溢价区({pd_zone['pct']:.0f}%) → 利空")
        else:
            all_signals.append(f"[{interval}] 均衡区({pd_zone['pct']:.0f}%)")
        
        # 统计多空
        if period_score > 0:
            bull_count += 1
        elif period_score < 0:
            bear_count += 1
        
        total_score += max(-50, min(50, period_score))  # 单周期最多±50
        
        details[interval] = {
            "swings_count": len(swings),
            "bos_count": bos_bull + bos_bear,
            "choch_count": choch_bull + choch_bear,
            "ob_count": len(obs),
            "fvg_unfilled": len(unfilled),
            "equal_levels": len(equals),
            "premium_discount": pd_zone,
        }
    
    # 多周期共振加分
    if total_periods > 0:
        if bull_count >= total_periods * 0.7:
            total_score += 15
            all_signals.append(f"🔄 多周期共振看多 ({bull_count}/{total_periods})")
        elif bear_count >= total_periods * 0.7:
            total_score -= 15
            all_signals.append(f"🔄 多周期共振看空 ({bear_count}/{total_periods})")
    
    # 综合判断
    total_score = max(-100, min(100, total_score))
    
    if total_score > 20:
        bias = "bullish"
    elif total_score < -20:
        bias = "bearish"
    else:
        bias = "neutral"
    
    # 去重排序关键价位
    all_supports = sorted(set(round(s, 4) for s in all_supports), reverse=True)[:8]
    all_resistances = sorted(set(round(r, 4) for r in all_resistances))[:8]
    
    return {
        "bias": bias,
        "score": total_score,
        "signals": all_signals,
        "key_levels": {
            "supports": all_supports,
            "resistances": all_resistances,
            "order_blocks": all_obs[:5],
            "fvg_unfilled": all_fvgs_unfilled[:5],
        },
        "details": details,
    }
