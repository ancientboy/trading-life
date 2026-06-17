#!/usr/bin/env python3
"""
智能币种筛选器 v1.0

多层筛选漏斗：
1. 基础层：USDT永续 + TRADING + 流动性>$5M
2. 波动层：24h振幅>2%（太平没肉吃）
3. 历史表现层：盈利币加分，亏损币降权
4. 微观结构层：资金费率/OI/多空比
5. 黑名单：稳定币 + 历史连亏币

输出：Top N 高质量交易候选币种
"""

import json
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict
from dataclasses import dataclass, field

import aiohttp

logger = logging.getLogger("SmartScreener")

BASE_DIR = '/opt/trading-agent/scripts'
DATA_DIR = "/opt/trading-agent/data"


@dataclass
class CoinScore:
    """币种评分"""
    symbol: str
    volume_24h: float = 0          # 24h成交额
    price_change_24h: float = 0    # 24h涨跌幅
    volatility_24h: float = 0      # 24h波动率
    funding_rate: float = 0        # 资金费率
    oi_change: float = 0           # OI变化
    ls_ratio: float = 1.0          # 多空比
    history_pnl: float = 0         # 历史盈亏
    history_trades: int = 0        # 历史交易次数
    history_wr: float = 0          # 历史胜率
    total_score: float = 0         # 综合评分
    tier: str = "C"                # S/A/B/C


class SmartScreener:
    """智能币种筛选器"""

    # 稳定币/非交易币黑名单
    BLACKLIST = {
        "BUSDUSDT", "USDCUSDT", "DAIUSDT", "TUSDUSDT", "FDUSDUSDT",
        "USDPUSDT", "EURTUSDT", "BTCSTUSDT", "BTCDOMUSDT", "DEFIUSDT",
        "XAGUSDT", "XAUUSDT",   # 贵金属合约（不是加密货币）
    }

    # 筛选阈值
    MIN_VOLUME_USD = 5_000_000     # 最低24h成交额 $5M
    MIN_VOLATILITY = 2.0           # 最低24h波动率 2%
    MAX_COINS = 150                # 最多保留150个币

    # 历史表现权重
    HISTORY_WEIGHTS = {
        "profitable": 15,          # 历史盈利币加分
        "losing": -20,             # 历史亏损币降权
        "never_traded": 5,         # 新币中性偏正
        "hot_streak": 10,          # 近期连胜
        "cold_streak": -15,        # 近期连亏
    }

    def __init__(self):
        self._history_stats = self._load_history()
        self._blacklist_coins: Set[str] = set()
        self._build_blacklist()

    def _load_history(self) -> Dict[str, Dict]:
        """加载历史交易统计"""
        stats = defaultdict(lambda: {"pnl": 0, "trades": 0, "wins": 0,
                                      "recent_pnl": 0, "recent_trades": 0})
        try:
            with open(f"{DATA_DIR}/trade-log.jsonl") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        t = json.loads(line)
                        if t.get("action") != "CLOSE":
                            continue
                        sym = t.get("symbol", "")
                        pnl = t.get("dollar_pnl", 0)
                        stats[sym]["pnl"] += pnl
                        stats[sym]["trades"] += 1
                        if pnl > 0:
                            stats[sym]["wins"] += 1

                        # 近期交易（最近7天）
                        ts = t.get("timestamp", "")
                        if ts > (datetime.now(timezone.utc).isoformat()[:10]):
                            stats[sym]["recent_pnl"] += pnl
                            stats[sym]["recent_trades"] += 1
                    except:
                        pass
        except:
            pass
        return dict(stats)

    def _build_blacklist(self):
        """构建动态黑名单"""
        self._blacklist_coins = set(self.BLACKLIST)

        # 历史连亏3次+的币加入黑名单
        for sym, stats in self._history_stats.items():
            if stats["trades"] >= 3 and stats["wins"] == 0:
                self._blacklist_coins.add(sym)
                logger.debug(f"黑名单（全亏）: {sym} ({stats['trades']}笔全亏)")
            elif stats["trades"] >= 5 and stats["wins"] / stats["trades"] < 0.2:
                self._blacklist_coins.add(sym)
                logger.debug(f"黑名单（极低胜率）: {sym} WR{stats['wins']/stats['trades']*100:.0f}%")

    async def screen(self, session: aiohttp.ClientSession,
                     top_n: int = 100) -> List[CoinScore]:
        """执行智能筛选，返回Top N币种"""
        logger.info(f"🔍 开始智能筛选...")

        # Step 1: 拉取全量数据
        tickers, funding_data = await asyncio.gather(
            self._fetch_tickers(session),
            self._fetch_funding(session),
        )

        if not tickers:
            logger.error("拉取tickers失败")
            return []

        # Step 2: 基础过滤
        candidates = []
        for sym, data in tickers.items():
            # 黑名单
            if sym in self._blacklist_coins:
                continue

            vol = float(data.get("quoteVolume", 0))
            change = data.get("priceChangePercent", 0)

            # 流动性过滤
            if vol < self.MIN_VOLUME_USD:
                continue

            # 计算波动率
            high = float(data.get("highPrice", 0))
            low = float(data.get("lowPrice", 0))
            close = float(data.get("lastPrice", 0))
            if close > 0 and high > 0:
                volatility = (high - low) / close * 100
            else:
                volatility = 0

            # 波动率过滤（太平的币没肉吃）
            if volatility < self.MIN_VOLATILITY:
                continue

            score = CoinScore(
                symbol=sym,
                volume_24h=vol,
                price_change_24h=float(change),
                volatility_24h=volatility,
            )

            # 资金费率
            if sym in funding_data:
                score.funding_rate = funding_data[sym]

            # 历史表现
            hist = self._history_stats.get(sym, {})
            score.history_pnl = hist.get("pnl", 0)
            score.history_trades = hist.get("trades", 0)
            if score.history_trades > 0:
                score.history_wr = hist["wins"] / score.history_trades * 100

            candidates.append(score)

        logger.info(f"  基础过滤: {len(candidates)}个候选 "
                    f"(黑名单{len(self._blacklist_coins)}个)")

        # Step 3: 评分排序
        for c in candidates:
            c.total_score = self._calc_score(c)

        candidates.sort(key=lambda x: -x.total_score)

        # Step 4: 分级
        for i, c in enumerate(candidates):
            if i < 10:
                c.tier = "S"  # Top 10 超级优先
            elif i < 30:
                c.tier = "A"  # Top 30 高优先
            elif i < top_n:
                c.tier = "B"  # Top 100 正常
            else:
                c.tier = "C"  # 不交易

        # 截取Top N
        result = candidates[:top_n]

        # 统计
        tiers = defaultdict(int)
        for c in result:
            tiers[c.tier] += 1
        logger.info(f"  筛选结果: {dict(tiers)}")
        logger.info(f"  S级币: {[c.symbol for c in result if c.tier == 'S'][:10]}")

        return result

    def _calc_score(self, coin: CoinScore) -> float:
        """计算综合评分"""
        score = 50  # 基础分

        # 1. 流动性（0-15分）
        if coin.volume_24h > 1_000_000_000:
            score += 15  # >$1B
        elif coin.volume_24h > 500_000_000:
            score += 12  # >$500M
        elif coin.volume_24h > 100_000_000:
            score += 8   # >$100M
        elif coin.volume_24h > 50_000_000:
            score += 5   # >$50M
        else:
            score += 2   # >$5M

        # 2. 波动率（0-20分）— 高波动=高机会
        if coin.volatility_24h > 15:
            score += 20  # 超高波动
        elif coin.volatility_24h > 8:
            score += 15  # 高波动
        elif coin.volatility_24h > 5:
            score += 10  # 中高
        elif coin.volatility_24h > 3:
            score += 5   # 中等
        else:
            score += 2   # 低波动

        # 3. 动量（0-15分）— 涨幅正=有趋势
        if coin.price_change_24h > 10:
            score += 15
        elif coin.price_change_24h > 5:
            score += 10
        elif coin.price_change_24h > 2:
            score += 5
        elif coin.price_change_24h > -2:
            score += 0   # 横盘
        elif coin.price_change_24h > -5:
            score += 3   # 小跌（做空机会）
        elif coin.price_change_24h > -10:
            score += 8   # 大跌（超跌反弹机会）
        else:
            score += 12  # 暴跌（极超跌机会）

        # 4. 资金费率（0-10分）
        fr = coin.funding_rate
        if abs(fr) > 0.001:
            score += 10  # 极端费率=大机会
        elif abs(fr) > 0.0005:
            score += 7   # 偏高
        elif abs(fr) > 0.0001:
            score += 3   # 正常
        else:
            score += 1   # 中性

        # 5. 历史表现（-20 ~ +15分）
        if coin.history_trades > 0:
            if coin.history_pnl > 1000:
                score += 15  # 历史大赚
            elif coin.history_pnl > 0:
                score += 8   # 历史小赚
            elif coin.history_pnl > -500:
                score -= 5   # 历史小亏
            else:
                score -= 20  # 历史大亏

            # 胜率加成
            if coin.history_wr > 60:
                score += 5
            elif coin.history_wr < 30:
                score -= 5
        else:
            score += 3  # 新币，中性偏正

        return max(0, min(100, score))

    async def _fetch_tickers(self, session) -> Dict[str, dict]:
        """拉取全量24h行情"""
        try:
            url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
            return {d["symbol"]: d for d in data if d.get("symbol", "").endswith("USDT")}
        except:
            return {}

    async def _fetch_funding(self, session) -> Dict[str, float]:
        """拉取全量资金费率"""
        try:
            url = "https://fapi.binance.com/fapi/v1/premiumIndex"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
            return {d["symbol"]: float(d.get("lastFundingRate", 0)) for d in data}
        except:
            return {}

    def save_results(self, coins: List[CoinScore], path: str):
        """保存筛选结果"""
        data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_coins": len(coins),
            "tiers": {
                "S": [c.symbol for c in coins if c.tier == "S"],
                "A": [c.symbol for c in coins if c.tier == "A"],
                "B": [c.symbol for c in coins if c.tier == "B"],
            },
            "blacklist": list(self._blacklist_coins),
            "details": [
                {
                    "symbol": c.symbol,
                    "tier": c.tier,
                    "score": round(c.total_score, 1),
                    "vol_M": round(c.volume_24h / 1_000_000, 1),
                    "change": round(c.price_change_24h, 2),
                    "volatility": round(c.volatility_24h, 1),
                    "funding": c.funding_rate,
                    "hist_pnl": c.history_pnl,
                    "hist_wr": c.history_wr,
                }
                for c in coins[:50]  # 只保存前50详情
            ],
        }
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
        logger.info(f"保存筛选结果到 {path} ({len(coins)}个币)")

    def format_report(self, coins: List[CoinScore]) -> str:
        """格式化筛选报告"""
        lines = ["🔍 智能币种筛选报告", "=" * 50]

        # S级
        s_tier = [c for c in coins if c.tier == "S"]
        if s_tier:
            lines.append(f"\n💎 S级 ({len(s_tier)}个) - 超级优先:")
            for c in s_tier[:10]:
                hist = f"历史+${c.history_pnl:,.0f}" if c.history_pnl > 0 else \
                       f"历史${c.history_pnl:+,.0f}" if c.history_trades > 0 else "新币"
                lines.append(
                    f"  {c.symbol}: Score={c.total_score:.0f} "
                    f"Vol=${c.volume_24h/1e6:.0f}M "
                    f"Chg={c.price_change_24h:+.1f}% "
                    f"Volatility={c.volatility_24h:.1f}% "
                    f"{hist}"
                )

        # A级
        a_tier = [c for c in coins if c.tier == "A"]
        if a_tier:
            lines.append(f"\n🥇 A级 ({len(a_tier)}个):")
            for c in a_tier[:10]:
                lines.append(
                    f"  {c.symbol}: Score={c.total_score:.0f} "
                    f"Vol=${c.volume_24h/1e6:.0f}M "
                    f"Chg={c.price_change_24h:+.1f}%"
                )

        # 黑名单
        lines.append(f"\n🚫 黑名单 ({len(self._blacklist_coins)}个):")
        for sym in sorted(self._blacklist_coins):
            if sym in self.BLACKLIST:
                continue  # 不显示稳定币
            hist = self._history_stats.get(sym, {})
            if hist.get("trades", 0) > 0:
                lines.append(
                    f"  {sym}: {hist['trades']}笔 "
                    f"WR{hist.get('wins',0)/hist['trades']*100:.0f}% "
                    f"PnL${hist.get('pnl',0):+,.0f}"
                )

        # 统计
        total = len(coins)
        lines.append(f"\n📊 总计: {total}个 | S:{len(s_tier)} A:{len(a_tier)} "
                    f"B:{total-len(s_tier)-len(a_tier)}")

        return "\n".join(lines)


async def run_screener():
    """运行筛选器"""
    screener = SmartScreener()
    async with aiohttp.ClientSession() as session:
        coins = await screener.screen(session, top_n=100)

    # 保存
    screener.save_results(coins, f"{DATA_DIR}/smart_screener_results.json")

    # 报告
    report = screener.format_report(coins)
    print(report)

    # 更新active_symbols（只保留S+A+B级）
    symbols = [c.symbol for c in coins]
    with open(f"{DATA_DIR}/active_symbols.json", 'w') as f:
        json.dump({"symbols": symbols, "updated": datetime.now(timezone.utc).isoformat()}, f, indent=2)
    print(f"\n✅ 更新active_symbols: {len(symbols)}个币")

    return coins


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    asyncio.run(run_screener())
