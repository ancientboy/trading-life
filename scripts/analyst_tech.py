"""
小风交易系统 - 分析师 Agent (Part 2: 技术分析引擎)

多维度分析：
1. 多周期量价关系 (K线形态+成交量)
2. 订单簿流动性 (买卖墙+密度)
3. 庄家行为识别 (主动买卖+大单)
4. 趋势判断 + 入场点定位
5. StochRSI 超买超卖判断 (防止追涨杀跌)
"""
import logging
from typing import Dict, List, Tuple
from collections import defaultdict

logger = logging.getLogger("TechAnalysis")


# ============================================
# 1. 量价分析
# ============================================
def analyze_volume_price(klines: List[dict]) -> dict:
    """多周期量价分析"""
    if len(klines) < 5:
        return {"score": 0, "signals": []}
    
    signals = []
    score = 0  # -100 ~ +100
    
    recent = klines[-3:]  # 最近3根
    prev = klines[-10:-3] if len(klines) >= 10 else klines[:-3]
    
    # 平均成交量
    avg_vol = sum(k["volume"] for k in prev) / len(prev) if prev else 1
    
    for k in recent:
        vol_ratio = k["volume"] / avg_vol if avg_vol > 0 else 1
        taker_buy_ratio = k["taker_buy_vol"] / k["volume"] if k["volume"] > 0 else 0.5
        
        # 放量 + 阳线 = 多头信号
        if k["body"] > 0 and vol_ratio > 2.0:
            score += 25
            signals.append(f"放量阳线 Vol×{vol_ratio:.1f} TakerBuy={taker_buy_ratio:.0%}")
        # 放量 + 阴线 = 空头信号
        elif k["body"] < 0 and vol_ratio > 2.0:
            score -= 25
            signals.append(f"放量阴线 Vol×{vol_ratio:.1f} TakerSell={1-taker_buy_ratio:.0%}")
        # 缩量 = 蓄力
        elif vol_ratio < 0.5:
            signals.append(f"缩量盘整 Vol×{vol_ratio:.1f}")
        
        # 主动买入/卖出占比
        if taker_buy_ratio > 0.65:
            score += 15
            signals.append(f"主动买入主导 {taker_buy_ratio:.0%}")
        elif taker_buy_ratio < 0.35:
            score -= 15
            signals.append(f"主动卖出主导 {1-taker_buy_ratio:.0%}")
        
        # K线形态
        if k["range"] > 0:
            body_ratio = abs(k["body"]) / k["range"]
            if body_ratio < 0.15:
                signals.append("十字星(犹豫)")
            elif k["lower_shadow"] > abs(k["body"]) * 2:
                score += 10
                signals.append("长下影线(支撑)")
            elif k["upper_shadow"] > abs(k["body"]) * 2:
                score -= 10
                signals.append("长上影线(压力)")
    
    return {"score": max(-100, min(100, score)), "signals": signals, "avg_vol": avg_vol}


# ============================================
# 2. 订单簿分析
# ============================================
def analyze_orderbook(depth: dict, mid_price: float) -> dict:
    """订单簿流动性分析"""
    bids = depth.get("bids", [])
    asks = depth.get("asks", [])
    if not bids or not asks:
        return {"score": 0, "signals": [], "walls": [], "imbalance": 0}
    
    total_bid = sum(b[1] for b in bids)
    total_ask = sum(a[1] for a in asks)
    imbalance = (total_bid - total_ask) / (total_bid + total_ask) if (total_bid + total_ask) > 0 else 0
    
    # 价格分桶 (按0.2%一档)
    bucket_pct = 0.002
    bid_buckets = defaultdict(float)
    ask_buckets = defaultdict(float)
    
    for price, qty in bids:
        bucket = round(price / (mid_price * bucket_pct)) * (mid_price * bucket_pct)
        bid_buckets[bucket] += qty
    for price, qty in asks:
        bucket = round(price / (mid_price * bucket_pct)) * (mid_price * bucket_pct)
        ask_buckets[bucket] += qty
    
    # 找买卖墙 (>平均3倍)
    avg_bid_per_bucket = total_bid / max(len(bid_buckets), 1)
    avg_ask_per_bucket = total_bid / max(len(ask_buckets), 1)
    
    bid_walls = [(p, q) for p, q in bid_buckets.items() if q > avg_bid_per_bucket * 3]
    ask_walls = [(p, q) for p, q in ask_buckets.items() if q > avg_ask_per_bucket * 3]
    bid_walls.sort(key=lambda x: -x[1])
    ask_walls.sort(key=lambda x: -x[1])
    
    signals = []
    score = 0
    
    # 买卖比
    if imbalance > 0.3:
        score += 20
        signals.append(f"买方堆积 +{imbalance:.0%}")
    elif imbalance < -0.3:
        score -= 20
        signals.append(f"卖方堆积 {imbalance:.0%}")
    
    # 买卖墙
    for p, q in bid_walls[:3]:
        dist = (mid_price - p) / mid_price * 100
        signals.append(f"🟢买墙 ${p:,.0f} ({q:.1f}BTC) 距{dist:.1f}%")
        score += min(10, q / 5)  # 墙越大加分越多
    for p, q in ask_walls[:3]:
        dist = (p - mid_price) / mid_price * 100
        signals.append(f"🔴卖墙 ${p:,.0f} ({q:.1f}BTC) 距+{dist:.1f}%")
        score -= min(10, q / 5)
    
    # 支撑阻力位（没有明显墙壁时用价格1%/0.5%偏移）
    if bid_walls:
        support = max(bid_walls, key=lambda x: x[1])[0]
    else:
        support = mid_price * 0.99  # 1%下方
    if ask_walls:
        resistance = max(ask_walls, key=lambda x: x[1])[0]
    else:
        resistance = mid_price * 1.01  # 1%上方
    
    return {
        "score": max(-100, min(100, score)),
        "signals": signals,
        "walls": {"bid_walls": bid_walls[:5], "ask_walls": ask_walls[:5]},
        "imbalance": imbalance,
        "support": support,
        "resistance": resistance,
        "total_bid": total_bid,
        "total_ask": total_ask,
    }


# ============================================
# 3. 庄家行为识别
# ============================================
def analyze_whale_behavior(trades: List[dict], klines_1m: List[dict]) -> dict:
    """大单和庄家行为分析"""
    if not trades:
        return {"score": 0, "signals": [], "big_buys": 0, "big_sells": 0}
    
    # 按大小分类
    threshold_big = sorted([t["qty"] for t in trades], reverse=True)[min(10, len(trades)-1)] if len(trades) > 5 else 0
    
    big_buys = []  # 主动买入大单
    big_sells = []  # 主动卖出大单
    
    for t in trades:
        is_buy = t["is_buyer_maker"]  # True=主动买入
        if t["qty"] >= threshold_big:
            if is_buy:
                big_buys.append(t)
            else:
                big_sells.append(t)
    
    total_big_buy = sum(t["qty"] for t in big_buys)
    total_big_sell = sum(t["qty"] for t in big_sells)
    
    # 买卖压力指标
    buy_vol = sum(t["qty"] for t in trades if t["is_buyer_maker"])
    sell_vol = sum(t["qty"] for t in trades if not t["is_buyer_maker"])
    pressure = (buy_vol - sell_vol) / (buy_vol + sell_vol) if (buy_vol + sell_vol) > 0 else 0
    
    signals = []
    score = 0
    
    if total_big_buy > total_big_sell * 2:
        score += 30
        signals.append(f"🐋大单净买入 {total_big_buy:.2f} vs {total_big_sell:.2f}")
    elif total_big_sell > total_big_buy * 2:
        score -= 30
        signals.append(f"🐋大单净卖出 {total_big_sell:.2f} vs {total_big_buy:.2f}")
    
    if pressure > 0.3:
        score += 15
        signals.append(f"买方压力 +{pressure:.0%}")
    elif pressure < -0.3:
        score -= 15
        signals.append(f"卖方压力 {pressure:.0%}")
    
    # 吃单速度 (从1m K线)
    if klines_1m:
        latest = klines_1m[-1]
        taker_speed = latest["taker_buy_vol"] / max(latest["volume"], 1)
        if taker_speed > 0.7:
            score += 10
            signals.append(f"吃单速度快 TakerBuy={taker_speed:.0%}")
        elif taker_speed < 0.3:
            score -= 10
            signals.append(f"吃单速度慢 TakerSell={1-taker_speed:.0%}")
    
    return {
        "score": max(-100, min(100, score)),
        "signals": signals,
        "big_buys": len(big_buys),
        "big_sells": len(big_sells),
        "pressure": pressure,
        "total_big_buy_vol": total_big_buy,
        "total_big_sell_vol": total_big_sell,
    }


# ============================================
# 4. 趋势判断
# ============================================
def analyze_trend(klines_by_interval: dict) -> dict:
    """多周期趋势共振判断"""
    results = {}
    
    for interval, klines in klines_by_interval.items():
        if len(klines) < 5:
            continue
        
        latest = klines[-1]
        # MA 计算
        closes = [k["close"] for k in klines]
        ma7 = sum(closes[-7:]) / min(len(closes), 7)
        ma25 = sum(closes[-25:]) / min(len(closes), 25) if len(closes) >= 5 else ma7
        
        price = latest["close"]
        
        # 趋势方向
        if price > ma7 > ma25:
            trend = "strong_up"
        elif price > ma7:
            trend = "up"
        elif price < ma7 < ma25:
            trend = "strong_down"
        elif price < ma7:
            trend = "down"
        else:
            trend = "sideways"
        
        # 成交量趋势
        if len(klines) >= 10:
            vol_recent = sum(k["volume"] for k in klines[-3:])
            vol_prev = sum(k["volume"] for k in klines[-10:-3])
            vol_trend = "increasing" if vol_recent > vol_prev * 1.3 else "decreasing" if vol_recent < vol_prev * 0.7 else "stable"
        else:
            vol_trend = "unknown"
        
        results[interval] = {
            "trend": trend,
            "ma7": ma7,
            "ma25": ma25,
            "price": price,
            "vol_trend": vol_trend,
        }
    
    # 多周期共振
    trends = [r["trend"] for r in results.values()]
    up_count = sum(1 for t in trends if "up" in t)
    down_count = sum(1 for t in trends if "down" in t)
    total = len(trends)
    
    if total == 0:
        resonance = "neutral"
        score = 0
    elif up_count >= total * 0.7:
        resonance = "strong_bullish"
        score = 40
    elif up_count > down_count:
        resonance = "bullish"
        score = 20
    elif down_count >= total * 0.7:
        resonance = "strong_bearish"
        score = -40
    elif down_count > up_count:
        resonance = "bearish"
        score = -20
    else:
        resonance = "mixed"
        score = 0
    
    return {
        "score": score,
        "resonance": resonance,
        "details": results,
        "up_periods": up_count,
        "down_periods": down_count,
    }


# ============================================
# 5. 入场点定位
# ============================================
def find_entry_point(analysis_data: dict) -> dict:
    """综合判断最佳入场点"""
    price = analysis_data.get("price", 0)
    if price == 0:
        return {"action": "WAIT", "reason": "价格数据不足"}
    
    ob = analysis_data.get("orderbook", {})
    trend = analysis_data.get("trend", {})
    vp_1h = analysis_data.get("volume_price_1h", {})
    whale = analysis_data.get("whale", {})
    
    support = ob.get("support", price * 0.99)
    resistance = ob.get("resistance", price * 1.01)
    
    # 默认波动幅度 (2%)
    atr_pct = 0.02

    # 入场区域 (统一用百分比计算，避免异常值)
    if trend.get("resonance") in ("strong_bullish", "bullish"):
        direction = "LONG"
        entry_low = round(price * 0.998, 2)    # -0.2%
        entry_high = round(price * 1.001, 2)   # +0.1%
        stop = round(price * 0.985, 2)         # -1.5%
        target1 = round(price * 1.03, 2)       # +3%
        target2 = round(price * 1.05, 2)       # +5%
        target3 = round(price * 1.08, 2)       # +8%
    elif trend.get("resonance") in ("strong_bearish", "bearish"):
        direction = "SHORT"
        entry_low = round(price * 0.999, 2)    # -0.1%
        entry_high = round(price * 1.002, 2)   # +0.2%
        stop = round(price * 1.015, 2)         # +1.5%
        target1 = round(price * 0.97, 2)       # -3%
        target2 = round(price * 0.95, 2)       # -5%
        target3 = round(price * 0.92, 2)       # -8%
    else:
        direction = "NEUTRAL"
        entry_low = round(price * 0.997, 2)
        entry_high = round(price * 1.003, 2)
        stop = round(price * 0.985, 2)
        target1 = round(price * 1.03, 2)       # +3%
        target2 = round(price * 1.05, 2)       # +5%
        target3 = round(price * 1.08, 2)       # +8%
    
    # 风险回报比
    risk = abs(price - stop)
    reward = abs(target1 - price)
    rr_ratio = reward / risk if risk > 0 else 0
    
    return {
        "direction": direction,
        "entry_zone": [round(entry_low, 2), round(entry_high, 2)],
        "stop_loss": round(stop, 2),
        "targets": [round(target1, 2), round(target2, 2), round(target3, 2)],
        "risk_reward": round(rr_ratio, 2),
        "support": round(support, 2),
        "resistance": round(resistance, 2),
    }


# ============================================
# 6. StochRSI 计算
# ============================================
def calc_stochrsi(klines: List[dict], rsi_period: int = 14, 
                  stoch_period: int = 14, k_smooth: int = 3, d_smooth: int = 3) -> dict:
    """
    计算 StochRSI 指标
    返回: {k_value, d_value, zone, signal}
    
    StochRSI 原理:
    1. 先算 RSI (相对强弱指数)
    2. 再对 RSI 做 Stochastic 归一化 (0-100)
    3. K线 = smoothed StochRSI, D线 = K线的移动平均
    
    超买: K > 80 (价格过高，不适合做多)
    超卖: K < 20 (价格过低，不适合做空)
    
    入场条件:
    - 做多: K 从超卖区(<20)向上穿越D线 → 底部反转信号
    - 做空: K 从超买区(>80)向下穿越D线 → 顶部反转信号
    """
    closes = [k["close"] for k in klines]
    n = len(closes)
    
    # 需要足够的数据
    min_required = rsi_period + stoch_period + k_smooth + d_smooth
    if n < min_required:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL", 
                "valid": False, "reason": f"数据不足({n}<{min_required})"}
    
    # Step 1: 计算 RSI
    deltas = [closes[i] - closes[i-1] for i in range(1, n)]
    gains = [max(d, 0) for d in deltas]
    losses = [abs(min(d, 0)) for d in deltas]
    
    # 用 Wilder 平滑
    avg_gain = sum(gains[:rsi_period]) / rsi_period
    avg_loss = sum(losses[:rsi_period]) / rsi_period
    
    rsi_values = []
    if avg_loss == 0:
        rsi_values.append(100)
    else:
        rs = avg_gain / avg_loss
        rsi_values.append(100 - 100 / (1 + rs))
    
    for i in range(rsi_period, len(deltas)):
        avg_gain = (avg_gain * (rsi_period - 1) + gains[i]) / rsi_period
        avg_loss = (avg_loss * (rsi_period - 1) + losses[i]) / rsi_period
        if avg_loss == 0:
            rsi_values.append(100)
        else:
            rs = avg_gain / avg_loss
            rsi_values.append(100 - 100 / (1 + rs))
    
    # Step 2: 对 RSI 做 Stochastic 归一化
    if len(rsi_values) < stoch_period:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL",
                "valid": False, "reason": "RSI数据不足"}
    
    stoch_rsi_raw = []
    for i in range(stoch_period - 1, len(rsi_values)):
        window = rsi_values[i - stoch_period + 1: i + 1]
        min_rsi = min(window)
        max_rsi = max(window)
        if max_rsi == min_rsi:
            stoch_rsi_raw.append(50)
        else:
            stoch_rsi_raw.append((rsi_values[i] - min_rsi) / (max_rsi - min_rsi) * 100)
    
    # Step 3: K = SMA(stoch_rsi, k_smooth), D = SMA(K, d_smooth)
    if len(stoch_rsi_raw) < k_smooth + d_smooth:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL",
                "valid": False, "reason": "Stoch数据不足"}
    
    k_values = []
    for i in range(k_smooth - 1, len(stoch_rsi_raw)):
        k_values.append(sum(stoch_rsi_raw[i - k_smooth + 1: i + 1]) / k_smooth)
    
    d_values = []
    for i in range(d_smooth - 1, len(k_values)):
        d_values.append(sum(k_values[i - d_smooth + 1: i + 1]) / d_smooth)
    
    if not k_values or not d_values:
        return {"k_value": 50, "d_value": 50, "zone": "neutral", "signal": "NEUTRAL",
                "valid": False, "reason": "计算失败"}
    
    current_k = k_values[-1]
    current_d = d_values[-1] if d_values else current_k
    prev_k = k_values[-2] if len(k_values) >= 2 else current_k
    prev_d = d_values[-2] if len(d_values) >= 2 else current_d
    
    # 判断区域
    if current_k > 80:
        zone = "overbought"
    elif current_k < 20:
        zone = "oversold"
    else:
        zone = "neutral"
    
    # 交叉信号
    signal = "NEUTRAL"
    # 金叉: K从下方穿越D (看多)
    if prev_k <= prev_d and current_k > current_d:
        signal = "BULLISH_CROSS"
    # 死叉: K从上方穿越D (看空)
    elif prev_k >= prev_d and current_k < current_d:
        signal = "BEARISH_CROSS"
    
    return {
        "k_value": round(current_k, 2),
        "d_value": round(current_d, 2),
        "prev_k": round(prev_k, 2),
        "prev_d": round(prev_d, 2),
        "zone": zone,
        "signal": signal,
        "valid": True,
    }


def check_stochrsi_entry(direction: str, stochrsi: dict) -> dict:
    """
    用 StochRSi 判断是否应该入场
    
    规则:
    - 做多(LONG): K < 40 (不在超买区) + 最好是金叉或K在低位
    - 做空(SHORT): K > 60 (不在超卖区) + 最好是死叉或K在高位
    
    拒绝:
    - 做多但 K > 80: 超买区做多 = 追涨，拒绝
    - 做空但 K < 20: 超卖区做空 = 追跌，拒绝
    """
    if not stochrsi.get("valid"):
        return {"allowed": True, "reason": "StochRSI数据不足，放行"}
    
    k = stochrsi["k_value"]
    d = stochrsi["d_value"]
    zone = stochrsi["zone"]
    signal = stochrsi["signal"]
    
    if direction == "LONG":
        # 超买区拒绝做多
        if k > 80:
            return {"allowed": False, "reason": f"StochRSI K={k:.0f}>80 超买区，拒绝追涨做多"}
        # 高位偏谨慎
        if k > 70 and signal != "BULLISH_CROSS":
            return {"allowed": False, "reason": f"StochRSI K={k:.0f} 高位且无金叉确认，做多风险高"}
        # 理想做多区间
        if k < 40 or signal == "BULLISH_CROSS":
            return {"allowed": True, "reason": f"StochRSI K={k:.0f} 低位/金叉，适合做多"}
        # 中性区也允许
        return {"allowed": True, "reason": f"StochRSI K={k:.0f} 中性区，谨慎做多"}
    
    elif direction == "SHORT":
        # 超卖区拒绝做空
        if k < 20:
            return {"allowed": False, "reason": f"StochRSI K={k:.0f}<20 超卖区，拒绝追跌做空"}
        # 低位偏谨慎
        if k < 30 and signal != "BEARISH_CROSS":
            return {"allowed": False, "reason": f"StochRSI K={k:.0f} 低位且无死叉确认，做空风险高"}
        # 理想做空区间
        if k > 60 or signal == "BEARISH_CROSS":
            return {"allowed": True, "reason": f"StochRSI K={k:.0f} 高位/死叉，适合做空"}
        # 中性区也允许
        return {"allowed": True, "reason": f"StochRSI K={k:.0f} 中性区，谨慎做空"}
    
    return {"allowed": True, "reason": "方向为NEUTRAL"}


# ============================================
# 7a. 多周期 StochRSI 共振检测
# ============================================
def check_multi_timeframe_stochrsi(direction: str, klines_dict: dict) -> dict:
    """
    多周期 StochRSI 极值共振检测 — 高灵敏度因子
    
    原理：当多个时间框架的 StochRSI 同时处于极值区域时，
    反转/延续信号的可信度大幅提升
    
    策略：
    - 做多: 15m+1h+4h 的K值都 < 25 (深度超卖共振) → 强力反弹信号
    - 做空: 15m+1h+4h 的K值都 > 75 (深度超买共振) → 强力回调信号
    - 任意两个周期极值 = 中等共振
    - 三个周期极值 = 强共振 (额外加分)
    
    返回: {resonance_level: "none"/"weak"/"medium"/"strong",
           score: -20~+20, details: str}
    """
    intervals = ["15m", "1h", "4h"]
    readings = {}
    
    for interval in intervals:
        klines = klines_dict.get(interval, [])
        srsi = calc_stochrsi(klines) if len(klines) > 30 else {"valid": False, "k_value": 50}
        readings[interval] = srsi
    
    # 检查各周期极值
    oversold_count = sum(1 for r in readings.values() 
                        if r.get("valid") and r.get("k_value", 50) < 25)
    overbought_count = sum(1 for r in readings.values() 
                          if r.get("valid") and r.get("k_value", 50) > 75)
    
    k_values = {i: r.get("k_value", 50) for i, r in readings.items()}
    
    result = {"resonance_level": "none", "score": 0, "details": "", "k_values": k_values}
    
    if direction == "LONG":
        if oversold_count >= 3:
            result["resonance_level"] = "strong"
            result["score"] = 20  # 三周期深度超卖，强力反弹
            result["details"] = f"🔥 三周期超卖共振! K={k_values}"
        elif oversold_count >= 2:
            result["resonance_level"] = "medium"
            result["score"] = 12
            result["details"] = f"⚡ 双周期超卖共振 K={k_values}"
        elif oversold_count >= 1:
            result["resonance_level"] = "weak"
            result["score"] = 5
            result["details"] = f"单周期超卖 K={k_values}"
        # 额外加分：金叉确认
        for i, r in readings.items():
            if r.get("signal") == "BULLISH_CROSS" and r.get("valid"):
                result["score"] += 3
                result["details"] += f" | {i}金叉"
    
    elif direction == "SHORT":
        if overbought_count >= 3:
            result["resonance_level"] = "strong"
            result["score"] = 20
            result["details"] = f"🔥 三周期超买共振! K={k_values}"
        elif overbought_count >= 2:
            result["resonance_level"] = "medium"
            result["score"] = 12
            result["details"] = f"⚡ 双周期超买共振 K={k_values}"
        elif overbought_count >= 1:
            result["resonance_level"] = "weak"
            result["score"] = 5
            result["details"] = f"单周期超买 K={k_values}"
        for i, r in readings.items():
            if r.get("signal") == "BEARISH_CROSS" and r.get("valid"):
                result["score"] += 3
                result["details"] += f" | {i}死叉"
    
    return result


# ============================================
# 7b. 量价背离检测
# ============================================
def detect_volume_divergence(klines: List[dict], direction: str, lookback: int = 20) -> dict:
    """
    量价背离检测 — 高灵敏度因子
    
    看多信号(底背离)：
    - 价格创新低，但成交量萎缩 + 下跌动能减弱
    
    看空信号(顶背离)：
    - 价格创新高，但成交量萎缩 + 上涨动能减弱
    
    返回: {divergence: bool, type: str, score: -15~+15}
    """
    if len(klines) < lookback:
        return {"divergence": False, "type": "none", "score": 0}
    
    recent = klines[-lookback:]
    half = len(recent) // 2
    first_half = recent[:half]
    second_half = recent[half:]
    
    # 两半段的平均成交量
    avg_vol_first = sum(k.get("volume", 0) for k in first_half) / len(first_half) if first_half else 1
    avg_vol_second = sum(k.get("volume", 0) for k in second_half) / len(second_half) if second_half else 1
    
    # 价格走势
    price_start = recent[0]["close"]
    price_end = recent[-1]["close"]
    price_mid = recent[half]["close"]
    
    # 成交量趋势
    vol_declining = avg_vol_second < avg_vol_first * 0.7  # 成交量萎缩30%+
    vol_surge = avg_vol_second > avg_vol_first * 1.5  # 成交量放大50%+
    
    result = {"divergence": False, "type": "none", "score": 0, "details": ""}
    
    if direction == "LONG":
        # 底背离：价格下跌但量能萎缩 → 卖盘枯竭
        if price_end < price_start and vol_declining:
            result["divergence"] = True
            result["type"] = "bullish_divergence"
            result["score"] = 12
            result["details"] = "📉 底背离: 价格下跌但量能萎缩，卖盘枯竭"
        # 放量上涨 → 趋势确认
        elif price_end > price_start and vol_surge:
            result["type"] = "volume_confirmed_breakout"
            result["score"] = 8
            result["details"] = "📈 放量上涨，趋势确认"
    
    elif direction == "SHORT":
        # 顶背离：价格上涨但量能萎缩 → 买盘枯竭
        if price_end > price_start and vol_declining:
            result["divergence"] = True
            result["type"] = "bearish_divergence"
            result["score"] = 12
            result["details"] = "📉 顶背离: 价格上涨但量能萎缩，买盘枯竭"
        # 放量下跌 → 趋势确认
        elif price_end < price_start and vol_surge:
            result["type"] = "volume_confirmed_breakdown"
            result["score"] = 8
            result["details"] = "📉 放量下跌，趋势确认"
    
    return result


# ============================================
# 7c. 大单比率 (Taker Buy/Sell Ratio)
# ============================================
def analyze_taker_ratio(trades: List[dict]) -> dict:
    """
    分析大单买卖比率 — 主力方向判断
    
    逻辑：
    - TakerBuyVolume / TakerSellVolume > 1.3 → 主力买入
    - TakerBuyVolume / TakerSellVolume < 0.7 → 主力卖出
    
    返回: {ratio, score: -10~+10, signal}
    """
    if not trades:
        return {"ratio": 1.0, "score": 0, "signal": "neutral", "details": ""}
    
    taker_buy = sum(t.get("qty", 0) for t in trades if t.get("is_buyer_maker") == False)
    taker_sell = sum(t.get("qty", 0) for t in trades if t.get("is_buyer_maker") == True)
    
    if taker_sell == 0:
        ratio = 5.0 if taker_buy > 0 else 1.0
    else:
        ratio = taker_buy / taker_sell
    
    result = {"ratio": round(ratio, 2), "score": 0, "signal": "neutral", "details": ""}
    
    if ratio > 1.5:
        result["score"] = 10
        result["signal"] = "strong_buy"
        result["details"] = f"🐋 主力强力买入 比率={ratio:.2f}"
    elif ratio > 1.2:
        result["score"] = 6
        result["signal"] = "buy"
        result["details"] = f"📊 主力买入 比率={ratio:.2f}"
    elif ratio < 0.67:
        result["score"] = -10
        result["signal"] = "strong_sell"
        result["details"] = f"🐋 主力强力卖出 比率={ratio:.2f}"
    elif ratio < 0.83:
        result["score"] = -6
        result["signal"] = "sell"
        result["details"] = f"📊 主力卖出 比率={ratio:.2f}"
    else:
        result["details"] = f"⚖️ 买卖均衡 比率={ratio:.2f}"
    
    return result


# ============================================
# 8. 趋势结束判断 (持仓监控用)
# ============================================
def detect_trend_exhaustion(klines: List[dict], direction: str, 
                            entry_price: float = 0) -> dict:
    """
    综合判断趋势是否结束 — 用于移动止盈的智能触发
    
    三重确认机制（全部满足才判定趋势结束）：
    1. 顶底结构突破：价格跌破前低(做多) / 突破前高(做空)
    2. StochRSI 反转信号：从极值区域拐头
    3. 量价确认：放量反转 / 缩量上涨
    
    返回: {
        trend_alive: bool,       # 趋势是否还活着
        exhaustion_score: 0~100, # 趋势衰竭分数(0=强劲 100=结束)
        reasons: [],             # 判断原因
        suggested_action: str    # hold / tighten_trail / close
    }
    """
    if len(klines) < 20:
        return {"trend_alive": True, "exhaustion_score": 0, 
                "reasons": ["数据不足"], "suggested_action": "hold"}
    
    reasons = []
    exhaustion = 0  # 0=趋势强劲, 累加到100=趋势结束
    
    # ====== 1. 顶底结构分析 ======
    # 找出近期的摆动高点和摆动低点
    highs = [(i, klines[i]["high"]) for i in range(2, len(klines)-2)]
    lows = [(i, klines[i]["low"]) for i in range(2, len(klines)-2)]
    
    swing_highs = []
    swing_lows = []
    
    for i in range(2, len(klines)-2):
        # 摆动高点: 比左右各2根K线都高
        if (klines[i]["high"] > klines[i-1]["high"] and 
            klines[i]["high"] > klines[i-2]["high"] and
            klines[i]["high"] > klines[i+1]["high"] and 
            klines[i]["high"] > klines[i+2]["high"]):
            swing_highs.append((i, klines[i]["high"]))
        # 摆动低点: 比左右各2根K线都低
        if (klines[i]["low"] < klines[i-1]["low"] and 
            klines[i]["low"] < klines[i-2]["low"] and
            klines[i]["low"] < klines[i+1]["low"] and 
            klines[i]["low"] < klines[i+2]["low"]):
            swing_lows.append((i, klines[i]["low"]))
    
    current_price = klines[-1]["close"]
    prev_price = klines[-2]["close"]
    
    if direction == "LONG":
        # 做多时看：价格是否跌破最近摆动低点（结构破位）
        if swing_lows:
            last_swing_low = swing_lows[-1][1]
            if current_price < last_swing_low:
                exhaustion += 40
                reasons.append(f"🔻 结构破位: 价格{current_price:.6f} < 前低{last_swing_low:.6f}")
            elif len(swing_lows) >= 2:
                # 检查是否在形成更低低点
                prev_swing_low = swing_lows[-2][1]
                if last_swing_low < prev_swing_low:
                    exhaustion += 20
                    reasons.append(f"📉 形成更低低点: {last_swing_low:.6f} < {prev_swing_low:.6f}")
        
        # 做多时看：是否在形成更低高点
        if len(swing_highs) >= 2:
            if swing_highs[-1][1] < swing_highs[-2][1]:
                exhaustion += 15
                reasons.append(f"📉 高点降低: {swing_highs[-1][1]:.6f} < {swing_highs[-2][1]:.6f}")
    
    elif direction == "SHORT":
        # 做空时看：价格是否突破最近摆动高点
        if swing_highs:
            last_swing_high = swing_highs[-1][1]
            if current_price > last_swing_high:
                exhaustion += 40
                reasons.append(f"🔺 结构破位: 价格{current_price:.6f} > 前高{last_swing_high:.6f}")
            elif len(swing_highs) >= 2:
                prev_swing_high = swing_highs[-2][1]
                if last_swing_high > prev_swing_high:
                    exhaustion += 20
                    reasons.append(f"📈 形成更高高点: {last_swing_high:.6f} > {prev_swing_high:.6f}")
        
        if len(swing_lows) >= 2:
            if swing_lows[-1][1] > swing_lows[-2][1]:
                exhaustion += 15
                reasons.append(f"📈 低点抬高: {swing_lows[-1][1]:.6f} > {swing_lows[-2][1]:.6f}")
    
    # ====== 2. StochRSI 反转检测 ======
    stochrsi = calc_stochrsi(klines)
    if stochrsi.get("valid"):
        k_val = stochrsi["k_value"]
        d_val = stochrsi["d_value"]
        signal = stochrsi.get("signal", "")
        
        if direction == "LONG":
            # 做多时: StochRSI从高位死叉 = 动能衰竭
            if k_val > 70 and signal == "BEARISH_CROSS":
                exhaustion += 25
                reasons.append(f"⛔ StochRSI高位死叉 K={k_val:.0f}")
            elif k_val > 80:
                exhaustion += 15
                reasons.append(f"⚠️ StochRSI超买 K={k_val:.0f}")
            elif k_val < 30 and signal == "BULLISH_CROSS":
                # 超卖区金叉 → 趋势可能恢复
                exhaustion = max(0, exhaustion - 10)
                reasons.append(f"✅ StochRSI超卖金叉，趋势可能恢复")
        
        elif direction == "SHORT":
            if k_val < 30 and signal == "BULLISH_CROSS":
                exhaustion += 25
                reasons.append(f"⛔ StochRSI低位金叉 K={k_val:.0f}")
            elif k_val < 20:
                exhaustion += 15
                reasons.append(f"⚠️ StochRSI超卖 K={k_val:.0f}")
            elif k_val > 70 and signal == "BEARISH_CROSS":
                exhaustion = max(0, exhaustion - 10)
                reasons.append(f"✅ StochRSI超买死叉，趋势可能恢复")
    
    # ====== 3. 量价确认 ======
    if len(klines) >= 10:
        recent_vol = sum(k["volume"] for k in klines[-3:])
        prev_vol = sum(k["volume"] for k in klines[-10:-3])
        avg_recent = recent_vol / 3
        avg_prev = prev_vol / 7
        
        # 最近一根K线的方向
        last_body = klines[-1]["close"] - klines[-1]["open"]
        
        if direction == "LONG":
            # 做多时放量下跌 = 空头反扑
            if last_body < 0 and avg_recent > avg_prev * 1.5:
                exhaustion += 20
                reasons.append(f"📉 放量下跌，空头反扑 vol={avg_recent/avg_prev:.1f}x")
            # 缩量上涨 = 上涨动能衰竭
            elif last_body > 0 and avg_recent < avg_prev * 0.5:
                exhaustion += 10
                reasons.append("⚠️ 缩量上涨，动能减弱")
        
        elif direction == "SHORT":
            if last_body > 0 and avg_recent > avg_prev * 1.5:
                exhaustion += 20
                reasons.append(f"📈 放量上涨，多头反扑 vol={avg_recent/avg_prev:.1f}x")
            elif last_body < 0 and avg_recent < avg_prev * 0.5:
                exhaustion += 10
                reasons.append("⚠️ 缩量下跌，动能减弱")
    
    # ====== 4. 综合判断 ======
    exhaustion = min(100, exhaustion)
    
    if exhaustion >= 60:
        action = "close"            # 趋势明确结束 → 收紧移动止盈
    elif exhaustion >= 35:
        action = "tighten_trail"    # 趋势可能减弱 → 缩小容忍度
    else:
        action = "hold"             # 趋势依然健康 → 保持宽松
    
    if not reasons:
        reasons.append("✅ 趋势健康，无衰竭信号")
    
    return {
        "trend_alive": exhaustion < 60,
        "exhaustion_score": exhaustion,
        "reasons": reasons,
        "suggested_action": action,
        "swing_highs": [h[1] for h in swing_highs[-3:]] if swing_highs else [],
        "swing_lows": [l[1] for l in swing_lows[-3:]] if swing_lows else [],
    }


# ============================================
# 7. ATR 计算 (用于动态止损)
# ============================================
def calc_atr(klines: List[dict], period: int = 14) -> float:
    """
    计算平均真实波幅(ATR)
    用于设置动态止损距离
    """
    if len(klines) < period + 1:
        return 0
    
    true_ranges = []
    for i in range(1, len(klines)):
        high = klines[i]["high"]
        low = klines[i]["low"]
        prev_close = klines[i-1]["close"]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        true_ranges.append(tr)
    
    if len(true_ranges) < period:
        return sum(true_ranges) / len(true_ranges) if true_ranges else 0
    
    # 用最近 period 根计算
    recent_tr = true_ranges[-period:]
    return sum(recent_tr) / period


def calc_dynamic_stop(price: float, direction: str, klines: List[dict], 
                      atr_multiplier: float = 1.5, min_sl_pct: float = 0.03) -> dict:
    """
    基于 ATR 计算动态止损价
    
    参数:
    - atr_multiplier: ATR倍数 (1.5 = 1.5倍ATR作为止损距离)
    - min_sl_pct: 最小止损距离百分比 (3% = 至少3%空间)
    
    逻辑:
    - 止损距离 = max(ATR × multiplier, price × min_sl_pct)
    - 确保止损不会太紧(被噪音触发)也不会太松(亏损过大)
    """
    atr = calc_atr(klines, period=14)
    
    if atr <= 0:
        # ATR计算失败，用固定百分比
        sl_pct = min_sl_pct
    else:
        atr_pct = atr / price
        # 取 ATR止损 和 最小止损 的较大值
        sl_pct = max(atr_pct * atr_multiplier, min_sl_pct)
    
    # 上限: 止损不超过8%
    sl_pct = min(sl_pct, 0.08)
    
    if direction == "LONG":
        stop_loss = price * (1 - sl_pct)
    else:
        stop_loss = price * (1 + sl_pct)
    
    return {
        "stop_loss": round(stop_loss, 6),
        "sl_pct": round(sl_pct * 100, 2),
        "atr": round(atr, 6),
        "atr_pct": round(atr / price * 100, 2) if price > 0 and atr > 0 else 0,
        "method": "dynamic_atr" if atr > 0 else "fixed_pct",
    }


# ============================================
# 9. EMA 计算
# ============================================
def calc_ema(closes: List[float], period: int = 20) -> float:
    """计算指数移动平均线 (EMA)"""
    if not closes or period <= 0:
        return 0
    if len(closes) < period:
        return sum(closes) / len(closes)
    multiplier = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    for price in closes[period:]:
        ema = (price - ema) * multiplier + ema
    return ema


# ============================================
# 10. K线反转形态识别
# ============================================
def detect_candle_pattern(klines: List[dict], direction: str = None) -> dict:
    """
    识别K线反转形态 (Pin Bar / 吞没 / 晨星·暮星)
    
    返回: {patterns: [], score: -15~+15, details: str}
    """
    if len(klines) < 3:
        return {"patterns": [], "score": 0, "details": "数据不足"}
    
    patterns = []
    score = 0
    latest = klines[-1]
    prev = klines[-2]
    prev2 = klines[-3]
    
    def body_size(k):
        return abs(k.get("body", 0))
    
    # ---- Pin Bar ----
    if latest.get("range", 0) > 0:
        body = body_size(latest)
        tr = latest["range"]
        ls = latest.get("lower_shadow", 0)
        us = latest.get("upper_shadow", 0)
        # 看涨Pin Bar: 长下影线 + 小实体
        if ls > body * 2 and ls > tr * 0.6:
            patterns.append("🔨看涨Pin Bar")
            score += 10
        # 看跌Pin Bar: 长上影线 + 小实体
        if us > body * 2 and us > tr * 0.6:
            patterns.append("📌看跌Pin Bar")
            score -= 10
    
    # ---- Engulfing (吞没) ----
    if body_size(latest) > 0 and body_size(prev) > 0:
        # 看涨吞没: 前阴后阳，阳线包裹阴线
        if prev.get("body", 0) < 0 and latest.get("body", 0) > 0:
            if latest["close"] > prev["open"] and latest["open"] < prev["close"]:
                patterns.append("📈看涨吞没")
                score += 12
        # 看跌吞没: 前阳后阴，阴线包裹阳线
        elif prev.get("body", 0) > 0 and latest.get("body", 0) < 0:
            if latest["close"] < prev["open"] and latest["open"] > prev["close"]:
                patterns.append("📉看跌吞没")
                score -= 12
    
    # ---- Morning / Evening Star ----
    if prev2 is not None and body_size(prev2) > 0:
        # 晨星: 大阴 + 小实体(十字星) + 大阳
        if (prev2.get("body", 0) < 0 and
            body_size(prev) < body_size(prev2) * 0.3 and
            latest.get("body", 0) > 0 and body_size(latest) > body_size(prev2) * 0.5):
            patterns.append("🌅晨星")
            score += 15
        # 暮星: 大阳 + 小实体 + 大阴
        elif (prev2.get("body", 0) > 0 and
              body_size(prev) < body_size(prev2) * 0.3 and
              latest.get("body", 0) < 0 and body_size(latest) > body_size(prev2) * 0.5):
            patterns.append("🌆暮星")
            score -= 15
    
    # Direction filter: 只返回与方向相关的形态
    if direction == "LONG":
        bull = [p for p in patterns if any(k in p for k in ["看涨", "晨星"])]
        score = abs(score) if bull else 0
        patterns = bull
    elif direction == "SHORT":
        bear = [p for p in patterns if any(k in p for k in ["看跌", "暮星"])]
        score = -abs(score) if bear else 0
        patterns = bear
    
    return {"patterns": patterns, "score": score,
            "details": " | ".join(patterns) if patterns else "无明显反转形态"}


# ============================================
# 11. 早期启动检测 (Breakout Setup)
# ============================================
def detect_breakout_setup(klines_15m: List[dict], klines_1h: List[dict] = None,
                          direction: str = None) -> dict:
    """
    早期启动检测 — 横盘区间突破
    
    1. 15m检测横盘区间（波动率收敛/ATR收缩）
    2. 放量突破区间边界
    3. 1h确认趋势方向
    
    返回: {detected: bool, score: -20~+20, details: str, breakout_level: float}
    """
    if len(klines_15m) < 30:
        return {"detected": False, "type": "none", "score": 0,
                "details": "15m数据不足", "breakout_level": 0}
    
    # === 1. 检测横盘收敛 ===
    lookback = min(50, len(klines_15m))
    recent = klines_15m[-lookback:]
    half = len(recent) // 2
    first_half = recent[:half]
    second_half = recent[half:]
    
    # 波动范围比较
    fh = max(k["high"] for k in first_half) - min(k["low"] for k in first_half)
    sh = max(k["high"] for k in second_half) - min(k["low"] for k in second_half)
    avg_price = recent[-1]["close"]
    if avg_price <= 0:
        return {"detected": False, "type": "none", "score": 0,
                "details": "价格异常", "breakout_level": 0}
    
    fh_pct = fh / avg_price * 100
    sh_pct = sh / avg_price * 100
    range_compressing = sh_pct < fh_pct * 0.65 and fh_pct > 0
    
    # ATR收敛
    def _atr(ks):
        if len(ks) < 2:
            return 0
        trs = []
        for i in range(1, len(ks)):
            h, l, pc = ks[i]["high"], ks[i]["low"], ks[i-1]["close"]
            trs.append(max(h - l, abs(h - pc), abs(l - pc)))
        return sum(trs) / len(trs) if trs else 0
    
    atr_compressing = _atr(second_half) < _atr(first_half) * 0.75 and _atr(first_half) > 0
    is_consolidating = range_compressing or atr_compressing
    
    # === 2. 区间边界 ===
    ref = recent[-20:] if len(recent) >= 20 else recent
    range_high = max(k["high"] for k in ref)
    range_low = min(k["low"] for k in ref)
    
    latest = klines_15m[-1]
    avg_vol = sum(k["volume"] for k in ref[:-1]) / max(len(ref) - 1, 1)
    vol_ratio = latest["volume"] / avg_vol if avg_vol > 0 else 1
    vol_surge = vol_ratio > 1.5
    
    current_price = latest["close"]
    
    # === 3. 突破检测 ===
    up_break = current_price > range_high and latest["close"] > latest["open"]
    dn_break = current_price < range_low and latest["close"] < latest["open"]
    
    # === 4. 1h趋势确认 ===
    trend_up = trend_dn = False
    if klines_1h and len(klines_1h) >= 5:
        c = [k["close"] for k in klines_1h]
        ma7 = sum(c[-7:]) / min(len(c), 7)
        ma25 = sum(c[-25:]) / min(len(c), 25) if len(c) >= 5 else ma7
        trend_up = c[-1] > ma7 > ma25
        trend_dn = c[-1] < ma7 < ma25
    
    # === 5. 评分 ===
    score = 0
    details = []
    breakout_level = 0
    
    if up_break:
        breakout_level = range_high
        s = 10
        details.append(f"🚀 向上突破 {range_high:.6f}")
        if vol_surge:
            s += 5; details.append(f"放量 Vol×{vol_ratio:.1f}")
        if trend_up:
            s += 5; details.append("1h趋势确认")
        if is_consolidating:
            s += 3; details.append("横盘突破")
        score = s
    elif dn_break:
        breakout_level = range_low
        s = -10
        details.append(f"💥 向下突破 {range_low:.6f}")
        if vol_surge:
            s -= 5; details.append(f"放量 Vol×{vol_ratio:.1f}")
        if trend_dn:
            s -= 5; details.append("1h趋势确认")
        if is_consolidating:
            s -= 3; details.append("横盘突破")
        score = s
    
    # Direction filter
    if direction == "LONG" and score > 0:
        score = min(20, score)
    elif direction == "SHORT" and score < 0:
        score = max(-20, score)
    elif direction and score != 0:
        score = score // 3
        if details:
            details.append("⚠️突破方向与交易方向矛盾")
    
    detected = abs(score) >= 5
    return {
        "detected": detected,
        "type": "upside" if score > 0 else "downside" if score < 0 else "none",
        "score": score,
        "details": " | ".join(details) if details else "无突破信号",
        "breakout_level": breakout_level,
    }


# ============================================
# 12. 趋势回调入场检测 (Pullback Entry)
# ============================================
def detect_pullback_entry(klines_15m: List[dict], klines_1h: List[dict] = None,
                          klines_4h: List[dict] = None, direction: str = None) -> dict:
    """
    趋势回调入场 — 主趋势中等待回调到位
    
    1. 确认主趋势(4h/1h方向一致)
    2. 15m回调结构(Higher Low做多 / Lower High做空)
    3. 回调到位: EMA附近 + StochRSI拐头 + 反转K线
    
    返回: {detected: bool, score: -20~+20, details: str, pullback_level: float}
    """
    if len(klines_15m) < 30:
        return {"detected": False, "type": "none", "score": 0,
                "details": "15m数据不足", "pullback_level": 0}
    
    # === 1. 主趋势确认 (4h + 1h) ===
    trend_up = trend_dn = False
    trend_str = 0
    for klines_tf in [klines_4h, klines_1h]:
        if klines_tf and len(klines_tf) >= 5:
            c = [k["close"] for k in klines_tf]
            ma7 = sum(c[-7:]) / min(len(c), 7)
            ma25 = sum(c[-25:]) / min(len(c), 25) if len(c) >= 5 else ma7
            if c[-1] > ma7 > ma25:
                trend_up = True; trend_str += 1
            elif c[-1] < ma7 < ma25:
                trend_dn = True; trend_str += 1
    
    # 必须有至少一个大周期确认
    if direction == "LONG" and not trend_up:
        return {"detected": False, "type": "none", "score": 0,
                "details": "大周期非上涨趋势，不满足回调入场", "pullback_level": 0}
    if direction == "SHORT" and not trend_dn:
        return {"detected": False, "type": "none", "score": 0,
                "details": "大周期非下跌趋势，不满足回调入场", "pullback_level": 0}
    
    # === 2. 15m回调结构 ===
    rk = klines_15m[-30:]
    swing_highs = []
    swing_lows = []
    for i in range(2, len(rk) - 2):
        if (rk[i]["high"] > rk[i-1]["high"] and rk[i]["high"] > rk[i-2]["high"] and
            rk[i]["high"] > rk[i+1]["high"] and rk[i]["high"] > rk[i+2]["high"]):
            swing_highs.append((i, rk[i]["high"]))
        if (rk[i]["low"] < rk[i-1]["low"] and rk[i]["low"] < rk[i-2]["low"] and
            rk[i]["low"] < rk[i+1]["low"] and rk[i]["low"] < rk[i+2]["low"]):
            swing_lows.append((i, rk[i]["low"]))
    
    hl_structure = lh_structure = False
    structure_details = []
    
    if direction == "LONG" and len(swing_lows) >= 2:
        if swing_lows[-1][1] > swing_lows[-2][1]:
            hl_structure = True
            structure_details.append("📈 Higher Low")
        elif len(swing_lows) >= 3 and swing_lows[-1][1] > swing_lows[-3][1]:
            hl_structure = True
            structure_details.append("📈 低点抬升(宽泛HL)")
    
    if direction == "SHORT" and len(swing_highs) >= 2:
        if swing_highs[-1][1] < swing_highs[-2][1]:
            lh_structure = True
            structure_details.append("📉 Lower High")
        elif len(swing_highs) >= 3 and swing_highs[-1][1] < swing_highs[-3][1]:
            lh_structure = True
            structure_details.append("📉 高点降低(宽泛LH)")
    
    # === 3. 回调到位判断 ===
    closes = [k["close"] for k in klines_15m]
    price = closes[-1]
    ema20 = calc_ema(closes, 20)
    ema50 = calc_ema(closes, min(50, len(closes)))
    
    near_ema = False
    ema_details = []
    
    if direction == "LONG" and price > 0:
        d20 = abs(price - ema20) / price * 100
        d50 = abs(price - ema50) / price * 100
        if price >= ema20 * 0.99 and d20 < 1.5:
            near_ema = True
            ema_details.append(f"回踩EMA20({d20:.1f}%)")
        elif price >= ema50 * 0.99 and d50 < 2.0:
            near_ema = True
            ema_details.append(f"回踩EMA50({d50:.1f}%)")
        elif ema50 <= price <= ema20 * 1.01:
            near_ema = True
            ema_details.append("EMA20-50区间")
    
    elif direction == "SHORT" and price > 0:
        d20 = abs(price - ema20) / price * 100
        d50 = abs(price - ema50) / price * 100
        if price <= ema20 * 1.01 and d20 < 1.5:
            near_ema = True
            ema_details.append(f"反弹EMA20({d20:.1f}%)")
        elif price <= ema50 * 1.01 and d50 < 2.0:
            near_ema = True
            ema_details.append(f"反弹EMA50({d50:.1f}%)")
        elif ema20 * 0.99 <= price <= ema50:
            near_ema = True
            ema_details.append("EMA20-50区间")
    
    # StochRSI拐头
    srsi_turning = False
    srsi_detail = ""
    srsi = calc_stochrsi(klines_15m)
    if srsi.get("valid"):
        k = srsi["k_value"]
        sig = srsi.get("signal", "")
        pk = srsi.get("prev_k", 50)
        if direction == "LONG" and ((k < 35 and sig == "BULLISH_CROSS") or (k < 40 and pk < k)):
            srsi_turning = True
            srsi_detail = f"StochRSI拐头 K={k:.0f}"
        elif direction == "SHORT" and ((k > 65 and sig == "BEARISH_CROSS") or (k > 60 and pk > k)):
            srsi_turning = True
            srsi_detail = f"StochRSI拐头 K={k:.0f}"
    
    # 反转K线
    candle_rev = False
    candle_detail = ""
    cp = detect_candle_pattern(klines_15m, direction)
    if cp["score"] != 0:
        candle_rev = True
        candle_detail = cp["details"]
    
    # === 4. 综合: 至少2个条件满足 ===
    conds = sum([hl_structure or lh_structure, near_ema, srsi_turning, candle_rev])
    all_det = structure_details + ema_details
    if srsi_detail:
        all_det.append(srsi_detail)
    if candle_detail:
        all_det.append(candle_detail)
    
    score = 0
    if direction == "LONG" and conds >= 2:
        score = min(20, 8 + (conds - 2) * 4 + trend_str * 2)
    elif direction == "SHORT" and conds >= 2:
        score = max(-20, -8 - (conds - 2) * 4 - trend_str * 2)
    
    return {
        "detected": abs(score) >= 8,
        "type": "pullback_long" if score > 0 else "pullback_short" if score < 0 else "none",
        "score": score,
        "details": " | ".join(all_det) if all_det else "回调条件不充分",
        "pullback_level": ema20 if direction == "LONG" else ema50 if direction == "SHORT" else 0,
    }


# ============================================
# 11. EMA144/EMA576 多空排列 & 回调入场检测
# ============================================
def check_ema_alignment(klines_4h: List[dict], current_price: float = 0) -> dict:
    """
    检测EMA144/EMA576的多空排列状态，判断回调入场机会
    
    核心逻辑:
    - 多头排列: EMA144 > EMA576 且 price > EMA144 → 上升趋势
      → 价格回落到EMA144或EMA576附近 = 回调买入机会
    - 空头排列: EMA144 < EMA576 且 price < EMA144 → 下降趋势
      → 价格反弹到EMA144或EMA576附近 = 回调做空机会
    - 无排列: EMA144和EMA576纠缠 → 观望
    
    止损补充: 基于最近swing高/低点作为区间边界
    - 多头止损 = 最近swing low下方 (跌破区间 = 方向反转)
    - 空头止损 = 最近swing high上方 (突破区间 = 方向反转)
    
    参数:
        klines_4h: 4h K线数据 (需≥600根以稳定计算EMA576)
        current_price: 当前价格 (默认取最后一根K线close)
    
    返回:
        {
            "alignment": "bullish"|"bearish"|"neutral",
            "ema144": float, "ema576": float,
            "price_vs_ema144": "above"|"below"|"near",
            "price_vs_ema576": "above"|"below"|"near",
            "pullback_opportunity": bool,
            "pullback_direction": "LONG"|"SHORT"|None,
            "pullback_level": float,  # 最佳回调入场价(EMA144或EMA576)
            "swing_sl": float,  # 基于swing点的止损价
            "swing_sl_pct": float,  # 止损距离百分比
            "summary": str,  # 人类可读摘要
        }
    """
    result = {
        "alignment": "neutral",
        "ema144": 0, "ema576": 0,
        "price_vs_ema144": "unknown",
        "price_vs_ema576": "unknown",
        "pullback_opportunity": False,
        "pullback_direction": None,
        "pullback_level": 0,
        "swing_sl": 0,
        "swing_sl_pct": 0,
        "summary": "EMA数据不足",
    }
    
    if not klines_4h or len(klines_4h) < 100:  # 至少100根才开始算
        return result
    
    closes = [float(k.get("close", 0)) for k in klines_4h if float(k.get("close", 0)) > 0]
    if len(closes) < 100:
        return result
    
    price = current_price if current_price > 0 else closes[-1]
    
    # --- 计算EMA144和EMA576 ---
    ema144 = calc_ema(closes, 144)
    ema576 = calc_ema(closes, 576) if len(closes) >= 200 else calc_ema(closes, min(len(closes), 144))
    
    if ema144 <= 0 or ema576 <= 0:
        return result
    
    result["ema144"] = ema144
    result["ema576"] = ema576
    
    # --- 判断多空排列 ---
    # 需要EMA144和EMA576有明显间距(>0.1%)才算排列，否则视为纠缠
    ema_gap_pct = abs(ema144 - ema576) / ema576 * 100
    
    if ema144 > ema576 and ema_gap_pct > 0.1:
        result["alignment"] = "bullish"  # 多头排列
    elif ema144 < ema576 and ema_gap_pct > 0.1:
        result["alignment"] = "bearish"  # 空头排列
    else:
        result["alignment"] = "neutral"  # 纠缠/过渡
        result["summary"] = f"EMA144={ema144:,.2f} EMA576={ema576:,.2f} 间距{ema_gap_pct:.2f}%→纠缠，无排列"
        return result
    
    # --- 价格相对EMA的位置 ---
    near_threshold = ema576 * 0.005  # 0.5%以内算"接近"
    
    # 价格 vs EMA144
    if abs(price - ema144) <= near_threshold:
        result["price_vs_ema144"] = "near"
    elif price > ema144:
        result["price_vs_ema144"] = "above"
    else:
        result["price_vs_ema144"] = "below"
    
    # 价格 vs EMA576
    if abs(price - ema576) <= near_threshold:
        result["price_vs_ema576"] = "near"
    elif price > ema576:
        result["price_vs_ema576"] = "above"
    else:
        result["price_vs_ema576"] = "below"
    
    # --- 判断回调入场机会 ---
    alignment = result["alignment"]
    
    if alignment == "bullish":
        # 多头排列 → 价格应在EMA144上方
        # 回调到EMA144附近 = 一级买点
        # 回调到EMA576附近 = 二级买点(更深回调但更强支撑)
        dist_144 = (price - ema144) / price * 100
        dist_576 = (price - ema576) / price * 100
        
        if dist_144 <= 1.5:  # 距EMA144在1.5%以内
            result["pullback_opportunity"] = True
            result["pullback_direction"] = "LONG"
            result["pullback_level"] = ema144
            result["summary"] = (
                f"📈 多头排列 EMA144={ema144:,.2f} > EMA576={ema576:,.2f} "
                f"| 价格回踩EMA144 距离{dist_144:+.2f}% → 回调做多机会"
            )
        elif dist_576 <= 3.0:  # 距EMA576在3%以内
            result["pullback_opportunity"] = True
            result["pullback_direction"] = "LONG"
            result["pullback_level"] = ema576
            result["summary"] = (
                f"📈 多头排列 EMA144={ema144:,.2f} > EMA576={ema576:,.2f} "
                f"| 深度回调至EMA576附近 距离{dist_576:+.2f}% → 强支撑做多机会"
            )
        else:
            result["summary"] = (
                f"📈 多头排列 EMA144={ema144:,.2f} > EMA576={ema576:,.2f} "
                f"| 价格距EMA144 {dist_144:+.2f}% 距EMA576 {dist_576:+.2f}% → 等待回调"
            )
    
    elif alignment == "bearish":
        # 空头排列 → 价格应在EMA144下方
        # 反弹到EMA144附近 = 一级做空点
        # 反弹到EMA576附近 = 二级做空点(更深反弹但更强阻力)
        dist_144 = (ema144 - price) / price * 100
        dist_576 = (ema576 - price) / price * 100
        
        if dist_144 <= 1.5:  # 距EMA144在1.5%以内
            result["pullback_opportunity"] = True
            result["pullback_direction"] = "SHORT"
            result["pullback_level"] = ema144
            result["summary"] = (
                f"📉 空头排列 EMA144={ema144:,.2f} < EMA576={ema576:,.2f} "
                f"| 价格反弹至EMA144 距离{dist_144:+.2f}% → 回调做空机会"
            )
        elif dist_576 <= 3.0:  # 距EMA576在3%以内
            result["pullback_opportunity"] = True
            result["pullback_direction"] = "SHORT"
            result["pullback_level"] = ema576
            result["summary"] = (
                f"📉 空头排列 EMA144={ema144:,.2f} < EMA576={ema576:,.2f} "
                f"| 深度反弹至EMA576附近 距离{dist_576:+.2f}% → 强阻力做空机会"
            )
        else:
            result["summary"] = (
                f"📉 空头排列 EMA144={ema144:,.2f} < EMA576={ema576:,.2f} "
                f"| 价格距EMA144 {dist_144:+.2f}% 距EMA576 {dist_576:+.2f}% → 等待反弹"
            )
    
    # --- 基于Swing点的区间止损 ---
    # 取最近50根4h K线的swing点，找最近的swing low/high作为区间边界
    try:
        from analyst_smc import find_swing_points
        recent_klines = klines_4h[-50:] if len(klines_4h) >= 50 else klines_4h
        swings = find_swing_points(recent_klines, left=3, right=3)
        
        if swings:
            swing_highs = [s.price for s in swings if s.type == "high"]
            swing_lows = [s.price for s in swings if s.type == "low"]
            
            # 最近一个swing high 和 swing low
            nearest_high = max(swing_highs) if swing_highs else 0
            nearest_low = min(swing_lows) if swing_lows else 0
            
            if result["pullback_direction"] == "LONG" and nearest_low > 0:
                # 多头止损 = 最近swing low - 0.3%
                swing_sl = nearest_low * 0.997
                result["swing_sl"] = swing_sl
                result["swing_sl_pct"] = abs(price - swing_sl) / price * 100
            elif result["pullback_direction"] == "SHORT" and nearest_high > 0:
                # 空头止损 = 最近swing high + 0.3%
                swing_sl = nearest_high * 1.003
                result["swing_sl"] = swing_sl
                result["swing_sl_pct"] = abs(price - swing_sl) / price * 100
    except Exception:
        pass  # swing计算失败不影响EMA对齐结果
    
    return result


# ============================================
# 4h趋势结构检测 — Higher High/Low & Lower High/Low
# ============================================
def detect_4h_structure(klines_4h: List[dict], lookback: int = 50) -> dict:
    """
    检测4h K线的趋势结构，基于 Swing High/Low 的 Higher/Lower 判断
    
    核心逻辑（SMC经典）：
    - 上涨趋势: Higher Highs + Higher Lows (HH+HL)
      → 只做多，禁止做空
    - 下跌趋势: Lower Highs + Lower Lows (LH+LL)
      → 只做空，禁止做多
    - 震荡/不明: 混合结构
      → 两个方向都可（但需要更高置信度）
    
    参数:
        klines_4h: 4h K线数据 (建议≥30根)
        lookback: 回看K线数（默认50根 ≈ 8天）
    
    返回:
        {
            "structure": "bullish" | "bearish" | "neutral",
            "allowed_directions": ["LONG"] | ["SHORT"] | ["LONG", "SHORT"],
            "swing_highs": [float, ...],
            "swing_lows": [float, ...],
            "last_hh": float, "last_hl": float,
            "last_lh": float, "last_ll": float,
            "break_type": "BOS_bull" | "BOS_bear" | "none",
            "confidence": 0-100,
            "summary": str,
        }
    """
    result = {
        "structure": "neutral",
        "allowed_directions": ["LONG", "SHORT"],
        "swing_highs": [],
        "swing_lows": [],
        "last_hh": 0, "last_hl": 0,
        "last_lh": 0, "last_ll": 0,
        "break_type": "none",
        "confidence": 0,
        "summary": "4h结构数据不足",
    }
    
    if not klines_4h or len(klines_4h) < 20:
        return result
    
    # 取最近N根K线做结构分析
    recent = klines_4h[-lookback:] if len(klines_4h) >= lookback else klines_4h
    if len(recent) < 15:
        return result
    
    # --- 1. 提取Swing Points ---
    # 先用 left=2,right=2 (更灵敏，能抓到更多swing点)
    # 如果点太少，再用 left=3,right=3
    swings = []
    try:
        from analyst_smc import find_swing_points
        swings = find_swing_points(recent, left=2, right=2)
        # 分离看看够不够
        _highs = [s for s in swings if s.type == "high"]
        _lows = [s for s in swings if s.type == "low"]
        if len(_highs) < 2 or len(_lows) < 2:
            # 不够，用更宽松的 left=1
            swings = find_swing_points(recent, left=1, right=1)
    except Exception:
        # fallback: 简单局部极值
        n = len(recent)
        for i in range(1, n - 1):
            if (recent[i]["high"] > recent[i-1]["high"] and 
                recent[i]["high"] > recent[i+1]["high"]):
                swings.append(type('SP', (), {"index": i, "price": recent[i]["high"], "type": "high"})())
            elif (recent[i]["low"] < recent[i-1]["low"] and 
                  recent[i]["low"] < recent[i+1]["low"]):
                swings.append(type('SP', (), {"index": i, "price": recent[i]["low"], "type": "low"})())
    
    if not swings:
        return result
    
    # 分离 highs 和 lows
    swing_highs = [s for s in swings if s.type == "high"]
    swing_lows = [s for s in swings if s.type == "low"]
    
    result["swing_highs"] = [s.price for s in swing_highs[-5:]]
    result["swing_lows"] = [s.price for s in swing_lows[-5:]]
    
    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return result
    
    # --- 2. 判断 Higher/Lower 结构 ---
    # 核心改进：最近的swing点权重更高
    # 最近2对 > 历史 > 更早
    recent_highs = swing_highs[-5:] if len(swing_highs) >= 5 else swing_highs
    recent_lows = swing_lows[-5:] if len(swing_lows) >= 5 else swing_lows
    
    # 加权统计 Higher High 和 Lower High
    # 越近的swing对权重越大（指数衰减）
    hh_score = 0.0  # Higher High 得分
    lh_score = 0.0  # Lower High 得分
    n_highs = len(recent_highs)
    for i in range(1, n_highs):
        # 权重：最近的对=1.0，每往前一对衰减0.5
        weight = 1.0 if i == n_highs - 1 else 0.5 ** (n_highs - 1 - i)
        if recent_highs[i].price > recent_highs[i-1].price:
            hh_score += weight
        elif recent_highs[i].price < recent_highs[i-1].price:
            lh_score += weight
    
    # 加权统计 Higher Low 和 Lower Low
    hl_score = 0.0  # Higher Low 得分
    ll_score = 0.0  # Lower Low 得分
    n_lows = len(recent_lows)
    for i in range(1, n_lows):
        weight = 1.0 if i == n_lows - 1 else 0.5 ** (n_lows - 1 - i)
        if recent_lows[i].price > recent_lows[i-1].price:
            hl_score += weight
        elif recent_lows[i].price < recent_lows[i-1].price:
            ll_score += weight
    
    total_h = hh_score + lh_score
    total_l = hl_score + ll_score
    
    # --- 3. 最近一次结构突破 ---
    # 最近一对swing high: LH = 潜在下跌信号
    # 最近一对swing low:  LL = 下跌确认
    if len(swing_highs) >= 2:
        if swing_highs[-1].price > swing_highs[-2].price:
            result["last_hh"] = swing_highs[-1].price
            result["break_type"] = "BOS_bull"
        else:
            result["last_lh"] = swing_highs[-1].price
    
    if len(swing_lows) >= 2:
        if swing_lows[-1].price < swing_lows[-2].price:
            result["last_ll"] = swing_lows[-1].price
            if result["break_type"] == "BOS_bull":
                # 同时有HH和LL → 看哪个更新
                h_idx = swing_highs[-1].index if hasattr(swing_highs[-1], 'index') else 0
                l_idx = swing_lows[-1].index if hasattr(swing_lows[-1], 'index') else 0
                if l_idx > h_idx:
                    result["break_type"] = "BOS_bear"
            else:
                result["break_type"] = "BOS_bear"
        else:
            result["last_hl"] = swing_lows[-1].price
    
    # 如果break_type还是none，根据最近的LH/LL设定
    if result["break_type"] == "none":
        if result["last_lh"] > 0:
            result["break_type"] = "BOS_bear"
        elif result["last_hh"] > 0:
            result["break_type"] = "BOS_bull"
    
    # --- 4. 综合判断趋势结构 ---
    bullish_score = 0
    bearish_score = 0
    
    # 高点结构 (满40分)
    if total_h > 0:
        bullish_score += (hh_score / total_h) * 40
        bearish_score += (lh_score / total_h) * 40
    
    # 低点结构 (满40分)
    if total_l > 0:
        bullish_score += (hl_score / total_l) * 40
        bearish_score += (ll_score / total_l) * 40
    
    # 最近一次突破 (20分)
    if result["break_type"] == "BOS_bull":
        bullish_score += 20
    elif result["break_type"] == "BOS_bear":
        bearish_score += 20
    
    # --- 5. 结构结论 ---
    threshold = 45
    
    # ★ 关键改进：结构转变检测
    # 如果最近一次BOS与整体方向相反 → 结构正在转变，降级为neutral
    # 例如：整体HH+HL（bull）但最近一个high变成了LH → 多头结构被破坏，转neutral
    structure_breaking = False
    if result["break_type"] == "BOS_bear" and bullish_score >= threshold:
        # 多头结构被打破（LH或LL出现）→ 降级为neutral
        structure_breaking = True
        bearish_score += 15  # 额外加权，反映结构转变
    elif result["break_type"] == "BOS_bull" and bearish_score >= threshold:
        # 空头结构被打破（HH或HL出现）→ 降级为neutral
        structure_breaking = True
        bullish_score += 15
    
    if bullish_score >= threshold and bullish_score > bearish_score * 1.3 and not structure_breaking:
        result["structure"] = "bullish"
        result["allowed_directions"] = ["LONG"]
        result["confidence"] = min(int(bullish_score), 95)
        h_prices = [f"${s.price:,.2f}" for s in recent_highs[-3:]]
        l_prices = [f"${s.price:,.2f}" for s in recent_lows[-3:]]
        result["summary"] = (
            f"4h上涨结构(HH+HL) 置信度{result['confidence']}% | "
            f"高点趋势: {h_prices} | 低点趋势: {l_prices}"
        )
    elif bearish_score >= threshold and bearish_score > bullish_score * 1.3 and not structure_breaking:
        result["structure"] = "bearish"
        result["allowed_directions"] = ["SHORT"]
        result["confidence"] = min(int(bearish_score), 95)
        h_prices = [f"${s.price:,.2f}" for s in recent_highs[-3:]]
        l_prices = [f"${s.price:,.2f}" for s in recent_lows[-3:]]
        result["summary"] = (
            f"4h下跌结构(LH+LL) 置信度{result['confidence']}% | "
            f"高点趋势: {h_prices} | 低点趋势: {l_prices}"
        )
    else:
        result["structure"] = "neutral"
        result["allowed_directions"] = ["LONG", "SHORT"]
        result["confidence"] = max(int(bullish_score), int(bearish_score))
        if structure_breaking:
            result["summary"] = (
                f"⚠️ 4h结构转变中! bull={bullish_score:.0f} bear={bearish_score:.0f} "
                f"BOS={result['break_type']} | "
                f"HH={hh_score:.1f} LH={lh_score:.1f} HL={hl_score:.1f} LL={ll_score:.1f}"
            )
        else:
            result["summary"] = (
                f"4h结构震荡(多空混合) bull={bullish_score:.0f} bear={bearish_score:.0f} | "
                f"HH={hh_score:.1f} LH={lh_score:.1f} HL={hl_score:.1f} LL={ll_score:.1f}"
            )
    
    return result
