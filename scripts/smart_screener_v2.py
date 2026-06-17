#!/usr/bin/env python3
"""
Smart Screener v2 — 修正版选币逻辑
核心改进：不再追高，改为找"即将爆发"的币

评分维度：
1. 流动性 — 必须有（基础分）
2. 趋势强度 — EMA排列判断方向
3. 位置 — 离支撑近=做多机会，离阻力近=做空机会
4. 蓄势 — 缩量整理后即将突破
5. 超跌 — 暴跌后的反弹机会
6. 均值回归 — RSI超买超卖

不再给"已经涨了"的币加分！
"""
import os, sys, json, asyncio, aiohttp, time, numpy as np
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


@dataclass
class CoinScoreV2:
    symbol: str
    volume_24h: float = 0
    price_change_24h: float = 0
    volatility_24h: float = 0
    funding_rate: float = 0
    
    # v2新指标
    trend: str = "neutral"          # up/down/neutral
    rsi_14: float = 50
    position_score: float = 0       # 位置评分（低买高卖）
    accumulation_score: float = 0   # 蓄势评分
    mean_reversion_score: float = 0 # 均值回归评分
    
    total_score: float = 0
    tier: str = "C"
    direction: str = "LONG"         # 推荐方向
    reason: str = ""


class SmartScreenerV2:
    BLACKLIST = {
        "BUSDUSDT", "USDCUSDT", "DAIUSDT", "TUSDUSDT", "FDUSDUSDT",
        "USDPUSDT", "EURTUSDT", "BTCSTUSDT", "BTCDOMUSDT", "DEFIUSDT",
        "XAGUSDT", "XAUUSDT",
    }
    
    def __init__(self):
        self._blacklist = set(self.BLACKLIST)
        self._load_history_blacklist()
    
    def _load_history_blacklist(self):
        try:
            with open(f"{DATA_DIR}/trade-log.jsonl") as f:
                stats = defaultdict(lambda: {"wins": 0, "losses": 0})
                for line in f:
                    try:
                        t = json.loads(line.strip())
                        if t.get("action") != "CLOSE": continue
                        sym = t.get("symbol", "")
                        pnl = t.get("dollar_pnl", 0)
                        if pnl >= 0: stats[sym]["wins"] += 1
                        else: stats[sym]["losses"] += 1
                    except:
                        pass
                for sym, s in stats.items():
                    if s["losses"] >= 3 and s["wins"] == 0:
                        self._blacklist.add(sym)
                    elif s["losses"] >= 5 and s["wins"] / max(s["losses"]+s["wins"], 1) < 0.2:
                        self._blacklist.add(sym)
        except: pass
    
    def calc_rsi(self, closes: List[float], period: int = 14) -> float:
        if len(closes) < period + 1: return 50
        deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
        gains = [d if d > 0 else 0 for d in deltas[-period:]]
        losses = [-d if d < 0 else 0 for d in deltas[-period:]]
        avg_gain = sum(gains) / period
        avg_loss = sum(losses) / period
        if avg_loss == 0: return 100
        rs = avg_gain / avg_loss
        return 100 - 100 / (1 + rs)
    
    def calc_ema(self, data: List[float], period: int) -> float:
        if len(data) < period: return data[-1] if data else 0
        k = 2 / (period + 1)
        ema = sum(data[:period]) / period
        for v in data[period:]:
            ema = v * k + ema * (1 - k)
        return ema
    
    async def screen(self, session: aiohttp.ClientSession, top_n: int = 100) -> List[CoinScoreV2]:
        """智能筛选v2"""
        # 拉取tickers
        tickers_data, funding_data, klines_batch = await asyncio.gather(
            self._fetch_tickers(session),
            self._fetch_funding(session),
            self._fetch_top_klines(session, top_n=50),
        )
        
        if not tickers_data:
            return []
        
        candidates = []
        for sym, data in tickers_data.items():
            if sym in self._blacklist: continue
            
            vol = float(data.get("quoteVolume", 0))
            if vol < 5_000_000: continue  # 流动性门槛
            
            change = float(data.get("priceChangePercent", 0))
            high = float(data.get("highPrice", 0))
            low = float(data.get("lowPrice", 0))
            close = float(data.get("lastPrice", 0))
            volatility = (high - low) / close * 100 if close > 0 else 0
            if volatility < 1.5: continue  # 太平没肉
            
            coin = CoinScoreV2(
                symbol=sym,
                volume_24h=vol,
                price_change_24h=change,
                volatility_24h=volatility,
                funding_rate=funding_data.get(sym, 0),
            )
            
            # v2: 用K线数据计算技术指标
            klines = klines_batch.get(sym, [])
            if len(klines) >= 50:
                closes = [float(k[4]) for k in klines]
                highs = [float(k[2]) for k in klines]
                lows = [float(k[3]) for k in klines]
                vols = [float(k[5]) for k in klines]
                
                # 趋势
                e20 = self.calc_ema(closes, 20)
                e50 = self.calc_ema(closes, 50)
                if e20 > e50 and closes[-1] > e20:
                    coin.trend = "strong_up"
                elif e20 > e50:
                    coin.trend = "up"
                elif e20 < e50 and closes[-1] < e20:
                    coin.trend = "strong_down"
                else:
                    coin.trend = "down"
                
                # RSI
                coin.rsi_14 = self.calc_rsi(closes, 14)
                
                # 位置评分（距最近支撑/阻力）
                range_30 = max(highs[-30:]) - min(lows[-30:])
                if range_30 > 0:
                    pos = (close - min(lows[-30:])) / range_30
                    coin.position_score = pos * 100  # 0=底部, 100=顶部
                
                # 蓄势评分（波动率收窄后）
                recent_vol = np.std([(closes[i]-closes[i-1])/closes[i-1] for i in range(-10, 0)])
                prior_vol = np.std([(closes[i]-closes[i-1])/closes[i-1] for i in range(-30, -10)])
                if prior_vol > 0:
                    vol_squeeze = recent_vol / prior_vol
                    coin.accumulation_score = (1 - vol_squeeze) * 100  # 越收窄分越高
            
            # 计算综合评分
            coin.total_score, coin.direction, coin.reason = self._calc_score_v2(coin)
            candidates.append(coin)
        
        candidates.sort(key=lambda x: -x.total_score)
        
        # 分级
        for i, c in enumerate(candidates):
            if i < 10: c.tier = "S"
            elif i < 30: c.tier = "A"
            elif i < top_n: c.tier = "B"
        
        return candidates[:top_n]
    
    def _calc_score_v2(self, coin: CoinScoreV2) -> tuple:
        """v2评分：找即将爆发的币"""
        score = 0
        direction = "LONG"
        reasons = []
        
        # 1. 流动性（0-10分）— 必须有
        if coin.volume_24h > 1e9: score += 10
        elif coin.volume_24h > 5e8: score += 8
        elif coin.volume_24h > 1e8: score += 5
        elif coin.volume_24h > 5e7: score += 3
        
        # 2. 波动率（0-10分）— 太小没肉
        if 3 < coin.volatility_24h < 15:
            score += 8  # 适中波动最好
        elif coin.volatility_24h >= 15:
            score += 10  # 高波动机会大
        elif coin.volatility_24h > 2:
            score += 3
        
        # 3. 趋势方向（-5~+15分）
        if coin.trend == "strong_up":
            score += 10
            direction = "LONG"
            reasons.append("强趋势↑")
        elif coin.trend == "up":
            score += 5
            direction = "LONG"
        elif coin.trend == "strong_down":
            score += 8  # 做空机会
            direction = "SHORT"
            reasons.append("强趋势↓")
        elif coin.trend == "down":
            score += 3
            direction = "SHORT"
        
        # 4. ⭐ 位置评分（核心改变！）
        # 底部附近做多 = 好位置
        # 顶部附近做空 = 好位置
        if direction == "LONG" and coin.position_score < 30:
            score += 15  # 在底部区域！低买
            reasons.append(f"低位({coin.position_score:.0f}%)")
        elif direction == "LONG" and coin.position_score < 50:
            score += 8
        elif direction == "LONG" and coin.position_score > 80:
            score -= 10  # 追高！惩罚
            reasons.append("⚠追高")
        elif direction == "SHORT" and coin.position_score > 70:
            score += 15  # 在顶部做空
            reasons.append(f"高位({coin.position_score:.0f}%)")
        elif direction == "SHORT" and coin.position_score > 50:
            score += 8
        
        # 5. ⭐ 均值回归（RSI）
        if coin.rsi_14 < 30:
            score += 15  # 超卖！反弹机会
            direction = "LONG"
            reasons.append(f"RSI超卖{coin.rsi_14:.0f}")
        elif coin.rsi_14 < 40:
            score += 8
            direction = "LONG"
        elif coin.rsi_14 > 70:
            score += 12  # 超买！做空机会
            direction = "SHORT"
            reasons.append(f"RSI超买{coin.rsi_14:.0f}")
        elif coin.rsi_14 > 60:
            score += 5
            direction = "SHORT"
        
        # 6. 蓄势评分（波动收窄=即将爆发）
        if coin.accumulation_score > 50:
            score += 10
            reasons.append("蓄势待发")
        
        # 7. 超跌反弹（24h暴跌后的反弹机会）
        if coin.price_change_24h < -10:
            score += 12  # 超跌反弹机会
            if direction == "LONG":
                reasons.append("超跌反弹")
        elif coin.price_change_24h < -5:
            score += 5
        
        # 8. ⭐ 关键改变：不再给"已经涨很多"的币加分
        # 反而给惩罚！
        if coin.price_change_24h > 15:
            score -= 5  # 涨太多了，别追
        elif coin.price_change_24h > 10:
            score -= 2
        
        # 9. 资金费率
        fr = coin.funding_rate
        if direction == "LONG" and fr < -0.0005:
            score += 5  # 做空人多，利于做多
        elif direction == "SHORT" and fr > 0.0005:
            score += 5  # 做多人多，利于做空
        
        reason = " | ".join(reasons) if reasons else "标准筛选"
        return max(0, score), direction, reason
    
    async def _fetch_tickers(self, session) -> Dict[str, dict]:
        try:
            url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
            return {d["symbol"]: d for d in data if d.get("symbol","").endswith("USDT")}
        except: return {}
    
    async def _fetch_funding(self, session) -> Dict[str, float]:
        try:
            url = "https://fapi.binance.com/fapi/v1/premiumIndex"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
            return {d["symbol"]: float(d.get("lastFundingRate", 0)) for d in data}
        except: return {}
    
    async def _fetch_top_klines(self, session, top_n=50) -> Dict[str, list]:
        """下载Top 50币的K线用于技术分析"""
        try:
            url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                tickers = await resp.json()
            
            by_vol = sorted(tickers, key=lambda x: -float(x.get("quoteVolume", 0)))
            symbols = [t["symbol"] for t in by_vol if t["symbol"].endswith("USDT")][:top_n]
            
            result = {}
            sem = asyncio.Semaphore(5)
            for sym in symbols:
                async with sem:
                    try:
                        url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=60"
                        async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                            raw = await resp.json()
                        if isinstance(raw, list) and len(raw) >= 50:
                            result[sym] = raw
                    except: pass
            return result
        except: return {}


async def run_screener_v2():
    """运行v2筛选"""
    async with aiohttp.ClientSession() as session:
        screener = SmartScreenerV2()
        coins = await screener.screen(session, top_n=50)
        
        # 输出
        print(f"\n{'排名':>4s} {'等级':>3s} {'方向':>5s} {'评分':>4s} {'币种':15s} {'24h':>7s} {'RSI':>5s} {'位置':>5s} {'原因'}")
        print("-" * 75)
        for i, c in enumerate(coins[:30], 1):
            print(f"{i:4d} {c.tier:>3s} {c.direction:>5s} {c.total_score:4.0f} {c.symbol:15s} "
                  f"{c.price_change_24h:+6.1f}% {c.rsi_14:5.1f} {c.position_score:5.0f}% {c.reason}")
        
        # 保存v2结果（含方向）
        output = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "v2",
            "S_tier": [{"symbol": c.symbol, "score": c.total_score, "direction": c.direction, "reason": c.reason} 
                       for c in coins if c.tier == "S"],
            "A_tier": [{"symbol": c.symbol, "score": c.total_score, "direction": c.direction, "reason": c.reason}
                       for c in coins if c.tier == "A"],
            "direction_map": {c.symbol: c.direction for c in coins if c.tier in ("S", "A")},
        }
        out_path = os.path.join(DATA_DIR, "screener_v2_results.json")
        with open(out_path, 'w') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        
        # 更新active_symbols.json（供momentum_agent使用）
        all_symbols = [c.symbol for c in coins if c.tier in ("S", "A", "B")]
        active_path = os.path.join(DATA_DIR, "active_symbols.json")
        active_data = {"symbols": all_symbols, "updated": str(int(time.time()*1000))}
        with open(active_path, 'w') as f:
            json.dump(active_data, f)
        
        # 保存方向映射（供策略使用）
        dir_map = {c.symbol: {"direction": c.direction, "score": c.total_score, "reason": c.reason}
                   for c in coins if c.tier in ("S", "A")}
        dir_path = os.path.join(DATA_DIR, "coin_directions.json")
        with open(dir_path, 'w') as f:
            json.dump(dir_map, f, indent=2, ensure_ascii=False)
        
        print(f"\n保存: {len(all_symbols)}个活跃币, {len(dir_map)}个方向信号")
        
        return coins


if __name__ == "__main__":
    asyncio.run(run_screener_v2())
