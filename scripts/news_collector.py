"""
小风交易系统 - 加密新闻 RSS 采集器

功能：
1. 多源 RSS 定时抓取（CoinDesk/CoinTelegraph/Decrypt 等）
2. 恐惧贪婪指数采集
3. 关键词过滤 + 币种关联匹配
4. 新闻去重（基于标题 hash）
5. 重要度评分（基于关键词权重）
6. 数据推送到 Redis Stream 供情报员 Agent 消费
"""
import json
import asyncio
import hashlib
import logging
import re
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Set
from collections import defaultdict

import aiohttp
import feedparser

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger("NewsCollector")

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_SOURCES, DATA_DIR, REDIS_URL

# Redis 连接
try:
    import redis
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    USE_REDIS = True
except Exception:
    USE_REDIS = False

# ============================================
# RSS 数据源（已验证可用）
# ============================================
RSS_FEEDS = [
    {"name": "CoinDesk",       "url": "https://www.coindesk.com/arc/outboundfeeds/rss/",       "weight": 1.0, "lang": "en"},
    {"name": "CoinTelegraph",  "url": "https://cointelegraph.com/rss",                         "weight": 1.0, "lang": "en"},
    {"name": "Decrypt",        "url": "https://decrypt.co/feed",                              "weight": 0.9, "lang": "en"},
    {"name": "Bitcoinist",     "url": "https://bitcoinist.com/feed/",                         "weight": 0.7, "lang": "en"},
    {"name": "NewsBTC",        "url": "https://www.newsbtc.com/feed/",                        "weight": 0.7, "lang": "en"},
    {"name": "CryptoBriefing", "url": "https://cryptobriefing.com/feed/",                     "weight": 0.8, "lang": "en"},
]

# ============================================
# 关键词权重表（用于重要度评分）
# ============================================
KEYWORD_WEIGHTS = {
    # 宏观/监管（高权重）
    "SEC": 3.0, "ETF": 3.0, "Fed": 3.0, "interest rate": 2.5, "regulation": 2.5,
    "ban": 2.5, "approve": 2.5, "law": 2.0, "congress": 2.0, "treasury": 2.0,
    "CBDC": 2.5, "sanctions": 2.0, "executive order": 3.0,

    # 重大事件
    "hack": 3.0, "exploit": 3.0, "breach": 3.0, "rug pull": 3.0, "scam": 2.0,
    "bankruptcy": 3.0, "crash": 2.5, "liquidation": 2.0, "insolvency": 3.0,
    "bailout": 2.5, "run": 2.0,

    # 机构动向
    "BlackRock": 2.5, "Fidelity": 2.5, "MicroStrategy": 2.0, "Strategy": 2.0,
    "Tesla": 2.0, "Goldman Sachs": 2.0, "JPMorgan": 2.0, "institutional": 2.0,
    "adoption": 2.0, "reserve": 2.5, "treasury buy": 2.5,

    # 技术升级
    "upgrade": 2.0, "fork": 2.0, "halving": 2.5, "merge": 2.0, "launch": 1.5,
    "mainnet": 2.0, "testnet": 1.0, "airdrop": 1.5, "staking": 1.0,
    "layer 2": 1.5, "L2": 1.5, "scaling": 1.5, "burn": 1.5,

    # 市场信号
    "all-time high": 2.5, "ATH": 2.5, "bottom": 2.0, "bullish": 1.5,
    "bearish": 1.5, "whale": 2.0, "accumulation": 1.5, "pump": 1.5,
    "dump": 2.0, " breakout": 1.5, "breakdown": 1.5,

    # 币种关键词
    "bitcoin": 1.5, "BTC": 1.5, "ethereum": 1.5, "ETH": 1.5,
    "BNB": 1.0, "SOL": 1.0, "XRP": 1.0, "DOGE": 1.0, "ADA": 1.0, "AVAX": 1.0,
}

# 币种别名映射
COIN_ALIASES = {
    "BTC": ["bitcoin", "btc", "satoshi"],
    "ETH": ["ethereum", "eth", "vitalik"],
    "BNB": ["bnb", "binance coin", "cz"],
    "SOL": ["solana", "sol"],
    "XRP": ["xrp", "ripple"],
    "DOGE": ["dogecoin", "doge", "shiba"],
    "ADA": ["cardano", "ada"],
    "AVAX": ["avalanche", "avax"],
}


def _hash_title(title: str) -> str:
    """标题去重 hash"""
    # 去除标点和空格后 hash
    clean = re.sub(r'[^a-zA-Z0-9]', '', title.lower())
    return hashlib.md5(clean.encode()).hexdigest()


def score_article(title: str, summary: str = "") -> float:
    """
    评估新闻重要度分数 (0-10)
    """
    text = f"{title} {summary}".lower()
    score = 0.0

    for keyword, weight in KEYWORD_WEIGHTS.items():
        kw_lower = keyword.lower()
        count = text.count(kw_lower)
        if count > 0:
            # 匹配次数有递减效应
            score += weight * min(count, 3)

    # 归一化到 0-10
    return min(score / 5.0, 10.0)


def extract_coins(title: str, summary: str = "") -> List[str]:
    """提取新闻关联的币种"""
    text = f"{title} {summary}".lower()
    coins = set()

    for coin, aliases in COIN_ALIASES.items():
        for alias in aliases:
            if alias in text:
                coins.add(coin)
                break

    return list(coins)


def categorize_article(title: str, summary: str = "") -> str:
    """新闻分类"""
    text = f"{title} {summary}".lower()

    categories = {
        "regulation": ["sec", "regulation", "ban", "law", "congress", "approve", "etf", "cbdc"],
        "macro": ["fed", "interest rate", "inflation", "gdp", "treasury", "dollar"],
        "institutional": ["blackrock", "fidelity", "institutional", "reserve", "treasury buy"],
        "security": ["hack", "exploit", "breach", "rug pull", "scam", "stolen"],
        "technology": ["upgrade", "fork", "halving", "mainnet", "layer 2", "l2", "scaling"],
        "market": ["ath", "crash", "pump", "dump", "bullish", "bearish", "all-time high"],
        "adoption": ["adoption", "payment", "merchant", "country", "legal tender"],
    }

    for cat, keywords in categories.items():
        for kw in keywords:
            if kw in text:
                return cat

    return "general"


# ============================================
# RSS 抓取
# ============================================
seen_hashes: Set[str] = set()


def load_seen_hashes():
    """加载已处理的标题 hash（去重）"""
    global seen_hashes
    hash_file = DATA_DIR / "news_hashes.txt"
    if hash_file.exists():
        with open(hash_file) as f:
            seen_hashes = set(line.strip() for line in f if line.strip())
        logger.info(f"📰 已加载 {len(seen_hashes)} 个历史新闻 hash")


def save_hash(h: str):
    """保存新 hash"""
    seen_hashes.add(h)
    hash_file = DATA_DIR / "news_hashes.txt"
    with open(hash_file, "a") as f:
        f.write(h + "\n")


async def fetch_rss(feed: dict, session: aiohttp.ClientSession) -> List[dict]:
    """抓取单个 RSS 源"""
    results = []
    try:
        async with session.get(
            feed["url"],
            timeout=aiohttp.ClientTimeout(total=15),
            headers={"User-Agent": "Mozilla/5.0 (XiaoFeng Trading Agent)"}
        ) as resp:
            if resp.status != 200:
                logger.warning(f"RSS {feed['name']} 返回 HTTP {resp.status}")
                return results

            content = await resp.text()
            parsed = feedparser.parse(content)

            for entry in parsed.entries[:20]:  # 每源最多20条
                title = entry.get("title", "").strip()
                if not title:
                    continue

                # 去重
                h = _hash_title(title)
                if h in seen_hashes:
                    continue

                summary = entry.get("summary", "") or entry.get("description", "")
                # 清理 HTML 标签
                summary = re.sub(r'<[^>]+>', '', summary)[:500]

                pub_date = entry.get("published", "") or entry.get("updated", "")
                link = entry.get("link", "")

                # 评分
                score = score_article(title, summary)
                coins = extract_coins(title, summary)
                category = categorize_article(title, summary)

                record = {
                    "type": "news",
                    "source": feed["name"],
                    "source_weight": feed["weight"],
                    "title": title,
                    "summary": summary[:200],
                    "link": link,
                    "pub_date": pub_date,
                    "category": category,
                    "related_coins": ",".join(coins),
                    "score": round(score, 2),
                    "is_important": score >= 3.0,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

                save_hash(h)
                results.append(record)

    except Exception as e:
        logger.error(f"❌ RSS {feed['name']} 错误: {e}")

    return results


# ============================================
# 恐惧贪婪指数
# ============================================
async def fetch_fear_greed(session: aiohttp.ClientSession) -> Optional[dict]:
    """获取恐惧贪婪指数"""
    try:
        url = "https://api.alternative.me/fng/?limit=3"
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 200:
                data = await resp.json()
                current = data.get("data", [{}])[0]

                value = int(current.get("value", 0))
                label = current.get("value_classification", "Unknown")

                # 判断情绪
                if value <= 20:
                    emoji = "😱"
                    signal = "极度恐惧 - 可能是买入机会"
                elif value <= 40:
                    emoji = "😟"
                    signal = "恐惧 - 谨慎乐观"
                elif value <= 60:
                    emoji = "😐"
                    signal = "中性"
                elif value <= 80:
                    emoji = "😊"
                    signal = "贪婪 - 注意风险"
                else:
                    emoji = "🤑"
                    signal = "极度贪婪 - 注意回调"

                record = {
                    "type": "fear_greed",
                    "value": value,
                    "label": label,
                    "emoji": emoji,
                    "signal": signal,
                    "timestamp": current.get("timestamp", ""),
                }
                logger.info(f"{emoji} 恐惧贪婪指数: {value} ({label}) - {signal}")
                return record
    except Exception as e:
        logger.error(f"❌ 恐惧贪婪指数错误: {e}")
    return None


# ============================================
# 推送到 Redis / 文件
# ============================================
def push_news(record: dict):
    """推送新闻到 Redis Stream"""
    payload = {k: str(v) for k, v in record.items()}
    if USE_REDIS:
        try:
            redis_client.xadd("stream:news", payload, maxlen=5000)
        except Exception as e:
            logger.error(f"Redis 推送失败: {e}")
            _save_to_file(record)
    else:
        _save_to_file(record)


def _save_to_file(record: dict):
    date_str = datetime.now().strftime("%Y-%m-%d")
    filepath = DATA_DIR / f"news-{date_str}.jsonl"
    with open(filepath, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


# ============================================
# 主循环
# ============================================
async def collect_all_feeds():
    """一轮完整抓取所有 RSS 源"""
    load_seen_hashes()

    async with aiohttp.ClientSession() as session:
        all_articles = []

        # 并发抓取所有 RSS
        tasks = [fetch_rss(feed, session) for feed in RSS_FEEDS]
        results = await asyncio.gather(*tasks)

        for articles in results:
            all_articles.extend(articles)

        # 按重要度排序
        all_articles.sort(key=lambda x: x["score"], reverse=True)

        # 推送所有新闻
        important_count = 0
        for article in all_articles:
            push_news(article)
            if article["is_important"]:
                important_count += 1
                coins = article["related_coins"]
                logger.info(
                    f"🔥 重要新闻 [{article['category']}] "
                    f"({article['score']:.1f}) {article['title'][:60]} "
                    f"| Coins: {coins or 'N/A'}"
                )

        # 恐惧贪婪指数
        fg = await fetch_fear_greed(session)
        if fg:
            push_news(fg)

        logger.info(
            f"📰 本轮采集: {len(all_articles)} 条新闻, "
            f"{important_count} 条重要 | "
            f"去重池: {len(seen_hashes)} 条"
        )

        return len(all_articles), important_count


async def main(interval: int = 300):
    """
    主循环，每 interval 秒抓取一轮
    默认 5 分钟
    """
    logger.info(f"🌀 小风交易系统 - 新闻 RSS 采集器启动")
    logger.info(f"📰 监控源: {len(RSS_FEEDS)} 个 RSS")
    logger.info(f"⏱️  采集间隔: {interval}s")

    while True:
        try:
            await collect_all_feeds()
        except Exception as e:
            logger.error(f"❌ 采集轮次错误: {e}")

        await asyncio.sleep(interval)


if __name__ == "__main__":
    try:
        asyncio.run(main(interval=300))
    except KeyboardInterrupt:
        logger.info("👋 新闻采集器已停止")
