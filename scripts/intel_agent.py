"""
小风交易系统 - 情报员 Agent

职责：
1. 从 Redis Stream 消费所有数据源
2. 聚合/去重/优先级排序
3. 提取关键信号，生成情报
4. 推送情报到 Redis Stream 供分析师消费
"""
import json
import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from collections import defaultdict

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger("IntelAgent")

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR, REDIS_URL, CORE_SYMBOLS

try:
    import redis
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    USE_REDIS = True
except Exception:
    USE_REDIS = False


# ============================================
# 情报数据结构
# ============================================
class IntelReport:
    """情报报告"""
    def __init__(self):
        self.timestamp = datetime.now(timezone.utc).isoformat()
        self.intels: List[dict] = []
        self.market_summary: dict = {}
        self.alerts: List[dict] = []  # P0/P1 预警

    def to_dict(self):
        return {
            "type": "intel_report",
            "timestamp": self.timestamp,
            "intel_count": len(self.intels),
            "alert_count": len(self.alerts),
            "intels": self.intels[:50],
            "market_summary": self.market_summary,
            "alerts": self.alerts,
        }


# ============================================
# 数据消费
# ============================================
def read_stream_latest(stream: str, count: int = 100) -> list:
    """读取最新的N条数据，自动解码 bytes"""
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
# 情报分析逻辑
# ============================================
class IntelAgent:
    def __init__(self):
        # 缓存状态
        self.ticker_cache: Dict[str, dict] = {}
        self.market_cache: Dict[str, dict] = {}  # 24h ticker with change%
        self.funding_cache: Dict[str, float] = {}
        self.recent_liquidations: List[dict] = []
        self.recent_whales: List[dict] = []
        self.important_news: List[dict] = []
        self.fear_greed: Optional[dict] = None
        self.screener_state: Optional[dict] = None
        self.trade_pool_symbols: List[str] = []

    async def collect_all(self) -> IntelReport:
        """收集所有数据源，生成情报报告"""
        report = IntelReport()

        # 1. 消费 Binance Ticker (全市场，从中提取核心币种)
        all_tickers = read_stream_latest("stream:binance:ticker", count=1000)
        for t in all_tickers:
            symbol = t.get("symbol", "")
            if symbol in CORE_SYMBOLS:
                self.ticker_cache[symbol] = t

        # 2. 消费 24h Market 数据 (有 change_pct 等完整信息)
        market_data = read_stream_latest("stream:binance:market", count=500)
        for m in market_data:
            symbol = m.get("symbol", "")
            self.market_cache[symbol] = m
            if symbol in CORE_SYMBOLS:
                self.ticker_cache[symbol] = {
                    "symbol": symbol,
                    "price": m.get("lastPrice", m.get("price", "?")),
                    "change_24h": m.get("priceChangePercent", "?"),
                    "volume": m.get("quoteVolume", "?"),
                    "high": m.get("highPrice", "?"),
                    "low": m.get("lowPrice", "?"),
                }

        # 3. 消费资金费率 (字段: lastFundingRate, markPrice, symbol)
        fundings = read_stream_latest("stream:binance:funding", count=100)
        seen_symbols = set()
        for f in fundings:
            symbol = f.get("symbol", "")
            if symbol in seen_symbols:
                continue
            seen_symbols.add(symbol)
            # lastFundingRate 是字符串，如 "-0.00005701"
            rate_str = f.get("lastFundingRate", "0")
            try:
                rate = float(rate_str)
            except (ValueError, TypeError):
                continue
            self.funding_cache[symbol] = rate
            mark_price = f.get("markPrice", "?")

            # 资金费率异常检测
            if abs(rate) >= 0.003:  # 0.3%
                priority = "P0" if abs(rate) >= 0.01 else "P1"
                direction = "极度看多 🔴" if rate > 0 else "极度看空 🟢"
                intel = {
                    "type": "funding_anomaly",
                    "priority": priority,
                    "title": f"💰 {symbol} 资金费率异常: {rate*100:.4f}% ({direction})",
                    "content": f"当前资金费率 {rate*100:.4f}%，标记价 {mark_price}",
                    "symbols_affected": [symbol],
                    "tags": ["funding", "bearish" if rate > 0 else "bullish"],
                }
                report.intels.append(intel)
                if priority in ("P0", "P1"):
                    report.alerts.append(intel)

        # 4. 消费爆仓数据
        liquidations = read_stream_latest("stream:binance:liquidation", count=30)
        for l in liquidations:
            self.recent_liquidations.append(l)
            try:
                val = float(l.get("value_usdt", l.get("notionalValue", 0)))
            except (ValueError, TypeError):
                continue
            if val >= 500_000:  # >50万
                priority = "P0" if val >= 5_000_000 else "P1"
                intel = {
                    "type": "liquidation",
                    "priority": priority,
                    "title": f"💥 大额爆仓: {l.get('symbol')} {l.get('side', '?')} ${val:,.0f}",
                    "content": f"价格 {l.get('price', '?')}，数量 {l.get('origQty', l.get('quantity', '?'))}",
                    "symbols_affected": [l.get("symbol", "")],
                    "tags": ["liquidation", l.get("side", "").lower()],
                }
                report.intels.append(intel)
                report.alerts.append(intel)
        self.recent_liquidations = self.recent_liquidations[-50:]

        # 5. 消费新闻 (type=news / type=fear_greed)
        news = read_stream_latest("stream:news", count=100)
        seen_titles = set()
        for n in news:
            ntype = n.get("type", "")

            if ntype == "fear_greed":
                self.fear_greed = {
                    "value": n.get("value", "?"),
                    "label": n.get("label", "?"),
                    "emoji": n.get("emoji", "?"),
                    "signal": n.get("signal", "?"),
                }
                continue

            if ntype == "news":
                title = n.get("title", "")
                if title in seen_titles:
                    continue
                seen_titles.add(title)

                is_important = n.get("is_important", "False") in ("True", "true", "1")
                if not is_important:
                    # 普通新闻也收集，但优先级低
                    score = float(n.get("score", 0))
                    if score < 1.5:
                        continue

                score = float(n.get("score", 0))
                priority = "P1" if score >= 3.0 else "P2"
                coins_str = n.get("related_coins", "")
                coins = [c.strip() for c in coins_str.split(",") if c.strip()] if coins_str else []

                intel = {
                    "type": "news",
                    "priority": priority,
                    "title": f"📰 [{n.get('category', '?')}] {title[:80]}",
                    "content": n.get("summary", n.get("title", ""))[:200],
                    "source": n.get("source", "?"),
                    "symbols_affected": coins,
                    "tags": ["news", n.get("category", "general")],
                }
                self.important_news.append(intel)
                report.intels.append(intel)
                if priority == "P1":
                    report.alerts.append(intel)

        self.important_news = self.important_news[-30:]

        # 6. 消费链上鲸鱼
        whales = read_stream_latest("stream:onchain:whale", count=30)
        for w in whales:
            self.recent_whales.append(w)
            try:
                val = float(w.get("amount_usd", "0").replace(",", ""))
            except (ValueError, TypeError):
                val = 0
            if val >= 1_000_000:
                intel = {
                    "type": "onchain_whale",
                    "priority": "P1",
                    "title": f"🐋 {w.get('chain', '?')} 鲸鱼: {w.get('amount', '?')} (${val:,.0f})",
                    "content": f"from: {str(w.get('from', '?'))[:20]}... → to: {str(w.get('to', '?'))[:20]}...",
                    "symbols_affected": [w.get("chain", "")],
                    "tags": ["whale", w.get("chain", "").lower()],
                }
                report.intels.append(intel)
                report.alerts.append(intel)
        self.recent_whales = self.recent_whales[-30:]

        # 7. 消费筛选器结果 (数据用 str() 序列化，需 ast.literal_eval)
        import ast
        screener = read_stream_latest("stream:screener", count=5)
        for s in screener:
            trade_pool = self._parse_python_str(s.get("trade_pool", "[]"))
            focus_pool = self._parse_python_str(s.get("focus_pool", "[]"))
            state = self._parse_python_str(s.get("state", "{}"))

            if trade_pool:
                self.trade_pool_symbols = [t.get("symbol", "") for t in trade_pool if isinstance(t, dict)]
                watch_size = s.get("watch_pool_size", 
                    state.get("watch_pool_size", len(state.get("watch_pool", []))) if isinstance(state, dict) else "?")

                intel = {
                    "type": "screener",
                    "priority": "P2",
                    "title": f"🎯 交易池更新: {', '.join(self.trade_pool_symbols[:10])}",
                    "content": f"观察池:{watch_size} 关注池:{len(focus_pool)} 交易池:{len(trade_pool)}",
                    "symbols_affected": self.trade_pool_symbols,
                    "tags": ["screener"],
                    "trade_pool_detail": trade_pool[:5],
                }
                report.intels.append(intel)
                self.screener_state = {
                    "watch_size": watch_size,
                    "focus_size": len(focus_pool),
                    "trade_size": len(trade_pool),
                    "trade_pool": trade_pool,
                    "focus_pool": focus_pool,
                }

                # 从 focus_pool 补全核心币种价格
                if isinstance(focus_pool, list):
                    for coin in focus_pool:
                        if isinstance(coin, dict):
                            sym = coin.get("symbol", "")
                            if sym in CORE_SYMBOLS and sym not in self.ticker_cache:
                                self.ticker_cache[sym] = {
                                    "symbol": sym,
                                    "price": str(coin.get("price", "?")),
                                    "change_24h": str(coin.get("change_24h", "?")),
                                    "volume": str(coin.get("volume_24h", "?")),
                                }

        # 8. 智能信号：价格异动检测
        for symbol, m in self.market_cache.items():
            if symbol not in CORE_SYMBOLS:
                continue
            try:
                change = float(m.get("priceChangePercent", 0))
            except (ValueError, TypeError):
                continue
            if abs(change) >= 3.0:
                priority = "P0" if abs(change) >= 7.0 else "P1"
                direction = "📈 暴涨" if change > 0 else "📉 暴跌"
                intel = {
                    "type": "price_alert",
                    "priority": priority,
                    "title": f"{direction} {symbol} 24h {change:+.2f}%",
                    "content": f"当前价 {m.get('lastPrice', '?')}，高 {m.get('highPrice', '?')} 低 {m.get('lowPrice', '?')}",
                    "symbols_affected": [symbol],
                    "tags": ["price", "bullish" if change > 0 else "bearish"],
                }
                report.intels.append(intel)
                if priority in ("P0", "P1"):
                    report.alerts.append(intel)

        # 9. 恐惧贪婪情报
        if self.fear_greed:
            val = self.fear_greed.get("value", "?")
            try:
                v = int(val)
                if v <= 20:  # 极度恐惧
                    report.intels.append({
                        "type": "sentiment",
                        "priority": "P1",
                        "title": f"😱 市场极度恐惧! 指数 {val} — 逆向信号?",
                        "content": f"恐惧贪婪指数: {val} ({self.fear_greed.get('label')})",
                        "symbols_affected": list(CORE_SYMBOLS[:3]),
                        "tags": ["sentiment", "contrarian"],
                    })
                elif v >= 80:  # 极度贪婪
                    report.intels.append({
                        "type": "sentiment",
                        "priority": "P1",
                        "title": f"🤑 市场极度贪婪! 指数 {val} — 注意风险",
                        "content": f"恐惧贪婪指数: {val} ({self.fear_greed.get('label')})",
                        "symbols_affected": list(CORE_SYMBOLS[:3]),
                        "tags": ["sentiment", "risk"],
                    })
            except (ValueError, TypeError):
                pass

        # 10. 生成市场概览
        report.market_summary = self._build_market_summary()

        # 按优先级排序
        priority_order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
        report.intels.sort(key=lambda x: priority_order.get(x.get("priority", "P3"), 9))
        report.alerts.sort(key=lambda x: priority_order.get(x.get("priority", "P3"), 9))

        return report

    @staticmethod
    def _parse_python_str(s):
        """解析 Python str() 序列化的数据（单引号），回退到 JSON"""
        import ast
        if isinstance(s, (list, dict)):
            return s
        if not isinstance(s, str):
            return s if isinstance(s, (list, dict)) else []
        try:
            return ast.literal_eval(s)
        except (ValueError, SyntaxError):
            try:
                return json.loads(s)
            except (json.JSONDecodeError, ValueError):
                return []

    def _build_market_summary(self) -> dict:
        """构建市场概览"""
        summary = {
            "core_prices": {},
            "funding_rates": {},
            "fear_greed": self.fear_greed,
            "recent_liquidations_count": len(self.recent_liquidations),
            "recent_whales_count": len(self.recent_whales),
            "important_news_count": len(self.important_news),
            "trade_pool_symbols": self.trade_pool_symbols,
        }

        # 核心币种价格 (优先用 market_cache 有完整信息)
        for symbol in CORE_SYMBOLS:
            m = self.market_cache.get(symbol, {})
            t = self.ticker_cache.get(symbol, {})
            summary["core_prices"][symbol] = {
                "price": m.get("lastPrice") or t.get("price", "?"),
                "change_24h": m.get("priceChangePercent", t.get("change_24h", "?")),
                "volume": m.get("quoteVolume", "?"),
            }

        # 资金费率
        for symbol, rate in self.funding_cache.items():
            summary["funding_rates"][symbol] = f"{rate*100:.4f}%"

        return summary

    def push_report(self, report: IntelReport):
        """推送情报报告"""
        data = report.to_dict()
        payload = {
            "type": "intel_report",
            "timestamp": data["timestamp"],
            "intel_count": str(data["intel_count"]),
            "alert_count": str(data["alert_count"]),
        }

        if USE_REDIS:
            try:
                redis_client.xadd("stream:intel", payload, maxlen=500)
                for alert in data["alerts"]:
                    alert_payload = {}
                    for k, v in alert.items():
                        if isinstance(v, (list, dict)):
                            alert_payload[k] = json.dumps(v, ensure_ascii=False)
                        else:
                            alert_payload[k] = str(v)
                    redis_client.xadd("stream:alerts", alert_payload, maxlen=200)
            except Exception as e:
                logger.error(f"Redis 推送失败: {e}")
                self._save_report(data)
        else:
            self._save_report(data)

    def _save_report(self, data: dict):
        date_str = datetime.now().strftime("%Y-%m-%d")
        filepath = DATA_DIR / f"intel-{date_str}.jsonl"
        with open(filepath, "a") as f:
            f.write(json.dumps(data, ensure_ascii=False) + "\n")


# ============================================
# Telegram 预警格式化
# ============================================
def format_telegram_report(report: IntelReport) -> str:
    """格式化 Telegram 情报简报"""
    lines = []
    lines.append("🔍 *小风情报简报*")
    lines.append(f"⏰ {datetime.now().strftime('%H:%M:%S')}")
    lines.append("")

    # 预警
    if report.alerts:
        lines.append("🚨 _预警_")
        for alert in report.alerts[:5]:
            priority = alert.get("priority", "?")
            emoji = {"P0": "🔴", "P1": "🟡", "P2": "🔵"}.get(priority, "⚪")
            lines.append(f"{emoji} {alert.get('title', '?')}")
        lines.append("")

    # 市场概览
    summary = report.market_summary
    if summary.get("core_prices"):
        lines.append("📊 _核心币种_")
        for symbol, data in summary["core_prices"].items():
            price = data.get("price", "?")
            change = data.get("change_24h", "?")
            name = symbol.replace("USDT", "")
            try:
                ch = float(change)
                arrow = "📈" if ch > 0 else "📉"
                lines.append(f"  {arrow} {name}: ${float(price):,.2f} ({ch:+.2f}%)")
            except (ValueError, TypeError):
                lines.append(f"  {name}: ${price} ({change}%)")
        lines.append("")

    # 恐惧贪婪
    fg = summary.get("fear_greed")
    if fg:
        lines.append(f"{fg.get('emoji', '?')} 恐惧贪婪: *{fg.get('value', '?')}* ({fg.get('label', '?')})")
        lines.append("")

    # 资金费率
    funding = summary.get("funding_rates", {})
    if funding:
        lines.append("💰 _资金费率_")
        for symbol, rate in funding.items():
            try:
                r = float(rate.replace('%', ''))
                indicator = "🔴多" if r > 0 else "🟢空" if r < 0 else "⚪平"
                if abs(r) >= 0.01:
                    lines.append(f"  ⚡ {symbol.replace('USDT','')}: {rate} {indicator}")
                else:
                    lines.append(f"  {symbol.replace('USDT','')}: {rate}")
            except (ValueError, TypeError):
                pass
        lines.append("")

    # 交易池
    tp = summary.get("trade_pool_symbols", [])
    if tp:
        lines.append(f"🎯 交易池: {', '.join([s.replace('USDT','') for s in tp[:8]])}")
        lines.append("")

    # 统计
    lines.append(f"📝 情报 {len(report.intels)} 条 | 预警 {len(report.alerts)} 条")
    lines.append(f"🐋 鲸鱼 {summary.get('recent_whales_count', 0)} | 💥 爆仓 {summary.get('recent_liquidations_count', 0)}")
    lines.append(f"📰 重要新闻 {summary.get('important_news_count', 0)}")

    return "\n".join(lines)


def format_telegram_alert(alert: dict) -> str:
    """格式化单条预警"""
    priority = alert.get("priority", "?")
    emoji = {"P0": "🔴🔴🔴", "P1": "🟡", "P2": "🔵"}.get(priority, "⚪")

    lines = [
        f"{emoji} *情报预警 [{priority}]*",
        f"{alert.get('title', '?')}",
        "",
        f"📝 {alert.get('content', '')[:200]}",
    ]

    coins = alert.get("symbols_affected", [])
    if coins:
        lines.append(f"🎯 关联: {', '.join(str(c) for c in coins[:5])}")

    tags = alert.get("tags", [])
    if tags:
        lines.append(f"🏷️ {', '.join(str(t) for t in tags)}")

    return "\n".join(lines)


# ============================================
# 主循环
# ============================================
async def main(interval: int = 60):
    """情报员主循环，每分钟聚合一次"""
    logger.info("🔍 小风交易系统 - 情报员 Agent 启动")

    agent = IntelAgent()

    while True:
        try:
            report = await agent.collect_all()
            agent.push_report(report)

            # 日志
            if report.intels:
                logger.info(f"🔍 情报: {len(report.intels)} 条 | 预警: {len(report.alerts)} 条")
                for alert in report.alerts[:3]:
                    logger.info(f"  {'🔴' if alert['priority']=='P0' else '🟡'} {alert['title'][:60]}")
            else:
                logger.debug("暂无新情报")

        except Exception as e:
            logger.error(f"❌ 情报员错误: {e}")

        await asyncio.sleep(interval)


if __name__ == "__main__":
    try:
        asyncio.run(main(interval=60))
    except KeyboardInterrupt:
        logger.info("👋 情报员已停止")
