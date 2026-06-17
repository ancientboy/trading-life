"""
统一追踪器 - 记录所有Agent的信号并统计

按 agent_type + entry_type 分组统计
"""

import json
import logging
import asyncio
import aiohttp
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List
from collections import defaultdict

import sys
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import DATA_DIR

logger = logging.getLogger("AgentTracker")

TRACKER_FILE = DATA_DIR / "agent_tracker.json"
HIT_THRESHOLD = 0.5


def _load() -> dict:
    if Path(TRACKER_FILE).exists():
        try:
            return json.loads(TRACKER_FILE.read_text())
        except:
            pass
    return {"version": 2, "signals": [], "stats": {}}


def _save(data: dict):
    TRACKER_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def record(agent_type: str, symbol: str, entry_type: str, price: float,
           score: int, reasoning: str = "", **kwargs):
    """记录信号"""
    data = _load()
    now = datetime.now(timezone.utc)
    
    # 去重（同币同类型1小时内）
    for s in reversed(data["signals"][-20:]):
        if s["symbol"] == symbol and s["entry_type"] == entry_type:
            try:
                prev = datetime.fromisoformat(s["timestamp"])
                if (now - prev).total_seconds() < 3600:
                    return
            except:
                pass
    
    signal = {
        "agent_type": agent_type,
        "symbol": symbol,
        "entry_type": entry_type,
        "entry_price": price,
        "score": score,
        "reasoning": reasoning[:200],
        "timestamp": now.isoformat(),
        "checks": {},
        "final_result": None,
    }
    signal.update(kwargs)
    
    data["signals"].append(signal)
    if len(data["signals"]) > 500:
        data["signals"] = data["signals"][-500:]
    
    _save(data)
    logger.info(f"📝 [{agent_type}] {symbol} {entry_type} @{price:.4f}")


async def check_all(session: aiohttp.ClientSession = None):
    """检查所有pending信号"""
    data = _load()
    now = datetime.now(timezone.utc)
    updated = False
    
    close = False
    if session is None:
        session = aiohttp.ClientSession()
        close = True
    
    try:
        for sig in data["signals"]:
            if sig.get("entry_price", 0) <= 0:
                continue
            sig_time = datetime.fromisoformat(sig["timestamp"])
            elapsed_h = (now - sig_time).total_seconds() / 3600
            
            for period, hours in [("4h", 4), ("8h", 8), ("24h", 24)]:
                if elapsed_h < hours:
                    continue
                if period in sig.get("checks", {}):
                    continue
                
                # 获取价格
                price = 0
                url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sig['symbol']}"
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                        price = float((await resp.json()).get('price', 0))
                except:
                    continue
                
                if price <= 0:
                    continue
                
                change = (price / sig["entry_price"] - 1) * 100
                sig.setdefault("checks", {})[period] = {
                    "price": price,
                    "change_pct": round(change, 2),
                    "hit": change >= HIT_THRESHOLD,
                }
                updated = True
            
            # 标记最终结果
            check_24h = sig.get("checks", {}).get("24h")
            if check_24h and not sig.get("final_result"):
                sig["final_result"] = "win" if check_24h["hit"] else "loss"
                updated = True
    finally:
        if close:
            await session.close()
    
    if updated:
        data["stats"] = _calc_stats(data["signals"])
        _save(data)


def _calc_stats(signals: list) -> dict:
    stats = {}
    
    # 按 agent_type 分组
    by_agent = defaultdict(list)
    for s in signals:
        if s.get("entry_price", 0) <= 0:
            continue
        by_agent[s.get("agent_type", "unknown")].append(s)
    
    for agent_type, agent_signals in by_agent.items():
        agent_stats = {
            "total": len(agent_signals),
            "by_entry_type": {},
        }
        
        # 按 entry_type 再分
        by_entry = defaultdict(list)
        for s in agent_signals:
            by_entry[s.get("entry_type", "other")].append(s)
        
        for entry_type, entry_signals in by_entry.items():
            checked_24h = [s for s in entry_signals if "24h" in s.get("checks", {})]
            if checked_24h:
                changes = [s["checks"]["24h"]["change_pct"] for s in checked_24h]
                hits = sum(1 for c in changes if c >= HIT_THRESHOLD)
                agent_stats["by_entry_type"][entry_type] = {
                    "total": len(entry_signals),
                    "checked_24h": len(checked_24h),
                    "wins": hits,
                    "win_rate": round(hits / len(checked_24h) * 100, 1) if checked_24h else 0,
                    "avg_change": round(sum(changes) / len(changes), 2),
                }
        
        stats[agent_type] = agent_stats
    
    return stats


def get_report() -> str:
    """生成对比报告"""
    data = _load()
    stats = data.get("stats", {})
    
    lines = ["📊 **多Agent追踪报告**"]
    
    for agent_type in ["major", "altcoin", "newcoin"]:
        agent_stats = stats.get(agent_type, {})
        if not agent_stats:
            continue
        
        total = agent_stats.get("total", 0)
        lines.append(f"\n**{agent_type.upper()}** ({total}条信号)")
        
        for et, es in agent_stats.get("by_entry_type", {}).items():
            wr = es.get("win_rate", 0)
            avg = es.get("avg_change", 0)
            checked = es.get("checked_24h", 0)
            lines.append(f"  {et}: {checked}条已检 | 胜率{wr}% | 平均{avg:+.2f}%")
    
    # 最近信号
    recent = data.get("signals", [])[-5:]
    if recent:
        lines.append("\n**最近信号**:")
        for s in reversed(recent):
            chks = " ".join(f"{k}:{v['change_pct']:+.1f}%" for k, v in s.get("checks", {}).items())
            lines.append(f"  [{s.get('agent_type','')}] {s['symbol']} {s.get('entry_type','')} {chks or 'pending'}")
    
    return "\n".join(lines)
