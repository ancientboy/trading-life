"""
小风交易系统 - Binance 实时数据采集器

功能：
1. WebSocket 实时价格（Ticker）
2. WebSocket 订单簿深度（Depth）
3. WebSocket 强平/爆仓事件（ForceOrder）
4. REST API 资金费率
5. REST API 24h 行情数据

所有数据推送到 Redis Stream 供 Agent 消费
"""
import json
import asyncio
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional

import aiohttp
import websockets

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger("BinanceCollector")

# 导入配置
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import CORE_SYMBOLS, REDIS_URL, DATA_DIR

# ============================================
# Redis Stream 推送（如果 Redis 不可用则降级到文件）
# ============================================
try:
    import redis
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    USE_REDIS = True
    logger.info("✅ Redis 连接成功")
except Exception as e:
    USE_REDIS = False
    logger.warning(f"⚠️ Redis 不可用，降级为文件存储: {e}")


def push_to_stream(stream: str, data: dict):
    """推送数据到 Redis Stream"""
    payload = {k: str(v) for k, v in data.items()}
    if USE_REDIS:
        try:
            redis_client.xadd(stream, payload, maxlen=10000)
        except Exception as e:
            logger.error(f"Redis 推送失败: {e}")
            _save_to_file(stream, data)
    else:
        _save_to_file(stream, data)


def _save_to_file(stream: str, data: dict):
    """降级：保存到文件"""
    date_str = datetime.now().strftime("%Y-%m-%d")
    filepath = DATA_DIR / f"{stream}-{date_str}.jsonl"
    with open(filepath, "a") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")


# ============================================
# 1. WebSocket 实时价格采集
# ============================================
async def collect_ticker(symbols: List[str]):
    """
    订阅 miniTicker 流，获取实时价格
    推送到 Redis Stream: stream:binance:ticker
    """
    streams = "/".join([f"{s.lower()}@miniTicker" for s in symbols])
    url = f"wss://stream.binance.com:9443/stream?streams={streams}"
    
    logger.info(f"📡 启动 Ticker 采集: {len(symbols)} 个交易对")
    
    while True:
        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                logger.info("✅ Ticker WebSocket 已连接")
                async for msg in ws:
                    data = json.loads(msg)
                    ticker = data.get("data", {})
                    symbol = ticker.get("s", "")
                    
                    record = {
                        "type": "ticker",
                        "symbol": symbol,
                        "price": ticker.get("c", "0"),
                        "volume_24h": ticker.get("v", "0"),
                        "quote_volume_24h": ticker.get("q", "0"),
                        "change_pct": ticker.get("P", "0"),
                        "high_24h": ticker.get("h", "0"),
                        "low_24h": ticker.get("l", "0"),
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    push_to_stream("stream:binance:ticker", record)
                    
        except websockets.ConnectionClosed:
            logger.warning("⚠️ Ticker 连接断开，5秒后重连...")
            await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"❌ Ticker 错误: {e}")
            await asyncio.sleep(10)


# ============================================
# 2. WebSocket 订单簿深度采集
# ============================================
async def collect_depth(symbols: List[str], level: int = 20):
    """
    订阅 depth 流，获取订单簿深度
    推送到 Redis Stream: stream:binance:depth
    """
    streams = "/".join([f"{s.lower()}@depth{level}@100ms" for s in symbols])
    url = f"wss://fstream.binance.com/stream?streams={streams}"
    
    logger.info(f"📡 启动 Depth 采集: {len(symbols)} 个交易对")
    
    while True:
        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                logger.info("✅ Depth WebSocket 已连接")
                async for msg in ws:
                    data = json.loads(msg)
                    depth_data = data.get("data", {})
                    symbol = depth_data.get("s", "")
                    bids = depth_data.get("b", [])[:5]  # 只取前5档
                    asks = depth_data.get("a", [])[:5]
                    
                    record = {
                        "type": "depth",
                        "symbol": symbol,
                        "best_bid": bids[0][0] if bids else "0",
                        "best_ask": asks[0][0] if asks else "0",
                        "spread": float(asks[0][0]) - float(bids[0][0]) if bids and asks else 0,
                        "bid_depth_5": sum(float(b[1]) for b in bids),
                        "ask_depth_5": sum(float(a[1]) for a in asks),
                        "bid_ask_ratio": (sum(float(b[1]) for b in bids) / max(sum(float(a[1]) for a in asks), 0.001)),
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    push_to_stream("stream:binance:depth", record)
                    
        except websockets.ConnectionClosed:
            logger.warning("⚠️ Depth 连接断开，5秒后重连...")
            await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"❌ Depth 错误: {e}")
            await asyncio.sleep(10)


# ============================================
# 3. WebSocket 强平/爆仓事件
# ============================================
async def collect_liquidations(symbols: List[str]):
    """
    订阅 forceOrder 流，监控强平/爆仓事件
    大量爆仓往往预示趋势反转（或加速）
    推送到 Redis Stream: stream:binance:liquidation
    """
    streams = "/".join([f"{s.lower()}@forceOrder" for s in symbols])
    url = f"wss://fstream.binance.com/stream?streams={streams}"
    
    logger.info(f"📡 启动 Liquidation 采集: {len(symbols)} 个交易对")
    
    while True:
        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                logger.info("✅ Liquidation WebSocket 已连接")
                async for msg in ws:
                    data = json.loads(msg)
                    order = data.get("data", {}).get("o", {})
                    
                    record = {
                        "type": "liquidation",
                        "symbol": order.get("s", ""),
                        "side": order.get("S", ""),       # BUY/SELL
                        "price": order.get("p", "0"),
                        "quantity": order.get("q", "0"),
                        "value_usdt": float(order.get("p", 0)) * float(order.get("q", 0)),
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    
                    # 只推送 > $10k 的爆仓（过滤噪音）
                    if record["value_usdt"] >= 10000:
                        push_to_stream("stream:binance:liquidation", record)
                        logger.info(f"💥 大额爆仓: {record['symbol']} {record['side']} ${record['value_usdt']:,.0f}")
                    
        except websockets.ConnectionClosed:
            logger.warning("⚠️ Liquidation 连接断开，5秒后重连...")
            await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"❌ Liquidation 错误: {e}")
            await asyncio.sleep(10)


# ============================================
# 4. REST API 资金费率（定时采集）
# ============================================
async def collect_funding_rate(symbols: List[str], interval: int = 300):
    """
    每 interval 秒获取一次资金费率
    采集全市场费率（不再只采8个币），用于：
    1. 核心币种的常规费率监控
    2. 发现山寨币的极端费率信号
    
    推送到 Redis Stream: stream:binance:funding
    """
    logger.info(f"📡 启动 Funding Rate 采集 (全市场): 每 {interval}s")
    
    async with aiohttp.ClientSession() as session:
        while True:
            try:
                url = "https://fapi.binance.com/fapi/v1/premiumIndex"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        all_rates = await resp.json()
                        
                        core_set = set(symbols)
                        extreme_count = 0
                        
                        for item in all_rates:
                            sym = item["symbol"]
                            rate = float(item.get("lastFundingRate", 0))
                            
                            # 核心币种：始终记录
                            # 非核心币种：只在费率极端时记录(节省Redis空间)
                            is_core = sym in core_set
                            is_extreme = abs(rate) >= 0.002  # ≥0.2% 算极端
                            
                            if not is_core and not is_extreme:
                                continue
                            
                            record = {
                                "type": "funding_rate",
                                "symbol": sym,
                                "rate": rate,
                                "rate_pct": f"{rate * 100:.4f}%",
                                "mark_price": item.get("markPrice", "0"),
                                "index_price": item.get("indexPrice", "0"),
                                "next_funding_time": item.get("nextFundingTime", ""),
                                "timestamp": datetime.utcnow().isoformat(),
                            }
                            
                            # 异常费率预警
                            if abs(rate) >= 0.001:
                                if rate > 0.003:
                                    direction = "🔴 极度看多(多头拥挤)"
                                elif rate < -0.003:
                                    direction = "🟢 极度看空(空头拥挤)"
                                elif rate > 0.001:
                                    direction = "🟡 偏多"
                                else:
                                    direction = "🟡 偏空"
                                record["alert"] = direction
                                extreme_count += 1
                                if not is_core or abs(rate) >= 0.003:
                                    logger.info(f"💰 费率异常: {sym} {rate*100:.4f}% {direction}")
                            
                            push_to_stream("stream:binance:funding", record)
                        
                        logger.debug(f"Funding采集完成: {len(all_rates)}币种, {extreme_count}个异常")
                    else:
                        logger.warning(f"资金费率请求失败: HTTP {resp.status}")
                        
            except Exception as e:
                logger.error(f"❌ Funding Rate 错误: {e}")
            
            await asyncio.sleep(interval)


# ============================================
# 5. REST API 24h 行情快照（定时采集）
# ============================================
async def collect_24h_ticker(interval: int = 60):
    """
    每分钟获取一次全市场24h行情快照
    用于币种筛选和异常检测
    """
    logger.info(f"📡 启动 24h Ticker 采集: 每 {interval}s")
    
    async with aiohttp.ClientSession() as session:
        while True:
            try:
                url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        tickers = await resp.json()
                        
                        # 保存完整快照
                        snapshot = {
                            "type": "market_snapshot",
                            "total_pairs": len(tickers),
                            "timestamp": datetime.utcnow().isoformat(),
                            "top_volume": [],
                            "top_gainers": [],
                            "top_losers": [],
                        }
                        
                        # 按24h成交额排序取 Top 50
                        usdt_pairs = [t for t in tickers if t["symbol"].endswith("USDT")]
                        by_volume = sorted(usdt_pairs, key=lambda x: float(x.get("quoteVolume", 0)), reverse=True)
                        snapshot["top_volume"] = [
                            {"symbol": t["symbol"], "volume": float(t.get("quoteVolume", 0)), "price": t.get("lastPrice", "0")}
                            for t in by_volume[:50]
                        ]
                        
                        # 涨幅 Top 10
                        by_change = sorted(usdt_pairs, key=lambda x: float(x.get("priceChangePercent", 0)), reverse=True)
                        snapshot["top_gainers"] = [
                            {"symbol": t["symbol"], "change_pct": float(t.get("priceChangePercent", 0))}
                            for t in by_change[:10]
                        ]
                        
                        # 跌幅 Top 10
                        snapshot["top_losers"] = [
                            {"symbol": t["symbol"], "change_pct": float(t.get("priceChangePercent", 0))}
                            for t in by_change[-10:]
                        ]
                        
                        push_to_stream("stream:binance:market", snapshot)
                        
                        # 异常检测：成交量突增 > 200%
                        for t in usdt_pairs:
                            vol_change = float(t.get("volume", 0))
                            # 这里可以做更复杂的异常检测
                        
                    else:
                        logger.warning(f"24h Ticker 请求失败: HTTP {resp.status}")
                        
            except Exception as e:
                logger.error(f"❌ 24h Ticker 错误: {e}")
            
            await asyncio.sleep(interval)


# ============================================
# 6. WebSocket 标记价格（用于止损/止盈计算）
# ============================================
async def collect_mark_price(symbols: List[str]):
    """
    订阅 markPrice 流，获取标记价格
    """
    streams = "/".join([f"{s.lower()}@markPrice@1s" for s in symbols])
    url = f"wss://fstream.binance.com/stream?streams={streams}"
    
    logger.info(f"📡 启动 MarkPrice 采集: {len(symbols)} 个交易对")
    
    while True:
        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                logger.info("✅ MarkPrice WebSocket 已连接")
                async for msg in ws:
                    data = json.loads(msg)
                    mp = data.get("data", {})
                    
                    record = {
                        "type": "mark_price",
                        "symbol": mp.get("s", ""),
                        "mark_price": mp.get("p", "0"),
                        "index_price": mp.get("i", "0"),
                        "funding_rate": mp.get("r", "0"),
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    push_to_stream("stream:binance:mark", record)
                    
        except websockets.ConnectionClosed:
            logger.warning("⚠️ MarkPrice 连接断开，5秒后重连...")
            await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"❌ MarkPrice 错误: {e}")
            await asyncio.sleep(10)


# ============================================
# 主启动器
# ============================================
async def main():
    """启动所有采集任务"""
    symbols = CORE_SYMBOLS
    
    logger.info("🌀 小风交易系统 - Binance 数据采集器启动")
    logger.info(f"📊 监控币种: {', '.join(symbols)}")
    logger.info(f"📊 运行模式: 数据采集")
    
    # 并行运行所有采集任务
    await asyncio.gather(
        collect_ticker(symbols),
        collect_depth(symbols),
        collect_liquidations(symbols),
        collect_mark_price(symbols),
        collect_funding_rate(symbols, interval=300),   # 5分钟
        collect_24h_ticker(interval=60),               # 1分钟
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("👋 采集器已停止")
