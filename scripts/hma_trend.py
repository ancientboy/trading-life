"""
小风交易系统 - Hull MA + Kahlman 趋势指标

原Pine Script: "长期趋势策略" by Adarsh
核心: Hull Moving Average (HMA) + Kahlman滤波平滑
  - HMA(34) 快线 + HMA3(34) 慢线
  - 快线上穿慢线 → B信号（做多）
  - 快线下穿慢线 → S信号（做空）
  
配合SMC使用:
  - B信号 + 价格在SMC支撑位附近 → 高置信度做多
  - S信号 + 价格在SMC阻力位附近 → 高置信度做空
  - 信号离SMC关键位太远 → 降权
  
周期建议: 1h最佳（平衡灵敏度与噪音），4h也可用于大趋势确认
纯Python实现，无外部依赖
"""

import math
from typing import Optional, Dict, List


# ============================================
# 1. 基础指标计算 (纯Python)
# ============================================

def _wma(series: List[float], period: int) -> List[Optional[float]]:
    """加权移动平均 (Weighted Moving Average)"""
    n = len(series)
    result: List[Optional[float]] = [None] * n
    if n < period:
        return result
    weight_sum = period * (period + 1) / 2.0
    for i in range(period - 1, n):
        s = 0.0
        valid = True
        for j in range(period):
            val = series[i - period + 1 + j]
            if val is None:
                valid = False
                break
            s += val * (j + 1)
        if valid:
            result[i] = s / weight_sum
    return result


def _hma(series: List[float], length: int) -> List[Optional[float]]:
    """
    Hull Moving Average
    HMA = WMA(2*WMA(src, len/2) - WMA(src, len), round(sqrt(len)))
    """
    half_len = max(1, length // 2)
    sqrt_len = max(1, round(math.sqrt(length)))
    
    wma_half = _wma(series, half_len)
    wma_full = _wma(series, length)
    
    diff: List[Optional[float]] = []
    for i in range(len(series)):
        a, b = wma_half[i], wma_full[i]
        if a is not None and b is not None:
            diff.append(2.0 * a - b)
        else:
            diff.append(None)
    
    return _wma(diff, sqrt_len)


def _hma3(series: List[float], length: int) -> List[Optional[float]]:
    """
    HMA 3.0 (3rd Generation)
    p = length/2
    HMA3 = WMA(WMA(close, p/3)*3 - WMA(close, p/2) - WMA(close, p), p)
    """
    p = max(1, length // 2)
    p3 = max(1, p // 3)
    p2 = max(1, p // 2)
    
    wma_p3 = _wma(series, p3)
    wma_p2 = _wma(series, p2)
    wma_p = _wma(series, p)
    
    diff: List[Optional[float]] = []
    for i in range(len(series)):
        a, b, c = wma_p3[i], wma_p2[i], wma_p[i]
        if a is not None and b is not None and c is not None:
            diff.append(a * 3.0 - b - c)
        else:
            diff.append(None)
    
    return _wma(diff, p)


def _kahlman(series: List[Optional[float]], gain: float = 5000) -> List[Optional[float]]:
    """
    Kahlman滤波器 (类似卡尔曼的简化自适应滤波)
    gain: 控制跟踪速度，值越大跟踪越紧（Pine Script默认5000）
    """
    n = len(series)
    result: List[Optional[float]] = [None] * n
    if n < 2:
        return result
    
    g = gain / 10000.0
    kf = 0.0
    velo = 0.0
    started = False
    
    for i in range(n):
        x = series[i]
        if x is None:
            result[i] = kf if started else None
            continue
        if not started:
            kf = x
            started = True
            result[i] = kf
            continue
        
        dk = x - kf
        smooth = kf + dk * math.sqrt(g * 2)
        velo = velo + g * dk
        kf = smooth + velo
        result[i] = kf
    
    return result


# ============================================
# 2. 信号检测
# ============================================

def detect_hma_signals(
    closes: List[float],
    length: int = 34,
    gain: float = 5000,
    use_kahlman: bool = True
) -> Dict:
    """
    检测HMA交叉信号
    
    返回: {
        "fast_line": list,          # HMA快线 (a)
        "slow_line": list,          # HMA3慢线 (b)
        "trend": "BULL"/"BEAR",     # 当前趋势
        "cross_up": bool,           # 最新是否有B信号
        "cross_dn": bool,           # 最新是否有S信号
        "cross_up_idx": int|None,   # 最近B信号位置
        "cross_dn_idx": int|None,   # 最近S信号位置
        "bars_since_signal": int,   # 距离最近信号的K线数
        "last_signal": "B"/"S"/None # 最近一次信号
    }
    """
    fast = _hma(closes, length)
    slow = _hma3(closes, length)
    
    if use_kahlman:
        fast_clean = [closes[i] if fast[i] is None else fast[i] for i in range(len(fast))]
        slow_clean = [closes[i] if slow[i] is None else slow[i] for i in range(len(slow))]
        fast = _kahlman(fast_clean, gain)
        slow = _kahlman(slow_clean, gain)
    
    n = len(fast)
    
    # 趋势: b > a = BULL(绿), a > b = BEAR(红)
    trend = "BULL"
    if fast[-1] is not None and slow[-1] is not None:
        trend = "BULL" if slow[-1] > fast[-1] else "BEAR"
    
    # 交叉检测 (最新一根)
    cross_up = False
    cross_dn = False
    if n >= 2 and fast[-1] is not None and slow[-1] is not None and fast[-2] is not None and slow[-2] is not None:
        cross_up = (slow[-1] > fast[-1]) and (slow[-2] <= fast[-2])
        cross_dn = (fast[-1] > slow[-1]) and (fast[-2] <= slow[-2])
    
    # 找最近的信号位置
    cross_up_idx = None
    cross_dn_idx = None
    for i in range(n - 1, 1, -1):
        if fast[i] is None or slow[i] is None or fast[i-1] is None or slow[i-1] is None:
            continue
        cu = (slow[i] > fast[i]) and (slow[i-1] <= fast[i-1])
        cd = (fast[i] > slow[i]) and (fast[i-1] <= slow[i-1])
        if cu and cross_up_idx is None:
            cross_up_idx = i
        if cd and cross_dn_idx is None:
            cross_dn_idx = i
        if cross_up_idx is not None and cross_dn_idx is not None:
            break
    
    # 最近信号
    last_signal = None
    bars_since = 999
    if cross_up_idx is not None and cross_dn_idx is not None:
        if cross_up_idx > cross_dn_idx:
            last_signal = "B"
            bars_since = n - 1 - cross_up_idx
        else:
            last_signal = "S"
            bars_since = n - 1 - cross_dn_idx
    elif cross_up_idx is not None:
        last_signal = "B"
        bars_since = n - 1 - cross_up_idx
    elif cross_dn_idx is not None:
        last_signal = "S"
        bars_since = n - 1 - cross_dn_idx
    
    return {
        "fast_line": fast,
        "slow_line": slow,
        "trend": trend,
        "cross_up": cross_up,
        "cross_dn": cross_dn,
        "cross_up_idx": cross_up_idx,
        "cross_dn_idx": cross_dn_idx,
        "bars_since_signal": bars_since,
        "last_signal": last_signal,
    }


# ============================================
# 3. 与SMC结合的高级信号
# ============================================

def check_hma_smc_alignment(
    hma_result: Dict,
    smc_signal: Optional[Dict],
    current_price: float,
    proximity_pct: float = 2.0
) -> Dict:
    """
    检测HMA信号与SMC关键位的对齐程度
    
    高置信度条件:
    - B信号(做多) + 价格在SMC支撑位(OB)附近
    - S信号(做空) + 价格在SMC阻力位(OB)附近
    
    proximity_pct: 距SMC关键位的最大允许距离(%)
    """
    last_signal = hma_result.get("last_signal")
    trend = hma_result.get("trend")
    bars_since = hma_result.get("bars_since_signal", 999)
    
    if not last_signal or bars_since > 10:
        return {
            "aligned": False,
            "alignment_type": f"趋势{trend}无近期信号",
            "proximity": 0,
            "confidence_mult": 1.0,
            "reason": f"HMA趋势={trend}，无近期B/S信号({bars_since}根K线前)"
        }
    
    if not smc_signal or smc_signal.get("direction") == "NEUTRAL":
        return {
            "aligned": False,
            "alignment_type": f"{last_signal}+无SMC",
            "proximity": 0,
            "confidence_mult": 1.0,
            "reason": f"HMA={last_signal}({bars_since}根前)，SMC无信号"
        }
    
    entry_zone = smc_signal.get("entry_zone")
    smc_dir = smc_signal.get("direction", "NEUTRAL")
    smc_conf = smc_signal.get("confidence", 0)
    
    if not entry_zone:
        return {
            "aligned": False,
            "alignment_type": f"{last_signal}+SMC无OB",
            "proximity": 0,
            "confidence_mult": 1.0,
            "reason": f"HMA={last_signal}，SMC={smc_dir}但无OB入场区"
        }
    
    ob_low, ob_high = entry_zone[0], entry_zone[1]
    
    if ob_low <= current_price <= ob_high:
        proximity = 0
    elif current_price < ob_low:
        proximity = (ob_low - current_price) / current_price * 100
    else:
        proximity = (current_price - ob_high) / current_price * 100
    
    # === 核心逻辑 ===
    aligned = False
    confidence_mult = 1.0
    reason = ""
    alignment_type = ""
    
    # B信号 + 做多 + 在支撑OB附近
    if last_signal == "B" and smc_dir == "LONG" and proximity <= proximity_pct:
        aligned = True
        if proximity == 0:
            confidence_mult = 1.5
            alignment_type = "B+支撑(在OB内)"
            reason = "⭐ B信号+SMC做多支撑OB内，极高置信度"
        else:
            confidence_mult = 1.3
            alignment_type = f"B+支撑(距{proximity:.1f}%)"
            reason = f"⭐ B信号+SMC做多支撑OB附近({proximity:.1f}%)"
    
    # S信号 + 做空 + 在阻力OB附近
    elif last_signal == "S" and smc_dir == "SHORT" and proximity <= proximity_pct:
        aligned = True
        if proximity == 0:
            confidence_mult = 1.5
            alignment_type = "S+阻力(在OB内)"
            reason = "⭐ S信号+SMC做空阻力OB内，极高置信度"
        else:
            confidence_mult = 1.3
            alignment_type = f"S+阻力(距{proximity:.1f}%)"
            reason = f"⭐ S信号+SMC做空阻力OB附近({proximity:.1f}%)"
    
    # 方向一致但离OB远
    elif last_signal == "B" and smc_dir == "LONG":
        confidence_mult = 1.0
        alignment_type = f"B+支撑远({proximity:.1f}%)"
        reason = f"B信号+SMC做多，但距支撑OB {proximity:.1f}%（远）"
    
    elif last_signal == "S" and smc_dir == "SHORT":
        confidence_mult = 1.0
        alignment_type = f"S+阻力远({proximity:.1f}%)"
        reason = f"S信号+SMC做空，但距阻力OB {proximity:.1f}%（远）"
    
    # 方向冲突
    elif last_signal == "B" and smc_dir == "SHORT":
        confidence_mult = 0.7
        alignment_type = "B vs SMC做空(冲突)"
        reason = f"⚠️ B信号但SMC={smc_dir}({smc_conf}%)，方向冲突"
    
    elif last_signal == "S" and smc_dir == "LONG":
        confidence_mult = 0.7
        alignment_type = "S vs SMC做多(冲突)"
        reason = f"⚠️ S信号但SMC={smc_dir}({smc_conf}%)，方向冲突"
    
    else:
        confidence_mult = 1.0
        alignment_type = f"{last_signal}+SMC={smc_dir}"
        reason = f"HMA={last_signal}，SMC={smc_dir}({smc_conf}%)"
    
    return {
        "aligned": aligned,
        "alignment_type": alignment_type,
        "proximity": round(proximity, 2),
        "confidence_mult": confidence_mult,
        "reason": reason,
        "last_signal": last_signal,
        "bars_since_signal": bars_since,
    }


# ============================================
# 4. 一站式接口
# ============================================

def analyze_hma_trend(
    klines: List[Dict],
    length: int = 34,
    gain: float = 5000,
    smc_signal: Optional[Dict] = None
) -> Dict:
    """
    一站式HMA分析 + SMC对齐检测
    
    klines: [{"open","high","low","close","volume"}, ...]
    需要至少 50+ 根K线才能稳定
    
    返回: {
        "trend": "BULL"/"BEAR",
        "last_signal": "B"/"S"/None,
        "bars_since_signal": int,
        "cross_now": bool,
        "cross_type": "B"/"S"/None,
        "smc_alignment": {...},
        "confidence_mult": float,
        "summary": str
    }
    """
    if len(klines) < 50:
        return {
            "trend": "UNKNOWN",
            "last_signal": None,
            "bars_since_signal": 999,
            "cross_now": False,
            "cross_type": None,
            "smc_alignment": None,
            "confidence_mult": 1.0,
            "summary": f"K线不足({len(klines)}<50)"
        }
    
    closes = [k["close"] for k in klines]
    current_price = closes[-1]
    
    hma_result = detect_hma_signals(closes, length, gain, use_kahlman=True)
    
    cross_now = hma_result["cross_up"] or hma_result["cross_dn"]
    cross_type = None
    if hma_result["cross_up"]:
        cross_type = "B"
    elif hma_result["cross_dn"]:
        cross_type = "S"
    
    smc_alignment = None
    conf_mult = 1.0
    if smc_signal:
        smc_alignment = check_hma_smc_alignment(hma_result, smc_signal, current_price)
        conf_mult = smc_alignment["confidence_mult"]
    
    parts = []
    parts.append(f"HMA趋势={hma_result['trend']}")
    if hma_result["last_signal"]:
        parts.append(f"最近{hma_result['last_signal']}信号({hma_result['bars_since_signal']}根前)")
    if cross_now:
        parts.append(f"★当前刚出{cross_type}信号")
    if smc_alignment:
        parts.append(smc_alignment["reason"])
    
    summary = " | ".join(parts)
    
    return {
        "trend": hma_result["trend"],
        "last_signal": hma_result["last_signal"],
        "bars_since_signal": hma_result["bars_since_signal"],
        "cross_now": cross_now,
        "cross_type": cross_type,
        "smc_alignment": smc_alignment,
        "confidence_mult": conf_mult,
        "summary": summary,
    }
