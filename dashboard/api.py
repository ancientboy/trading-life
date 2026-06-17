"""
Trading Agent Dashboard API v2
以 Agent 为核心维度，每个 agent 独立展示
"""
import json
import os
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import aiofiles
import aiohttp

# ============================================================
# 配置
# ============================================================
BASE_DIR = Path(os.environ.get("TRADING_AGENT_ROOT", "/opt/trading-agent"))
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"
AGENTS_DIR = BASE_DIR / "scripts" / "agents"

OPENCLAW_URL = os.environ.get("OPENCLAW_URL", "http://localhost:18789")
OPENCLAW_TOKEN = os.environ.get("OPENCLAW_TOKEN", "")
OPENCLAW_SESSION = os.environ.get("OPENCLAW_SESSION", "main")

# Zhipu API for chat
ZHIPU_API_KEY = os.environ.get("ZHIPU_API_KEY", "")
if not ZHIPU_API_KEY:
    try:
        with open("/root/.openclaw/openclaw.json") as f:
            _cfg = json.load(f)
        ZHIPU_API_KEY = _cfg.get("env", {}).get("ZHIPU_API_KEY", "")
    except:
        pass

CHAT_SYSTEM_PROMPT = """你是炮炮（Pào Pào），Trading Agent 系统的 AI 助手。你可以帮用户查看和管理交易 Agent。

当前系统有5个 Agent：
- XAU Agent: 黄金趋势交易
- Major Agent: 主流币(BTC/ETH)趋势跟踪+反转
- Altcoin Agent: 山寨币结构突破+埋伏
- Newcoin Agent: 新币上市捕获
- Momentum Agent: 动量快钱/波段，Trailing止盈

用户可能会问你交易状态、参数调整、重启进程等。你需要先调用相关 API 获取实时数据再回答。
当前数据目录: /opt/trading-agent/data/
脚本目录: /opt/trading-agent/scripts/
"""

app = FastAPI(title="Trading Agent Dashboard v2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Agent 定义
# ============================================================
AGENTS = {
    "xau": {
        "id": "xau",
        "name": "XAU Agent",
        "icon": "🥇",
        "desc": "黄金趋势交易 - 基于结构突破 + EMA 趋势跟踪",
        "state_file": "agent_xau_state.json",
        "strategy": "趋势跟踪",
        "market": "黄金(XAUUSDT)",
        "interval": "15m/1h/4h",
        "risk": "中",
    },
    "major": {
        "id": "major",
        "name": "Major Agent",
        "icon": "₿",
        "desc": "主流币趋势交易 - BTC/ETH 等大市值币种的趋势跟踪与反转",
        "state_file": "agent_major_state.json",
        "strategy": "趋势跟踪 + 反转",
        "market": "BTC/ETH 等主流币",
        "interval": "1h/4h",
        "risk": "中",
    },
    "altcoin": {
        "id": "altcoin",
        "name": "Altcoin Agent",
        "icon": "🚀",
        "desc": "山寨币突破交易 - 监控池结构突破 + 启动前信号埋伏",
        "state_file": "agent_altcoin_state.json",
        "strategy": "结构突破 + 埋伏",
        "market": "山寨币",
        "interval": "5m/15m/1h",
        "risk": "高",
    },
    "newcoin": {
        "id": "newcoin",
        "name": "Newcoin Agent",
        "icon": "✨",
        "desc": "新币上市交易 - 新上线币种的初期波动捕获",
        "state_file": "agent_newcoin_state.json",
        "strategy": "新币捕获",
        "market": "新上线币种",
        "interval": "5m/15m",
        "risk": "极高",
    },
    "momentum": {
        "id": "momentum",
        "name": "Momentum Agent",
        "icon": "⚡",
        "desc": "动量快钱/波段交易 - 急涨追入 + Trailing 止盈",
        "state_file": "agent_momentum_state.json",
        "strategy": "动量追涨 + Trailing",
        "market": "全市场(527币)",
        "interval": "5m/15m",
        "risk": "高",
    },
}

CST = timezone(timedelta(hours=8))

# ============================================================
# 工具函数
# ============================================================
def safe_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except:
        return default or {}

def safe_jsonl(path: Path, limit=200):
    lines = []
    if not path.exists():
        return lines
    try:
        with open(path) as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - limit * 600))
            raw = f.readlines()
            for line in raw[-limit:]:
                line = line.strip()
                if line:
                    try:
                        lines.append(json.loads(line))
                    except:
                        pass
    except:
        pass
    return lines

def get_agent_full_info(agent_id: str) -> dict:
    """获取 agent 完整信息（含 meta + state）"""
    meta = AGENTS.get(agent_id)
    if not meta:
        return None
    
    state = safe_json(DATA_DIR / meta["state_file"])
    if not state:
        return {**meta, "capital": 0, "initial_capital": 0, "pnl": 0, "pnl_pct": 0,
                "trades": 0, "wins": 0, "win_rate": 0, "is_circuit_break": False,
                "consecutive_losses": 0, "positions": [], "pending_orders": [],
                "trades_history": [], "running": False, "process_pid": None}
    
    capital = state.get("capital", 0)
    initial = state.get("initial_capital", 0)
    pnl = capital - initial
    pnl_pct = (pnl / initial * 100) if initial else 0
    trades = state.get("total_trades", 0)
    wins = state.get("total_wins", 0)
    wr = (wins / trades * 100) if trades else 0
    
    # positions
    positions = []
    for p in state.get("active_positions", []):
        positions.append({
            "symbol": "XAUUSDT",
            "direction": p.get("direction", ""),
            "entry_price": p.get("entry_price", 0),
            "pnl_pct": p.get("pnl_pct", 0),
            "reason": p.get("reason", ""),
        })
    for sym, p in state.get("positions", {}).items():
        if isinstance(p, dict):
            positions.append({
                "symbol": p.get("symbol", sym),
                "direction": p.get("direction", ""),
                "entry_price": p.get("entry_price", 0),
                "quantity": p.get("quantity", 0),
                "leverage": p.get("leverage", 0),
                "stop_loss": p.get("stop_loss", 0),
                "entry_type": p.get("entry_type", ""),
                "entry_reasoning": p.get("entry_reasoning", ""),
            })
    
    # history
    history = state.get("trades_history", state.get("trade_history", []))
    if not isinstance(history, list):
        history = []
    
    return {
        **meta,
        "capital": capital,
        "initial_capital": initial,
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "trades": trades,
        "wins": wins,
        "win_rate": wr,
        "is_circuit_break": state.get("is_circuit_break", False),
        "consecutive_losses": state.get("consecutive_losses", 0),
        "positions": positions,
        "pending_orders": state.get("pending_orders", []),
        "trades_history": history[-50:],
        "running": _is_agent_running(agent_id),
        "process_pid": _get_agent_pid(agent_id),
        "updated_at": state.get("updated_at", ""),
    }

def _is_agent_running(agent_id: str) -> bool:
    """检查 agent 是否在运行"""
    try:
        result = subprocess.run(
            ["pgrep", "-f", f"{agent_id}"],
            capture_output=True, text=True
        )
        return result.returncode == 0
    except:
        return False

def _is_runner_running():
    try:
        result = subprocess.run(["pgrep", "-f", "multi_agent_runner"], capture_output=True, text=True)
        return result.returncode == 0
    except:
        return False

def _get_agent_pid(agent_id: str) -> Optional[int]:
    try:
        result = subprocess.run(
            ["pgrep", "-f", f"{agent_id}"],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            pids = result.stdout.strip().split('\n')
            return int(pids[0]) if pids[0] else None
    except:
        pass
    return None

# ============================================================
# REST API
# ============================================================
@app.get("/api/overview")
async def overview():
    """总览 - 所有agent概要"""
    agents = []
    total_capital = 0
    total_initial = 0
    total_trades = 0
    total_wins = 0
    
    for aid in AGENTS:
        info = get_agent_full_info(aid)
        if info:
            agents.append(info)
            total_capital += info["capital"]
            total_initial += info["initial_capital"]
            total_trades += info["trades"]
            total_wins += info["wins"]
    
    risk = safe_json(DATA_DIR / "risk_state.json")
    screener = safe_json(DATA_DIR / "smart_screener_results.json")
    
    return {
        "timestamp": datetime.now(CST).isoformat(),
        "total_capital": total_capital,
        "total_initial": total_initial,
        "total_pnl": total_capital - total_initial,
        "total_pnl_pct": (total_capital - total_initial) / total_initial * 100 if total_initial else 0,
        "total_trades": total_trades,
        "total_wins": total_wins,
        "total_wr": (total_wins / total_trades * 100) if total_trades else 0,
        "agents": agents,
        "risk": {
            "daily_pnl": risk.get("daily_pnl", 0),
            "circuit_break": risk.get("is_circuit_break", False),
            "consecutive_losses": risk.get("consecutive_losses", 0),
            "total_realized_pnl": risk.get("stats_total_realized_pnl", 0),
        },
        "screener": {
            "timestamp": screener.get("timestamp", ""),
            "tiers": screener.get("tiers", {}),
            "total_coins": screener.get("total_coins", 0),
        },
        "runner": {
            "running": _is_runner_running(),
        },
    }

@app.get("/api/agent/{name}")
async def agent_detail(name: str):
    """Agent 完整详情"""
    info = get_agent_full_info(name.lower())
    if not info:
        return {"error": f"Unknown agent: {name}"}
    return info

@app.get("/api/agent/{name}/trades")
async def agent_trades(name: str, limit: int = Query(default=50, le=200)):
    """某个 Agent 的交易记录（从 state 的 trades_history）"""
    info = get_agent_full_info(name.lower())
    if not info:
        return {"error": f"Unknown agent: {name}"}
    history = info.get("trades_history", [])
    return {"agent": name, "trades": history[-limit:], "count": len(history)}

@app.get("/api/trades")
async def trades(limit: int = Query(default=100, le=500)):
    """全部交易记录（trade-log.jsonl）"""
    trades = safe_jsonl(DATA_DIR / "trade-log.jsonl", limit)
    return {"trades": trades, "count": len(trades)}

@app.get("/api/signals")
async def signals():
    """信号追踪 - 按 agent 分组"""
    tracker = safe_json(DATA_DIR / "agent_tracker.json")
    raw = tracker.get("signals", [])
    stats = tracker.get("stats", {})
    
    if isinstance(raw, list):
        # 按 agent_type 分组
        grouped = {}
        for s in raw:
            agent = s.get("agent_type", "unknown")
            if agent not in grouped:
                grouped[agent] = []
            grouped[agent].append(s)
        # 每组取最近50条
        for k in grouped:
            grouped[k] = grouped[k][-50:]
        return {"signals_by_agent": grouped, "stats": stats, "total": len(raw)}
    else:
        return {"signals_by_agent": {"unknown": dict(list(raw.items())[-50:])}, "stats": stats, "total": len(raw)}

@app.get("/api/watchpool")
async def watchpool():
    """监控池 - 按 prelaunch_phase 分组"""
    wp = safe_json(DATA_DIR / "watch_pool.json")
    if not wp:
        return {"coins": [], "groups": {}, "total": 0}
    
    coins = wp.get("coins", [])
    
    # 按 prelaunch_phase 分组
    groups = {}
    for c in coins:
        phase = c.get("prelaunch_phase", "其他")
        if phase not in groups:
            groups[phase] = []
        groups[phase].append(c)
    
    return {"coins": coins, "groups": groups, "total": len(coins)}

@app.get("/api/screener")
async def screener():
    """选币器 - 含分级说明"""
    sc = safe_json(DATA_DIR / "smart_screener_results.json")
    if not sc:
        return {"tiers": {}, "total_coins": 0, "tier_descriptions": {}}
    
    # 分级说明
    tier_descriptions = {
        "S": "顶级 - 多维度高分：强趋势 + 高成交量 + 技术面完美突破，适合重仓",
        "A": "优质 - 趋势明确 + 成交量配合 + 技术面较好，适合正常仓位",
        "B": "中等 - 有一定趋势但信号不够强，适合轻仓试水",
        "C": "观察 - 信号较弱或趋势不明朗，仅作观察",
    }
    
    return {
        "timestamp": sc.get("timestamp", ""),
        "tiers": sc.get("tiers", {}),
        "total_coins": sc.get("total_coins", 0),
        "tier_descriptions": tier_descriptions,
    }

@app.get("/api/logs")
async def logs(lines: int = Query(default=100, le=500)):
    """最近日志"""
    # 合并所有日志
    all_lines = []
    for log_file in LOG_DIR.glob("*.log"):
        try:
            text = log_file.read_text()
            file_lines = text.strip().split("\n")
            all_lines.extend(file_lines[-lines//2:])
        except:
            pass
    all_lines = sorted(all_lines)[-lines:]
    return {"logs": all_lines, "count": len(all_lines)}

@app.get("/api/ticker")
async def ticker():
    """实时价格"""
    symbols = ["XAUUSDT", "BTCUSDT", "ETHUSDT"]
    results = {}
    try:
        async with aiohttp.ClientSession() as session:
            for sym in symbols:
                url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sym}"
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                        data = await resp.json()
                        results[sym] = float(data.get("price", 0))
                except:
                    results[sym] = 0
    except:
        pass
    return results

# ============================================================
# Agent 控制 API
# ============================================================
@app.post("/api/agent/{name}/start")
async def agent_start(name: str):
    """启动 Agent（通过 OpenClaw 发指令）"""
    aid = name.lower()
    if aid not in AGENTS:
        return {"error": f"Unknown agent: {name}"}
    
    # 直接通过 subprocess 启动对应的 runner
    try:
        # 使用 multi_agent_runner 或单独启动
        subprocess.Popen(
            ["python3", "-m", "scripts.multi_agent_runner"],
            cwd=str(BASE_DIR),
            stdout=open("/tmp/agent-start.log", "a"),
            stderr=subprocess.STDOUT,
        )
        return {"status": "started", "agent": aid}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/agent/{name}/stop")
async def agent_stop(name: str):
    """停止 Agent"""
    aid = name.lower()
    if aid not in AGENTS:
        return {"error": f"Unknown agent: {name}"}
    
    try:
        # 找到并终止进程
        result = subprocess.run(
            ["pkill", "-f", f"agent.*{aid}"],
            capture_output=True, text=True
        )
        return {"status": "stopped", "agent": aid}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ============================================================
# Chat API
# ============================================================
class ChatMessage(BaseModel):
    message: str

chat_history = []

@app.post("/api/chat")
async def chat(msg: ChatMessage):
    """发送消息 - 直接调 Zhipu API"""
    chat_history.append({"role": "user", "content": msg.message, "time": datetime.now(CST).isoformat()})
    
    reply = ""
    
    # 构建实时数据上下文
    context = await _build_chat_context(msg.message)
    user_msg = msg.message
    if context:
        user_msg = f"[实时数据]\n{context}\n\n[用户问题]\n{msg.message}"
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
                headers={"Authorization": f"Bearer {ZHIPU_API_KEY}"},
                json={
                    "model": "glm-5.1",
                    "messages": [
                        {"role": "system", "content": CHAT_SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "max_tokens": 2048,
                },
                timeout=aiohttp.ClientTimeout(total=60)
            ) as resp:
                data = await resp.json()
                if "choices" in data:
                    reply = data["choices"][0].get("message", {}).get("content", "")
                elif "error" in data:
                    reply = f"API 错误: {data['error'].get('message', str(data['error']))}"
                else:
                    reply = str(data)[:500]
    except Exception as e:
        reply = f"调用失败: {str(e)}"
    
    if not reply:
        reply = "（暂无回复）"
    
    chat_history.append({"role": "assistant", "content": reply, "time": datetime.now(CST).isoformat()})
    return {"reply": reply, "history": chat_history[-50:]}


async def _build_chat_context(message: str) -> str:
    """根据用户消息注入实时数据"""
    msg_lower = message.lower()
    parts = []
    
    if any(kw in msg_lower for kw in ['状态', '持仓', '盈亏', '资金', 'agent', '情况', '总结', '汇报', 'overview']):
        try:
            ov = await _get_overview_dict()
            lines = [f"总资金: ${ov['total_capital']:.0f}, 总盈亏: ${ov['total_pnl']:.0f} ({ov['total_pnl_pct']:.1f}%), 胜率: {ov['total_wr']:.1f}%"]
            for a in ov['agents']:
                pos_str = ', '.join([f"{p['symbol']} {p['direction']}" for p in a['positions']]) or '无持仓'
                lines.append(f"{a['name']}: 资金${a['capital']:.0f}, 盈亏${a['pnl']:.0f}({a['pnl_pct']:.1f}%), 胜率{a['win_rate']:.1f}%, 持仓: {pos_str}")
            parts.append('\n'.join(lines))
        except:
            pass
    
    return '\n'.join(parts)


async def _get_overview_dict() -> dict:
    agents = []
    tc = ti = tt = tw = 0
    for aid in AGENTS:
        info = get_agent_full_info(aid)
        if info:
            agents.append(info)
            tc += info["capital"]; ti += info["initial_capital"]
            tt += info["trades"]; tw += info["wins"]
    return {"total_capital": tc, "total_initial": ti, "total_pnl": tc-ti,
            "total_pnl_pct": (tc-ti)/ti*100 if ti else 0,
            "total_trades": tt, "total_wins": tw,
            "total_wr": (tw/tt*100) if tt else 0, "agents": agents}

@app.get("/api/chat/history")
async def chat_history_api():
    return {"history": chat_history[-50:]}

# ============================================================
# WebSocket
# ============================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await overview()
            await websocket.send_json(data)
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

AGENT_CONFIG_DIR = BASE_DIR / "config" / "agents"

AGENT_CONFIG_SCHEMA = {
    "xau": {
        "fields": [
            {"key": "boll_period", "label": "布林带周期", "type": "int", "min": 10, "max": 60},
            {"key": "boll_std", "label": "布林带标准差", "type": "float", "min": 1.0, "max": 3.0, "step": 0.1},
            {"key": "take_profit", "label": "止盈($)", "type": "float", "min": 1, "max": 50},
            {"key": "stop_loss", "label": "止损($)", "type": "float", "min": 1, "max": 50},
            {"key": "max_positions", "label": "最大持仓", "type": "int", "min": 1, "max": 50},
            {"key": "leverage", "label": "杠杆", "type": "int", "min": 1, "max": 500},
            {"key": "srsi_lower", "label": "StochRSI下限", "type": "float", "min": 1, "max": 30},
            {"key": "srsi_upper", "label": "StochRSI上限", "type": "float", "min": 70, "max": 99},
        ]
    },
    "major": {"fields": [{"key": "max_positions", "label": "最大持仓", "type": "int", "min": 1, "max": 10}]},
    "altcoin": {"fields": [{"key": "max_positions", "label": "最大持仓", "type": "int", "min": 1, "max": 10}]},
    "newcoin": {"fields": [{"key": "max_positions", "label": "最大持仓", "type": "int", "min": 1, "max": 5}]},
    "momentum": {"fields": [{"key": "max_positions", "label": "最大持仓", "type": "int", "min": 1, "max": 10}]},
}

DEFAULT_SOUL = {
    "xau": "# XAU Agent\n\n黄金趋势交易 — 结构突破 + EMA 趋势跟踪\n\n## 原则\n- 只做 XAUUSDT\n- 顺势挂单，禁止逆势加仓\n",
    "major": "# Major Agent\n\n主流币 BTC/ETH 趋势跟踪与反转\n",
    "altcoin": "# Altcoin Agent\n\n山寨币波段 + 动量\n",
    "newcoin": "# Newcoin Agent\n\n新币捕获，严格止损\n",
    "momentum": "# Momentum Agent\n\n动量追涨，快进快出\n",
}


def _agent_dir(agent_id: str) -> Path:
    d = AGENT_CONFIG_DIR / agent_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_agent_config(agent_id: str) -> dict:
    meta = AGENTS.get(agent_id, {})
    state_file = DATA_DIR / meta.get("state_file", f"agent_{agent_id}_state.json")
    cfg = {}
    if state_file.exists():
        try:
            cfg = json.loads(state_file.read_text()).get("config", {})
        except Exception:
            pass
    cfg_path = _agent_dir(agent_id) / "config.json"
    if cfg_path.exists():
        try:
            cfg.update(json.loads(cfg_path.read_text()))
        except Exception:
            pass
    return cfg


def _load_agent_soul(agent_id: str) -> str:
    soul_path = _agent_dir(agent_id) / "SOUL.md"
    if soul_path.exists():
        return soul_path.read_text(encoding="utf-8")
    return DEFAULT_SOUL.get(agent_id, f"# {agent_id} Agent\n")


class AgentConfigUpdate(BaseModel):
    config: dict


class AgentSoulUpdate(BaseModel):
    content: str


@app.get("/api/agent/{name}/profile")
async def agent_profile(name: str):
    aid = name.lower()
    if aid not in AGENTS:
        return JSONResponse({"error": f"Unknown agent: {name}"}, status_code=404)
    info = get_agent_full_info(aid)
    return {
        "agent": aid,
        "meta": info,
        "config": _load_agent_config(aid),
        "schema": AGENT_CONFIG_SCHEMA.get(aid, {"fields": []}),
        "soul_md": _load_agent_soul(aid),
    }


@app.put("/api/agent/{name}/config")
async def update_agent_config(name: str, body: AgentConfigUpdate):
    aid = name.lower()
    if aid not in AGENTS:
        return JSONResponse({"error": f"Unknown agent: {name}"}, status_code=404)
    schema = AGENT_CONFIG_SCHEMA.get(aid, {}).get("fields", [])
    allowed = {f["key"] for f in schema}
    clean = {}
    for k, v in (body.config or {}).items():
        if k not in allowed:
            continue
        fdef = next((f for f in schema if f["key"] == k), None)
        if not fdef:
            continue
        if fdef["type"] == "int":
            v = int(v)
            v = max(fdef.get("min", v), min(fdef.get("max", v), v))
        elif fdef["type"] == "float":
            v = float(v)
            v = max(fdef.get("min", v), min(fdef.get("max", v), v))
        clean[k] = v
    cfg_path = _agent_dir(aid) / "config.json"
    existing = {}
    if cfg_path.exists():
        try:
            existing = json.loads(cfg_path.read_text())
        except Exception:
            pass
    existing.update(clean)
    cfg_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    meta = AGENTS[aid]
    state_file = DATA_DIR / meta["state_file"]
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text())
            state.setdefault("config", {}).update(existing)
            state_file.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return {"ok": True, "config": existing, "message": "参数已保存，重启 Agent 后完全生效"}


@app.put("/api/agent/{name}/soul")
async def update_agent_soul(name: str, body: AgentSoulUpdate):
    aid = name.lower()
    if aid not in AGENTS:
        return JSONResponse({"error": f"Unknown agent: {name}"}, status_code=404)
    content = (body.content or "").strip()
    if not content:
        return JSONResponse({"error": "SOUL 内容不能为空"}, status_code=400)
    if len(content) > 8000:
        return JSONResponse({"error": "SOUL 内容不能超过 8000 字"}, status_code=400)
    soul_path = _agent_dir(aid) / "SOUL.md"
    soul_path.write_text(content, encoding="utf-8")
    return {"ok": True, "message": "SOUL 已保存"}

# ============================================================
# 交易人生 Life Game API
# ============================================================
from life_game import router as life_router, init_life_game

init_life_game(DATA_DIR, ZHIPU_API_KEY)
app.include_router(life_router, prefix="/api/life", tags=["life"])

# ============================================================
# 静态文件
# ============================================================
STATIC_DIR = Path(__file__).parent / "static"

# Explicit routes (must be before static mount)
@app.get("/pixel")
async def pixel_page():
    if STATIC_DIR.exists():
        return FileResponse(str(STATIC_DIR / "pixel.html"))
    return {"error": "pixel.html not found"}

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DASHBOARD_PORT", 9095))
    uvicorn.run(app, host="0.0.0.0", port=port)
