"""
小风交易系统 - 分析师 Agent (Part 1: 数据采集)

从 Binance REST API 获取多维度分析数据：
- 多周期K线 (1m/5m/15m/1h/4h/1d)
- 深度订单簿 (500档)
- 近期成交 (大单检测)
"""
import asyncio
import aiohttp
import logging
import time
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

logger = logging.getLogger("AnalystAgent")

# Binance Futures 基础 URL
FAPI_BASE = "https://fapi.binance.com"

# 分析用的K线周期
KLINE_INTERVALS = {
    "1m":  {"limit": 120, "label": "1分钟"},
    "5m":  {"limit": 96,  "label": "5分钟"},
    "15m": {"limit": 200, "label": "15分钟"},
    "1h":  {"limit": 120, "label": "1小时"},
    "4h":  {"limit": 600, "label": "4小时"},  # 600根×4h=100天，EMA576需要~96天数据
    "1d":  {"limit": 30,  "label": "日线"},
}


async def fetch_klines(session: aiohttp.ClientSession, symbol: str, 
                       interval: str, limit: int = 100) -> List[dict]:
    """获取K线数据，返回标准化字典列表"""
    url = f"{FAPI_BASE}/fapi/v1/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    
    async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
        raw = await resp.json()
    
    result = []
    for k in raw:
        result.append({
            "open_time": k[0],
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),        # 成交量(币)
            "close_time": k[6],
            "quote_volume": float(k[7]),   # 成交额(USDT)
            "trades": int(k[8]),
            "taker_buy_vol": float(k[9]),  # 主动买入量
            "taker_buy_qv": float(k[10]),  # 主动买入额
            # 计算字段
            "taker_sell_vol": float(k[5]) - float(k[9]),
            "body": float(k[4]) - float(k[1]),
            "upper_shadow": float(k[2]) - max(float(k[1]), float(k[4])),
            "lower_shadow": min(float(k[1]), float(k[4])) - float(k[3]),
            "range": float(k[2]) - float(k[3]),
        })
    return result


async def fetch_depth(session: aiohttp.ClientSession, symbol: str, 
                      limit: int = 500) -> dict:
    """获取深度订单簿"""
    url = f"{FAPI_BASE}/fapi/v1/depth"
    params = {"symbol": symbol, "limit": limit}
    
    async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
        data = await resp.json()
    
    bids = [(float(b[0]), float(b[1])) for b in data.get("bids", [])]
    asks = [(float(a[0]), float(a[1])) for a in data.get("asks", [])]
    
    return {"bids": bids, "asks": asks, "timestamp": data.get("E", 0)}


async def fetch_recent_trades(session: aiohttp.ClientSession, symbol: str, 
                              limit: int = 200) -> List[dict]:
    """获取近期成交"""
    url = f"{FAPI_BASE}/fapi/v1/aggTrades"
    params = {"symbol": symbol, "limit": limit}
    
    async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
        raw = await resp.json()
    
    return [{
        "price": float(t["p"]),
        "qty": float(t["q"]),
        "time": t["T"],
        "is_buyer_maker": t["m"],  # True=卖出方是maker(主动买入)
    } for t in raw]


async def fetch_funding_and_mark(session: aiohttp.ClientSession, symbol: str) -> dict:
    """获取资金费率和标记价格"""
    url = f"{FAPI_BASE}/fapi/v1/premiumIndex"
    params = {"symbol": symbol}
    
    async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
        data = await resp.json()
    
    return {
        "mark_price": float(data.get("markPrice", 0)),
        "index_price": float(data.get("indexPrice", 0)),
        "funding_rate": float(data.get("lastFundingRate", 0)),
        "next_funding_time": data.get("nextFundingTime", 0),
        "basis": float(data.get("markPrice", 0)) - float(data.get("indexPrice", 0)),
    }


async def fetch_open_interest(session: aiohttp.ClientSession, symbol: str) -> dict:
    """获取持仓量"""
    url = f"{FAPI_BASE}/fapi/v1/openInterest"
    params = {"symbol": symbol}
    
    try:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            data = await resp.json()
        return {"open_interest": float(data.get("openInterest", 0))}
    except:
        return {"open_interest": 0}


async def collect_all_analysis(session: aiohttp.ClientSession, symbol: str) -> dict:
    """收集单个币种的全部分析数据"""
    tasks = []
    
    # K线多周期
    for interval, cfg in KLINE_INTERVALS.items():
        tasks.append(fetch_klines(session, symbol, interval, cfg["limit"]))
    
    # 订单簿 + 成交 + 费率 + 持仓量
    tasks.append(fetch_depth(session, symbol, 500))
    tasks.append(fetch_recent_trades(session, symbol, 200))
    tasks.append(fetch_funding_and_mark(session, symbol))
    tasks.append(fetch_open_interest(session, symbol))
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    kline_data = {}
    interval_keys = list(KLINE_INTERVALS.keys())
    for i, interval in enumerate(interval_keys):
        if isinstance(results[i], Exception):
            logger.warning(f"K线 {interval} 获取失败: {results[i]}")
            kline_data[interval] = []
        else:
            kline_data[interval] = results[i]
    
    depth_data = results[len(interval_keys)] if not isinstance(results[len(interval_keys)], Exception) else {"bids": [], "asks": []}
    trades_data = results[len(interval_keys)+1] if not isinstance(results[len(interval_keys)+1], Exception) else []
    funding_data = results[len(interval_keys)+2] if not isinstance(results[len(interval_keys)+2], Exception) else {}
    oi_data = results[len(interval_keys)+3] if not isinstance(results[len(interval_keys)+3], Exception) else {}
    
    return {
        "symbol": symbol,
        "timestamp": int(time.time() * 1000),
        "klines": kline_data,
        "depth": depth_data,
        "trades": trades_data,
        "funding": funding_data,
        "open_interest": oi_data,
    }
