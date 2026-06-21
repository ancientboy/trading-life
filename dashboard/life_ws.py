"""
交易人生 — 原生 WebSocket 推送（扑克房间 / 竞技馆 / 猜涨跌）
REST 写操作 + WS 订阅推送；断线后客户端可 REST 兜底轮询。
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

import life_db

ws_router = APIRouter()

LIVE_TICK_SEC = 3.0
HEARTBEAT_SEC = 25.0


@dataclass
class WsClient:
    websocket: WebSocket
    account_id: str
    client_id: int
    subscriptions: set[str] = field(default_factory=set)
    last_pong: float = field(default_factory=time.time)
    advanced_since: dict[str, int] = field(default_factory=dict)


class LifeWsHub:
    def __init__(self) -> None:
        self._clients: dict[int, WsClient] = {}
        self._channel_map: dict[str, set[int]] = {}
        self._next_id = 1
        self._seq = 0
        self._broadcast_task: Optional[asyncio.Task] = None
        self._pending_poker: set[str] = set()
        self._pending_advanced: set[str] = set()
        self._pending_arena = False
        self._pending_guess = False

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    async def connect(self, websocket: WebSocket, account_id: str) -> WsClient:
        await websocket.accept()
        cid = self._next_id
        self._next_id += 1
        client = WsClient(websocket=websocket, account_id=account_id, client_id=cid)
        self._clients[cid] = client
        self._ensure_broadcast_task()
        return client

    def disconnect(self, client_id: int) -> None:
        client = self._clients.pop(client_id, None)
        if not client:
            return
        for ch in list(client.subscriptions):
            self._unsubscribe_client(client_id, ch)

    def subscribe(self, client_id: int, channel: str) -> None:
        client = self._clients.get(client_id)
        if not client or not channel:
            return
        client.subscriptions.add(channel)
        self._channel_map.setdefault(channel, set()).add(client_id)

    def unsubscribe(self, client_id: int, channel: str) -> None:
        self._unsubscribe_client(client_id, channel)
        client = self._clients.get(client_id)
        if client:
            client.subscriptions.discard(channel)

    def _unsubscribe_client(self, client_id: int, channel: str) -> None:
        subs = self._channel_map.get(channel)
        if subs:
            subs.discard(client_id)
            if not subs:
                del self._channel_map[channel]

    def has_subscribers(self, channel: str) -> bool:
        return bool(self._channel_map.get(channel))

    async def send_json(self, client: WsClient, msg_type: str, payload: Any) -> None:
        envelope = {
            "type": msg_type,
            "seq": self._next_seq(),
            "ts": life_db.now_ms(),
            "payload": payload,
        }
        await client.websocket.send_text(json.dumps(envelope, ensure_ascii=False))

    async def broadcast_channel(
        self,
        channel: str,
        msg_type: str,
        build_payload: Callable[[str], Awaitable[Any]],
    ) -> None:
        client_ids = list(self._channel_map.get(channel, ()))
        if not client_ids:
            return
        for cid in client_ids:
            client = self._clients.get(cid)
            if not client:
                continue
            try:
                payload = await build_payload(client.account_id)
                await self.send_json(client, msg_type, payload)
            except Exception:
                pass

    def schedule_poker_room(self, room_id: str) -> None:
        if room_id:
            self._pending_poker.add(room_id)
            self._ensure_broadcast_task()

    def schedule_advanced(self, room_id: str) -> None:
        if room_id:
            self._pending_advanced.add(room_id)
            self._ensure_broadcast_task()

    def schedule_arena(self) -> None:
        self._pending_arena = True
        self._ensure_broadcast_task()

    def schedule_guess(self) -> None:
        self._pending_guess = True
        self._ensure_broadcast_task()

    def _ensure_broadcast_task(self) -> None:
        if self._broadcast_task and not self._broadcast_task.done():
            return
        try:
            loop = asyncio.get_running_loop()
            self._broadcast_task = loop.create_task(self._broadcast_loop())
        except RuntimeError:
            pass

    async def _broadcast_loop(self) -> None:
        while True:
            try:
                await self._flush_pending()
                if self.has_subscribers("arena:live") or self.has_subscribers("guess:current"):
                    await self._tick_live_channels()
            except Exception:
                pass
            await asyncio.sleep(LIVE_TICK_SEC)

    async def _flush_pending(self) -> None:
        poker_ids = list(self._pending_poker)
        self._pending_poker.clear()
        for rid in poker_ids:
            await broadcast_poker_room(rid)

        advanced_ids = list(self._pending_advanced)
        self._pending_advanced.clear()
        for rid in advanced_ids:
            await broadcast_poker_advanced(rid)

        if self._pending_arena:
            self._pending_arena = False
            await broadcast_arena_live()

        if self._pending_guess:
            self._pending_guess = False
            await broadcast_guess_current()

    async def _tick_live_channels(self) -> None:
        if self.has_subscribers("arena:live"):
            await broadcast_arena_live()
        if self.has_subscribers("guess:current"):
            await broadcast_guess_current()


hub = LifeWsHub()


async def _build_poker_payload(room_id: str, account_id: str) -> dict:
    from life_engagement import _resolve_room_id, _room_payload, _human_count_in_room, _close_poker_room

    with life_db._lock:
        with life_db._conn() as c:
            rid = _resolve_room_id(c, room_id)
            if not rid:
                return {"ok": False, "error": "房间不存在", "room": None}
            room = c.execute("SELECT * FROM poker_rooms WHERE id=?", (rid,)).fetchone()
            if not room:
                return {"ok": False, "error": "房间不存在", "room": None}
            room = dict(room)
            if room["status"] == "waiting" and _human_count_in_room(c, rid) == 0:
                _close_poker_room(c, rid)
                return {"ok": False, "error": "房间已关闭（无人）", "room": None}
            if room["status"] in ("closed", "settled"):
                return {"ok": False, "error": "房间已关闭", "room": None}
            payload = _room_payload(c, room, account_id)
    return {"ok": True, "room": payload}


async def broadcast_poker_room(room_id: str) -> None:
    channel = f"poker:room:{room_id}"

    async def build(account_id: str) -> dict:
        return await _build_poker_payload(room_id, account_id)

    await hub.broadcast_channel(channel, "poker.room.state", build)


async def _push_advanced_state(
    client: WsClient,
    room_id: str,
    since_seq: int,
    auto_run: bool,
    max_steps: int,
    request_id: str = "",
    push: bool = False,
) -> dict:
    from poker_advanced import get_advanced_state

    client.advanced_since[room_id] = since_seq
    cap = 80
    out = await get_advanced_state(
        room_id,
        client.account_id,
        since_seq=since_seq,
        auto_run=auto_run,
        max_steps=max(0, min(max_steps, cap)),
    )
    payload = {**out, "request_id": request_id, "push": push}
    await hub.send_json(client, "poker.advanced.state", payload)
    return out


async def handle_advanced_tick(client: WsClient, data: dict) -> None:
    room_id = str(data.get("room_id") or "").strip()
    if not room_id:
        await hub.send_json(client, "poker.advanced.state", {
            "ok": False,
            "error": "缺少 room_id",
            "request_id": data.get("request_id", ""),
        })
        return

    since_seq = int(data.get("since_seq") or 0)
    auto_run = data.get("auto_run", True)
    if isinstance(auto_run, str):
        auto_run = auto_run.lower() not in ("false", "0", "no")
    max_steps = int(data.get("max_steps") if data.get("max_steps") is not None else 1)
    request_id = str(data.get("request_id") or "")

    await _push_advanced_state(
        client, room_id, since_seq, bool(auto_run), max_steps, request_id=request_id,
    )

    if auto_run and max_steps > 0:
        await notify_advanced_peers(room_id, client.client_id)


async def push_guess_snapshot(client: WsClient) -> None:
    payload = await _build_guess_payload(client.account_id)
    await hub.send_json(client, "guess.current", payload)


async def push_arena_snapshot(client: WsClient) -> None:
    payload = await _build_arena_payload(client.account_id)
    await hub.send_json(client, "arena.live", payload)


async def push_advanced_snapshot(client: WsClient, room_id: str) -> None:
    since = client.advanced_since.get(room_id, 0)
    await _push_advanced_state(client, room_id, since, False, 0, push=True)


async def notify_advanced_peers(room_id: str, driver_client_id: int) -> None:
    channel = f"poker:advanced:{room_id}"
    for cid in list(hub._channel_map.get(channel, ())):
        if cid == driver_client_id:
            continue
        peer = hub._clients.get(cid)
        if not peer:
            continue
        since = peer.advanced_since.get(room_id, 0)
        try:
            await _push_advanced_state(peer, room_id, since, False, 0, push=True)
        except Exception:
            pass


async def broadcast_poker_advanced(room_id: str) -> None:
    channel = f"poker:advanced:{room_id}"
    for cid in list(hub._channel_map.get(channel, ())):
        client = hub._clients.get(cid)
        if not client:
            continue
        since = client.advanced_since.get(room_id, 0)
        try:
            await _push_advanced_state(client, room_id, since, False, 0, push=True)
        except Exception:
            pass


async def _build_arena_payload(account_id: str) -> dict:
    from trading_events import _arena_payload, _recent_first_flag

    last_settled_payload = None
    payload = None
    with life_db._lock:
        with life_db._conn() as c:
            row = c.execute(
                "SELECT * FROM arena_rounds WHERE status IN ('join','running') ORDER BY starts_at DESC LIMIT 1"
            ).fetchone()
            if row:
                payload = _arena_payload(c, dict(row), account_id)
            prev = c.execute(
                "SELECT * FROM arena_rounds WHERE status='settled' ORDER BY ends_at DESC LIMIT 1"
            ).fetchone()
            if prev:
                last_settled_payload = _arena_payload(c, dict(prev), account_id)
                if account_id:
                    from life_game import load_user

                    stats = (load_user(account_id).get("stats") or {})
                    my = last_settled_payload.get("my_entry")
                    if my and my.get("rank") and int(my["rank"]) <= 3:
                        last_settled_payload["first_podium"] = _recent_first_flag(
                            stats, "first_arena_podium_at", prev["ends_at"],
                        )
    return {"ok": True, "current": payload, "last_settled": last_settled_payload}


async def broadcast_arena_live() -> None:
    async def build(account_id: str) -> dict:
        return await _build_arena_payload(account_id)

    await hub.broadcast_channel("arena:live", "arena.live", build)


async def _build_guess_payload(account_id: str) -> dict:
    from trading_events import _guess_payload, _recent_first_flag

    with life_db._lock:
        with life_db._conn() as c:
            row = c.execute(
                "SELECT * FROM guess_rounds WHERE status IN ('open','running') ORDER BY starts_at DESC LIMIT 1"
            ).fetchone()
            if not row:
                row = c.execute(
                    "SELECT * FROM guess_rounds ORDER BY starts_at DESC LIMIT 1"
                ).fetchone()
            payload = _guess_payload(c, dict(row), account_id) if row else None
            prev = c.execute(
                "SELECT * FROM guess_rounds WHERE status='settled' ORDER BY ends_at DESC LIMIT 1"
            ).fetchone()
            last_my = None
            last_pk = None
            if prev and account_id:
                bet_row = c.execute(
                    "SELECT * FROM guess_bets WHERE round_id=? AND user_id=?",
                    (prev["id"], account_id),
                ).fetchone()
                if bet_row:
                    last_my = dict(bet_row)
                    ws = prev["winner_side"] if "winner_side" in prev.keys() else None
                    if not ws and prev.get("end_price") and prev.get("start_price"):
                        sp, ep = float(prev["start_price"]), float(prev["end_price"])
                        ws = "tie" if abs(ep - sp) < 1e-9 else ("up" if ep > sp else "down")
                    last_my["won"] = bool(ws and ws != "tie" and last_my["direction"] == ws)
                    if last_my.get("won") and account_id:
                        from life_game import load_user

                        stats = (load_user(account_id).get("stats") or {})
                        last_my["first_win"] = _recent_first_flag(
                            stats, "first_guess_win_at", prev["ends_at"],
                        )
                        from trading_modes import get_pending_leverage

                        pl = get_pending_leverage(stats)
                        if pl:
                            last_my["pending_leverage"] = pl
                from trading_modes import PK_RAKE, _display_name as _pk_name

                pk_row = c.execute(
                    """SELECT * FROM guess_pk_rooms
                       WHERE round_id=? AND status='settled'
                       AND (user_a=? OR user_b=?)
                       ORDER BY settled_at DESC LIMIT 1""",
                    (prev["id"], account_id, account_id),
                ).fetchone()
                if pk_row:
                    room = dict(pk_row)
                    ws = prev["winner_side"] if "winner_side" in prev.keys() else ""
                    if not ws and prev.get("end_price") and prev.get("start_price"):
                        sp, ep = float(prev["start_price"]), float(prev["end_price"])
                        ws = "tie" if abs(ep - sp) < 1e-9 else ("up" if ep > sp else "down")
                    is_a = room["user_a"] == account_id
                    my_dir = room["dir_a"] if is_a else room["dir_b"]
                    won = room["winner_id"] == account_id
                    opp_id = room["user_b"] if is_a else room["user_a"]
                    opp_name = "AI 对手" if str(opp_id).startswith("npc_") else _pk_name(opp_id)
                    from life_game import load_user

                    stats = (load_user(account_id).get("stats") or {})
                    streak = int(stats.get("daily_modes", {}).get("pk_streak", 0)) if won else 0
                    last_pk = {
                        "won": won,
                        "my_direction": my_dir,
                        "winner_side": ws,
                        "opponent_name": opp_name,
                        "stake": int(room["stake"]),
                        "won_amount": int(room["stake"] * 2 * (1 - PK_RAKE)) if won else 0,
                        "streak": streak,
                        "round_id": room["round_id"],
                    }
    last = dict(prev) if prev else None
    if last and last_my:
        last["my_bet"] = last_my
    return {
        "ok": True,
        "current": payload,
        "last_settled": last,
        "last_my_bet": last_my,
        "last_pk_result": last_pk,
    }


async def broadcast_guess_current() -> None:
    async def build(account_id: str) -> dict:
        return await _build_guess_payload(account_id)

    await hub.broadcast_channel("guess:current", "guess.current", build)


def schedule_poker_room_broadcast(room_id: str) -> None:
    hub.schedule_poker_room(room_id)


def schedule_advanced_broadcast(room_id: str) -> None:
    hub.schedule_advanced(room_id)


def schedule_arena_broadcast() -> None:
    hub.schedule_arena()


def schedule_guess_broadcast() -> None:
    hub.schedule_guess()


@ws_router.websocket("/ws")
async def life_websocket(websocket: WebSocket, token: str = Query("")):
    account_id = life_db.resolve_session_token((token or "").strip()) if token else None
    if not account_id:
        await websocket.close(code=4001, reason="unauthorized")
        return

    client = await hub.connect(websocket, account_id)
    try:
        await hub.send_json(client, "connected", {"account_id": account_id})
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=HEARTBEAT_SEC)
            except asyncio.TimeoutError:
                try:
                    await hub.send_json(client, "ping", {})
                except Exception:
                    break
                continue

            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = (data.get("action") or "").strip().lower()
            if action == "subscribe":
                for ch in data.get("channels") or []:
                    if isinstance(ch, str) and ch:
                        hub.subscribe(client.client_id, ch)
                        if ch == "arena:live":
                            asyncio.create_task(push_arena_snapshot(client))
                        elif ch == "guess:current":
                            asyncio.create_task(push_guess_snapshot(client))
                        elif ch.startswith("poker:advanced:"):
                            adv_room = ch[len("poker:advanced:"):]
                            if adv_room:
                                asyncio.create_task(push_advanced_snapshot(client, adv_room))
            elif action == "unsubscribe":
                for ch in data.get("channels") or []:
                    if isinstance(ch, str) and ch:
                        hub.unsubscribe(client.client_id, ch)
                        if ch.startswith("poker:advanced:"):
                            adv_room = ch[len("poker:advanced:"):]
                            client.advanced_since.pop(adv_room, None)
            elif action == "advanced.tick":
                await handle_advanced_tick(client, data)
            elif action == "ping":
                client.last_pong = time.time()
                await hub.send_json(client, "pong", {})
            elif action == "pong":
                client.last_pong = time.time()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        hub.disconnect(client.client_id)
