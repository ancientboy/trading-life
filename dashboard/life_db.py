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
STARTING_POINTS = 10000
DEFAULT_PORTFOLIO_USDT = 50000.0
DEFAULT_AGENT_ALLOC_USDT = 10000.0


def init_db(data_dir: Path) -> None:
    global _db_path
    _db_path = data_dir / "life_game.db"
    with _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS life_users (
            id TEXT PRIMARY KEY,
            points INTEGER NOT NULL DEFAULT 10000,
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
        CREATE TABLE IF NOT EXISTS agent_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'event',
            summary TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_memory ON agent_memory(user_id, agent_id, created_at DESC);
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
    _migrate_referrals()
    _migrate_life_notifications()
    _migrate_poker_highlights()
    _migrate_trading_events()
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


def _migrate_referrals() -> None:
    with _conn() as c:
        existing = {r[1] for r in c.execute("PRAGMA table_info(life_accounts)").fetchall()}
        if "invite_code" not in existing:
            c.execute("ALTER TABLE life_accounts ADD COLUMN invite_code TEXT")
        if "referred_by" not in existing:
            c.execute("ALTER TABLE life_accounts ADD COLUMN referred_by TEXT")
        c.execute("""
            CREATE TABLE IF NOT EXISTS referrals (
                invitee_id TEXT PRIMARY KEY,
                inviter_id TEXT NOT NULL,
                register_rewarded INTEGER NOT NULL DEFAULT 0,
                poker_rewarded INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT ''
            )
        """)
        c.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_life_accounts_invite_code "
            "ON life_accounts(invite_code) WHERE invite_code IS NOT NULL AND invite_code != ''"
        )


def _migrate_life_notifications() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS life_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0
            )
        """)
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_life_notifications_account "
            "ON life_notifications(account_id, read, id)"
        )


def push_life_notification(account_id: str, kind: str, message: str) -> None:
    if not account_id:
        return
    with _lock:
        with _conn() as c:
            c.execute(
                "INSERT INTO life_notifications (account_id, kind, message, created_at, read) "
                "VALUES (?,?,?,?,0)",
                (account_id, kind, message, datetime.now(CST).isoformat()),
            )


def pop_life_notifications(account_id: str, limit: int = 10) -> list[str]:
    with _lock:
        with _conn() as c:
            rows = c.execute(
                "SELECT id, message FROM life_notifications "
                "WHERE account_id=? AND read=0 ORDER BY id ASC LIMIT ?",
                (account_id, max(1, min(limit, 20))),
            ).fetchall()
            if not rows:
                return []
            ids = [int(r["id"]) for r in rows]
            placeholders = ",".join("?" * len(ids))
            c.execute(f"UPDATE life_notifications SET read=1 WHERE id IN ({placeholders})", ids)
            return [str(r["message"]) for r in rows]


def list_referral_invitees(account_id: str, limit: int = 30) -> list[dict]:
    with _lock:
        with _conn() as c:
            rows = c.execute(
                """
                SELECT r.invitee_id, r.created_at, r.poker_rewarded,
                       COALESCE(NULLIF(a.display_name, ''), a.username, '好友') AS name
                FROM referrals r
                LEFT JOIN life_accounts a ON a.id = r.invitee_id
                WHERE r.inviter_id=?
                ORDER BY r.created_at DESC
                LIMIT ?
                """,
                (account_id, max(1, min(limit, 50))),
            ).fetchall()
    return [
        {
            "invitee_id": r["invitee_id"],
            "name": r["name"],
            "registered_at": r["created_at"],
            "poker_done": bool(r["poker_rewarded"]),
        }
        for r in rows
    ]


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
    ensure_invite_code(aid)
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


MAX_AGENT_MEMORIES = 30


def append_agent_memory(user_id: str, agent_id: str, kind: str, summary: str) -> None:
    text = (summary or "").strip()[:200]
    if not text or not agent_id:
        return
    ts = now_ms()
    with _lock:
        with _conn() as c:
            c.execute(
                "INSERT INTO agent_memory (user_id, agent_id, kind, summary, created_at) VALUES (?,?,?,?,?)",
                (user_id, agent_id, (kind or "event")[:16], text, ts),
            )
            cnt = c.execute(
                "SELECT COUNT(*) FROM agent_memory WHERE user_id=? AND agent_id=?",
                (user_id, agent_id),
            ).fetchone()[0]
            if cnt > MAX_AGENT_MEMORIES:
                c.execute(
                    """DELETE FROM agent_memory WHERE id IN (
                       SELECT id FROM agent_memory WHERE user_id=? AND agent_id=?
                       ORDER BY created_at ASC LIMIT ?)""",
                    (user_id, agent_id, cnt - MAX_AGENT_MEMORIES),
                )


def get_agent_memories(user_id: str, agent_id: str, limit: int = 12) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, kind, summary, created_at FROM agent_memory WHERE user_id=? AND agent_id=? ORDER BY created_at DESC LIMIT ?",
            (user_id, agent_id, max(1, min(limit, 30))),
        ).fetchall()
    return [dict(r) for r in rows]


def memory_snippets_for_prompt(user_id: str, agent_id: str, limit: int = 8) -> list[str]:
    rows = get_agent_memories(user_id, agent_id, limit)
    return [r["summary"] for r in reversed(rows)]


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


# ─── 邀请裂变 ───────────────────────────────────────────────

REFERRAL_INVITEE_BONUS = 500
REFERRAL_INVITER_SIGNUP = 300
REFERRAL_INVITER_POKER = 200


def _gen_invite_code(c) -> str:
    import random
    import string
    chars = string.ascii_uppercase + string.digits
    for _ in range(60):
        code = "".join(random.choice(chars) for _ in range(6))
        if not c.execute("SELECT 1 FROM life_accounts WHERE invite_code=?", (code,)).fetchone():
            return code
    return uuid4_hex()[:6].upper()


def ensure_invite_code(account_id: str) -> str:
    with _lock:
        with _conn() as c:
            row = c.execute("SELECT invite_code FROM life_accounts WHERE id=?", (account_id,)).fetchone()
            if row and row["invite_code"]:
                return str(row["invite_code"])
            code = _gen_invite_code(c)
            c.execute("UPDATE life_accounts SET invite_code=? WHERE id=?", (code, account_id))
            return code


def apply_referral(invitee_id: str, code: str) -> dict:
    code = (code or "").strip().upper()
    if not code or len(code) < 4:
        return {"ok": False, "error": "邀请码无效"}
    with _lock:
        with _conn() as c:
            inviter = c.execute(
                "SELECT id FROM life_accounts WHERE invite_code=? COLLATE NOCASE", (code,),
            ).fetchone()
            if not inviter:
                return {"ok": False, "error": "邀请码不存在"}
            inviter_id = inviter["id"]
            if inviter_id == invitee_id:
                return {"ok": False, "error": "不能使用自己的邀请码"}
            if c.execute("SELECT 1 FROM referrals WHERE invitee_id=?", (invitee_id,)).fetchone():
                return {"ok": False, "error": "已绑定过邀请人"}
            c.execute(
                "INSERT INTO referrals (invitee_id, inviter_id, register_rewarded, poker_rewarded, created_at) "
                "VALUES (?,?,1,0,?)",
                (invitee_id, inviter_id, datetime.now(CST).isoformat()),
            )
            c.execute("UPDATE life_accounts SET referred_by=? WHERE id=?", (inviter_id, invitee_id))
    from life_game import load_user, save_user, _earn
    u_invitee = load_user(invitee_id)
    _earn(u_invitee, REFERRAL_INVITEE_BONUS, account_id=invitee_id)
    save_user(invitee_id, u_invitee)
    u_inviter = load_user(inviter_id)
    _earn(u_inviter, REFERRAL_INVITER_SIGNUP, account_id=inviter_id)
    save_user(inviter_id, u_inviter)
    push_life_notification(
        inviter_id, "referral_signup",
        f"🎉 新好友注册成功，你获得 +{REFERRAL_INVITER_SIGNUP} 积分",
    )
    return {
        "ok": True,
        "inviter_bonus": REFERRAL_INVITER_SIGNUP,
        "invitee_bonus": REFERRAL_INVITEE_BONUS,
    }


def try_referral_poker_reward(invitee_id: str) -> None:
    if not invitee_id or invitee_id.startswith(("npc_", "ai_")):
        return
    inviter_id = None
    invitee_name = "好友"
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT inviter_id FROM referrals WHERE invitee_id=? AND poker_rewarded=0", (invitee_id,),
            ).fetchone()
            if not row:
                return
            inviter_id = row["inviter_id"]
            acc = c.execute(
                "SELECT COALESCE(NULLIF(display_name,''), username, '好友') AS name "
                "FROM life_accounts WHERE id=?", (invitee_id,),
            ).fetchone()
            if acc:
                invitee_name = acc["name"]
            c.execute("UPDATE referrals SET poker_rewarded=1 WHERE invitee_id=?", (invitee_id,))
    from life_game import load_user, save_user, _earn
    u = load_user(inviter_id)
    _earn(u, REFERRAL_INVITER_POKER, account_id=inviter_id)
    save_user(inviter_id, u)
    push_life_notification(
        inviter_id, "referral_poker",
        f"🎁 {invitee_name} 完成首局扑克，你获得 +{REFERRAL_INVITER_POKER} 积分",
    )


def get_referral_summary(account_id: str) -> dict:
    code = ensure_invite_code(account_id)
    invitees = list_referral_invitees(account_id)
    pending = [i for i in invitees if not i.get("poker_done")]
    with _lock:
        with _conn() as c:
            count = c.execute(
                "SELECT COUNT(*) FROM referrals WHERE inviter_id=?", (account_id,),
            ).fetchone()[0]
            poker_done = c.execute(
                "SELECT COUNT(*) FROM referrals WHERE inviter_id=? AND poker_rewarded=1", (account_id,),
            ).fetchone()[0]
    return {
        "invite_code": code,
        "invites_count": count,
        "poker_rewards": poker_done,
        "invitees": invitees,
        "pending_poker_invitees": pending,
        "rewards": {
            "invitee_signup": REFERRAL_INVITEE_BONUS,
            "inviter_signup": REFERRAL_INVITER_SIGNUP,
            "inviter_first_poker": REFERRAL_INVITER_POKER,
        },
    }


# ─── 裂变：本周战报 / 扑克高光 / 待助力 ───

HIGHLIGHT_MIN_HAND_CAT = 5  # 顺子及以上
HIGHLIGHT_MIN_WIN_MULT = 2  # 赢得 >= 买入 2 倍


def _week_key(dt: Optional[datetime] = None) -> str:
    d = (dt or datetime.now(CST)).date()
    return d.strftime("%G-W%V")


def _mutate_user_stats(uid: str, mutator) -> dict:
    ensure_user(uid)
    with _lock:
        with _conn() as c:
            row = c.execute("SELECT stats_json FROM life_users WHERE id=?", (uid,)).fetchone()
            stats = json.loads(row["stats_json"] or "{}")
            mutator(stats)
            c.execute(
                "UPDATE life_users SET stats_json=? WHERE id=?",
                (json.dumps(stats, ensure_ascii=False), uid),
            )
            return stats


def _empty_weekly_stats() -> dict:
    return {
        "poker_games": 0,
        "poker_wins": 0,
        "points_net": 0,
        "points_won": 0,
        "best_hand_cat": 0,
        "best_hand_name": "",
        "trading_trades": 0,
        "trading_wins": 0,
        "trading_pnl": 0.0,
        "best_trade_pnl": 0.0,
    }


def record_weekly_poker(
    uid: str,
    *,
    won: int,
    net: int,
    won_hand: bool,
    hand_cat: int,
    hand_name: str,
) -> None:
    if not uid or uid.startswith(("npc_", "ai_")):
        return
    wk = _week_key()

    def mut(stats: dict) -> None:
        weekly = stats.setdefault("weekly", {})
        w = weekly.setdefault(wk, _empty_weekly_stats())
        w["poker_games"] = int(w.get("poker_games", 0)) + 1
        if won_hand:
            w["poker_wins"] = int(w.get("poker_wins", 0)) + 1
        w["points_net"] = int(w.get("points_net", 0)) + int(net)
        if won > 0:
            w["points_won"] = int(w.get("points_won", 0)) + int(won)
        if hand_cat > int(w.get("best_hand_cat", 0)):
            w["best_hand_cat"] = hand_cat
            w["best_hand_name"] = hand_name or w.get("best_hand_name", "")

    _mutate_user_stats(uid, mut)


def record_weekly_trading(
    uid: str,
    *,
    pnl_amount: float,
    won: bool,
) -> None:
    if not uid or uid.startswith(("npc_", "ai_")):
        return
    wk = _week_key()

    def mut(stats: dict) -> None:
        weekly = stats.setdefault("weekly", {})
        w = weekly.setdefault(wk, _empty_weekly_stats())
        w["trading_trades"] = int(w.get("trading_trades", 0)) + 1
        if won:
            w["trading_wins"] = int(w.get("trading_wins", 0)) + 1
        w["trading_pnl"] = round(float(w.get("trading_pnl", 0)) + float(pnl_amount), 2)
        best = float(w.get("best_trade_pnl", 0))
        if pnl_amount > best:
            w["best_trade_pnl"] = round(float(pnl_amount), 2)

    _mutate_user_stats(uid, mut)


TRADING_BOOTSTRAP_WINDOW_SEC = 60


def _account_age_sec(account_id: str) -> Optional[float]:
    acc = get_account_by_id(account_id) or {}
    raw = acc.get("created_at") or ""
    if not raw:
        return None
    try:
        created = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=CST)
        return (datetime.now(CST) - created.astimezone(CST)).total_seconds()
    except Exception:
        return None


def _has_any_sim_trades(user_id: str) -> bool:
    for row in list_agent_trading(user_id):
        try:
            st = json.loads(row.get("state_json") or "{}")
        except json.JSONDecodeError:
            continue
        if st.get("positions") or st.get("trades_history"):
            return True
    return False


def should_bootstrap_trading(account_id: str) -> bool:
    """注册后 60 秒内、尚无模拟成交 → 首 tick 加权开仓。"""
    if not account_id or account_id.startswith(("npc_", "ai_")):
        return False
    user = load_user(account_id)
    stats = user.get("stats") or {}
    if stats.get("trading_bootstrap_done"):
        return False
    if _has_any_sim_trades(account_id):
        return False
    age = _account_age_sec(account_id)
    if age is None or age > TRADING_BOOTSTRAP_WINDOW_SEC:
        return False
    return True


def mark_trading_bootstrap_done(account_id: str) -> None:
    if not account_id or account_id.startswith(("npc_", "ai_")):
        return

    def mut(stats: dict) -> None:
        stats["trading_bootstrap_done"] = True
        stats["trading_bootstrap_at"] = datetime.now(CST).isoformat()

    _mutate_user_stats(account_id, mut)


def get_weekly_report(account_id: str) -> dict:
    wk = _week_key()
    user = load_user(account_id)
    stats = user.get("stats") or {}
    w = (stats.get("weekly") or {}).get(wk) or {}
    season = get_active_season()
    season_row = None
    if season:
        with _lock:
            with _conn() as c:
                season_row = c.execute(
                    "SELECT points_earned, social_score, pvp_wins, pnl_score, rank "
                    "FROM season_scores WHERE season_id=? AND user_id=?",
                    (season["id"], account_id),
                ).fetchone()
    acc = get_account_by_id(account_id) or {}
    rank_hint = None
    if season and season_row:
        with _lock:
            with _conn() as c:
                better = c.execute(
                    "SELECT COUNT(*) FROM season_scores WHERE season_id=? AND points_earned > ?",
                    (season["id"], season_row["points_earned"]),
                ).fetchone()[0]
                rank_hint = int(better) + 1
    mon = datetime.now(CST).date()
    week_start = mon - timedelta(days=mon.weekday())
    week_end = week_start + timedelta(days=6)
    return {
        "week_key": wk,
        "week_label": f"{week_start.strftime('%m/%d')} – {week_end.strftime('%m/%d')}",
        "display_name": acc.get("display_name") or acc.get("username") or "玩家",
        "poker_games": int(w.get("poker_games", 0)),
        "poker_wins": int(w.get("poker_wins", 0)),
        "points_net": int(w.get("points_net", 0)),
        "points_won": int(w.get("points_won", 0)),
        "best_hand_name": w.get("best_hand_name") or "—",
        "best_hand_cat": int(w.get("best_hand_cat", 0)),
        "trading_trades": int(w.get("trading_trades", 0)),
        "trading_wins": int(w.get("trading_wins", 0)),
        "trading_pnl": round(float(w.get("trading_pnl", 0)), 2),
        "best_trade_pnl": round(float(w.get("best_trade_pnl", 0)), 2),
        "season_name": season["name"] if season else "",
        "season_points": int(season_row["points_earned"]) if season_row else 0,
        "season_social": int(season_row["social_score"]) if season_row else 0,
        "season_pvp_wins": int(season_row["pvp_wins"]) if season_row else 0,
        "season_rank_hint": rank_hint,
        "current_points": int(user.get("points", 0)),
    }


def _migrate_poker_highlights() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS poker_highlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT '',
                display_name TEXT NOT NULL DEFAULT '',
                hand_name TEXT NOT NULL DEFAULT '',
                hand_combo TEXT NOT NULL DEFAULT '',
                community_json TEXT NOT NULL DEFAULT '[]',
                hole_cards_json TEXT NOT NULL DEFAULT '[]',
                won INTEGER NOT NULL DEFAULT 0,
                pot INTEGER NOT NULL DEFAULT 0,
                room_id TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL DEFAULT 0
            )
        """)
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_poker_highlights_created "
            "ON poker_highlights(created_at DESC)"
        )


def _migrate_trading_events() -> None:
    with _lock:
        with _conn() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS guess_rounds (
                    id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
                    start_price REAL NOT NULL DEFAULT 0,
                    end_price REAL NOT NULL DEFAULT 0,
                    starts_at INTEGER NOT NULL,
                    ends_at INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    pool_up INTEGER NOT NULL DEFAULT 0,
                    pool_down INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS guess_bets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    round_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    stake INTEGER NOT NULL,
                    payout INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    UNIQUE(round_id, user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_guess_bets_round ON guess_bets(round_id);
                CREATE TABLE IF NOT EXISTS arena_rounds (
                    id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
                    starts_at INTEGER NOT NULL,
                    join_ends_at INTEGER NOT NULL,
                    ends_at INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'join',
                    entry_fee INTEGER NOT NULL DEFAULT 30,
                    prize_pool INTEGER NOT NULL DEFAULT 0,
                    spectate_pool INTEGER NOT NULL DEFAULT 0,
                    start_price REAL NOT NULL DEFAULT 0,
                    end_price REAL NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS arena_entries (
                    round_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    agent_name TEXT NOT NULL DEFAULT '',
                    strategy_preset TEXT NOT NULL DEFAULT 'major',
                    is_npc INTEGER NOT NULL DEFAULT 0,
                    entry_fee INTEGER NOT NULL DEFAULT 0,
                    direction TEXT NOT NULL DEFAULT 'LONG',
                    leverage REAL NOT NULL DEFAULT 5,
                    entry_price REAL NOT NULL DEFAULT 0,
                    return_pct REAL NOT NULL DEFAULT 0,
                    rank INTEGER NOT NULL DEFAULT 0,
                    prize INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (round_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS arena_spectator_bets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    round_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    pick_user_id TEXT NOT NULL,
                    stake INTEGER NOT NULL,
                    payout INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_arena_spectator_round ON arena_spectator_bets(round_id);
            """)


def record_poker_game_meta(account_id: str, won_hand: bool) -> dict:
    """记录总局数 / 首胜，返回 {first_game, first_win}"""
    if not account_id or account_id.startswith(("npc_", "ai_")):
        return {"first_game": False, "first_win": False}
    out = {"first_game": False, "first_win": False}

    def mut(stats: dict) -> None:
        total = int(stats.get("poker_games_total", 0))
        out["first_game"] = total == 0
        stats["poker_games_total"] = total + 1
        if won_hand and not stats.get("first_poker_win"):
            stats["first_poker_win"] = True
            stats["first_poker_win_at"] = datetime.now(CST).isoformat()
            out["first_win"] = True

    _mutate_user_stats(account_id, mut)
    return out


def is_first_poker_game(account_id: str) -> bool:
    user = load_user(account_id)
    stats = user.get("stats") or {}
    return int(stats.get("poker_games_total", 0)) == 0


def record_trading_win_meta(account_id: str, profitable: bool) -> dict:
    """记录模拟盘盈利笔数 / 首笔盈利，返回 {first_win}"""
    if not account_id or account_id.startswith(("npc_", "ai_")):
        return {"first_win": False}
    out = {"first_win": False}

    def mut(stats: dict) -> None:
        total = int(stats.get("trading_closed_total", 0))
        stats["trading_closed_total"] = total + 1
        if profitable and not stats.get("first_trading_win"):
            stats["first_trading_win"] = True
            stats["first_trading_win_at"] = datetime.now(CST).isoformat()
            out["first_win"] = True
        if profitable:
            stats["trading_wins_total"] = int(stats.get("trading_wins_total", 0)) + 1

    _mutate_user_stats(account_id, mut)
    return out


def is_poker_highlight(hand_cat: int, won: int, buy_in: int) -> bool:
    if hand_cat >= HIGHLIGHT_MIN_HAND_CAT:
        return True
    if buy_in > 0 and won >= buy_in * HIGHLIGHT_MIN_WIN_MULT:
        return True
    return False


def publish_poker_highlight(
    user_id: str,
    display_name: str,
    *,
    hand_name: str,
    hand_combo: str,
    community: list,
    hole_cards: list,
    won: int,
    pot: int,
    room_id: str = "",
) -> Optional[int]:
    ts = now_ms()
    body = f"🃏 {display_name} · {hand_name}"
    if won > 0:
        body += f" · 赢得 {won} 积分"
    with _lock:
        with _conn() as c:
            c.execute(
                """INSERT INTO poker_highlights
                   (user_id, display_name, hand_name, hand_combo, community_json,
                    hole_cards_json, won, pot, room_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    user_id, display_name, hand_name, hand_combo,
                    json.dumps(community, ensure_ascii=False),
                    json.dumps(hole_cards, ensure_ascii=False),
                    int(won), int(pot), room_id or "", ts,
                ),
            )
            hid = int(c.execute("SELECT last_insert_rowid()").fetchone()[0])
            c.execute(
                "INSERT INTO chat_messages (channel, user_id, display_name, agent_id, body, kind, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                ("global", user_id, display_name, "", body, "highlight", ts),
            )
    return hid


def list_poker_highlights(since_id: int = 0, limit: int = 20) -> list[dict]:
    with _lock:
        with _conn() as c:
            rows = c.execute(
                """SELECT id, user_id, display_name, hand_name, hand_combo,
                          community_json, hole_cards_json, won, pot, room_id, created_at
                   FROM poker_highlights WHERE id > ? ORDER BY id DESC LIMIT ?""",
                (max(0, since_id), max(1, min(limit, 40))),
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["community"] = json.loads(d.pop("community_json") or "[]")
            d["hole_cards"] = json.loads(d.pop("hole_cards_json") or "[]")
        except Exception:
            d["community"] = []
            d["hole_cards"] = []
        out.append(d)
    return list(reversed(out))


def maybe_push_pending_poker_nudges(account_id: str) -> None:
    """邀请人：好友已注册但未首局扑克时，每日最多提醒一次"""
    today = _today()
    pending = [i for i in list_referral_invitees(account_id) if not i.get("poker_done")]
    if not pending:
        return

    def mut(stats: dict) -> None:
        sent = stats.setdefault("pending_poker_nudge_date", "")
        if sent == today:
            return
        stats["pending_poker_nudge_date"] = today
        names = "、".join(p["name"] for p in pending[:3])
        extra = f" 等 {len(pending)} 人" if len(pending) > 3 else ""
        push_life_notification(
            account_id,
            "referral_pending",
            f"⏳ {names}{extra} 还差 1 局扑克 · 提醒 TA 你可得 +{REFERRAL_INVITER_POKER}",
        )

    _mutate_user_stats(account_id, mut)


def maybe_push_invitee_poker_nudge(invitee_id: str) -> None:
    """被邀请人：注册后尚未打牌，登录时 gentle nudge"""
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT inviter_id FROM referrals WHERE invitee_id=? AND poker_rewarded=0",
                (invitee_id,),
            ).fetchone()
            if not row:
                return
    today = _today()

    def mut(stats: dict) -> None:
        if stats.get("invitee_poker_nudge_date") == today:
            return
        stats["invitee_poker_nudge_date"] = today
        push_life_notification(
            invitee_id,
            "referral_invitee_poker",
            "🃏 打一局德州扑克，帮邀请你的好友解锁 +200 奖励！",
        )

    _mutate_user_stats(invitee_id, mut)


def remind_invitee_poker(inviter_id: str, invitee_id: str) -> dict:
    with _lock:
        with _conn() as c:
            row = c.execute(
                "SELECT 1 FROM referrals WHERE inviter_id=? AND invitee_id=? AND poker_rewarded=0",
                (inviter_id, invitee_id),
            ).fetchone()
            if not row:
                return {"ok": False, "error": "好友已完成首局或不存在"}
            inviter = c.execute(
                "SELECT COALESCE(NULLIF(display_name,''), username, '好友') AS name FROM life_accounts WHERE id=?",
                (inviter_id,),
            ).fetchone()
    inviter_name = inviter["name"] if inviter else "好友"
    push_life_notification(
        invitee_id,
        "referral_nudge",
        f"📣 {inviter_name} 等你来打一局德州扑克！完成首局 TA 得 +{REFERRAL_INVITER_POKER} 积分",
    )
    return {"ok": True, "message": f"已提醒 {invitee_id}"}

