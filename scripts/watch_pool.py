"""
重点监控池 + 小周期突破触发 v21

流程：
1. 全市场扫描 → 找到有强烈启动前信号的币 → 加入监控池
2. 监控池里的币，用1h/15m小周期监控突破
3. 一旦小周期突破 → 立即触发买入信号

关键：
- 监控池是持续更新的（每轮扫描都会刷新）
- 小周期突破比日线快得多，适合山寨币
- 4h确认方向 + 15m触发入场
"""

import json
import time
import logging
import asyncio
import aiohttp
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

import sys
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR

logger = logging.getLogger("WatchPool")

WATCH_FILE = DATA_DIR / "watch_pool.json"


@dataclass
class WatchCoin:
    """监控池中的币种"""
    symbol: str
    added_at: str           # 加入时间
    prelaunch_score: int    # 启动前信号分数
    prelaunch_phase: str    # 阶段（吸筹/洗盘/变盘前夜）
    prelaunch_detail: str   # 详情
    big_trend: str          # 4h趋势（uptrend/downtrend/neutral）
    key_levels: dict        # 关键价位 {support, resistance, entry_zone}
    watch_1h_high: float = 0.0   # 1h监控区间上沿
    watch_1h_low: float = 0.0    # 1h监控区间下沿
    watch_15m_high: float = 0.0  # 15m监控区间上沿
    watch_15m_low: float = 0.0   # 15m监控区间下沿
    triggered: bool = False      # 是否已触发
    triggered_at: str = ""       # 触发时间
    triggered_price: float = 0.0 # 触发价格
    triggered_tf: str = ""       # 触发周期
    trigger_type: str = ""       # 触发类型
    expire_at: str = ""          # 过期时间（24h后移出）


def _load_pool() -> dict:
    if WATCH_FILE.exists():
        try:
            return json.loads(WATCH_FILE.read_text())
        except:
            pass
    return {"version": 1, "coins": [], "stats": {"total_added": 0, "total_triggered": 0}}


def _save_pool(data: dict):
    WATCH_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def add_to_watch_pool(
    symbol: str,
    prelaunch_score: int,
    prelaunch_phase: str,
    prelaunch_detail: str,
    big_trend: str = "neutral",
    key_levels: dict = None,
) -> bool:
    """加入监控池"""
    data = _load_pool()
    now = datetime.now(timezone.utc)
    
    # 检查是否已在池中
    for c in data["coins"]:
        if c["symbol"] == symbol and not c.get("triggered"):
            # 更新信息
            c["prelaunch_score"] = max(c.get("prelaunch_score", 0), prelaunch_score)
            c["prelaunch_phase"] = prelaunch_phase
            c["prelaunch_detail"] = prelaunch_detail
            c["big_trend"] = big_trend
            _save_pool(data)
            return False  # 已存在，只更新
    
    expire = now + timedelta(hours=24)
    
    coin = WatchCoin(
        symbol=symbol,
        added_at=now.isoformat(),
        prelaunch_score=prelaunch_score,
        prelaunch_phase=prelaunch_phase,
        prelaunch_detail=prelaunch_detail,
        big_trend=big_trend,
        key_levels=key_levels or {},
        expire_at=expire.isoformat(),
    )
    
    data["coins"].append(asdict(coin))
    data["stats"]["total_added"] = data["stats"].get("total_added", 0) + 1
    
    # 清理过期和已触发的（保留最近100条）
    data["coins"] = [c for c in data["coins"] if not c.get("triggered", False)][:50]
    
    _save_pool(data)
    logger.info(f"👀 加入监控池: {symbol} {prelaunch_phase}(score={prelaunch_score})")
    return True


def get_active_watches() -> list:
    """获取活跃的监控币种（未触发+未过期）"""
    data = _load_pool()
    now = datetime.now(timezone.utc)
    
    active = []
    for c in data["coins"]:
        if c.get("triggered"):
            continue
        try:
            expire = datetime.fromisoformat(c["expire_at"])
            if now > expire:
                continue
        except:
            continue
        active.append(c)
    
    return active


def mark_triggered(symbol: str, price: float, tf: str, trigger_type: str):
    """标记为已触发"""
    data = _load_pool()
    now = datetime.now(timezone.utc)
    
    for c in data["coins"]:
        if c["symbol"] == symbol and not c.get("triggered"):
            c["triggered"] = True
            c["triggered_at"] = now.isoformat()
            c["triggered_price"] = price
            c["triggered_tf"] = tf
            c["trigger_type"] = trigger_type
            data["stats"]["total_triggered"] = data["stats"].get("total_triggered", 0) + 1
            _save_pool(data)
            logger.info(f"🚀 触发: {symbol} {trigger_type} @{price:.4f} ({tf})")
            return True
    
    _save_pool(data)
    return False


# =============================================
# 小周期突破扫描
# =============================================
async def scan_watch_pool_breakouts(session: aiohttp.ClientSession = None):
    """扫描监控池中的币种，检测小周期突破"""
    active = get_active_watches()
    if not active:
        return []
    
    close_session = False
    if session is None:
        session = aiohttp.ClientSession()
        close_session = True
    
    triggers = []
    
    try:
        for coin in active:
            symbol = coin["symbol"]
            
            # 获取5m/15m/1h K线（多周期扫描）
            for tf, interval, min_bars in [("5m", "5m", 60), ("15m", "15m", 50), ("1h", "1h", 30)]:
                try:
                    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval={interval}&limit={min_bars}"
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                        raw = await resp.json()
                    
                    if not raw or len(raw) < 20:
                        continue
                    
                    klines = [{"open": k[1], "high": k[2], "low": k[3], "close": k[4], "volume": k[5]} for k in raw]
                    
                    # 检测突破
                    trigger = _check_small_tf_breakout(symbol, klines, tf, coin)
                    if trigger:
                        triggers.append(trigger)
                        break  # 已触发，不需要检查更小周期
                    
                except Exception as e:
                    logger.debug(f"扫描 {symbol} {tf} 失败: {e}")
                    continue
            
            # 避免API限频
            await asyncio.sleep(0.3)
    
    finally:
        if close_session:
            await session.close()
    
    return triggers


def _check_small_tf_breakout(symbol: str, klines: list, tf: str, coin: dict) -> Optional[dict]:
    """
    检测小周期突破
    
    触发条件：
    1. 最近5根K线形成横盘/收敛
    2. 最新一根K线放量突破横盘上沿
    3. 大趋势向上（4h uptrend）
    """
    closes = [float(k['close']) for k in klines]
    highs = [float(k['high']) for k in klines]
    lows = [float(k['low']) for k in klines]
    volumes = [float(k['volume']) for k in klines]
    
    if len(closes) < 20:
        return None
    
    # 最近K线形成横盘区间（5m看15根, 15m看10根, 1h看10根）
    recent = {"5m": 15, "15m": 10, "1h": 10}.get(tf, 10)
    recent_highs = highs[-recent-1:-1]  # 排除最新一根
    recent_lows = lows[-recent-1:-1]
    recent_volumes = volumes[-recent-1:-1]
    
    zone_high = max(recent_highs)
    zone_low = min(recent_lows)
    zone_mid = (zone_high + zone_low) / 2
    
    if zone_mid == 0:
        return None
    
    amplitude = (zone_high - zone_low) / zone_mid * 100
    
    # 横盘振幅不能太大（5m<2%, 15m<3%, 1h<4%）
    max_amp = {"5m": 2.0, "15m": 3.0, "1h": 4.0}.get(tf, 3.0)
    if amplitude > max_amp:
        return None
    
    # 最新K线
    latest_close = closes[-1]
    latest_high = highs[-1]
    latest_vol = volumes[-1]
    avg_vol = sum(recent_volumes) / len(recent_volumes) if recent_volumes else 1
    
    # ★ 突破条件
    # 1. 收盘价 > 区间上沿
    if latest_close <= zone_high:
        return None
    
    # 2. 放量突破（量 > 均量1.5倍）
    vol_ratio = latest_vol / avg_vol if avg_vol > 0 else 1
    if vol_ratio < 1.2:
        return None  # 无量突破不算
    
    # 3. 大趋势确认
    big_trend = coin.get("big_trend", "neutral")
    if big_trend == "downtrend":
        return None  # 大趋势下跌不追
    
    # 计算突破幅度
    breakout_pct = (latest_close / zone_high - 1) * 100
    
    # 标记触发
    mark_triggered(symbol, latest_close, tf, f"{tf}放量突破({breakout_pct:+.1f}%, ×{vol_ratio:.1f}量)")
    
    return {
        "symbol": symbol,
        "tf": tf,
        "price": latest_close,
        "zone_high": zone_high,
        "zone_low": zone_low,
        "amplitude": round(amplitude, 2),
        "breakout_pct": round(breakout_pct, 2),
        "vol_ratio": round(vol_ratio, 1),
        "prelaunch_score": coin.get("prelaunch_score", 0),
        "prelaunch_phase": coin.get("prelaunch_phase", ""),
        "big_trend": big_trend,
        "added_at": coin.get("added_at", ""),
        "time": datetime.now(timezone.utc).isoformat(),
    }


def get_watch_report() -> str:
    """生成监控池报告"""
    data = _load_pool()
    stats = data.get("stats", {})
    coins = data.get("coins", [])
    
    lines = []
    lines.append("👀 **监控池报告**")
    lines.append(f"总加入: {stats.get('total_added', 0)} | 已触发: {stats.get('total_triggered', 0)}")
    lines.append("")
    
    active = [c for c in coins if not c.get("triggered")]
    triggered = [c for c in coins if c.get("triggered")]
    
    if active:
        lines.append(f"**监控中({len(active)}个)**:")
        for c in active[-10:]:
            phase = c.get("prelaunch_phase", "?")
            score = c.get("prelaunch_score", 0)
            trend = c.get("big_trend", "?")
            added = c.get("added_at", "")[11:16]
            lines.append(f"  📊 {c['symbol']:12s} {phase}({score}分) 趋势={trend} 加入于{added}UTC")
    
    if triggered:
        lines.append("")
        lines.append(f"**已触发({len(triggered)}个)**:")
        for c in triggered[-5:]:
            tf = c.get("triggered_tf", "")
            price = c.get("triggered_price", 0)
            tt = c.get("trigger_type", "")
            lines.append(f"  🚀 {c['symbol']:12s} {tf} @{price:.4f} {tt}")
    
    return "\n".join(lines)
