"""
小风交易系统 - 币种筛选器（三层漏斗机制）

第一层: 观察池 (~200) - 按成交额 + 活跃度自动筛选
第二层: 关注池 (~50)  - 综合评分：量价异动 + 新闻热度 + 资金费率 + 链上活跃
第三层: 交易池 (~10)  - 高置信度信号：多维度共振 + Agent 分析确认

核心 8 币种（BTC/ETH/BNB/SOL/XRP/DOGE/ADA/AVAX）常驻关注池
"""
import json
import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict
from dataclasses import dataclass, field, asdict

import aiohttp

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger("CoinScreener")

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR, REDIS_URL, CORE_SYMBOLS

# Redis
try:
    import redis
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    USE_REDIS = True
except Exception:
    USE_REDIS = False

# ============================================
# 漏斗参数
# ============================================
# 第一层：观察池
WATCH_POOL_SIZE = 200          # 观察池大小
WATCH_MIN_VOLUME_USD = 5_000_000  # 最低24h成交额 $5M

# 第二层：关注池
FOCUS_POOL_SIZE = 50           # 关注池大小
FOCUS_MIN_SCORE = 30.0         # 最低综合评分

# 第三层：交易池
TRADE_POOL_SIZE = 10           # 交易池大小
TRADE_MIN_SCORE = 60.0         # 最低交易评分

# 核心 8 币种始终在关注池
CORE_COINS = {"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"}

# ============================================
# 数据结构
# ============================================
@dataclass
class CoinScore:
    """币种综合评分"""
    symbol: str = ""
    # 基础数据
    price: float = 0
    change_24h: float = 0
    volume_24h: float = 0
    high_24h: float = 0
    low_24h: float = 0
    # 衍生数据
    price_range_pct: float = 0      # (high-low)/low 振幅
    volume_rank: int = 0             # 成交额排名
    # 评分维度
    score_volume: float = 0          # 成交量评分
    score_momentum: float = 0        # 动量评分
    score_volatility: float = 0      # 波动率评分
    score_funding: float = 0         # 资金费率评分
    score_news: float = 0            # 新闻热度评分
    score_onchain: float = 0         # 链上活跃评分
    score_total: float = 0           # 综合评分
    # 分层
    pool: str = "none"               # watch / focus / trade / core
    # 信号
    signals: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


# ============================================
# 推送数据
# ============================================
def push_screen(record: dict):
    payload = {k: str(v) for k, v in record.items()}
    if USE_REDIS:
        try:
            redis_client.xadd("stream:screener", payload, maxlen=2000)
        except Exception:
            _save_to_file(record)
    else:
        _save_to_file(record)


def _save_to_file(record: dict):
    date_str = datetime.now().strftime("%Y-%m-%d")
    filepath = DATA_DIR / f"screener-{date_str}.jsonl"
    with open(filepath, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def save_pool_state(watch: List[CoinScore], focus: List[CoinScore], trade: List[CoinScore]):
    """保存漏斗状态到文件"""
    state = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "watch_pool": [c.to_dict() for c in watch],
        "focus_pool": [c.to_dict() for c in focus],
        "trade_pool": [c.to_dict() for c in trade],
        "watch_count": len(watch),
        "focus_count": len(focus),
        "trade_count": len(trade),
    }
    filepath = DATA_DIR / "screener-state.json"
    with open(filepath, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    return state


# ============================================
# 第一层：观察池筛选
# ============================================
async def build_watch_pool(session: aiohttp.ClientSession) -> List[CoinScore]:
    """
    从 Binance 期货市场按成交额筛选 TOP 200 → 观察池
    """
    try:
        async with session.get(
            "https://fapi.binance.com/fapi/v1/ticker/24hr",
            timeout=aiohttp.ClientTimeout(total=15)
        ) as resp:
            tickers = await resp.json()

        # 只取 USDT 交易对
        usdt_pairs = [t for t in tickers if t["symbol"].endswith("USDT")]

        # 按24h成交额排序
        usdt_pairs.sort(key=lambda x: float(x.get("quoteVolume", 0)), reverse=True)

        watch_pool = []
        for i, t in enumerate(usdt_pairs[:WATCH_POOL_SIZE]):
            symbol = t["symbol"]
            price = float(t.get("lastPrice", 0))
            volume = float(t.get("quoteVolume", 0))
            change = float(t.get("priceChangePercent", 0))
            high = float(t.get("highPrice", 0))
            low = float(t.get("lowPrice", 0))

            price_range = ((high - low) / low * 100) if low > 0 else 0

            score = CoinScore(
                symbol=symbol,
                price=price,
                change_24h=change,
                volume_24h=volume,
                high_24h=high,
                low_24h=low,
                price_range_pct=round(price_range, 2),
                volume_rank=i + 1,
            )
            watch_pool.append(score)

        # 过滤低成交额
        watch_pool = [c for c in watch_pool if c.volume_24h >= WATCH_MIN_VOLUME_USD]

        logger.info(f"👁️ 观察池: {len(watch_pool)} 个币种 (成交额 >= ${WATCH_MIN_VOLUME_USD/1e6:.0f}M)")
        return watch_pool

    except Exception as e:
        logger.error(f"❌ 观察池构建失败: {e}")
        return []


# ============================================
# 第二层：关注池筛选（综合评分）
# ============================================
async def build_focus_pool(
    session: aiohttp.ClientSession,
    watch_pool: List[CoinScore]
) -> Tuple[List[CoinScore], List[CoinScore]]:
    """
    对观察池进行综合评分 → 关注池 (~50)

    评分维度:
    - 成交量异常 (0-20分)
    - 动量/趋势 (0-20分)
    - 波动率 (0-15分)
    - 资金费率异常 (0-15分)
    - 新闻热度 (0-15分)
    - 链上活跃度 (0-15分)
    """

    # 获取资金费率数据
    funding_data = {}
    try:
        async with session.get(
            "https://fapi.binance.com/fapi/v1/premiumIndex",
            timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            premiums = await resp.json()
            for p in premiums:
                funding_data[p["symbol"]] = float(p.get("lastFundingRate", 0))
    except Exception as e:
        logger.warning(f"资金费率获取失败: {e}")

    # 获取新闻热度（从 Redis）
    news_scores: Dict[str, float] = defaultdict(float)
    if USE_REDIS:
        try:
            entries = redis_client.xrange("stream:news", count=500)
            for _, data in entries:
                raw = {k.decode(): v.decode() for k, v in data.items()}
                if raw.get("type") == "news":
                    coins = raw.get("related_coins", "")
                    score = float(raw.get("score", 0))
                    for c in coins.split(","):
                        if c:
                            news_scores[f"{c}USDT"] += score
        except Exception:
            pass

    # 对每个币种评分
    scored = []

    for coin in watch_pool:
        # --- 成交量评分 (0-20) ---
        vol_rank = coin.volume_rank
        if vol_rank <= 10:
            coin.score_volume = 20
        elif vol_rank <= 30:
            coin.score_volume = 16
        elif vol_rank <= 50:
            coin.score_volume = 12
        elif vol_rank <= 100:
            coin.score_volume = 8
        elif vol_rank <= 200:
            coin.score_volume = 5
        else:
            coin.score_volume = 2

        # --- 动量评分 (0-20) ---
        change = abs(coin.change_24h)
        if change >= 20:
            coin.score_momentum = 20
            coin.signals.append(f"🔥 强势动量 {coin.change_24h:+.1f}%")
        elif change >= 10:
            coin.score_momentum = 16
            coin.signals.append(f"📈 明显动量 {coin.change_24h:+.1f}%")
        elif change >= 5:
            coin.score_momentum = 12
        elif change >= 2:
            coin.score_momentum = 8
        else:
            coin.score_momentum = 3

        # --- 波动率评分 (0-15) ---
        if coin.price_range_pct >= 10:
            coin.score_volatility = 15
            coin.signals.append(f"🌊 高波动 {coin.price_range_pct:.1f}%")
        elif coin.price_range_pct >= 6:
            coin.score_volatility = 12
        elif coin.price_range_pct >= 3:
            coin.score_volatility = 8
        else:
            coin.score_volatility = 3

        # --- 资金费率评分 (0-15) ---
        rate = funding_data.get(coin.symbol, 0)
        abs_rate = abs(rate)
        if abs_rate >= 0.003:  # 0.3%
            coin.score_funding = 15
            direction = "看多" if rate > 0 else "看空"
            coin.signals.append(f"💰 费率异常 {rate*100:.3f}% ({direction})")
        elif abs_rate >= 0.001:
            coin.score_funding = 10
        elif abs_rate >= 0.0005:
            coin.score_funding = 6
        else:
            coin.score_funding = 2

        # --- 新闻热度评分 (0-15) ---
        news = news_scores.get(coin.symbol, 0)
        if news >= 10:
            coin.score_news = 15
            coin.signals.append(f"📰 新闻热度 {news:.0f}")
        elif news >= 5:
            coin.score_news = 10
        elif news >= 2:
            coin.score_news = 6
        elif news >= 0.5:
            coin.score_news = 3
        else:
            coin.score_news = 0

        # --- 链上活跃评分 (0-15) ---
        # 暂时用成交额作为代理指标（后续接入链上数据）
        if coin.volume_24h >= 1e9:
            coin.score_onchain = 15
        elif coin.volume_24h >= 500e6:
            coin.score_onchain = 12
        elif coin.volume_24h >= 100e6:
            coin.score_onchain = 8
        elif coin.volume_24h >= 50e6:
            coin.score_onchain = 5
        else:
            coin.score_onchain = 2

        # --- 综合评分 ---
        coin.score_total = (
            coin.score_volume +
            coin.score_momentum +
            coin.score_volatility +
            coin.score_funding +
            coin.score_news +
            coin.score_onchain
        )

        # 标记核心币
        if coin.symbol in CORE_COINS:
            coin.pool = "core"

        scored.append(coin)

    # 按综合评分排序
    scored.sort(key=lambda x: x.score_total, reverse=True)

    # 构建关注池：核心币 + 高分币种
    focus_pool = []
    core_coins = []
    other_coins = []

    for c in scored:
        if c.symbol in CORE_COINS:
            c.pool = "core"
            core_coins.append(c)
        else:
            other_coins.append(c)

    # 核心8币种始终在关注池
    focus_pool.extend(core_coins)

    # 非核心币取高分
    remaining = FOCUS_POOL_SIZE - len(core_coins)
    for c in other_coins[:remaining]:
        if c.score_total >= FOCUS_MIN_SCORE:
            c.pool = "focus"
            focus_pool.append(c)

    # 更新其余为观察池
    focus_symbols = {c.symbol for c in focus_pool}
    for c in scored:
        if c.symbol not in focus_symbols:
            c.pool = "watch"

    logger.info(
        f"🔍 关注池: {len(focus_pool)} 个 "
        f"(核心 {len(core_coins)} + 动态 {len(focus_pool) - len(core_coins)})"
    )

    return scored, focus_pool


# ============================================
# 第三层：交易池筛选（高置信度信号）
# ============================================
def build_trade_pool(focus_pool: List[CoinScore]) -> List[CoinScore]:
    """
    从关注池中筛选交易池（高置信度信号）

    条件：
    1. 综合评分 >= 60
    2. 至少有 2 个信号
    3. 动量 + 资金费率 + 至少一个其他维度共振
    """
    trade_pool = []

    for c in focus_pool:
        # 基础门槛
        if c.score_total < TRADE_MIN_SCORE:
            continue

        # 多信号共振
        if len(c.signals) < 2:
            continue

        # 至少动量或资金费率有一个突出
        has_momentum = c.score_momentum >= 12
        has_funding = c.score_funding >= 10
        has_volatility = c.score_volatility >= 10
        has_news = c.score_news >= 6

        resonance = sum([has_momentum, has_funding, has_volatility, has_news])
        if resonance < 2:
            continue

        c.pool = "trade"
        c.signals.append(f"⚡ 多维共振 ({resonance}/4)")
        trade_pool.append(c)

    # 按评分排序，取 TOP N
    trade_pool.sort(key=lambda x: x.score_total, reverse=True)
    trade_pool = trade_pool[:TRADE_POOL_SIZE]

    logger.info(f"🎯 交易池: {len(trade_pool)} 个高置信度币种")
    return trade_pool


# ============================================
# 完整一轮筛选
# ============================================
async def run_screener(session: aiohttp.ClientSession) -> dict:
    """执行完整的三层漏斗筛选"""
    start = time.time()

    # 第一层
    watch_pool = await build_watch_pool(session)
    if not watch_pool:
        return {"error": "观察池构建失败"}

    # 第二层
    all_scored, focus_pool = await build_focus_pool(session, watch_pool)

    # 第三层
    trade_pool = build_trade_pool(focus_pool)

    elapsed = time.time() - start

    # 保存状态
    state = save_pool_state(watch_pool[:WATCH_POOL_SIZE], focus_pool, trade_pool)

    # 推送结果
    result = {
        "type": "screener_result",
        "watch_count": len(watch_pool),
        "focus_count": len(focus_pool),
        "trade_count": len(trade_pool),
        "trade_pool_symbols": ",".join([c.symbol for c in trade_pool]),
        "focus_pool_symbols": ",".join([c.symbol for c in focus_pool]),
        "elapsed_seconds": f"{elapsed:.1f}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    push_screen(result)

    # 打印报告
    logger.info("=" * 60)
    logger.info(f"🔍 币种筛选器报告 | 耗时 {elapsed:.1f}s")
    logger.info(f"   观察池: {len(watch_pool)} | 关注池: {len(focus_pool)} | 交易池: {len(trade_pool)}")
    logger.info("=" * 60)

    if trade_pool:
        logger.info("🎯 交易池候选:")
        for c in trade_pool:
            signals_str = " | ".join(c.signals[:3])
            logger.info(
                f"   {c.symbol:15} 评分:{c.score_total:.0f} "
                f"({c.score_volume}/{c.score_momentum}/{c.score_funding}/{c.score_news}) "
                f"24h:{c.change_24h:+.1f}% Vol:${c.volume_24h/1e6:.0f}M "
                f"| {signals_str}"
            )

    # 关注池新进入者（非核心币）
    new_focus = [c for c in focus_pool if c.pool == "focus" and c.symbol not in CORE_COINS]
    if new_focus:
        logger.info(f"👀 关注池新面孔 ({len(new_focus)}):")
        for c in new_focus[:10]:
            logger.info(
                f"   {c.symbol:15} 评分:{c.score_total:.0f} "
                f"24h:{c.change_24h:+.1f}% Vol:${c.volume_24h/1e6:.0f}M"
            )

    return {
        "state": state,
        "trade_pool": [c.to_dict() for c in trade_pool],
        "focus_pool": [c.to_dict() for c in focus_pool],
        "watch_pool_size": len(watch_pool),
    }


# ============================================
# 主循环
# ============================================
async def main(interval: int = 300):
    """
    主循环，每 interval 秒执行一轮筛选
    默认 5 分钟
    """
    logger.info("🌀 小风交易系统 - 币种筛选器启动")
    logger.info(f"🔍 三层漏斗: 观察池(~{WATCH_POOL_SIZE}) → 关注池(~{FOCUS_POOL_SIZE}) → 交易池(~{TRADE_POOL_SIZE})")

    async with aiohttp.ClientSession() as session:
        while True:
            try:
                await run_screener(session)
            except Exception as e:
                logger.error(f"❌ 筛选轮次错误: {e}")

            await asyncio.sleep(interval)


if __name__ == "__main__":
    try:
        asyncio.run(main(interval=300))
    except KeyboardInterrupt:
        logger.info("👋 币种筛选器已停止")
