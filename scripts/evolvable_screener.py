#!/usr/bin/env python3
"""
可进化选币器 v3
评分权重可进化，基于回测数据验证

最优策略组合（数据验证）：
1. 低位+放量: +3.51%, 命中65.4%
2. 波动大+低位: +3.73%, 命中49.4%
3. 暴跌反弹: +4.92%, 命中47.8%
4. MACD负+低位: +2.13%, 命中53.9%

核心因子权重：
- position(位置) 最重要 → 低位做多
- vol_ratio(放量) 第二 → 确认信号
- volatility(波动) 第三 → 波动大=机会
- RSI 权重降低（相关性差）
- 追高 惩罚加重
"""
import os, sys, json, asyncio, aiohttp, time
import numpy as np
from datetime import datetime, timezone
from typing import Dict, List
from collections import defaultdict
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(__file__))
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


# 可进化的权重参数
DEFAULT_WEIGHTS = {
    # 核心因子（数据验证有效的）
    "position_low_bonus": 18,      # 低位(0-30%)加分 ← 最强(命中率65.4%)
    "position_high_penalty": -12,   # 高位(>70%)惩罚
    "vol_ratio_bonus": 12,          # 放量(>1.5x)加分
    "volatility_bonus": 10,         # 高波动(>8%)加分
    "oversold_bonus": 10,           # 暴跌(<-10%)加分
    "squeeze_bonus": 8,             # 蓄势(波动收窄)加分
    "macd_negative_bonus": 6,       # MACD负值（超跌）加分
    
    # 次要因子
    "rsi_oversold_bonus": 5,        # RSI<30（权重降低）
    "rsi_overbought_bonus": 5,      # RSI>70（做空信号）
    "ema_trend_bonus": 5,           # EMA趋势方向
    "bb_lower_bonus": 5,            # 布林下轨附近
    
    # 流动性（基础）
    "volume_base": 8,               # 流动性基础分
    
    # 惩罚
    "chase_high_penalty": -8,       # 追高(>15%)惩罚
    "low_vol_penalty": -5,          # 低波动(<2%)惩罚
}

# 进化空间
WEIGHT_SPACE = {
    "position_low_bonus": [10, 12, 15, 18, 20, 25],
    "position_high_penalty": [-5, -8, -10, -12, -15],
    "vol_ratio_bonus": [5, 8, 10, 12, 15],
    "volatility_bonus": [5, 8, 10, 12, 15],
    "oversold_bonus": [5, 8, 10, 12, 15],
    "squeeze_bonus": [3, 5, 8, 10, 12],
    "macd_negative_bonus": [3, 5, 8, 10],
    "rsi_oversold_bonus": [0, 3, 5, 8, 10],
    "ema_trend_bonus": [0, 3, 5, 8],
    "chase_high_penalty": [-3, -5, -8, -10, -12],
}


def calc_ema(data, period):
    if len(data) < period: return data[-1] if data else 0
    k = 2 / (period + 1)
    ema = sum(data[:period]) / period
    for v in data[period:]: ema = v * k + ema * (1 - k)
    return ema


def calc_rsi(closes, period=14):
    if len(closes) < period + 1: return 50
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0 for d in deltas[-period:]]
    ag = sum(gains) / period
    al = sum(losses) / period
    if al == 0: return 100
    return 100 - 100 / (1 + ag / al)


def score_coin_evolved(
    closes, highs, lows, vols,
    volume_24h: float, change_24h: float, funding: float,
    weights: dict,
) -> dict:
    """可进化评分"""
    n = len(closes)
    if n < 50: return None
    
    score = 20  # 基础分降低（让因子权重更重要）
    direction = "LONG"
    reasons = []
    
    # === 核心因子 ===
    
    # 1. 位置（最强因子）
    range_30 = max(highs[-30:]) - min(lows[-30:])
    pos = (closes[-1] - min(lows[-30:])) / max(range_30, 0.01) * 100
    
    if pos < 30:
        score += weights["position_low_bonus"]
        direction = "LONG"
        reasons.append(f"低位{pos:.0f}%")
    elif pos > 70:
        score += weights["position_high_penalty"]
        direction = "SHORT"
        reasons.append(f"高位{pos:.0f}%")
    elif pos < 50:
        score += weights["position_low_bonus"] * 0.3
    
    # 2. 放量
    avg_vol = np.mean(vols[-20:])
    vol_ratio = vols[-1] / avg_vol if avg_vol > 0 else 1
    if vol_ratio > 1.5:
        score += weights["vol_ratio_bonus"]
        reasons.append(f"放量{vol_ratio:.1f}x")
    elif vol_ratio > 1.2:
        score += weights["vol_ratio_bonus"] * 0.3
    
    # 3. 波动率
    volatility = (max(highs[-6:]) - min(lows[-6:])) / closes[-1] * 100
    if volatility > 8:
        score += weights["volatility_bonus"]
        reasons.append(f"高波动{volatility:.0f}%")
    elif volatility > 5:
        score += weights["volatility_bonus"] * 0.5
    elif volatility < 2:
        score += weights["low_vol_penalty"]
    
    # 4. 超跌反弹
    if change_24h < -10:
        score += weights["oversold_bonus"]
        direction = "LONG"
        reasons.append("暴跌反弹")
    elif change_24h < -5:
        score += weights["oversold_bonus"] * 0.5
        direction = "LONG"
    
    # 5. 蓄势
    recent_std = np.std([(closes[i]-closes[i-1])/closes[i-1] for i in range(-10, 0)])
    prior_std = np.std([(closes[i]-closes[i-1])/closes[i-1] for i in range(-30, -10)])
    squeeze = recent_std / prior_std if prior_std > 0 else 1
    if squeeze < 0.6:
        score += weights["squeeze_bonus"]
        reasons.append("蓄势")
    
    # 6. MACD
    e12 = calc_ema(closes, 12)
    e26 = calc_ema(closes, 26)
    macd = (e12 - e26) / closes[-1] * 100
    if macd < -1 and direction == "LONG":
        score += weights["macd_negative_bonus"]
        reasons.append("MACD超跌")
    
    # === 次要因子 ===
    
    # 7. RSI（降低权重）
    rsi = calc_rsi(closes, 14)
    if rsi < 30:
        score += weights["rsi_oversold_bonus"]
        direction = "LONG"
    elif rsi > 70:
        score += weights["rsi_overbought_bonus"]
        direction = "SHORT"
    
    # 8. EMA趋势
    e20 = calc_ema(closes, 20)
    e50 = calc_ema(closes, 50)
    if direction == "LONG" and e20 > e50:
        score += weights["ema_trend_bonus"]
    elif direction == "SHORT" and e20 < e50:
        score += weights["ema_trend_bonus"]
    
    # 9. 布林带
    sma20 = np.mean(closes[-20:])
    std20 = np.std(closes[-20:])
    bb_pos = (closes[-1] - (sma20 - 2*std20)) / (4*std20) * 100 if std20 > 0 else 50
    if bb_pos < 20 and direction == "LONG":
        score += weights["bb_lower_bonus"]
    
    # === 基础 ===
    
    # 10. 流动性
    if volume_24h > 1e9: score += weights["volume_base"]
    elif volume_24h > 5e8: score += weights["volume_base"] * 0.8
    elif volume_24h > 1e8: score += weights["volume_base"] * 0.5
    
    # 11. 追高惩罚
    if change_24h > 15:
        score += weights["chase_high_penalty"]
    elif change_24h > 10:
        score += weights["chase_high_penalty"] * 0.5
    
    reason = " | ".join(reasons) if reasons else "标准"
    return {"score": max(0, score), "direction": direction, "rsi": rsi, 
            "position": pos, "reasons": reason, "vol_ratio": vol_ratio}


async def evolve_screener_weights(days=90, top_n=50, generations=10):
    """进化选币权重"""
    from screener_validator import fetch_klines_batch
    
    print("🧬 选币权重进化")
    
    # 下载数据
    async with aiohttp.ClientSession() as session:
        url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            tickers = await resp.json()
        symbols = sorted(tickers, key=lambda x: -float(x.get("quoteVolume", 0)))
        symbols = [t["symbol"] for t in symbols if t["symbol"].endswith("USDT")][:top_n]
    
    data = await fetch_klines_batch(symbols, "4h", days*6)
    print(f"  币种: {len(data)}个")
    
    # 评估函数
    def evaluate(weights):
        min_len = min(len(d['closes']) for d in data.values())
        results = []
        for t in range(50, min_len - 18, 6):
            scored = []
            for sym, d in data.items():
                closes = d['closes'][:t+1]
                highs = d['highs'][:t+1]
                lows = d['lows'][:t+1]
                vols = d['vols'][:t+1]
                
                ch24h = (closes[-1] - closes[-7]) / closes[-7] * 100 if len(closes) > 7 else 0
                vol24h = sum(vols[-6:]) * closes[-1]
                
                r = score_coin_evolved(closes, highs, lows, vols, vol24h, ch24h, 0, weights)
                if r and r["score"] >= 40:
                    fwd_raw = (d['closes'][min(t+18, len(d['closes'])-1)] - closes[-1]) / closes[-1] * 100
                    fwd = -fwd_raw if r["direction"] == "SHORT" else fwd_raw
                    scored.append(fwd)
            
            scored.sort(reverse=True)
            results.extend(scored[:10])
        
        if not results: return -999, 0, 0
        avg = np.mean(results)
        hit = np.mean([r > 0 for r in results]) * 100
        score = avg * (hit / 50) * min(1 + len(results) / 200, 2)
        return score, avg, hit
    
    # GA进化
    best_weights = DEFAULT_WEIGHTS.copy()
    best_score, best_avg, best_hit = evaluate(best_weights)
    print(f"  基线: Score={best_score:.1f} Avg={best_avg:+.2f}% Hit={best_hit:.0f}%")
    
    np.random.seed(42)
    for gen in range(generations):
        # 变异
        mutant = best_weights.copy()
        for key in WEIGHT_SPACE:
            if np.random.random() < 0.5:
                mutant[key] = np.random.choice(WEIGHT_SPACE[key])
        
        score, avg, hit = evaluate(mutant)
        if score > best_score:
            best_score = score
            best_avg = avg
            best_hit = hit
            best_weights = mutant.copy()
            print(f"  Gen{gen+1}: ✅ Score={score:.1f} Avg={avg:+.2f}% Hit={hit:.0f}%")
    
    print(f"\n🏆 最优权重:")
    for k, v in best_weights.items():
        default = DEFAULT_WEIGHTS.get(k, 0)
        changed = " ←" if v != default else ""
        print(f"  {k}: {v}{changed}")
    print(f"\n  Score={best_score:.1f} Avg={best_avg:+.2f}% Hit={best_hit:.0f}%")
    
    # 保存
    out = os.path.join(DATA_DIR, "evolve", "screener_weights.json")
    with open(out, 'w') as f:
        json.dump({"weights": best_weights, "score": best_score, 
                   "avg_return": best_avg, "hit_rate": best_hit,
                   "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S')}, f, indent=2)
    
    return best_weights


if __name__ == "__main__":
    asyncio.run(evolve_screener_weights())


async def run_screener_v3():
    """运行v3选币（进化权重版）"""
    from screener_validator import fetch_klines_batch
    
    # 加载进化权重
    weights_file = os.path.join(DATA_DIR, "evolve", "screener_weights.json")
    try:
        weights = json.load(open(weights_file))["weights"]
    except:
        weights = DEFAULT_WEIGHTS
    
    async with aiohttp.ClientSession() as session:
        # 获取tickers
        url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            tickers = await resp.json()
        
        ticker_map = {t["symbol"]: t for t in tickers if t["symbol"].endswith("USDT")}
        by_vol = sorted(ticker_map.values(), key=lambda x: -float(x.get("quoteVolume", 0)))
        symbols = [t["symbol"] for t in by_vol if t["symbol"] not in BLACKLIST][:80]
        
        # 下载K线
        klines = await fetch_klines_batch(symbols, "4h", 180)
        
        # 评分
        results = []
        for sym in symbols:
            if sym not in klines: continue
            d = klines[sym]
            t = ticker_map.get(sym, {})
            
            ch24h = float(t.get("priceChangePercent", 0))
            vol24h = float(t.get("quoteVolume", 0))
            funding = 0  # TODO: fetch
            
            r = score_coin_evolved(
                d['closes'], d['highs'], d['lows'], d['vols'],
                vol24h, ch24h, funding, weights
            )
            if r:
                r["symbol"] = sym
                r["vol_24h"] = vol24h
                r["change_24h"] = ch24h
                results.append(r)
        
        results.sort(key=lambda x: -x["score"])
        
        # 分级
        for i, r in enumerate(results):
            if i < 10: r["tier"] = "S"
            elif i < 30: r["tier"] = "A"
            else: r["tier"] = "B"
        
        # 输出
        print(f"\n{'#':>3s} {'级':>2s} {'方向':>5s} {'分':>3s} {'币种':15s} {'24h':>7s} {'RSI':>5s} {'位置':>5s} {'原因'}")
        print("-" * 70)
        for i, r in enumerate(results[:30], 1):
            print(f"{i:3d} {r.get('tier','C'):>2s} {r['direction']:>5s} {r['score']:3.0f} {r['symbol']:15s} "
                  f"{r['change_24h']:+6.1f}% {r['rsi']:5.1f} {r['position']:5.0f}% {r['reasons']}")
        
        # 保存
        s_tier = [{"symbol": r["symbol"], "score": r["score"], "direction": r["direction"], "reason": r["reasons"]}
                  for r in results if r.get("tier") == "S"]
        a_tier = [{"symbol": r["symbol"], "score": r["score"], "direction": r["direction"], "reason": r["reasons"]}
                  for r in results if r.get("tier") == "A"]
        
        output = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "v3",
            "weights_source": "evolved",
            "S_tier": s_tier,
            "A_tier": a_tier,
            "direction_map": {r["symbol"]: r["direction"] for r in results if r.get("tier") in ("S", "A")},
        }
        with open(os.path.join(DATA_DIR, "screener_v2_results.json"), 'w') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        
        # 更新active_symbols
        all_syms = [r["symbol"] for r in results if r.get("tier") in ("S", "A", "B")]
        with open(os.path.join(DATA_DIR, "active_symbols.json"), 'w') as f:
            json.dump({"symbols": all_syms, "updated": str(int(time.time()*1000))}, f)
        
        # 方向映射
        dir_map = {r["symbol"]: {"direction": r["direction"], "score": r["score"], "reason": r["reasons"]}
                   for r in results if r.get("tier") in ("S", "A")}
        with open(os.path.join(DATA_DIR, "coin_directions.json"), 'w') as f:
            json.dump(dir_map, f, indent=2, ensure_ascii=False)
        
        print(f"\n✅ S级{len(s_tier)} A级{len(a_tier)} 共{len(all_syms)}币")
        return results


# 黑名单
BLACKLIST = {
    "BUSDUSDT", "USDCUSDT", "DAIUSDT", "TUSDUSDT", "FDVDUSDT",
    "USDPUSDT", "EURTUSDT", "BTCSTUSDT", "BTCDOMUSDT", "DEFIUSDT",
    "XAGUSDT", "XAUUSDT",
}


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--evolve", action="store_true", help="进化权重")
    p.add_argument("--run", action="store_true", help="运行选币")
    args = p.parse_args()
    
    if args.evolve:
        asyncio.run(evolve_screener_weights())
    elif args.run:
        asyncio.run(run_screener_v3())
