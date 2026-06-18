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

_lock = threading.RLock()
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
DEFAULT_PORTFOLIO_USDT = 50000.0
DEFAULT_AGENT_ALLOC_USDT = 10000.0


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
        CREATE TABLE IF NOT EXISTS life_accounts (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS life_sessions (
            token TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_session_account ON life_sessions(account_id);
        CREATE INDEX IF NOT EXISTS idx_session_expires ON life_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT NOT NULL,
            user_id TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            agent_id TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'user',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, created_at);
        CREATE TABLE IF NOT EXISTS agent_mood (
            user_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            stress INTEGER NOT NULL DEFAULT 0,
            mood_tag TEXT NOT NULL DEFAULT 'neutral',
            zone TEXT NOT NULL DEFAULT 'hall',
            channel TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, agent_id)
        );
        CREATE TABLE IF NOT EXISTS mentor_pairs (
            user_id TEXT NOT NULL,
            mentor_agent_id TEXT NOT NULL,
            mentee_agent_id TEXT NOT NULL,
            paired_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, mentee_agent_id)
        );
        CREATE TABLE IF NOT EXISTS npc_events (
            id TEXT PRIMARY KEY,
            zone TEXT NOT NULL,
            npc_id TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            buff_type TEXT NOT NULL DEFAULT '',
            buff_value INTEGER NOT NULL DEFAULT 0,
            reward_points INTEGER NOT NULL DEFAULT 0,
            starts_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS npc_event_claims (
            user_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            claimed_at TEXT NOT NULL,
            PRIMARY KEY (user_id, event_id)
        );
        CREATE TABLE IF NOT EXISTS poker_rooms (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'waiting',
            pot INTEGER NOT NULL DEFAULT 0,
            host_user_id TEXT NOT NULL,
            min_players INTEGER NOT NULL DEFAULT 2,
            buy_in INTEGER NOT NULL DEFAULT 30,
            created_at INTEGER NOT NULL,
            started_at INTEGER NOT NULL DEFAULT 0,
            settled_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS poker_room_players (
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            seat_id TEXT NOT NULL DEFAULT '',
            buy_in INTEGER NOT NULL DEFAULT 0,
            score INTEGER NOT NULL DEFAULT 0,
            rank INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (room_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS seat_auctions (
            seat_id TEXT PRIMARY KEY,
            activity TEXT NOT NULL DEFAULT '',
            high_bid INTEGER NOT NULL DEFAULT 0,
            high_bidder TEXT NOT NULL DEFAULT '',
            ends_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS dispatch_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            action TEXT NOT NULL,
            node_id TEXT NOT NULL DEFAULT '',
            cost INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            enqueued_at INTEGER NOT NULL,
            processed_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_dispatch_pending ON dispatch_queue(user_id, status);
        CREATE TABLE IF NOT EXISTS trading_pk (
            id TEXT PRIMARY KEY,
            challenger_id TEXT NOT NULL,
            defender_id TEXT NOT NULL,
            challenger_score REAL NOT NULL DEFAULT 0,
            defender_score REAL NOT NULL DEFAULT 0,
            winner_id TEXT NOT NULL DEFAULT '',
            stake INTEGER NOT NULL DEFAULT 50,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            settled_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS seasons (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE IF NOT EXISTS season_scores (
            season_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            points_earned INTEGER NOT NULL DEFAULT 0,
            social_score INTEGER NOT NULL DEFAULT 0,
            pvp_wins INTEGER NOT NULL DEFAULT 0,
            pnl_score REAL NOT NULL DEFAULT 0,
            rank INTEGER NOT NULL DEFAULT 0,
            settled INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (season_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS guilds (
            id TEXT PRIMARY KEY,
            season_id TEXT NOT NULL,
            name TEXT NOT NULL,
            leader_id TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS guild_members (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS season_cosmetics (
            season_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            label TEXT NOT NULL,
            item_type TEXT NOT NULL DEFAULT 'cosmetic',
            item_value TEXT NOT NULL DEFAULT '',
            cost INTEGER NOT NULL DEFAULT 100,
            PRIMARY KEY (season_id, item_id)
        );
        CREATE TABLE IF NOT EXISTS user_portfolios (
            user_id TEXT PRIMARY KEY,
            cash REAL NOT NULL DEFAULT 50000,
            initial_balance REAL NOT NULL DEFAULT 50000,
            last_sim_tick INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS user_agent_trading (
            user_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            strategy_preset TEXT NOT NULL DEFAULT 'major',
            capital REAL NOT NULL DEFAULT 10000,
            initial_capital REAL NOT NULL DEFAULT 10000,
            state_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, agent_id)
        );
        """)
    _migrate_poker_advanced_columns()
    _migrate_json_files(data_dir)
    _seed_engagement_data()


def _migrate_poker_advanced_columns() -> None:
    """进阶德州扑克 — 房间状态 / 玩家筹码字段"""
    cols_rooms = [
        ("game_mode", "TEXT NOT NULL DEFAULT 'classic'"),
        ("phase", "TEXT NOT NULL DEFAULT ''"),
        ("hand_number", "INTEGER NOT NULL DEFAULT 0"),
        ("game_state_json", "TEXT NOT NULL DEFAULT ''"),
        ("spectator", "INTEGER NOT NULL DEFAULT 0"),
    ]
    cols_players = [
        ("stack", "INTEGER NOT NULL DEFAULT 0"),
        ("hole_cards_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("folded", "INTEGER NOT NULL DEFAULT 0"),
        ("all_in", "INTEGER NOT NULL DEFAULT 0"),
        ("current_bet", "INTEGER NOT NULL DEFAULT 0"),
        ("eliminated", "INTEGER NOT NULL DEFAULT 0"),
        ("meta_json", "TEXT NOT NULL DEFAULT '{}'"),
    ]
    with _conn() as c:
        existing_r = {r[1] for r in c.execute("PRAGMA table_info(poker_rooms)").fetchall()}
        for name, ddl in cols_rooms:
            if name not in existing_r:
                c.execute(f"ALTER TABLE poker_rooms ADD COLUMN {name} {ddl}")
        existing_p = {r[1] for r in c.execute("PRAGMA table_info(poker_room_players)").fetchall()}
        for name, ddl in cols_players:
            if name not in existing_p:
                c.execute(f"ALTER TABLE poker_room_players ADD COLUMN {name} {ddl}")


def _conn() -> sqlite3.Connection:
    if _db_path is None:
        raise RuntimeError("life_db not initialized")
    conn = sqlite3.connect(str(_db_path), check_same_thread=False, timeout=15.0)
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
            auc = c.execute("SELECT * FROM seat_auctions WHERE seat_id=?", (seat_id,)).fetchone()
            if auc and auc["ends_at"] > now_ms and auc["high_bidder"] and auc["high_bidder"] != user_id:
                return {"ok": False, "error": "auction_active", "high_bidder": auc["high_bidder"]}
            if auc and auc["ends_at"] <= now_ms and auc["high_bidder"] and auc["high_bidder"] != user_id:
                return {"ok": False, "error": "auction_won_by_other", "winner": auc["high_bidder"]}
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


SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000


def purge_expired_sessions(now_ms: Optional[int] = None) -> None:
    ts = now_ms or int(datetime.now(CST).timestamp() * 1000)
    with _lock:
        with _conn() as c:
            c.execute("DELETE FROM life_sessions WHERE expires_at < ?", (ts,))


def create_account(username: str, password_hash: str, display_name: str) -> dict:
    purge_expired_sessions()
    aid = f"acc_{uuid4_hex()}"
    with _lock:
        with _conn() as c:
            try:
                c.execute(
                    "INSERT INTO life_accounts (id, username, password_hash, display_name, created_at) VALUES (?,?,?,?,?)",
                    (aid, username, password_hash, display_name or username, datetime.now(CST).isoformat()),
                )
            except sqlite3.IntegrityError:
                return {"ok": False, "error": "username_taken"}
    ensure_user(aid)
    return {"ok": True, "account_id": aid}


def uuid4_hex() -> str:
    import uuid
    return uuid.uuid4().hex[:16]


def get_account_by_username(username: str) -> Optional[dict]:
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT id, username, password_hash, display_name, created_at FROM life_accounts WHERE username=? COLLATE NOCASE",
                (username.strip(),),
            ).fetchone()
            if not row:
                return None
            return dict(row)


def get_account_by_id(account_id: str) -> Optional[dict]:
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT id, username, display_name, created_at FROM life_accounts WHERE id=?",
                (account_id,),
            ).fetchone()
            return dict(row) if row else None


def create_session(account_id: str) -> str:
    import secrets
    purge_expired_sessions()
    token = secrets.token_urlsafe(32)
    now_ms = int(datetime.now(CST).timestamp() * 1000)
    expires = now_ms + SESSION_TTL_MS
    with _lock:
        with _conn() as c:
            c.execute(
                "INSERT INTO life_sessions (token, account_id, expires_at, created_at) VALUES (?,?,?,?)",
                (token, account_id, expires, datetime.now(CST).isoformat()),
            )
    return token


def resolve_session_token(token: str) -> Optional[str]:
    purge_expired_sessions()
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT account_id, expires_at FROM life_sessions WHERE token=?",
                (token,),
            ).fetchone()
            if not row:
                return None
            now_ms = int(datetime.now(CST).timestamp() * 1000)
            if row["expires_at"] < now_ms:
                c.execute("DELETE FROM life_sessions WHERE token=?", (token,))
                return None
            return row["account_id"]


def delete_session(token: str) -> None:
    with _lock:
        with _conn() as c:
            c.execute("DELETE FROM life_sessions WHERE token=?", (token,))


def reset_session_idle(account_id: str) -> None:
    now_ms = int(datetime.now(CST).timestamp() * 1000)
    with _lock:
        with _conn() as c:
            c.execute("UPDATE life_users SET last_idle_tick=? WHERE id=?", (now_ms, account_id))


SEASON_LENGTH_MS = 14 * 24 * 60 * 60 * 1000


def _seed_engagement_data() -> None:
    now_ms = int(datetime.now(CST).timestamp() * 1000)
    with _lock:
        with _conn() as c:
            if not c.execute("SELECT 1 FROM seasons LIMIT 1").fetchone():
                sid = datetime.now(CST).strftime("%Y-S%W")
                c.execute(
                    "INSERT INTO seasons (id, name, starts_at, ends_at, status) VALUES (?,?,?,?,?)",
                    (sid, f"第 {sid} 赛季", now_ms, now_ms + SEASON_LENGTH_MS, "active"),
                )
                for item in [
                    (sid, "season_frame_gold", "金色赛季头像框", "frame", "gold", 150),
                    (sid, "season_sofa_sakura", "樱花沙发皮肤", "cosmetic", "sofa_sakura", 220),
                    (sid, "season_hat_crown", "赛季皇冠帽", "hat", "crown", 180),
                ]:
                    c.execute(
                        "INSERT OR IGNORE INTO season_cosmetics (season_id, item_id, label, item_type, item_value, cost) VALUES (?,?,?,?,?,?)",
                        item,
                    )
            if not c.execute("SELECT 1 FROM npc_events WHERE ends_at > ?", (now_ms,)).fetchone():
                day_end = now_ms + 24 * 60 * 60 * 1000
                for ev in [
                    ("ev_lily_lunch", "restaurant", "lily", "午餐特惠", "今日用餐积分 -20%", "dine_discount", 20, 15, now_ms, day_end),
                    ("ev_gaga_spa", "spa", "masseur", "理疗加钟", "按摩奖励 +10 积分", "massage_bonus", 10, 20, now_ms, day_end),
                    ("ev_jack_poker", "casino", "dealer", "牌局红利", "德州完成额外 +15 积分", "poker_bonus", 15, 25, now_ms, day_end),
                    ("ev_gugu_tasks", "hall", "reception", "任务加倍", "领取每日任务 +50%", "task_bonus", 50, 10, now_ms, day_end),
                ]:
                    c.execute(
                        "INSERT OR REPLACE INTO npc_events (id, zone, npc_id, title, body, buff_type, buff_value, reward_points, starts_at, ends_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        ev,
                    )


def now_ms() -> int:
    return int(datetime.now(CST).timestamp() * 1000)


def ensure_season_score(season_id: str, user_id: str) -> None:
    with _lock:
        with _conn() as c:
            c.execute(
                "INSERT OR IGNORE INTO season_scores (season_id, user_id) VALUES (?,?)",
                (season_id, user_id),
            )


def get_active_season() -> Optional[dict]:
    ts = now_ms()
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM seasons WHERE status='active' AND starts_at <= ? AND ends_at > ? ORDER BY starts_at DESC LIMIT 1",
                (ts, ts),
            ).fetchone()
            return dict(row) if row else None


def add_season_points(user_id: str, points: int = 0, social: int = 0, pvp_win: int = 0, pnl: float = 0) -> None:
    season = get_active_season()
    if not season:
        return
    ensure_season_score(season["id"], user_id)
    with _lock:
        with _conn() as c:
            c.execute(
                """UPDATE season_scores SET
                   points_earned = points_earned + ?,
                   social_score = social_score + ?,
                   pvp_wins = pvp_wins + ?,
                   pnl_score = pnl_score + ?
                   WHERE season_id=? AND user_id=?""",
                (points, social, pvp_win, pnl, season["id"], user_id),
            )


def get_user_guild(user_id: str, season_id: str) -> Optional[dict]:
    with _lock:
        with _conn() as c:
            row = c.execute(
                """SELECT g.*, m.role FROM guild_members m
                   JOIN guilds g ON g.id = m.guild_id
                   WHERE m.user_id=? AND g.season_id=?""",
                (user_id, season_id),
            ).fetchone()
            return dict(row) if row else None


# ── 用户模拟交易资产仓库 ──

def ensure_portfolio(user_id: str) -> dict:
    now = datetime.now(CST).isoformat()
    with _lock:
        with _conn() as c:
            row = c.execute("SELECT * FROM user_portfolios WHERE user_id=?", (user_id,)).fetchone()
            if row:
                return dict(row)
            c.execute(
                "INSERT INTO user_portfolios (user_id, cash, initial_balance, last_sim_tick, updated_at) VALUES (?,?,?,0,?)",
                (user_id, DEFAULT_PORTFOLIO_USDT, DEFAULT_PORTFOLIO_USDT, now),
            )
            return {
                "user_id": user_id,
                "cash": DEFAULT_PORTFOLIO_USDT,
                "initial_balance": DEFAULT_PORTFOLIO_USDT,
                "last_sim_tick": 0,
                "updated_at": now,
            }


def update_portfolio_tick(user_id: str, ts_ms: int) -> None:
    now = datetime.now(CST).isoformat()
    with _lock:
        with _conn() as c:
            c.execute(
                "UPDATE user_portfolios SET last_sim_tick=?, updated_at=? WHERE user_id=?",
                (ts_ms, now, user_id),
            )


def get_agent_trading(user_id: str, agent_id: str) -> Optional[dict]:
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT * FROM user_agent_trading WHERE user_id=? AND agent_id=?",
                (user_id, agent_id),
            ).fetchone()
            return dict(row) if row else None


def list_agent_trading(user_id: str) -> list[dict]:
    with _lock:
        with _conn() as c:
            rows = c.execute(
                "SELECT * FROM user_agent_trading WHERE user_id=? ORDER BY agent_id",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]


def save_agent_trading(
    user_id: str,
    agent_id: str,
    *,
    strategy_preset: str,
    capital: float,
    initial_capital: float,
    state_json: str,
) -> None:
    now = datetime.now(CST).isoformat()
    with _lock:
        with _conn() as c:
            c.execute(
                """INSERT INTO user_agent_trading
                   (user_id, agent_id, strategy_preset, capital, initial_capital, state_json, updated_at)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(user_id, agent_id) DO UPDATE SET
                   strategy_preset=excluded.strategy_preset,
                   capital=excluded.capital,
                   initial_capital=excluded.initial_capital,
                   state_json=excluded.state_json,
                   updated_at=excluded.updated_at""",
                (user_id, agent_id, strategy_preset, capital, initial_capital, state_json, now),
            )


def delete_agent_trading(user_id: str, agent_id: str) -> None:
    with _lock:
        with _conn() as c:
            c.execute(
                "DELETE FROM user_agent_trading WHERE user_id=? AND agent_id=?",
                (user_id, agent_id),
            )


def reset_portfolio(user_id: str) -> None:
    now = datetime.now(CST).isoformat()
    with _lock:
        with _conn() as c:
            c.execute(
                "UPDATE user_portfolios SET cash=?, initial_balance=?, last_sim_tick=0, updated_at=? WHERE user_id=?",
                (DEFAULT_PORTFOLIO_USDT, DEFAULT_PORTFOLIO_USDT, now, user_id),
            )
            c.execute("DELETE FROM user_agent_trading WHERE user_id=?", (user_id,))


def adjust_portfolio_cash(user_id: str, delta: float) -> float:
    ensure_portfolio(user_id)
    with _lock:
        with _conn() as c:
            c.execute(
                "UPDATE user_portfolios SET cash = cash + ?, updated_at=? WHERE user_id=?",
                (delta, datetime.now(CST).isoformat(), user_id),
            )
            row = c.execute("SELECT cash FROM user_portfolios WHERE user_id=?", (user_id,)).fetchone()
            return float(row["cash"]) if row else 0.0

