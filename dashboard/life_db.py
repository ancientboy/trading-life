"""
交易人生 SQLite 存储 — 替代 JSON 文件
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

CST = timezone(timedelta(hours=8))

_lock = threading.Lock()
_db_path: Optional[Path] = None

DAILY_TASK_DEFS = [
    {"id": "idle_30", "label": "挂机 30 分钟", "target": 30, "reward": 50, "kind": "idle_minutes", "icon": "⏱"},
    {"id": "massage_3", "label": "完成 3 次按摩", "target": 3, "reward": 40, "kind": "activity", "activity": "massage", "icon": "💆"},
    {"id": "dine_2", "label": "用餐 2 次", "target": 2, "reward": 30, "kind": "activity", "activity": "dine", "icon": "🍽"},
    {"id": "dispatch_5", "label": "派遣 5 次", "target": 5, "reward": 35, "kind": "dispatch", "icon": "🚀"},
    {"id": "rest_2", "label": "休息 2 次", "target": 2, "reward": 25, "kind": "activity", "activity": "rest", "icon": "🛋"},
    {"id": "poker_1", "label": "德州 1 局", "target": 1, "reward": 30, "kind": "activity", "activity": "poker", "icon": "🃏"},
]

DEFAULT_FREE_UNLOCKS = ["color_default", "hat_beanie", "hat_cap"]
STARTING_POINTS = 200


def init_db(data_dir: Path) -> None:
    global _db_path
    _db_path = data_dir / "life_game.db"
    with _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS life_users (
            id TEXT PRIMARY KEY,
            points INTEGER NOT NULL DEFAULT 200,
            last_idle_tick INTEGER NOT NULL DEFAULT 0,
            daily_date TEXT NOT NULL DEFAULT '',
            stats_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS daily_tasks (
            user_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            claimed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, task_id)
        );
        CREATE TABLE IF NOT EXISTS shop_unlocks (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            PRIMARY KEY (user_id, item_id)
        );
        CREATE TABLE IF NOT EXISTS custom_agents (
            user_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            meta_json TEXT NOT NULL,
            PRIMARY KEY (user_id, agent_id)
        );
        CREATE TABLE IF NOT EXISTS seat_occupancy (
            seat_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            activity TEXT NOT NULL DEFAULT '',
            until_ts INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_seat_until ON seat_occupancy(until_ts);
        """)
    _migrate_json_files(data_dir)


def _conn() -> sqlite3.Connection:
    if _db_path is None:
        raise RuntimeError("life_db not initialized")
    conn = sqlite3.connect(str(_db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _today() -> str:
    return datetime.now(CST).strftime("%Y-%m-%d")


def _default_tasks() -> dict[str, dict]:
    return {t["id"]: {"progress": 0, "claimed": False} for t in DAILY_TASK_DEFS}


def _migrate_json_files(data_dir: Path) -> None:
    legacy = data_dir / "life_users"
    if not legacy.is_dir():
        return
    for path in legacy.glob("*.json"):
        uid = path.stem
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        with _lock:
            if _user_exists(uid):
                continue
            _insert_user_from_legacy(uid, data)


def _user_exists(uid: str) -> bool:
    with _conn() as c:
        row = c.execute("SELECT 1 FROM life_users WHERE id=?", (uid,)).fetchone()
        return row is not None


def _insert_user_from_legacy(uid: str, data: dict) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO life_users (id, points, last_idle_tick, daily_date, stats_json, created_at) VALUES (?,?,?,?,?,?)",
            (
                uid,
                data.get("points", STARTING_POINTS),
                data.get("last_idle_tick", 0),
                data.get("daily_date", _today()),
                json.dumps(data.get("stats", {}), ensure_ascii=False),
                datetime.now(CST).isoformat(),
            ),
        )
        for tid, t in (data.get("daily_tasks") or {}).items():
            c.execute(
                "INSERT OR REPLACE INTO daily_tasks (user_id, task_id, progress, claimed) VALUES (?,?,?,?)",
                (uid, tid, t.get("progress", 0), 1 if t.get("claimed") else 0),
            )
        for item in data.get("shop_unlocks") or []:
            c.execute("INSERT OR IGNORE INTO shop_unlocks (user_id, item_id) VALUES (?,?)", (uid, item))
        for aid, meta in (data.get("custom_agents") or {}).items():
            c.execute(
                "INSERT OR REPLACE INTO custom_agents (user_id, agent_id, meta_json) VALUES (?,?,?)",
                (uid, aid, json.dumps(meta, ensure_ascii=False)),
            )


def ensure_user(uid: str) -> None:
    with _lock:
        with _conn() as c:
            row = c.execute("SELECT id FROM life_users WHERE id=?", (uid,)).fetchone()
            if row:
                _reset_daily_if_needed(c, uid)
                return
            c.execute(
                "INSERT INTO life_users (id, points, last_idle_tick, daily_date, stats_json, created_at) VALUES (?,?,?,?,?,?)",
                (uid, STARTING_POINTS, 0, _today(), "{}", datetime.now(CST).isoformat()),
            )
            for tid in _default_tasks():
                c.execute(
                    "INSERT INTO daily_tasks (user_id, task_id, progress, claimed) VALUES (?,?,0,0)",
                    (uid, tid),
                )
            for item in DEFAULT_FREE_UNLOCKS:
                c.execute("INSERT OR IGNORE INTO shop_unlocks (user_id, item_id) VALUES (?,?)", (uid, item))


def _reset_daily_if_needed(c: sqlite3.Connection, uid: str) -> None:
    row = c.execute("SELECT daily_date FROM life_users WHERE id=?", (uid,)).fetchone()
    if not row or row["daily_date"] == _today():
        return
    c.execute("UPDATE life_users SET daily_date=?, stats_json=? WHERE id=?", (_today(), "{}", uid))
    for tid in _default_tasks():
        c.execute(
            "INSERT OR REPLACE INTO daily_tasks (user_id, task_id, progress, claimed) VALUES (?,?,0,0)",
            (uid, tid),
        )


def load_user(uid: str) -> dict:
    ensure_user(uid)
    with _lock:
        with _conn() as c:
            _reset_daily_if_needed(c, uid)
            u = c.execute("SELECT * FROM life_users WHERE id=?", (uid,)).fetchone()
            tasks = {
                r["task_id"]: {"progress": r["progress"], "claimed": bool(r["claimed"])}
                for r in c.execute("SELECT * FROM daily_tasks WHERE user_id=?", (uid,))
            }
            for tid, defv in _default_tasks().items():
                tasks.setdefault(tid, defv)
            unlocks = [
                r["item_id"] for r in c.execute("SELECT item_id FROM shop_unlocks WHERE user_id=?", (uid,))
            ]
            agents = {}
            for r in c.execute("SELECT agent_id, meta_json FROM custom_agents WHERE user_id=?", (uid,)):
                agents[r["agent_id"]] = json.loads(r["meta_json"])
            stats = json.loads(u["stats_json"] or "{}")
            return {
                "points": u["points"],
                "last_idle_tick": u["last_idle_tick"],
                "daily_date": u["daily_date"],
                "daily_tasks": tasks,
                "shop_unlocks": list(set(DEFAULT_FREE_UNLOCKS + unlocks)),
                "custom_agents": agents,
                "stats": stats,
            }


def save_user_points(uid: str, points: int, last_idle_tick: Optional[int] = None) -> None:
    with _lock:
        with _conn() as c:
            if last_idle_tick is not None:
                c.execute("UPDATE life_users SET points=?, last_idle_tick=? WHERE id=?", (points, last_idle_tick, uid))
            else:
                c.execute("UPDATE life_users SET points=? WHERE id=?", (points, uid))


def save_user_stats(uid: str, stats: dict) -> None:
    with _lock:
        with _conn() as c:
            c.execute("UPDATE life_users SET stats_json=? WHERE id=?", (json.dumps(stats, ensure_ascii=False), uid))


def update_task(uid: str, task_id: str, progress: int, claimed: Optional[bool] = None) -> None:
    with _lock:
        with _conn() as c:
            if claimed is None:
                c.execute(
                    "UPDATE daily_tasks SET progress=? WHERE user_id=? AND task_id=?",
                    (progress, uid, task_id),
                )
            else:
                c.execute(
                    "UPDATE daily_tasks SET progress=?, claimed=? WHERE user_id=? AND task_id=?",
                    (progress, 1 if claimed else 0, uid, task_id),
                )


def add_shop_unlock(uid: str, item_id: str) -> None:
    with _lock:
        with _conn() as c:
            c.execute("INSERT OR IGNORE INTO shop_unlocks (user_id, item_id) VALUES (?,?)", (uid, item_id))


def save_custom_agent(uid: str, agent_id: str, meta: dict) -> None:
    with _lock:
        with _conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO custom_agents (user_id, agent_id, meta_json) VALUES (?,?,?)",
                (uid, agent_id, json.dumps(meta, ensure_ascii=False)),
            )


def update_custom_agent_soul(uid: str, agent_id: str, soul: str) -> bool:
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT meta_json FROM custom_agents WHERE user_id=? AND agent_id=?",
                (uid, agent_id),
            ).fetchone()
            if not row:
                return False
            meta = json.loads(row["meta_json"])
            meta["soulMd"] = soul
            c.execute(
                "UPDATE custom_agents SET meta_json=? WHERE user_id=? AND agent_id=?",
                (json.dumps(meta, ensure_ascii=False), uid, agent_id),
            )
            return True


def save_user_data(uid: str, data: dict) -> None:
    """将内存中的用户状态写回数据库（替代原 JSON save_user）。"""
    ensure_user(uid)
    with _lock:
        with _conn() as c:
            c.execute(
                "UPDATE life_users SET points=?, last_idle_tick=?, daily_date=?, stats_json=? WHERE id=?",
                (
                    data.get("points", STARTING_POINTS),
                    data.get("last_idle_tick", 0),
                    data.get("daily_date", _today()),
                    json.dumps(data.get("stats", {}), ensure_ascii=False),
                    uid,
                ),
            )
            for tid, t in (data.get("daily_tasks") or {}).items():
                c.execute(
                    "INSERT OR REPLACE INTO daily_tasks (user_id, task_id, progress, claimed) VALUES (?,?,?,?)",
                    (uid, tid, t.get("progress", 0), 1 if t.get("claimed") else 0),
                )
            for item in data.get("shop_unlocks") or []:
                c.execute("INSERT OR IGNORE INTO shop_unlocks (user_id, item_id) VALUES (?,?)", (uid, item))
            for aid, meta in (data.get("custom_agents") or {}).items():
                c.execute(
                    "INSERT OR REPLACE INTO custom_agents (user_id, agent_id, meta_json) VALUES (?,?,?)",
                    (uid, aid, json.dumps(meta, ensure_ascii=False)),
                )


def migrate_user(uid: str, points: int, last_idle_tick: int, custom_agents: dict, shop_unlocks: list) -> None:
    ensure_user(uid)
    user = load_user(uid)
    with _lock:
        with _conn() as c:
            if not user["custom_agents"] and custom_agents:
                for aid, meta in custom_agents.items():
                    c.execute(
                        "INSERT OR REPLACE INTO custom_agents (user_id, agent_id, meta_json) VALUES (?,?,?)",
                        (uid, aid, json.dumps(meta, ensure_ascii=False)),
                    )
            if user["points"] == STARTING_POINTS and points != STARTING_POINTS:
                c.execute("UPDATE life_users SET points=? WHERE id=?", (points, uid))
            if last_idle_tick:
                c.execute("UPDATE life_users SET last_idle_tick=? WHERE id=?", (last_idle_tick, uid))
            for item in shop_unlocks or []:
                c.execute("INSERT OR IGNORE INTO shop_unlocks (user_id, item_id) VALUES (?,?)", (uid, item))


def purge_expired_seats(now_ms: Optional[int] = None) -> None:
    ts = now_ms or int(datetime.now(CST).timestamp() * 1000)
    with _lock:
        with _conn() as c:
            c.execute("DELETE FROM seat_occupancy WHERE until_ts > 0 AND until_ts < ?", (ts,))


def get_all_seats() -> dict[str, dict]:
    purge_expired_seats()
    with _lock:
        with _conn() as c:
            rows = c.execute("SELECT seat_id, user_id, agent_id, activity, until_ts FROM seat_occupancy").fetchall()
            return {
                r["seat_id"]: {
                    "user_id": r["user_id"],
                    "agent_id": r["agent_id"],
                    "activity": r["activity"],
                    "until_ts": r["until_ts"],
                }
                for r in rows
            }


def claim_seat(seat_id: str, user_id: str, agent_id: str, activity: str, until_ts: int) -> dict:
    purge_expired_seats()
    now_ms = int(datetime.now(CST).timestamp() * 1000)
    with _lock:
        with _conn() as c:
            row = c.execute("SELECT * FROM seat_occupancy WHERE seat_id=?", (seat_id,)).fetchone()
            if row:
                if row["until_ts"] > now_ms and row["agent_id"] != agent_id:
                    return {"ok": False, "error": "occupied", "occupied_by": row["agent_id"]}
                c.execute(
                    "UPDATE seat_occupancy SET user_id=?, agent_id=?, activity=?, until_ts=? WHERE seat_id=?",
                    (user_id, agent_id, activity, until_ts, seat_id),
                )
            else:
                c.execute(
                    "INSERT INTO seat_occupancy (seat_id, user_id, agent_id, activity, until_ts) VALUES (?,?,?,?,?)",
                    (seat_id, user_id, agent_id, activity, until_ts),
                )
    return {"ok": True, "seat_id": seat_id}


def release_seat(seat_id: str, agent_id: str) -> dict:
    with _lock:
        with _conn() as c:
            row = c.execute("SELECT agent_id FROM seat_occupancy WHERE seat_id=?", (seat_id,)).fetchone()
            if not row:
                return {"ok": True}
            if row["agent_id"] != agent_id:
                return {"ok": False, "error": "not_owner"}
            c.execute("DELETE FROM seat_occupancy WHERE seat_id=?", (seat_id,))
    return {"ok": True}
