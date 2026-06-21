#!/usr/bin/env python3
"""Life WebSocket 集成冒烟测试（本地或远程）。"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.error
import urllib.request
from typing import Any

import websockets

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9095"
API = BASE.rstrip("/").replace("ws://", "http://").replace("wss://", "https://")
if API.endswith("/api/life"):
    API_ROOT = API
else:
    API_ROOT = f"{API}/api/life"
WS_BASE = API_ROOT.replace("https://", "wss://").replace("http://", "ws://")
WS_URL = WS_BASE.replace("/api/life", "/api/life/ws")


def http_json(method: str, path: str, body: dict | None = None, token: str = "") -> dict:
    url = f"{API_ROOT}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"ok": False, "error": raw, "status": e.code}


async def ws_roundtrip(token: str) -> None:
    url = f"{WS_URL}?token={token}"
    async with websockets.connect(url, open_timeout=15) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert hello.get("type") == "connected", hello

        await ws.send(json.dumps({"action": "subscribe", "channels": ["arena:live", "guess:current"]}))
        got_arena = False
        got_guess = False
        for _ in range(20):
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            t = msg.get("type")
            if t == "arena.live" and msg.get("payload", {}).get("ok"):
                got_arena = True
            if t == "guess.current" and msg.get("payload", {}).get("ok"):
                got_guess = True
            if got_arena and got_guess:
                break
        assert got_arena, "未收到 arena.live 推送"
        assert got_guess, "未收到 guess.current 推送"

        agent = http_json("POST", "/agents/quick-create", {
            "agentType": "trading",
            "name": "观赛测试交易员",
        }, token)
        if not agent.get("ok"):
            print("  skip advanced tick: 无法创建 Agent")
            return
        agent_id = (agent.get("agent") or {}).get("id") or agent.get("agent_id") or ""
        if not agent_id:
            print("  skip advanced tick: 未返回 agent id")
            return
        start = http_json("POST", "/pvp/poker/ai-spectator/start", {
            "agent_id": agent_id,
            "buy_in": 1000,
            "num_players": 3,
        }, token)
        if not start.get("ok"):
            print(f"  skip advanced tick: {start.get('error')}")
            return
        assert start.get("ok"), start
        room_id = start["room_id"]
        await ws.send(json.dumps({"action": "subscribe", "channels": [f"poker:advanced:{room_id}"]}))

        req_id = "test_adv_1"
        await ws.send(json.dumps({
            "action": "advanced.tick",
            "request_id": req_id,
            "room_id": room_id,
            "since_seq": 0,
            "auto_run": True,
            "max_steps": 1,
        }))
        got_adv = False
        for _ in range(30):
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
            if msg.get("type") != "poker.advanced.state":
                continue
            payload = msg.get("payload") or {}
            if payload.get("request_id") == req_id and payload.get("ok"):
                got_adv = True
                assert payload.get("game"), payload
                break
        assert got_adv, "未收到 poker.advanced.state 响应"
        print(f"  advanced tick ok: room={room_id} events={payload.get('game', {}).get('event_count')}")


def main() -> int:
    print(f"==> API: {API_ROOT}")
    print(f"==> WS:  {WS_URL}")

    user = f"ws_test_{int(__import__('time').time())}"
    reg = http_json("POST", "/auth/register", {
        "username": user,
        "password": "testpass123",
        "display_name": "WS测试",
    })
    assert reg.get("ok"), reg
    token = reg["token"]
    print(f"==> 注册成功: {user}")

    me = http_json("GET", "/auth/me", token=token)
    assert me.get("ok"), me

    asyncio.run(ws_roundtrip(token))
    print("==> WebSocket 冒烟测试通过")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"FAILED: {e}", file=sys.stderr)
        raise
