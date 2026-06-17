"""
资金费率趋势分析模块

核心功能：
1. 计算单币资金费率趋势方向（偏多/偏空/中性）
2. 检测币种与BTC费率背离（非正相关判断）
3. 生成趋势判断信号供选币和AI决策使用

设计理念：
- 不是所有币都跟BTC正相关。资金费率反映市场对单个币的真实看法
- 费率方向 = 市场净头寸方向（正=多头占优，负=空头占优）
- 费率趋势变化 = 预期方向转变的前兆
- BTC-山寨费率背离 = 该币独立行情的信号
"""
import logging
import time
from typing import Dict, Optional, List
from datetime import datetime, timezone

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import REDIS_URL

logger = logging.getLogger("FundingTrend")

try:
    import redis
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    USE_REDIS = True
except Exception:
    USE_REDIS = False
    logger.warning("Redis不可用，资金费率趋势分析将使用默认值")


def _read_funding_history(symbol: str = None, count: int = 100) -> list:
    """
    从Redis读取资金费率历史数据
    
    Args:
        symbol: 指定币种（None=读取所有币种）
        count: 读取条数
    
    Returns:
        list of {symbol, rate, timestamp}
    """
    if not USE_REDIS:
        return []
    
    try:
        entries = redis_client.xrevrange("stream:binance:funding", count=count)
        results = []
        seen = set()
        
        for eid, raw_data in entries:
            decoded = {}
            for k, v in raw_data.items():
                key = k.decode() if isinstance(k, bytes) else k
                val = v.decode() if isinstance(v, bytes) else v
                decoded[key] = val
            
            sym = decoded.get("symbol", "")
            
            # 去重：每个symbol只取最新一条
            if sym in seen:
                continue
            seen.add(sym)
            
            # 如果指定symbol，只保留该币
            if symbol and sym != symbol:
                continue
            
            try:
                rate = float(decoded.get("lastFundingRate", 0))
            except (ValueError, TypeError):
                continue
            
            results.append({
                "symbol": sym,
                "rate": rate,
                "markPrice": decoded.get("markPrice", "0"),
                "nextFundingTime": decoded.get("nextFundingTime", ""),
            })
        
        return results
    except Exception as e:
        logger.debug(f"读取费率历史失败: {e}")
        return []


def get_funding_rate(symbol: str) -> float:
    """获取某币种当前资金费率"""
    data = _read_funding_history(symbol, count=20)
    for d in data:
        if d["symbol"] == symbol:
            return d["rate"]
    return 0.0


def analyze_funding_trend(symbol: str) -> dict:
    """
    分析单币资金费率趋势
    
    返回:
    {
        "rate": float,              # 当前费率
        "direction": str,           # "bullish" / "bearish" / "neutral"
        "strength": int,            # 1-10 (趋势强度)
        "score": int,               # -50 ~ +50 (正=看多信号, 负=看空信号)
        "label": str,               # 人类可读描述
        "btc_divergence": str,      # BTC背离状态
        "independent_signal": str,  # 独立行情信号描述
    }
    
    核心逻辑:
    - 费率为正且上升 → 多头在加仓 → 趋势偏多（但过热有反转风险）
    - 费率为正但很高(>0.05%) → 多头过热 → 逆向偏空
    - 费率为负且下降 → 空头在加仓 → 趋势偏空（但过热有反转风险）
    - 费率为负且很深(<-0.05%) → 空头过热 → 逆向偏多
    - 中性费率(-0.01%~0.01%) → 无方向信号
    """
    rate = get_funding_rate(symbol)
    
    result = {
        "rate": rate,
        "direction": "neutral",
        "strength": 0,
        "score": 0,
        "label": "中性",
        "btc_divergence": "无数据",
        "independent_signal": "",
    }
    
    if rate == 0:
        return result
    
    rate_pct = rate * 100  # 转百分比
    
    # === 费率方向+强度判断 ===
    # 正费率：多头付费 → 多头占优
    # 负费率：空头付费 → 空头占优
    # 极端正/负 → 过热，可能反转
    
    if rate >= 0.001:  # >= 0.1% → 多头严重拥挤
        # 极度过热 → 逆向信号（看空）
        result["direction"] = "bearish"  # 过热=反转前兆
        result["strength"] = min(10, int(abs(rate_pct) * 20))
        result["score"] = -min(50, int(abs(rate_pct) * 50))
        result["label"] = f"多头极度拥挤({rate_pct:+.4f}%)→反转看空"
    elif rate >= 0.0005:  # 0.05%~0.1% → 多头偏热
        result["direction"] = "slightly_bearish"
        result["strength"] = min(5, int(abs(rate_pct) * 10))
        result["score"] = -min(20, int(abs(rate_pct) * 30))
        result["label"] = f"多头较拥挤({rate_pct:+.4f}%)→略偏空"
    elif rate >= 0.0001:  # 0.01%~0.05% → 温和偏多
        result["direction"] = "bullish"
        result["strength"] = min(3, int(abs(rate_pct) * 10) + 1)
        result["score"] = min(10, int(abs(rate_pct) * 30))
        result["label"] = f"温和偏多({rate_pct:+.4f}%)→趋势延续"
    elif rate > -0.0001:  # -0.01%~0.01% → 中性
        result["direction"] = "neutral"
        result["strength"] = 0
        result["score"] = 0
        result["label"] = f"中性({rate_pct:+.4f}%)"
    elif rate > -0.0005:  # -0.05%~-0.01% → 温和偏空
        result["direction"] = "bearish"
        result["strength"] = min(3, int(abs(rate_pct) * 10) + 1)
        result["score"] = -min(10, int(abs(rate_pct) * 30))
        result["label"] = f"温和偏空({rate_pct:+.4f}%)→趋势延续"
    elif rate > -0.001:  # -0.1%~-0.05% → 空头偏热
        result["direction"] = "slightly_bullish"
        result["strength"] = min(5, int(abs(rate_pct) * 10))
        result["score"] = min(20, int(abs(rate_pct) * 30))
        result["label"] = f"空头较拥挤({rate_pct:+.4f}%)→略偏多"
    else:  # <= -0.1% → 空头严重拥挤
        # 极度过热 → 逆向信号（看多）
        result["direction"] = "bullish"  # 过热=反转前兆
        result["strength"] = min(10, int(abs(rate_pct) * 20))
        result["score"] = min(50, int(abs(rate_pct) * 50))
        result["label"] = f"空头极度拥挤({rate_pct:+.4f}%)→反转看多"
    
    # === BTC 背离检测 ===
    btc_rate = get_funding_rate("BTCUSDT")
    if btc_rate != 0:
        result = _check_btc_divergence(result, rate, btc_rate, symbol)
    
    return result


def _check_btc_divergence(result: dict, coin_rate: float, btc_rate: float, symbol: str) -> dict:
    """
    检测币种费率与BTC费率的背离
    
    背离 = 两者的市场情绪方向相反
    - BTC费率正(多头占优) + 山寨费率负(空头占优) → 负相关/背离 → 该币独立行情
    - BTC费率负(空头占优) + 山寨费率正(多头占优) → 负相关/背离 → 该币逆势走强
    
    一致 = 两者同向
    - 都偏多/都偏空 → 正相关 → 跟随BTC趋势
    """
    # 判断方向
    btc_bullish = btc_rate > 0.0001  # BTC费率>0.01% → 多头占优
    btc_bearish = btc_rate < -0.0001  # BTC费率<-0.01% → 空头占优
    coin_bullish = coin_rate > 0.0001
    coin_bearish = coin_rate < -0.0001
    
    base = symbol.replace("USDT", "")
    
    if btc_bullish and coin_bearish:
        # BTC多头+山寨空头 → 背离：资金在逃离山寨进BTC
        result["btc_divergence"] = "strong_bearish_divergence"
        result["independent_signal"] = f"⚠️ {base}与BTC严重背离：BTC多头热但{base}空头热，资金在逃离{base}进BTC"
        # 背离强化方向信号
        if result["score"] < 0:
            result["score"] = int(result["score"] * 1.5)  # 看空信号加强
    elif btc_bearish and coin_bullish:
        # BTC空头+山寨多头 → 背离：该币逆势走强
        result["btc_divergence"] = "strong_bullish_divergence"
        result["independent_signal"] = f"✨ {base}与BTC背离：BTC空头热但{base}多头热，{base}逆势走强"
        # 背离强化方向信号
        if result["score"] > 0:
            result["score"] = int(result["score"] * 1.5)  # 看多信号加强
    elif (btc_bullish and coin_bullish) or (btc_bearish and coin_bearish):
        # 一致 → 正相关，跟随BTC
        result["btc_divergence"] = "aligned"
        result["independent_signal"] = f"📊 {base}与BTC费率方向一致(正相关)"
    else:
        # 一方中性，无法判断
        result["btc_divergence"] = "neutral"
        result["independent_signal"] = ""
    
    return result


def analyze_funding_for_screening() -> Dict[str, dict]:
    """
    批量获取所有币种的费率趋势（供选币阶段使用）
    
    Returns:
        {symbol: analyze_funding_trend()的结果}
    """
    all_funding = _read_funding_history(count=300)
    results = {}
    
    for f in all_funding:
        sym = f["symbol"]
        results[sym] = analyze_funding_trend(sym)
    
    return results


def get_funding_direction_signal(symbol: str) -> dict:
    """
    供技术分析阶段使用的费率方向信号
    
    返回简化版：
    {
        "direction": "LONG" / "SHORT" / "NEUTRAL",
        "confidence": 0-100,
        "reason": str,
        "btc_relation": "正相关" / "负相关背离" / "一致" / "中性",
    }
    """
    trend = analyze_funding_trend(symbol)
    
    direction = "NEUTRAL"
    confidence = 0
    reason = ""
    btc_relation = "中性"
    
    d = trend["direction"]
    score = trend["score"]
    
    # 将趋势方向转为交易方向
    if d == "bullish":
        direction = "LONG"
        confidence = min(80, 40 + trend["strength"] * 5)
        reason = trend["label"]
    elif d == "slightly_bullish":
        direction = "LONG"
        confidence = min(60, 30 + trend["strength"] * 5)
        reason = trend["label"]
    elif d == "bearish":
        direction = "SHORT"
        confidence = min(80, 40 + trend["strength"] * 5)
        reason = trend["label"]
    elif d == "slightly_bearish":
        direction = "SHORT"
        confidence = min(60, 30 + trend["strength"] * 5)
        reason = trend["label"]
    else:
        direction = "NEUTRAL"
        confidence = 0
        reason = "费率中性，无方向信号"
    
    # BTC相关性格式化
    div = trend["btc_divergence"]
    if "bearish_divergence" in div:
        btc_relation = "负相关背离(资金逃离该币)"
        if direction == "SHORT":
            confidence = min(90, confidence + 10)  # 背离强化做空
    elif "bullish_divergence" in div:
        btc_relation = "负相关背离(该币逆势)"
        if direction == "LONG":
            confidence = min(90, confidence + 10)  # 背离强化做多
    elif div == "aligned":
        btc_relation = "正相关(与BTC一致)"
    else:
        btc_relation = "中性"
    
    return {
        "direction": direction,
        "confidence": confidence,
        "reason": reason,
        "btc_relation": btc_relation,
        "rate": trend["rate"],
        "score": score,
    }


def generate_funding_briefing(symbol: str) -> str:
    """
    生成资金费率简报文本（供AI briefing使用）
    """
    trend = analyze_funding_trend(symbol)
    rate_pct = trend["rate"] * 100
    
    parts = []
    parts.append(f"费率{rate_pct:+.4f}% → {trend['label']}")
    
    if trend["strength"] >= 5:
        parts.append(f"强度={trend['strength']}/10(强)")
    elif trend["strength"] >= 3:
        parts.append(f"强度={trend['strength']}/10(中)")
    
    if trend["independent_signal"]:
        parts.append(trend["independent_signal"])
    
    return " | ".join(parts)
