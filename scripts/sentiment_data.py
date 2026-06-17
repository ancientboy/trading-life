"""
小风交易系统 - 短线舆情情绪数据采集 (v2 - 短线优化版)

从 Redis Stream + Binance API 读取情报数据，生成标准化情绪评分。
针对短线交易(minutes~hours)优化：
- 资金费率异常 (25%) — 短线最有效的情绪指标
- 爆仓事件 (20%) — 极端情绪即时反映
- Open Interest变化 (15%) — 仓位动量
- 新闻情绪 (20%) — 事件驱动
- 鲸鱼动向 (10%) — 聪明钱
- 恐惧贪婪指数 (10%) — 长周期指标，仅极端值生效(FG<15或>85)
"""
import json
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from collections import defaultdict

logger = logging.getLogger("SentimentData")

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import REDIS_URL, CORE_SYMBOLS

try:
    import redis
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    USE_REDIS = True
except Exception:
    USE_REDIS = False
    logger.warning("Redis不可用，舆情数据将使用默认值")


def _read_stream_latest(stream: str, count: int = 50) -> list:
    """读取Redis Stream最新数据"""
    if not USE_REDIS:
        return []
    try:
        entries = redis_client.xrevrange(stream, count=count)
        results = []
        for eid, raw_data in entries:
            decoded = {}
            for k, v in raw_data.items():
                key = k.decode() if isinstance(k, bytes) else k
                val = v.decode() if isinstance(v, bytes) else v
                decoded[key] = val
            results.append(decoded)
        return results
    except Exception as e:
        logger.debug(f"读取 {stream} 失败: {e}")
        return []


# ============================================
# 1. 恐惧贪婪指数
# ============================================
def get_fear_greed() -> dict:
    """
    获取恐惧贪婪指数 — 短线优化版
    
    ⚠️ FG是日线级别长周期指标，对短线交易参考价值有限。
    只在极端值时才产生信号，避免把长周期信号误用于短周期判断。
    
    评分逻辑（仅极端生效）：
    - FG < 10: 极度恐惧 → score +50 (历史强反弹区)
    - FG 10-15: 深度恐惧 → score +30
    - FG 15-85: 正常区间 → score 0 (短线不参考!)
    - FG 85-90: 深度贪婪 → score -30
    - FG > 90: 极度贪婪 → score -50 (历史见顶区)
    """
    news = _read_stream_latest("stream:news", count=20)
    
    for n in news:
        if n.get("type") == "fear_greed":
            try:
                val = int(n.get("value", 50))
            except (ValueError, TypeError):
                val = 50
            
            label = n.get("label", "Neutral")
            
            # 短线优化：只在极端区域才给信号
            if val < 10:
                score = 50   # 极端恐惧 → 强反弹信号
                signal = "EXTREME_FEAR"
            elif val < 15:
                score = 30
                signal = "DEEP_FEAR"
            elif val <= 85:
                score = 0    # 正常区间 → 短线不参考FG
                signal = "NORMAL_RANGE"
            elif val <= 90:
                score = -30
                signal = "DEEP_GREED"
            else:
                score = -50  # 极端贪婪 → 见顶信号
                signal = "EXTREME_GREED"
            
            return {
                "value": val,
                "label": label,
                "emoji": n.get("emoji", "😐"),
                "score": score,
                "signal": signal,
            }
    
    # 默认中性
    return {"value": 50, "label": "Neutral", "emoji": "😐", "score": 0, "signal": "NORMAL_RANGE"}


# ============================================
# 2. 新闻情绪分析
# ============================================
def get_news_sentiment(symbol: str = None) -> dict:
    """
    分析最近新闻对特定币种/整体市场的情绪
    
    返回: {score: float(-100~+100), news_count: int, bullish_count: int, 
           bearish_count: int, highlights: list, categories: dict}
    """
    news = _read_stream_latest("stream:news", count=50)
    
    total_score = 0
    news_count = 0
    bullish_count = 0
    bearish_count = 0
    highlights = []
    category_scores = defaultdict(float)
    
    for n in news:
        ntype = n.get("type", "")
        if ntype != "news":
            continue
        
        # 如果指定了symbol，只看相关新闻
        related = n.get("related_coins", "")
        if symbol and symbol.replace("USDT", "") not in related:
            # 也看宏观新闻(无特定币种关联的)
            if related.strip():
                continue
        
        try:
            score = float(n.get("score", 0))
        except (ValueError, TypeError):
            score = 0
        
        title = n.get("title", "")
        category = n.get("category", "general")
        source = n.get("source", "?")
        
        # 根据新闻内容判断多空方向
        news_direction = _classify_news_direction(title, category)
        
        # 重要新闻权重更高
        is_important = n.get("is_important", "False") in ("True", "true", "1")
        weight = 2.0 if is_important else 1.0
        
        # 新闻评分：score越高说明关键词权重越大
        direction_score = score * news_direction * weight
        
        total_score += direction_score
        news_count += 1
        
        if news_direction > 0:
            bullish_count += 1
        elif news_direction < 0:
            bearish_count += 1
        
        category_scores[category] += direction_score
        
        # 记录重要新闻
        if is_important or score >= 3.0:
            highlights.append({
                "title": title[:80],
                "direction": "bullish" if news_direction > 0 else "bearish" if news_direction < 0 else "neutral",
                "score": score,
                "category": category,
            })
    
    # 归一化到 -100 ~ +100
    normalized = max(-100, min(100, total_score * 5)) if news_count > 0 else 0
    
    return {
        "score": round(normalized, 1),
        "news_count": news_count,
        "bullish_count": bullish_count,
        "bearish_count": bearish_count,
        "highlights": highlights[:10],
        "categories": dict(category_scores),
    }


def _classify_news_direction(title: str, category: str) -> int:
    """
    简单关键词分类：新闻是偏多还是偏空
    返回: +1(多), -1(空), 0(中性)
    """
    title_lower = title.lower()
    
    # 看多关键词
    bullish_keywords = [
        "etf approved", "etf approval", "bullish", "rally", "surge", "breakout",
        "adoption", "institutional buy", "partnership", "upgrade", "staking",
        "burn", "buyback", "sec approve", "spot etf", "inflow",
        "飙升", "暴涨", "利好", "突破", "采用", "合作",
    ]
    # 看空关键词
    bearish_keywords = [
        "hack", "exploit", "ban", "crackdown", "sec sue", "lawsuit", "rug pull",
        "bankrupt", "insolvency", "crash", "plunge", "dump", "fraud",
        "regulation", "restrict", "outflow", "sell-off",
        "暴跌", "崩盘", "利空", "被黑", "封杀", "处罚",
    ]
    
    for kw in bullish_keywords:
        if kw in title_lower:
            return 1
    for kw in bearish_keywords:
        if kw in title_lower:
            return -1
    
    # 类别默认倾向
    if category in ("security",):
        return -1  # 安全事件偏空
    if category in ("institutional",):
        return 1   # 机构新闻偏多
    
    return 0


# ============================================
# 3. 资金费率情绪
# ============================================
def get_funding_sentiment(symbol: str = None) -> dict:
    """
    从资金费率判断市场情绪
    
    逻辑：
    - 费率极高(>0.1%): 多头过热 → 偏空信号 score为负
    - 费率偏高(>0.03%): 偏多但需谨慎
    - 费率中性: 无影响
    - 费率偏低(<-0.03%): 空头较多
    - 费率极低(<-0.1%): 空头过热 → 偏多信号
    
    返回: {score: float, anomalies: list}
    """
    fundings = _read_stream_latest("stream:binance:funding", count=100)
    
    score = 0
    anomalies = []
    seen = set()
    
    for f in fundings:
        sym = f.get("symbol", "")
        if sym in seen:
            continue
        seen.add(sym)
        
        # 如果指定了symbol，只看该币种
        if symbol and sym != symbol:
            continue
        
        try:
            rate = float(f.get("lastFundingRate", 0))
        except (ValueError, TypeError):
            continue
        
        # 极端费率检测
        if rate >= 0.01:  # 1% 年化极高
            score -= 30
            anomalies.append({
                "symbol": sym,
                "rate": rate,
                "direction": "极度看多过热",
                "signal": "bearish",
            })
        elif rate >= 0.003:  # 0.3%
            score -= 15
            anomalies.append({
                "symbol": sym,
                "rate": rate,
                "direction": "偏多",
                "signal": "slightly_bearish",
            })
        elif rate <= -0.01:
            score += 30
            anomalies.append({
                "symbol": sym,
                "rate": rate,
                "direction": "极度看空过热",
                "signal": "bullish",
            })
        elif rate <= -0.003:
            score += 15
            anomalies.append({
                "symbol": sym,
                "rate": rate,
                "direction": "偏空",
                "signal": "slightly_bullish",
            })
    
    return {
        "score": max(-100, min(100, score)),
        "anomalies": anomalies[:10],
    }


# ============================================
# 4. 鲸鱼动向情绪
# ============================================
def get_whale_sentiment() -> dict:
    """
    链上鲸鱼动向情绪
    
    逻辑：大额转入交易所 = 可能要卖(空), 大额转出 = 可能囤币(多)
    但我们没有方向数据，所以用金额大小和频率做加权
    
    返回: {score: float, big_moves: list}
    """
    whales = _read_stream_latest("stream:onchain:whale", count=20)
    
    score = 0
    big_moves = []
    total_usd = 0
    
    for w in whales:
        try:
            val = float(str(w.get("amount_usd", "0")).replace(",", ""))
        except (ValueError, TypeError):
            val = 0
        
        if val < 100_000:  # 忽略小鲸鱼
            continue
        
        total_usd += val
        chain = w.get("chain", "?")
        to_addr = str(w.get("to", ""))
        
        # 简单判断：大额移动本身就是市场活跃信号
        # 无法精确判断方向，按金额大小给一个小的偏向
        if val >= 10_000_000:  # 千万级
            score += 10  # 大额移动通常意味着波动要来，偏看多(鲸鱼一般买后涨)
            big_moves.append({
                "chain": chain,
                "amount_usd": val,
                "signal": "large_activity",
            })
        elif val >= 1_000_000:  # 百万级
            score += 3
            big_moves.append({
                "chain": chain,
                "amount_usd": val,
                "signal": "medium_activity",
            })
    
    return {
        "score": max(-50, min(50, score)),
        "big_moves": big_moves[:5],
        "total_usd": round(total_usd, 0),
    }


# ============================================
# 5. 爆仓情绪
# ============================================
def get_liquidation_sentiment() -> dict:
    """
    爆仓数据反映市场极端情绪
    
    逻辑：
    - 大量多头爆仓 → 市场刚跌完，可能反弹(偏多)
    - 大量空头爆仓 → 市场刚涨完，可能回调(偏空)
    
    返回: {score: float, long_liq_usd: float, short_liq_usd: float}
    """
    liqs = _read_stream_latest("stream:binance:liquidation", count=30)
    
    long_liq_usd = 0
    short_liq_usd = 0
    big_events = []
    
    for l in liqs:
        try:
            val = float(l.get("value_usdt", l.get("notionalValue", 0)))
        except (ValueError, TypeError):
            val = 0
        
        side = l.get("side", "").upper()
        if side in ("BUY", "LONG"):
            long_liq_usd += val
        else:
            short_liq_usd += val
        
        if val >= 500_000:
            big_events.append({
                "symbol": l.get("symbol", "?"),
                "side": side,
                "value_usd": val,
            })
    
    total = long_liq_usd + short_liq_usd
    
    # 多头爆仓多 → 刚跌完，逆向看多；空头爆仓多 → 刚涨完，逆向看空
    if total > 0:
        ratio = (long_liq_usd - short_liq_usd) / total
        # 多头爆仓多 → ratio为正 → 看多(反弹)
        score = ratio * 40
    else:
        score = 0
    
    return {
        "score": max(-50, min(50, round(score, 1))),
        "long_liq_usd": round(long_liq_usd, 0),
        "short_liq_usd": round(short_liq_usd, 0),
        "big_events": big_events[:5],
    }


# ============================================
# 6. Open Interest 变化情绪 (新增 - 短线关键指标)
# ============================================
def get_open_interest_sentiment(symbol: str = None) -> dict:
    """
    Open Interest 变化 → 短线情绪信号
    
    逻辑：
    - OI急增+价格上涨 → 新多头涌入(偏多但过热风险)
    - OI急增+价格下跌 → 新空头涌入(偏空但过度风险)
    - OI急减+价格上涨 → 空头平仓反弹(偏多，空头认输)
    - OI急减+价格下跌 → 多头平仓下跌(偏空，多头认输)
    
    使用 Binance API 直接获取，无需Redis缓存
    返回: {score: float, oi_change_pct: float, signal: str}
    """
    import aiohttp
    import requests
    
    # 确定要查询的symbol
    if symbol:
        symbols = [symbol]
    else:
        # 默认看大盘币的综合OI信号
        symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    
    total_score = 0
    oi_details = []
    
    for sym in symbols:
        try:
            # 获取当前OI
            url = f"https://fapi.binance.com/fapi/v1/openInterest?symbol={sym}"
            resp = requests.get(url, timeout=5)
            if resp.status_code != 200:
                continue
            oi_data = resp.json()
            current_oi = float(oi_data.get("openInterest", 0))
            
            if current_oi <= 0:
                continue
            
            # 获取OI历史（每小时统计，最近24小时）
            url_hist = f"https://fapi.binance.com/futures/data/openInterestHist?symbol={sym}&period=1h&limit=24"
            resp2 = requests.get(url_hist, timeout=5)
            if resp2.status_code != 200:
                continue
            oi_hist = resp2.json()
            
            if not oi_hist or len(oi_hist) < 3:
                continue
            
            # 比较最近1小时 vs 24小时前的OI变化
            latest_oi = float(oi_hist[-1].get("sumOpenInterest", current_oi))
            old_oi = float(oi_hist[0].get("sumOpenInterest", current_oi))
            
            if old_oi > 0:
                oi_change_pct = (latest_oi - old_oi) / old_oi * 100
            else:
                oi_change_pct = 0
            
            # 最近几个周期的OI变化趋势
            recent_3 = oi_hist[-3:] if len(oi_hist) >= 3 else oi_hist[-1:]
            recent_oi_vals = [float(x.get("sumOpenInterest", 0)) for x in recent_3]
            if len(recent_oi_vals) >= 2 and recent_oi_vals[0] > 0:
                short_change = (recent_oi_vals[-1] - recent_oi_vals[0]) / recent_oi_vals[0] * 100
            else:
                short_change = 0
            
            # 评分逻辑
            score = 0
            sig = "NEUTRAL"
            
            # OI短期急增（>5% in 3h）→ 仓位过热信号
            if short_change > 10:
                score = -25  # 极度过热 → 看空
                sig = "OI_EXTREME_OVERHEAT"
            elif short_change > 5:
                score = -15  # 偏热
                sig = "OI_OVERHEAT"
            # OI短期急减（<-5% in 3h）→ 大量平仓，趋势可能反转
            elif short_change < -10:
                score = 20   # 大量平仓后往往反弹
                sig = "OI_MASS_UNWIND"
            elif short_change < -5:
                score = 10
                sig = "OI_DECREASING"
            # 24h OI变化辅助判断
            elif oi_change_pct > 15:
                score = -10  # 持续增仓过快
                sig = "OI_RAPID_BUILD"
            elif oi_change_pct < -15:
                score = 10   # 持续减仓，市场清洗
                sig = "OI_EXTENDED_DECLINE"
            
            total_score += score
            oi_details.append({
                "symbol": sym,
                "oi_change_24h": round(oi_change_pct, 2),
                "oi_change_3h": round(short_change, 2),
                "current_oi": current_oi,
                "signal": sig,
            })
            
        except Exception as e:
            logger.debug(f"OI获取失败 {sym}: {e}")
            continue
    
    # 取平均分
    avg_score = total_score / len(oi_details) if oi_details else 0
    
    return {
        "score": max(-50, min(50, round(avg_score, 1))),
        "oi_details": oi_details,
        "symbols_checked": len(oi_details),
    }


# ============================================
# 综合情绪评分（被 analyst_agent 调用）— v2 短线优化版
# ============================================
def collect_sentiment(symbol: str = None) -> dict:
    """
    综合所有舆情维度，生成最终情绪评分 — v2 短线优化版
    
    短线优先级排序（按时效性）：
    - 资金费率: 权重 0.25 (8h周期, 短线最有效)
    - 爆仓数据: 权重 0.20 (实时, 极端情绪即时反映)
    - Open Interest: 权重 0.15 (小时级, 仓位动量)
    - 新闻情绪: 权重 0.20 (小时级, 事件驱动)
    - 鲸鱼动向: 权重 0.10 (分钟~小时, 聪明钱)
    - 恐惧贪婪: 权重 0.10 (日线级, 仅极端值生效)
    
    返回: {
        composite_score: float(-100~+100),
        sentiment_label: str,
        details: {各维度数据},
        symbol_specific: bool,
    }
    """
    fg = get_fear_greed()
    news = get_news_sentiment(symbol)
    funding = get_funding_sentiment(symbol)
    whale = get_whale_sentiment()
    liq = get_liquidation_sentiment()
    oi = get_open_interest_sentiment(symbol)
    
    # 短线优化权重：资金费率+爆仓+OI占60%
    weights = {
        "fear_greed": 0.10,    # 长周期指标降权，仅极端生效
        "news": 0.20,          # 事件驱动
        "funding": 0.25,       # 短线核心
        "whale": 0.10,         # 辅助
        "liquidation": 0.20,   # 极端情绪
        "open_interest": 0.15, # 仓位动量
    }
    
    scores = {
        "fear_greed": fg["score"],
        "news": news["score"],
        "funding": funding["score"],
        "whale": whale["score"],
        "liquidation": liq["score"],
        "open_interest": oi["score"],
    }
    
    composite = sum(scores[k] * weights[k] for k in weights)
    composite = max(-100, min(100, round(composite, 1)))
    
    # 情绪标签
    if composite >= 40:
        label = "极度乐观"
    elif composite >= 20:
        label = "乐观"
    elif composite >= 10:
        label = "偏多"
    elif composite > -10:
        label = "中性"
    elif composite > -20:
        label = "偏空"
    elif composite > -40:
        label = "悲观"
    else:
        label = "极度悲观"
    
    # 生成理由（给交易信号用）
    reasons = []
    if abs(fg["score"]) >= 20:
        fg_dir = "看多(极端恐惧)" if fg["score"] > 0 else "看空(极端贪婪)"
        reasons.append(f"FG={fg['value']}({fg['signal']}) → {fg_dir}")
    if abs(news["score"]) >= 15:
        news_dir = "利多" if news["score"] > 0 else "利空"
        reasons.append(f"新闻{news['bullish_count']}多/{news['bearish_count']}空 → {news_dir}")
    if abs(funding["score"]) >= 15:
        reasons.append(f"资金费率异常{len(funding['anomalies'])}个(score={funding['score']})")
    if whale["big_moves"]:
        reasons.append(f"鲸鱼大额移动{len(whale['big_moves'])}笔 (${whale['total_usd']/1e6:.1f}M)")
    if liq["big_events"]:
        liq_dir = "多头爆仓多→可能反弹" if liq["long_liq_usd"] > liq["short_liq_usd"] else "空头爆仓多→可能回调"
        reasons.append(f"爆仓${(liq['long_liq_usd']+liq['short_liq_usd'])/1e6:.1f}M, {liq_dir}")
    if oi["oi_details"]:
        for d in oi["oi_details"]:
            if d["signal"] != "NEUTRAL":
                reasons.append(f"OI({d['symbol']}) 3h变化{d['oi_change_3h']:+.1f}% → {d['signal']}")
    
    return {
        "composite_score": composite,
        "sentiment_label": label,
        "scores": scores,
        "weights": weights,
        "reasons": reasons,
        "details": {
            "fear_greed": fg,
            "news": news,
            "funding": funding,
            "whale": whale,
            "liquidation": liq,
            "open_interest": oi,
        },
        "symbol": symbol,
    }


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    
    print("=== 整体市场情绪 ===")
    result = collect_sentiment()
    print(f"综合评分: {result['composite_score']} ({result['sentiment_label']})")
    for k, v in result["scores"].items():
        print(f"  {k}: {v}")
    print(f"理由: {result['reasons']}")
    
    print("\n=== BTCUSDT 情绪 ===")
    result_btc = collect_sentiment("BTCUSDT")
    print(f"综合评分: {result_btc['composite_score']} ({result_btc['sentiment_label']})")
    print(f"理由: {result_btc['reasons']}")
