"""
方向判断引擎 v2 — 纯做多 + StochRSI + 顶底结构 + 大小周期共振

核心理念：
  1. 大周期(4h/1d)判断趋势方向 — 只做多，大周期必须向上
  2. 顶底结构(Swing High/Low)判断趋势 — Higher High + Higher Low = 上涨趋势
  3. StochRSI 多周期共振 — 多个小周期同时超卖/金叉 = 即将启动
  4. 布林带辅助 — 价格在中轨以下或刚突破中轨 = 还有上涨空间

完全不做空，只寻找即将启动的做多机会。
"""

import logging
from typing import List, Dict, Optional

logger = logging.getLogger("DirectionRules")


# ============================================
# 基础指标计算
# ============================================

def calc_bollinger_bands(closes: List[float], period: int = 20, std_dev: float = 2.0) -> Optional[Dict]:
    """布林带计算"""
    if len(closes) < period:
        return None

    window = closes[-period:]
    sma = sum(window) / period
    variance = sum((c - sma) ** 2 for c in window) / period
    std = variance ** 0.5

    upper = sma + std_dev * std
    lower = sma - std_dev * std
    price = closes[-1]

    bandwidth = upper - lower
    percent_b = (price - lower) / bandwidth * 100 if bandwidth > 0 else 50.0

    return {
        'upper': upper,
        'middle': sma,
        'lower': lower,
        'bandwidth_pct': bandwidth / sma * 100 if sma > 0 else 0,
        'percent_b': percent_b,
        'price': price,
    }


def calc_ema(closes: List[float], period: int) -> float:
    """EMA计算"""
    if len(closes) < period:
        return closes[-1] if closes else 0.0

    multiplier = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period

    for c in closes[period:]:
        ema = (c - ema) * multiplier + ema

    return ema


def calc_stochrsi(closes: List[float], rsi_period: int = 14,
                  stoch_period: int = 14, k_smooth: int = 3, d_smooth: int = 3) -> dict:
    """
    计算 StochRSI 指标
    返回: {k_value, d_value, zone, signal, valid}
    """
    n = len(closes)
    min_required = rsi_period + stoch_period + k_smooth + d_smooth
    if n < min_required:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL",
                "valid": False, "reason": f"数据不足({n}<{min_required})"}

    # Step 1: RSI
    deltas = [closes[i] - closes[i - 1] for i in range(1, n)]
    gains = [max(d, 0) for d in deltas]
    losses = [abs(min(d, 0)) for d in deltas]

    avg_gain = sum(gains[:rsi_period]) / rsi_period
    avg_loss = sum(losses[:rsi_period]) / rsi_period

    rsi_values = []
    if avg_loss == 0:
        rsi_values.append(100)
    else:
        rsi_values.append(100 - 100 / (1 + avg_gain / avg_loss))

    for i in range(rsi_period, len(deltas)):
        avg_gain = (avg_gain * (rsi_period - 1) + gains[i]) / rsi_period
        avg_loss = (avg_loss * (rsi_period - 1) + losses[i]) / rsi_period
        if avg_loss == 0:
            rsi_values.append(100)
        else:
            rsi_values.append(100 - 100 / (1 + avg_gain / avg_loss))

    if len(rsi_values) < stoch_period:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL",
                "valid": False, "reason": "RSI数据不足"}

    # Step 2: Stochastic 归一化
    stoch_rsi_raw = []
    for i in range(stoch_period - 1, len(rsi_values)):
        window = rsi_values[i - stoch_period + 1: i + 1]
        max_rsi = max(window)
        min_rsi = min(window)
        if max_rsi == min_rsi:
            stoch_rsi_raw.append(50)
        else:
            stoch_rsi_raw.append((rsi_values[i] - min_rsi) / (max_rsi - min_rsi) * 100)

    # Step 3: K = SMA(stoch_rsi, k_smooth), D = SMA(K, d_smooth)
    if len(stoch_rsi_raw) < k_smooth + d_smooth:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL",
                "valid": False, "reason": "平滑数据不足"}

    k_values = []
    for i in range(k_smooth - 1, len(stoch_rsi_raw)):
        k_values.append(sum(stoch_rsi_raw[i - k_smooth + 1: i + 1]) / k_smooth)

    d_values = []
    for i in range(d_smooth - 1, len(k_values)):
        d_values.append(sum(k_values[i - d_smooth + 1: i + 1]) / d_smooth)

    if not k_values or not d_values:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL",
                "valid": False, "reason": "计算失败"}

    k_val = k_values[-1]
    d_val = d_values[-1]

    # 前一根K值（判断交叉方向）
    prev_k = k_values[-2] if len(k_values) >= 2 else k_val
    prev_d = d_values[-2] if len(d_values) >= 2 else d_val

    # 判断区域
    if k_val < 20:
        zone = "oversold"
    elif k_val > 80:
        zone = "overbought"
    else:
        zone = "neutral"

    # 判断信号
    if prev_k < prev_d and k_val > d_val and k_val < 30:
        signal = "GOLDEN_CROSS_OVERSOLD"  # 超卖区金叉 → 强做多
    elif prev_k < prev_d and k_val > d_val:
        signal = "GOLDEN_CROSS"  # 普通金叉
    elif prev_k > prev_d and k_val < d_val and k_val > 70:
        signal = "DEAD_CROSS_OVERBOUGHT"  # 超买区死叉
    elif prev_k > prev_d and k_val < d_val:
        signal = "DEAD_CROSS"  # 普通死叉
    else:
        signal = "NEUTRAL"

    return {
        "k_value": round(k_val, 2),
        "d_value": round(d_val, 2),
        "prev_k": round(prev_k, 2),
        "prev_d": round(prev_d, 2),
        "zone": zone,
        "signal": signal,
        "valid": True,
    }


# ============================================
# 顶底结构（Swing High/Low）检测
# ============================================

def detect_swing_points(closes: List[float], highs: List[float] = None,
                        lows: List[float] = None, left: int = 5, right: int = 5) -> dict:
    """
    检测顶底结构（Swing Highs & Swing Lows）
    
    返回: {
        swing_highs: [{index, price}],
        swing_lows: [{index, price}],
        structure: "uptrend" | "downtrend" | "ranging",
        last_swing_low: float,  # 最近一个底部 → 止损参考
        last_swing_high: float, # 最近一个顶部
        trend_strength: float,  # 趋势强度 0-100
    }
    """
    if highs is None:
        highs = closes
    if lows is None:
        lows = closes

    n = len(closes)
    if n < left + right + 1:
        return {
            "swing_highs": [], "swing_lows": [],
            "structure": "ranging",
            "last_swing_low": closes[-1] if closes else 0,
            "last_swing_high": closes[-1] if closes else 0,
            "trend_strength": 0,
        }

    swing_highs = []
    swing_lows = []

    # 找 Swing High: 中心点比左右各N根K线的high都高
    for i in range(left, n - right):
        is_high = True
        for j in range(i - left, i + right + 1):
            if j != i and highs[j] >= highs[i]:
                is_high = False
                break
        if is_high:
            swing_highs.append({"index": i, "price": highs[i]})

    # 找 Swing Low: 中心点比左右各N根K线的low都低
    for i in range(left, n - right):
        is_low = True
        for j in range(i - left, i + right + 1):
            if j != i and lows[j] <= lows[i]:
                is_low = False
                break
        if is_low:
            swing_lows.append({"index": i, "price": lows[i]})

    # 判断趋势结构
    structure = "ranging"
    trend_strength = 0

    if len(swing_highs) >= 2 and len(swing_lows) >= 2:
        # 最近几个顶底
        recent_highs = [s["price"] for s in swing_highs[-3:]]
        recent_lows = [s["price"] for s in swing_lows[-3:]]

        # Higher Highs + Higher Lows = 上涨趋势
        hh_count = sum(1 for i in range(1, len(recent_highs)) if recent_highs[i] > recent_highs[i - 1])
        hl_count = sum(1 for i in range(1, len(recent_lows)) if recent_lows[i] > recent_lows[i - 1])

        # Lower Highs + Lower Lows = 下跌趋势
        lh_count = sum(1 for i in range(1, len(recent_highs)) if recent_highs[i] < recent_highs[i - 1])
        ll_count = sum(1 for i in range(1, len(recent_lows)) if recent_lows[i] < recent_lows[i - 1])

        total_pairs = max(len(recent_highs) - 1, 1)

        if hh_count >= 1 and hl_count >= 1:
            structure = "uptrend"
            trend_strength = (hh_count + hl_count) / (total_pairs * 2) * 100
        elif lh_count >= 1 and ll_count >= 1:
            structure = "downtrend"
            trend_strength = (lh_count + ll_count) / (total_pairs * 2) * 100
        elif hh_count >= 1:
            structure = "uptrend_weak"
            trend_strength = hh_count / total_pairs * 50

    last_sh = swing_highs[-1]["price"] if swing_highs else (highs[-1] if highs else 0)
    last_sl = swing_lows[-1]["price"] if swing_lows else (lows[-1] if lows else 0)

    return {
        "swing_highs": swing_highs[-5:],
        "swing_lows": swing_lows[-5:],
        "structure": structure,
        "last_swing_low": last_sl,
        "last_swing_high": last_sh,
        "trend_strength": round(trend_strength, 1),
    }


# ============================================
# 方向判断主函数 — 纯做多
# ============================================

def judge_direction(
    klines_15m: list,
    klines_1h: list,
    klines_4h: list,
) -> Dict:
    """
    纯做多方向判断引擎 v2

    评分维度（全部只做 LONG）:
    
    1. 大周期趋势（4h）— 必须向上，否则 SKIP
       - 4h 顶底结构 = uptrend → 通过
       - 4h EMA20 > EMA50 且价格 > EMA20 → 通过
       - 都不满足 → SKIP
    
    2. StochRSI 多周期共振（15m + 1h + 4h）
       - 超卖区金叉 +20分（每个周期）
       - 普通金叉 +10分
       - 超卖区(K<20) +8分
       - 多周期同时金叉/超卖 → 额外 +15分共振加分
    
    3. 顶底结构（1h + 4h）
       - 1h 出现 Higher Low → +15分（底部抬高=即将启动）
       - 4h 上涨结构 → +20分
       - 1h 刚突破前高(Swing High) → +15分
    
    4. 布林带辅助
       - BB %B < 20 → +10分（价格在下轨附近=有空间）
       - BB 刚突破中轨 → +10分
    
    5. 成交量确认
       - 放量 ×1.15
       - 缩量 ×0.8

    阈值:
      得分≥50 → 强信号(80-95%)
      得分≥35 → 中信号(65-85%)
      得分≥20 → 弱信号(55-70%)
      得分<20 → SKIP
      4h趋势不向上 → 直接SKIP
    
    Returns:
        {direction, confidence, score, reasoning, strategy, indicators}
    """
    score = 0
    reasoning = []
    indicators = {}

    # === 提取数据 ===
    def get_closes(klines):
        if not klines:
            return [], [], []
        closes = [float(k.get('close', 0)) for k in klines if float(k.get('close', 0)) > 0]
        highs = [float(k.get('high', 0)) for k in klines if float(k.get('close', 0)) > 0]
        lows = [float(k.get('low', 0)) for k in klines if float(k.get('close', 0)) > 0]
        return closes, highs, lows

    closes_15m, highs_15m, lows_15m = get_closes(klines_15m)
    closes_1h, highs_1h, lows_1h = get_closes(klines_1h)
    closes_4h, highs_4h, lows_4h = get_closes(klines_4h)

    # =============================================
    # 1. 大周期趋势过滤（4h）— 必须向上
    # =============================================
    big_trend_ok = False
    structure_4h = None

    if len(closes_4h) >= 30:
        # 4h 顶底结构
        structure_4h = detect_swing_points(closes_4h, highs_4h, lows_4h, left=3, right=3)
        indicators['structure_4h'] = structure_4h['structure']
        indicators['trend_strength_4h'] = structure_4h['trend_strength']

        # 4h EMA
        ema20_4h = calc_ema(closes_4h, 20)
        ema50_4h = calc_ema(closes_4h, 50)
        price_4h = closes_4h[-1]
        indicators['ema20_4h'] = round(ema20_4h, 6)
        indicators['ema50_4h'] = round(ema50_4h, 6)

        ema_bullish = ema20_4h > ema50_4h and price_4h > ema20_4h
        structure_bullish = structure_4h['structure'] in ['uptrend', 'uptrend_weak']

        if structure_bullish:
            big_trend_ok = True
            score += 20
            reasoning.append(f"4h顶底结构={structure_4h['structure']} 强度={structure_4h['trend_strength']:.0f}% → 上涨趋势 +20")

        if ema_bullish:
            big_trend_ok = True
            score += 10
            reasoning.append(f"4h EMA多头排列(price>{round(ema20_4h,4)}>{round(ema50_4h,4)}) +10")

        if not big_trend_ok:
            reasoning.append(f"❌ 4h趋势不向上(structure={structure_4h['structure']}, EMA={'多' if ema_bullish else '非多'})")
            # 记录止损参考价
            if structure_4h:
                indicators['stop_loss_ref'] = structure_4h['last_swing_low']
            return {
                "direction": "SKIP",
                "confidence": 0,
                "score": 0,
                "reasoning": reasoning,
                "strategy": "big_trend_not_bullish",
                "indicators": indicators,
            }
    else:
        reasoning.append(f"4h数据不足({len(closes_4h)}根)，跳过大周期过滤")
        # 数据不足不强制SKIP，但分数低

    # =============================================
    # 2. StochRSI 多周期共振
    # =============================================
    stochrsi_signals = {}
    bullish_periods = 0

    for label, closes in [("15m", closes_15m), ("1h", closes_1h), ("4h", closes_4h)]:
        srsi = calc_stochrsi(closes)
        stochrsi_signals[label] = srsi
        indicators[f'stochrsi_{label}'] = {
            'k': srsi['k_value'],
            'd': srsi['d_value'],
            'zone': srsi['zone'],
            'signal': srsi['signal'],
        }

        if not srsi['valid']:
            reasoning.append(f"StochRSI {label}: 数据不足")
            continue

        k = srsi['k_value']
        d = srsi['d_value']
        sig = srsi['signal']

        # 超卖区金叉 → 最强做多信号
        if sig == "GOLDEN_CROSS_OVERSOLD":
            score += 20
            bullish_periods += 1
            reasoning.append(f"⭐ StochRSI {label}: 超卖金叉(K={k:.1f}↑D={d:.1f}) +20")
        # 普通金叉
        elif sig == "GOLDEN_CROSS":
            score += 10
            bullish_periods += 1
            reasoning.append(f"StochRSI {label}: 金叉(K={k:.1f}↑D={d:.1f}) +10")
        # 超卖区(K<20)
        elif srsi['zone'] == 'oversold':
            score += 8
            bullish_periods += 1
            reasoning.append(f"StochRSI {label}: 超卖区(K={k:.1f}) +8")
        # K从低位回升(K在20-40之间且K>D)
        elif k < 40 and k > d:
            score += 5
            bullish_periods += 1
            reasoning.append(f"StochRSI {label}: 低位回升(K={k:.1f}>D={d:.1f}) +5")
        # 超买区 → 减分
        elif srsi['zone'] == 'overbought':
            score -= 15
            reasoning.append(f"⚠️ StochRSI {label}: 超买区(K={k:.1f}) -15")
        # 死叉
        elif sig in ["DEAD_CROSS", "DEAD_CROSS_OVERBOUGHT"]:
            score -= 10
            reasoning.append(f"⚠️ StochRSI {label}: 死叉(K={k:.1f}↓D={d:.1f}) -10")

    # 多周期共振加分
    if bullish_periods >= 3:
        score += 20
        reasoning.append(f"🔥 StochRSI 三周期共振(全部看多) +20")
    elif bullish_periods >= 2:
        score += 10
        reasoning.append(f"StochRSI 双周期共振 +10")

    # =============================================
    # 3. 顶底结构（1h — 小周期即将启动判断）
    # =============================================
    structure_1h = None
    if len(closes_1h) >= 30:
        structure_1h = detect_swing_points(closes_1h, highs_1h, lows_1h, left=4, right=4)
        indicators['structure_1h'] = structure_1h['structure']

        # Higher Low (底部抬高) → 即将启动
        if structure_1h['structure'] in ['uptrend', 'uptrend_weak']:
            score += 15
            reasoning.append(f"1h顶底结构={structure_1h['structure']} → 底部抬高 +15")

        # 价格刚突破前高 → 启动确认
        if len(closes_1h) >= 2:
            prev_sh = structure_1h['last_swing_high']
            current_price = closes_1h[-1]
            prev_price = closes_1h[-2]
            if prev_price <= prev_sh and current_price > prev_sh:
                score += 15
                reasoning.append(f"1h突破前高(${prev_sh:.4f}) → 启动确认 +15")

        # 记录止损参考（1h最近Swing Low）
        indicators['stop_loss_ref_1h'] = structure_1h['last_swing_low']

    # 4h 也记录止损参考
    if structure_4h:
        indicators['stop_loss_ref_4h'] = structure_4h['last_swing_low']
    # 15m 止损参考
    if len(closes_15m) >= 20:
        structure_15m = detect_swing_points(closes_15m, highs_15m, lows_15m, left=3, right=3)
        indicators['stop_loss_ref_15m'] = structure_15m['last_swing_low']

    # =============================================
    # 4. 波浪区间套（大周期底部 + 小周期突破）
    # =============================================
    # 区间套原理：
    # 4h 底部形态(双底/头肩底) + 15m 突破颈线 = 精确入场
    # 4h 底部形态 + 1h 二浪回调到Fib50/61.8% = 三浪前入场
    # 多周期依次突破 = 启动确认
    wave_bonus = 0
    wave_reasons = []
    neck_broke_4h = False

    try:
        from wave_pattern import detect_bottom_pattern, detect_wave_position, find_swings
        import sys

        # --- 4h 底部形态 ---
        bottom_4h = None
        wave_4h = None
        if len(klines_4h) >= 30:
            bottom_4h = detect_bottom_pattern(klines_4h)
            if bottom_4h:
                wave_4h = detect_wave_position(klines_4h, bottom_4h)

        # --- 1h 底部形态 ---
        bottom_1h = None
        wave_1h = None
        if len(klines_1h) >= 30:
            bottom_1h = detect_bottom_pattern(klines_1h)
            if bottom_1h:
                wave_1h = detect_wave_position(klines_1h, bottom_1h)

        # --- 15m 颈线突破检测 ---
        broke_neckline_15m = False
        neckline_price = 0
        if len(klines_15m) >= 20:
            # 如果4h有底部，取4h颈线
            if bottom_4h:
                neckline_price = bottom_4h.neckline
            elif bottom_1h:
                neckline_price = bottom_1h.neckline

            if neckline_price > 0:
                # 15m 检查是否刚突破颈线（最近3根K线）
                recent_15m = klines_15m[-3:]
                prev_15m = klines_15m[-5:-3] if len(klines_15m) >= 5 else []
                # 最近K线close > 颈线 且 之前close <= 颈线 = 刚突破
                if len(recent_15m) >= 2 and len(prev_15m) >= 1:
                    curr_above = all(float(k.get('close', 0)) > neckline_price for k in recent_15m[-2:])
                    prev_below = any(float(k.get('close', 0)) <= neckline_price for k in prev_15m)
                    if curr_above and prev_below:
                        broke_neckline_15m = True

                # 也检测15m自身的底部突破
                bottom_15m = detect_bottom_pattern(klines_15m)
                if bottom_15m and not broke_neckline_15m:
                    if len(klines_15m) >= 3:
                        nl_15m = bottom_15m.neckline
                        c_now = float(klines_15m[-1].get('close', 0))
                        c_prev = float(klines_15m[-2].get('close', 0))
                        c_prev2 = float(klines_15m[-3].get('close', 0)) if len(klines_15m) >= 3 else 0
                        if c_now > nl_15m and c_prev <= nl_15m:
                            broke_neckline_15m = True
                            neckline_price = nl_15m

        # === 组合评分（严格版：4h颈线必须突破才给高分）===
        pt_cn = {"double_bottom": "双底", "head_shoulders_bottom": "头肩底", "multiple_bottom": "多重底"}

        # 判断4h颈线是否已突破（wave_4h存在且wave > 0 = 已突破颈线）
        neck_broke_4h = wave_4h and wave_4h.get("wave", 0) > 0

        # ──── 第一梯队：4h颈线已突破 + 确认信号 ────

        if bottom_4h and neck_broke_4h and broke_neckline_15m:
            # ★ 最强：4h底部突破 + 15m突破颈线（区间套精确入场）
            wave_bonus += 25
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"🔥 4h{pt}已突破颈线 + 15m精确突破${neckline_price:.4f} → 区间套入场 +25")

        elif bottom_4h and neck_broke_4h and wave_4h.get("signal") == "wave2_buy_zone":
            # ★ 次强：4h底部突破后 + 4h二浪回调到位（Fib50/61.8%）
            wave_bonus += 23
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"🔥 4h{pt}突破后二浪回调到位(Fib{wave_4h.get('pullback_pct',0):.0f}%) → 三浪前入场 +23")

        elif bottom_4h and neck_broke_4h and wave_4h.get("signal") == "wave3_starting":
            # ★ 强：4h底部突破 + 4h三浪启动
            wave_bonus += 21
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"🔥 4h{pt}突破后三浪启动中 +21")

        elif bottom_4h and neck_broke_4h and wave_1h and wave_1h.get("signal") == "wave2_buy_zone":
            # ★ 强：4h已突破 + 1h二浪回调到位（精确入场时机）
            wave_bonus += 20
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"✅ 4h{pt}已突破 + 1h二浪回调到位(Fib{wave_1h.get('pullback_pct',0):.0f}%) +20")

        elif bottom_4h and neck_broke_4h and wave_1h and wave_1h.get("signal") == "wave3_starting":
            # 强：4h已突破 + 1h三浪启动
            wave_bonus += 19
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"✅ 4h{pt}已突破 + 1h三浪突破 +19")

        elif bottom_4h and neck_broke_4h and wave_4h.get("wave") == 1:
            # 中上：4h突破 + 一浪冲高中
            wave_bonus += 17
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"✅ 4h{pt}突破后一浪冲高中 +17")

        elif bottom_4h and neck_broke_4h:
            # 中等：4h已突破但无特殊1h信号
            wave_bonus += 14
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            w4s = wave_4h.get("signal", "")
            pb = wave_4h.get("pullback_pct", 0)
            wave_reasons.append(f"✅ 4h{pt}已突破颈线({w4s}, Fib{pb:.0f}%) +14")

        # ──── 第二梯队：4h底部形成中（未突破），只给观察分 ────

        elif bottom_4h and not neck_broke_4h and wave_1h and wave_1h.get("signal") == "wave2_buy_zone":
            # 4h未突破 + 1h自己的底部回调到位 → 不该入场，只是观察
            wave_bonus += 6
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"👀 4h{pt}未突破颈线 + 1h回调到位 → 等颈线突破再入场 +6")

        elif bottom_4h and not neck_broke_4h:
            # 4h底部形成中（未突破）
            wave_bonus += 4
            pt = pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type)
            wave_reasons.append(f"👀 4h{pt}形成中(颈线${bottom_4h.neckline:.4f})，等突破 +4")

        # ──── 第三梯队：只有1h底部 ────

        elif bottom_1h and broke_neckline_15m:
            # 1h底部 + 15m突破颈线（独立于4h）
            wave_bonus += 12
            pt = pt_cn.get(bottom_1h.pattern_type, bottom_1h.pattern_type)
            wave_reasons.append(f"✅ 1h{pt} + 15m突破颈线${neckline_price:.4f} +12")

        elif bottom_1h:
            # 1h底部形成中
            wave_bonus += 3
            pt = pt_cn.get(bottom_1h.pattern_type, bottom_1h.pattern_type)
            wave_reasons.append(f"👀 1h{pt}形成中 +3")

        if wave_bonus > 0:
            # 只有4h颈线已突破时才覆盖趋势过滤
            if not big_trend_ok and neck_broke_4h:
                big_trend_ok = True
                wave_reasons.append("💡 4h底部已突破颈线 → 覆盖趋势过滤（反转确认）")
            score += wave_bonus
            reasoning.extend(wave_reasons)

    except Exception as e:
        reasoning.append(f"波浪分析跳过: {e}")

    # =============================================
    # 5. 布林带辅助
    # =============================================
    bb_15m = calc_bollinger_bands(closes_15m)
    indicators['bb_15m'] = bb_15m

    if bb_15m:
        pb = bb_15m['percent_b']
        if pb < 15:
            score += 10
            reasoning.append(f"BB15m: 接近下轨(%B={pb:.1f}) → 有上涨空间 +10")
        elif pb < 40:
            score += 5
            reasoning.append(f"BB15m: 中下区间(%B={pb:.1f}) → 偏多 +5")
        elif pb > 85:
            score -= 10
            reasoning.append(f"⚠️ BB15m: 接近上轨(%B={pb:.1f}) → 空间有限 -10")

    bb_1h = calc_bollinger_bands(closes_1h)
    if bb_1h:
        pb_1h = bb_1h['percent_b']
        if pb_1h < 20:
            score += 8
            reasoning.append(f"BB1h: 下轨附近(%B={pb_1h:.1f}) → 确认偏多 +8")

    # =============================================
    # 6. 成交量确认
    # =============================================
    if klines_15m and len(klines_15m) >= 10:
        try:
            vols = [float(k.get('volume', 0)) for k in klines_15m[-5:]]
            prev_vols = [float(k.get('volume', 0)) for k in klines_15m[-10:-5]]
            if prev_vols and sum(prev_vols) > 0:
                vol_ratio = (sum(vols) / 5) / (sum(prev_vols) / 5)
                indicators['vol_ratio'] = round(vol_ratio, 2)
                if vol_ratio > 1.5 and score > 10:
                    score = int(score * 1.15)
                    reasoning.append(f"放量确认(×{vol_ratio:.1f}) → 信号增强 ×1.15")
                elif vol_ratio < 0.5 and score > 10:
                    score = int(score * 0.8)
                    reasoning.append(f"缩量(×{vol_ratio:.1f}) → 信号减弱 ×0.8")
        except Exception:
            pass

    # =============================================
    # 6.5 ★ v21: 启动前信号检测（吸筹+均线粘合+缩量极值）
    # =============================================
    if klines_4h and len(klines_4h) >= 20:
        try:
            from prelaunch_detector import detect_prelaunch_signals
            prelaunch = detect_prelaunch_signals(klines_4h, symbol="")
            if prelaunch["score"] > 0:
                pl_score = prelaunch["score"]
                # 按比例加分（最高+25）
                bonus = min(25, int(pl_score * 0.25))
                score += bonus
                reasoning.append(f"🔥 启动前信号: {prelaunch['detail']} +{bonus}")
                indicators['prelaunch_score'] = pl_score
                indicators['prelaunch_phase'] = prelaunch['phase']
        except Exception:
            pass

    # =============================================
    # 7. 最终决策
    # =============================================
    # ★ v21: StochRSI 入场时机 — 按入场类型区别对待
    # 
    # 两种入场模式，StochRSI要求不同：
    #
    # A. 结构突破入场（颈线/多重底/前高突破）
    #    → 不需要等StochRSI超卖金叉！突破本身就是确认信号
    #    → 但StochRSI不能在超买区（K>80），否则容易买在顶部
    #
    # B. 波浪回调/超卖反弹入场（没有突破结构）
    #    → 必须等StochRSI超卖金叉！这是唯一的入场时机确认
    #
    
    # 判断是否是结构突破
    has_structure_breakout = any(kw in ' '.join(reasoning) for kw in 
        ['突破颈线', '颈线突破', '多重底已突破', '头肩底突破', '区间套精确突破', '突破前高'])
    
    has_stochrsi_trigger = False
    stochrsi_trigger_detail = ""
    stochrsi_overbought = False  # 是否超买
    
    for label in ["15m", "1h", "4h"]:
        s = stochrsi_signals.get(label, {})
        sig = s.get('signal', '')
        k = s.get('k_value', 50)
        d = s.get('d_value', 50)
        zone = s.get('zone', 'neutral')
        
        # 检查超买
        if zone == 'overbought' or k > 80:
            stochrsi_overbought = True
        
        if sig == "GOLDEN_CROSS_OVERSOLD":
            has_stochrsi_trigger = True
            stochrsi_trigger_detail = f"StochRSI {label} 超卖金叉(K={k:.1f})"
            break
        elif sig == "GOLDEN_CROSS" and zone == 'oversold':
            has_stochrsi_trigger = True
            stochrsi_trigger_detail = f"StochRSI {label} 超卖区金叉(K={k:.1f})"
            break
        elif zone == 'oversold' and k > d:
            has_stochrsi_trigger = True
            stochrsi_trigger_detail = f"StochRSI {label} 超卖区K回升(K={k:.1f}↑)"
            break
    
    # 入场逻辑分支
    if has_structure_breakout:
        # === A. 结构突破模式 ===
        # 突破本身就是信号，不需要StochRSI金叉
        # 但StochRSI不能在超买区（追高风险大）
        if stochrsi_overbought:
            reasoning.append(f"⚠️ 结构突破但StochRSI超买区，追高风险大")
            # 降低分数而不是完全拒绝
            score = int(score * 0.7)
            reasoning.append(f"📊 超买降分: 得分调整为{score}")
        else:
            reasoning.append(f"✅ 结构突破入场（不强制要求StochRSI金叉）")
    else:
        # === B. 波浪回调/普通入场模式 ===
        # 必须等StochRSI超卖金叉
        if not has_stochrsi_trigger and score >= 35:
            reasoning.append(f"⏳ 综合得分={score}但非结构突破且StochRSI未到超卖金叉，等待入场时机")
            direction = "WAIT"
            confidence = min(40, score)
            strategy = "waiting_stochrsi_trigger"
            return {
                "direction": direction,
                "confidence": confidence,
                "score": score,
                "reasoning": reasoning,
                "strategy": strategy,
                "indicators": indicators,
                "entry_wave_level": "4h" if neck_broke_4h else ("1h" if bottom_1h else ""),
                "stochrsi_status": "waiting",
            }
        elif has_stochrsi_trigger:
            reasoning.append(f"🎯 StochRSI入场时机确认: {stochrsi_trigger_detail}")
    
    # v21: 提高最低入场门槛，避免弱信号入场
    if score >= 50:
        direction = "LONG"
        confidence = min(95, 60 + score)
        strategy = "strong_uptrend_resonance"
    elif score >= 35:
        direction = "LONG"
        confidence = min(85, 50 + score)
        strategy = "uptrend_resonance"
    else:
        direction = "SKIP"
        confidence = 0
        strategy = "signal_too_weak"
        reasoning.append(f"综合得分={score}，做多信号不足(阈值35)，跳过")

    return {
        "direction": direction,
        "confidence": confidence,
        "score": score,
        "reasoning": reasoning,
        "strategy": strategy,
        "indicators": indicators,
        "entry_wave_level": "4h" if neck_broke_4h else ("1h" if bottom_1h else ""),
    }
