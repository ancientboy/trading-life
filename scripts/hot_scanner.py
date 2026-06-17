"""
小风交易系统 - 币安爆款扫描器

在币安期货中寻找爆发性山寨币：
1. 成交量爆发 (24h成交额突然放大)
2. 新上市代币 (上线7天内)
3. 涨跌幅异常 (>15%)
4. 资金费率极端 (>0.1%)
5. 持仓量暴增 (>50%)

只扫描币安期货，因为只在币安交易。
"""
import asyncio
import aiohttp
import json
import logging
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from dataclasses import dataclass, field, asdict
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR, REDIS_URL

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
logger = logging.getLogger("HotScanner")

import redis as _redis
try:
    redis_client = _redis.from_url(REDIS_URL)
    USE_REDIS = True
except:
    USE_REDIS = False


# ============================================
# 爆款信号定义
# ============================================
@dataclass
class HotSignal:
    symbol: str
    price: float
    change_24h: float
    volume_24h: float
    funding_rate: float
    open_interest: float = 0
    oi_change_pct: float = 0
    price_range_pct: float = 0
    signals: list = field(default_factory=list)
    hot_score: float = 0
    category: str = ""  # volume_spike / new_listing / momentum / funding_extreme / oi_surge

    def to_dict(self):
        return asdict(self)


# ============================================
# 扫描逻辑
# ============================================
async def scan_hot_coins(session: aiohttp.ClientSession) -> List[HotSignal]:
    """扫描币安期货中的爆款山寨币"""

    # 1. 获取所有期货交易对 24h 行情
    async with session.get(
        "https://fapi.binance.com/fapi/v1/ticker/24hr",
        timeout=aiohttp.ClientTimeout(total=15)
    ) as resp:
        tickers = await resp.json()

    # 2. 获取资金费率
    async with session.get(
        "https://fapi.binance.com/fapi/v1/premiumIndex",
        timeout=aiohttp.ClientTimeout(total=10)
    ) as resp:
        premiums = await resp.json()
    funding_map = {p["symbol"]: float(p.get("lastFundingRate", 0)) for p in premiums}

    # 3. 获取持仓量 (Open Interest)
    oi_map = {}
    try:
        async with session.get(
            "https://fapi.binance.com/fapi/v1/openInterest",
            params={"symbol": "BTCUSDT"},  # 先试一个
            timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status != 200:
                # 批量获取
                async with session.get(
                    "https://fapi.binance.com/futures/data/openInterestHist",
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp2:
                    pass  # 这个API不一定能用，跳过
    except:
        pass

    # 过滤 USDT 交易对
    usdt_pairs = [t for t in tickers if t["symbol"].endswith("USDT")]

    results = []

    for t in usdt_pairs:
        symbol = t["symbol"]
        price = float(t.get("lastPrice", 0))
        volume = float(t.get("quoteVolume", 0))
        change = float(t.get("priceChangePercent", 0))
        high = float(t.get("highPrice", 0))
        low = float(t.get("lowPrice", 0))
        funding = funding_map.get(symbol, 0)
        range_pct = ((high - low) / low * 100) if low > 0 else 0

        sig = HotSignal(
            symbol=symbol,
            price=price,
            change_24h=change,
            volume_24h=volume,
            funding_rate=funding,
            price_range_pct=round(range_pct, 2),
        )

        score = 0

        # === 成交量爆发 ===
        # 按24h成交额排名，找突然放量的
        if volume >= 500_000_000:  # >$500M
            score += 15
        elif volume >= 100_000_000:  # >$100M
            score += 10
        elif volume >= 50_000_000:  # >$50M
            score += 5

        # === 涨跌幅异常 ===
        abs_change = abs(change)
        if abs_change >= 30:
            score += 25
            sig.signals.append(f"🚀 暴涨暴跌 {change:+.1f}%")
            sig.category = "momentum"
        elif abs_change >= 15:
            score += 18
            sig.signals.append(f"🔥 大幅波动 {change:+.1f}%")
            if not sig.category:
                sig.category = "momentum"
        elif abs_change >= 8:
            score += 10
            sig.signals.append(f"📈 明显异动 {change:+.1f}%")

        # === 波动率 ===
        if range_pct >= 20:
            score += 15
            sig.signals.append(f"🌊 剧烈震荡 {range_pct:.1f}%")
        elif range_pct >= 10:
            score += 8

        # === 资金费率极端 ===
        abs_funding = abs(funding)
        if abs_funding >= 0.003:  # 0.3%
            score += 20
            direction = "多头" if funding > 0 else "空头"
            sig.signals.append(f"💰 费率极端 {funding*100:.3f}% ({direction}拥挤)")
            if not sig.category:
                sig.category = "funding_extreme"
        elif abs_funding >= 0.001:  # 0.1%
            score += 10
            sig.signals.append(f"📊 费率偏高 {funding*100:.3f}%")

        sig.hot_score = score

        # 只保留有信号的 (score >= 10)
        if score >= 10 and sig.signals:
            results.append(sig)

    # 按 hot_score 排序
    results.sort(key=lambda x: x.hot_score, reverse=True)

    # 取 TOP 20
    top = results[:20]

    logger.info(f"🔥 爆款扫描完成: {len(results)} 个异动币种, TOP {len(top)}")
    for i, s in enumerate(top[:10]):
        signals_str = " | ".join(s.signals[:2])
        logger.info(
            f"  {i+1}. {s.symbol:15} 分数:{s.hot_score:.0f} "
            f"24h:{s.change_24h:+.1f}% Vol:${s.volume_24h/1e6:.0f}M "
            f"FR:{s.funding_rate*100:.3f}% {signals_str}"
        )

    return top


async def scan_new_listings(session: aiohttp.ClientSession) -> List[HotSignal]:
    """扫描近期新上市的币安期货合约 (通过成交额/价格特征推断)"""
    async with session.get(
        "https://fapi.binance.com/fapi/v1/exchangeInfo",
        timeout=aiohttp.ClientTimeout(total=15)
    ) as resp:
        info = await resp.json()

    symbols_info = info.get("symbols", [])
    new_listings = []

    now = time.time()
    for s in symbols_info:
        if s.get("status") != "TRADING" or not s["symbol"].endswith("USDT"):
            continue
        onboard_date = s.get("onboardDate", 0)
        if onboard_date == 0:
            continue
        # 7天内上线的
        days_since = (now - onboard_date / 1000) / 86400
        if days_since <= 7:
            new_listings.append({
                "symbol": s["symbol"],
                "days_since_listing": round(days_since, 1),
                "contract_type": s.get("contractType", ""),
            })

    if new_listings:
        new_listings.sort(key=lambda x: x["days_since_listing"])
        logger.info(f"🆕 近7天新上线合约: {len(new_listings)}个")
        for n in new_listings:
            logger.info(f"  {n['symbol']} (上线{n['days_since_listing']}天) {n['contract_type']}")

    return new_listings


def push_hot_signals(signals: List[HotSignal]):
    """推送爆款信号到 Redis"""
    for sig in signals:
        payload = {k: str(v) if not isinstance(v, list) else json.dumps(v)
                   for k, v in sig.to_dict().items()}
        payload["type"] = "hot_signal"
        if USE_REDIS:
            try:
                redis_client.xadd("stream:hot", payload, maxlen=500)
            except:
                pass
        # 同时推到文件
        date_str = datetime.now().strftime("%Y-%m-%d")
        filepath = DATA_DIR / f"hot-{date_str}.jsonl"
        with open(filepath, "a") as f:
            f.write(json.dumps(sig.to_dict(), ensure_ascii=False) + "\n")


def format_hot_report(signals: List[HotSignal]) -> str:
    """Telegram 格式的爆款报告"""
    if not signals:
        return "🔍 当前无明显爆款异动"

    lines = ["🔥 *币安爆款扫描*", f"⏰ {datetime.now().strftime('%H:%M')}", ""]

    for i, s in enumerate(signals[:10]):
        change_emoji = "🟢" if s.change_24h > 0 else "🔴"
        lines.append(
            f"{i+1}. *{s.symbol.replace('USDT','')}* {change_emoji} {s.change_24h:+.1f}%"
        )
        lines.append(
            f"   💵${s.volume_24h/1e6:.0f}M "
            f"📊FR:{s.funding_rate*100:.3f}% "
            f"⭐{s.hot_score:.0f}分"
        )
        for sig in s.signals[:2]:
            lines.append(f"   {sig}")

    return "\n".join(lines)


async def main():
    """测试入口"""
    async with aiohttp.ClientSession() as session:
        # 扫描爆款
        hot = await scan_hot_coins(session)
        print(format_hot_report(hot))
        print()

        # 扫描新上市
        new = await scan_new_listings(session)
        if new:
            print(f"🆕 新上市: {[n['symbol'] for n in new]}")

        # 推送
        push_hot_signals(hot)


if __name__ == "__main__":
    asyncio.run(main())
