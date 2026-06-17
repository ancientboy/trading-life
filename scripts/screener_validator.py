#!/usr/bin/env python3
"""
选币逻辑回测验证器
验证选币评分和后实际收益的关系

核心指标：
- 选出的S级币后N天收益
- 不同评分区间的收益对比
- 方向（LONG/SHORT）准确率
"""
import os, sys, json, time, asyncio, aiohttp
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import List, Dict
sys.path.insert(0, os.path.dirname(__file__))


async def fetch_klines_batch(symbols: List[str], interval="4h", limit=540) -> dict:
    """批量下载K线"""
    data = {}
    async with aiohttp.ClientSession() as session:
        sem = asyncio.Semaphore(5)
        for sym in symbols:
            async with sem:
                try:
                    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval={interval}&limit={limit}"
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        raw = await resp.json()
                    if isinstance(raw, list) and len(raw) > 100:
                        data[sym] = {
                            'closes': [float(k[4]) for k in raw],
                            'highs': [float(k[2]) for k in raw],
                            'lows': [float(k[3]) for k in raw],
                            'vols': [float(k[5]) for k in raw],
                        }
                except: pass
    return data


def calc_ema(data, period):
    if len(data) < period: return data[-1]
    k = 2 / (period + 1)
    ema = sum(data[:period]) / period
    for v in data[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def calc_rsi(closes, period=14):
    if len(closes) < period + 1: return 50
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0 for d in deltas[-period:]]
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0: return 100
    return 100 - 100 / (1 + avg_gain / avg_loss)


def score_coin_v2(closes, highs, lows, vols, change_24h, volume_24h, funding) -> dict:
    """v2选币评分（纯函数，可回测）"""
    n = len(closes)
    if n < 50: return None
    
    score = 0
    direction = "LONG"
    reasons = []
    
    # 流动性
    if volume_24h > 1e9: score += 10
    elif volume_24h > 5e8: score += 8
    elif volume_24h > 1e8: score += 5
    
    # 波动率
    volatility = (max(highs[-6:]) - min(lows[-6:])) / closes[-1] * 100
    if 3 < volatility < 15: score += 8
    elif volatility >= 15: score += 10
    
    # 趋势
    e20 = calc_ema(closes, 20)
    e50 = calc_ema(closes, 50)
    if e20 > e50 and closes[-1] > e20:
        trend = "strong_up"; score += 10; direction = "LONG"
    elif e20 > e50:
        trend = "up"; score += 5; direction = "LONG"
    elif e20 < e50 and closes[-1] < e20:
        trend = "strong_down"; score += 8; direction = "SHORT"
    else:
        trend = "down"; score += 3; direction = "SHORT"
    
    # RSI
    rsi = calc_rsi(closes, 14)
    if rsi < 30:
        score += 15; direction = "LONG"; reasons.append(f"RSI超卖{rsi:.0f}")
    elif rsi < 40:
        score += 8; direction = "LONG"
    elif rsi > 70:
        score += 12; direction = "SHORT"; reasons.append(f"RSI超买{rsi:.0f}")
    elif rsi > 60:
        score += 5; direction = "SHORT"
    
    # 位置
    range_30 = max(highs[-30:]) - min(lows[-30:])
    if range_30 > 0:
        pos = (closes[-1] - min(lows[-30:])) / range_30 * 100
    else:
        pos = 50
    
    if direction == "LONG" and pos < 30:
        score += 15; reasons.append(f"低位{pos:.0f}%")
    elif direction == "LONG" and pos > 80:
        score -= 10; reasons.append("追高")
    elif direction == "SHORT" and pos > 70:
        score += 15; reasons.append(f"高位{pos:.0f}%")
    
    # 蓄势
    recent_vol = np.std([(closes[i]-closes[i-1])/closes[i-1] for i in range(-10, 0)])
    prior_vol = np.std([(closes[i]-closes[i-1])/closes[i-1] for i in range(-30, -10)])
    if prior_vol > 0:
        squeeze = recent_vol / prior_vol
        if squeeze < 0.5:
            score += 10; reasons.append("蓄势")
    
    # 超跌
    if change_24h < -10:
        score += 12; reasons.append("超跌")
    elif change_24h < -5:
        score += 5
    
    # 追高惩罚
    if change_24h > 15: score -= 5
    elif change_24h > 10: score -= 2
    
    return {"score": max(0, score), "direction": direction, "rsi": rsi, "position": pos, "reasons": reasons}


def backtest_screener_v2(
    all_data: dict,
    forward_bars: int = 18,  # 3天
    rebalance_bars: int = 6,  # 每天
    top_n: int = 10,
) -> dict:
    """回测v2选币逻辑"""
    
    results = []  # {score, direction, actual_return}
    
    # 找最短长度
    min_len = min(len(d['closes']) for d in all_data.values())
    
    # 获取tickers数据近似（用K线计算24h change和volume）
    for t in range(50, min_len - forward_bars, rebalance_bars):
        scored = []
        for sym, d in all_data.items():
            closes = d['closes']
            highs = d['highs']
            lows = d['lows']
            vols = d['vols']
            
            # 24h涨跌
            change_24h = (closes[t] - closes[t-6]) / closes[t-6] * 100 if t >= 6 else 0
            volume_24h = sum(vols[t-6:t]) * closes[t] if t >= 6 else 0
            
            # 评分
            result = score_coin_v2(
                closes[:t+1], highs[:t+1], lows[:t+1], vols[:t+1],
                change_24h, volume_24h, 0
            )
            if result:
                # 计算前向收益（按推荐方向）
                fwd_raw = (closes[t+forward_bars] - closes[t]) / closes[t] * 100
                if result["direction"] == "SHORT":
                    fwd = -fwd_raw  # 做空收益
                else:
                    fwd = fwd_raw
                
                scored.append({
                    "sym": sym, "score": result["score"], 
                    "direction": result["direction"],
                    "fwd_return": fwd,
                    "fwd_raw": fwd_raw,
                    "reasons": result["reasons"],
                    "rsi": result["rsi"],
                    "position": result["position"],
                })
        
        # 取Top N
        scored.sort(key=lambda x: -x["score"])
        for s in scored[:top_n]:
            results.append(s)
    
    if not results:
        return {"error": "no results"}
    
    # 分析
    returns = np.array([r["fwd_return"] for r in results])
    scores = np.array([r["score"] for r in results])
    
    # 按评分分层
    tiers = {
        "S(60+)": [r for r in results if r["score"] >= 60],
        "A(45-60)": [r for r in results if 45 <= r["score"] < 60],
        "B(30-45)": [r for r in results if 30 <= r["score"] < 45],
        "C(<30)": [r for r in results if r["score"] < 30],
    }
    
    # 按方向分层
    longs = [r for r in results if r["direction"] == "LONG"]
    shorts = [r for r in results if r["direction"] == "SHORT"]
    
    summary = {
        "total_picks": len(results),
        "avg_return": round(np.mean(returns), 3),
        "median_return": round(np.median(returns), 3),
        "hit_rate": round(np.mean(returns > 0) * 100, 1),
        "avg_score": round(np.mean(scores), 1),
        
        "by_tier": {},
        "by_direction": {
            "LONG": {"count": len(longs), "avg_return": round(np.mean([r["fwd_return"] for r in longs]), 3) if longs else 0,
                     "hit_rate": round(np.mean([r["fwd_return"] > 0 for r in longs]) * 100, 1) if longs else 0},
            "SHORT": {"count": len(shorts), "avg_return": round(np.mean([r["fwd_return"] for r in shorts]), 3) if shorts else 0,
                      "hit_rate": round(np.mean([r["fwd_return"] > 0 for r in shorts]) * 100, 1) if shorts else 0},
        },
        
        # 高分币是否真的更好？
        "score_correlation": round(np.corrcoef(scores, returns)[0, 1], 3),
    }
    
    for tier_name, tier_results in tiers.items():
        if tier_results:
            tr = np.array([r["fwd_return"] for r in tier_results])
            summary["by_tier"][tier_name] = {
                "count": len(tier_results),
                "avg_return": round(np.mean(tr), 3),
                "hit_rate": round(np.mean(tr > 0) * 100, 1),
            }
    
    # 对比v1（纯追高）
    v1_results = []
    for t in range(50, min_len - forward_bars, rebalance_bars):
        for sym, d in all_data.items():
            closes = d['closes']
            ch = (closes[t] - closes[t-6]) / closes[t-6] * 100 if t >= 6 else 0
            if ch > 5:  # v1逻辑：追涨
                fwd = (closes[t+forward_bars] - closes[t]) / closes[t] * 100
                v1_results.append(fwd)
    
    if v1_results:
        summary["v1_chase_high"] = {
            "avg_return": round(np.mean(v1_results), 3),
            "hit_rate": round(np.mean([r > 0 for r in v1_results]) * 100, 1),
            "count": len(v1_results),
        }
    
    return summary


async def run_validation():
    """运行选币验证"""
    print("🔍 选币逻辑v2回测验证")
    
    # 获取Top50币
    async with aiohttp.ClientSession() as session:
        url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            tickers = await resp.json()
        symbols = sorted(tickers, key=lambda x: -float(x.get("quoteVolume", 0)))
        symbols = [t["symbol"] for t in symbols if t["symbol"].endswith("USDT")][:50]
    
    print(f"  币种: {len(symbols)}个")
    
    # 下载K线
    print(f"  下载数据...")
    data = await fetch_klines_batch(symbols, "4h", 540)
    print(f"  获取: {len(data)}个")
    
    # 回测
    result = backtest_screener_v2(data, forward_bars=18, top_n=10)
    
    # 输出
    print(f"\n{'='*50}")
    print(f"📊 v2选币回测结果")
    print(f"{'='*50}")
    print(f"总选币次数: {result.get('total_picks', 0)}")
    print(f"平均收益: {result.get('avg_return', 0):+.2f}%")
    print(f"中位收益: {result.get('median_return', 0):+.2f}%")
    print(f"命中率: {result.get('hit_rate', 0):.1f}%")
    print(f"评分-收益相关性: {result.get('score_correlation', 0):.3f}")
    
    print(f"\n按等级:")
    for tier, stats in result.get("by_tier", {}).items():
        print(f"  {tier:10s}: {stats['count']:4d}次 均{stats['avg_return']:+.2f}% 命中{stats['hit_rate']:.0f}%")
    
    print(f"\n按方向:")
    for d, stats in result.get("by_direction", {}).items():
        print(f"  {d:6s}: {stats['count']:4d}次 均{stats['avg_return']:+.2f}% 命中{stats['hit_rate']:.0f}%")
    
    if "v1_chase_high" in result:
        v1 = result["v1_chase_high"]
        print(f"\nv1追高对比: 均{v1['avg_return']:+.2f}% 命中{v1['hit_rate']:.0f}%")
    
    # 保存
    out = f"/opt/trading-agent/scripts/data/evolve/screener_validation_{int(time.time())}.json"
    with open(out, 'w') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"\n保存: {out}")
    
    return result


if __name__ == "__main__":
    asyncio.run(run_validation())
