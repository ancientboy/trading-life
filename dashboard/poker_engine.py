"""完整德州扑克引擎 — 多街下注、边池、淘汰制锦标赛"""
from __future__ import annotations

import copy
import random
from typing import Any

from poker_hands import (
    compare_hands,
    evaluate_best,
    hand_combo,
    hand_name,
    make_deck,
    score_key,
    score_to_display,
)

STREETS = ("preflop", "flop", "turn", "river", "showdown")
ACTIONS = ("fold", "check", "call", "raise", "all_in")


def _bb_for_buy_in(buy_in: int) -> int:
    return max(10, buy_in // 50)


def _sb_for_buy_in(buy_in: int) -> int:
    return max(5, _bb_for_buy_in(buy_in) // 2)


def new_tournament_state(
    room_id: str,
    buy_in: int,
    roster: list[dict[str, Any]],
) -> dict[str, Any]:
    """roster: user_id, agent_id, seat_id, name, is_npc, poker_profile"""
    players = []
    for i, r in enumerate(roster):
        players.append({
            "seat_index": i,
            "user_id": r["user_id"],
            "agent_id": r.get("agent_id", ""),
            "seat_id": r.get("seat_id", f"poker_s{i + 1}"),
            "name": r.get("name", r["user_id"]),
            "is_npc": bool(r.get("is_npc")),
            "stack": buy_in,
            "hole_cards": [],
            "folded": False,
            "all_in": False,
            "bet_street": 0,
            "bet_hand": 0,
            "eliminated": False,
            "poker_profile": r.get("poker_profile") or {},
            "soul_md": r.get("soul_md") or "",
        })
    return {
        "room_id": room_id,
        "buy_in": buy_in,
        "big_blind": _bb_for_buy_in(buy_in),
        "small_blind": _sb_for_buy_in(buy_in),
        "hand_number": 0,
        "button_index": 0,
        "phase": "waiting",
        "deck": [],
        "community": [],
        "players": players,
        "pot": 0,
        "side_pots": [],
        "current_bet": 0,
        "min_raise": 0,
        "actor_index": -1,
        "last_aggressor": -1,
        "acted_this_street": [],
        "events": [],
        "status": "playing",
        "winners_last_hand": [],
        "last_reasoning": {},
    }


def _alive_players(state: dict) -> list[dict]:
    return [p for p in state["players"] if not p["eliminated"] and p["stack"] > 0]


def _in_hand(state: dict) -> list[dict]:
    return [p for p in state["players"] if not p["eliminated"] and not p["folded"] and (p["stack"] > 0 or p["all_in"] or p["bet_hand"] > 0)]


def _can_act(p: dict) -> bool:
    return not p["eliminated"] and not p["folded"] and not p["all_in"] and p["stack"] > 0


def _next_seat(state: dict, start: int, predicate) -> int | None:
    n = len(state["players"])
    for step in range(1, n + 1):
        idx = (start + step) % n
        p = state["players"][idx]
        if predicate(p):
            return idx
    return None


def _emit(state: dict, kind: str, payload: dict) -> None:
    state["events"].append({
        "seq": len(state["events"]),
        "kind": kind,
        **payload,
    })


def start_new_hand(state: dict) -> dict:
    alive = _alive_players(state)
    if len(alive) < 2:
        state["status"] = "tournament_complete"
        state["phase"] = "complete"
        _emit(state, "tournament_end", {"alive": len(alive)})
        return state

    state["hand_number"] += 1
    state["phase"] = "preflop"
    state["deck"] = make_deck()
    random.shuffle(state["deck"])
    state["community"] = []
    state["pot"] = 0
    state["side_pots"] = []
    state["current_bet"] = 0
    state["acted_this_street"] = []
    state["last_aggressor"] = -1
    state["winners_last_hand"] = []
    state["last_reasoning"] = {}

    for p in state["players"]:
        p["hole_cards"] = []
        p["folded"] = p["eliminated"] or p["stack"] <= 0
        p["all_in"] = False
        p["bet_street"] = 0
        p["bet_hand"] = 0
        if p["stack"] <= 0 and not p["eliminated"]:
            p["eliminated"] = True
            p["folded"] = True

    # 移动按钮到下一个存活玩家
    if state["hand_number"] > 1:
        nxt = _next_seat(state, state["button_index"], lambda p: not p["eliminated"] and p["stack"] > 0)
        if nxt is not None:
            state["button_index"] = nxt

    idx = 0
    for p in state["players"]:
        if p["folded"]:
            continue
        p["hole_cards"] = [state["deck"][idx], state["deck"][idx + 1]]
        idx += 2
    state["deck"] = state["deck"][idx:]

    bb = state["big_blind"]
    sb = state["small_blind"]
    btn = state["button_index"]
    n_alive = len([p for p in state["players"] if not p["folded"]])

    if n_alive == 2:
        sb_idx = btn
        bb_idx = _next_seat(state, btn, lambda p: not p["folded"]) or btn
    else:
        sb_idx = _next_seat(state, btn, lambda p: not p["folded"])
        bb_idx = _next_seat(state, sb_idx or btn, lambda p: not p["folded"]) if sb_idx is not None else None

    if sb_idx is not None:
        _post_blind(state, sb_idx, sb, "sb")
    if bb_idx is not None:
        _post_blind(state, bb_idx, bb, "bb")

    state["current_bet"] = bb
    state["min_raise"] = bb
    state["last_aggressor"] = bb_idx if bb_idx is not None else -1

    first = _next_seat(state, bb_idx if bb_idx is not None else btn, lambda p: _can_act(p))
    state["actor_index"] = first if first is not None else -1

    _emit(state, "hand_start", {
        "hand_number": state["hand_number"],
        "button_index": btn,
        "small_blind": sb,
        "big_blind": bb,
    })
    return state


def _post_blind(state: dict, seat_idx: int, amount: int, label: str) -> None:
    p = state["players"][seat_idx]
    pay = min(amount, p["stack"])
    p["stack"] -= pay
    p["bet_street"] += pay
    p["bet_hand"] += pay
    state["pot"] += pay
    if p["stack"] == 0:
        p["all_in"] = True
    _emit(state, "blind", {"seat_index": seat_idx, "name": p["name"], "amount": pay, "label": label})


def legal_actions(state: dict, seat_idx: int) -> list[dict]:
    if state["phase"] == "showdown" or state["status"] != "playing":
        return []
    p = state["players"][seat_idx]
    if not _can_act(p) or state["actor_index"] != seat_idx:
        return []

    to_call = state["current_bet"] - p["bet_street"]
    acts: list[dict] = [{"action": "fold"}]

    if to_call <= 0:
        acts.append({"action": "check"})
    else:
        acts.append({"action": "call", "amount": min(to_call, p["stack"])})

    if p["stack"] > to_call:
        min_raise_total = state["current_bet"] + state["min_raise"]
        raise_amt = min(p["stack"], max(min_raise_total - p["bet_street"], state["min_raise"]))
        if raise_amt > 0 and (p["stack"] - to_call) >= state["min_raise"] or to_call == 0:
            acts.append({"action": "raise", "min": min_raise_total, "max": p["bet_street"] + p["stack"]})
    if p["stack"] > 0:
        acts.append({"action": "all_in", "amount": p["stack"]})
    return acts


def apply_action(state: dict, seat_idx: int, action: str, amount: int = 0) -> dict:
    if state["actor_index"] != seat_idx:
        return {"ok": False, "error": "非当前行动玩家"}
    legal = {a["action"]: a for a in legal_actions(state, seat_idx)}
    if action not in legal:
        return {"ok": False, "error": f"非法动作: {action}"}

    p = state["players"][seat_idx]
    to_call = state["current_bet"] - p["bet_street"]

    if action == "fold":
        p["folded"] = True
        _emit(state, "action", {"seat_index": seat_idx, "name": p["name"], "action": "fold"})

    elif action == "check":
        if to_call > 0:
            return {"ok": False, "error": "不能过牌"}
        _emit(state, "action", {"seat_index": seat_idx, "name": p["name"], "action": "check"})

    elif action == "call":
        pay = min(to_call, p["stack"])
        p["stack"] -= pay
        p["bet_street"] += pay
        p["bet_hand"] += pay
        state["pot"] += pay
        if p["stack"] == 0:
            p["all_in"] = True
        _emit(state, "action", {"seat_index": seat_idx, "name": p["name"], "action": "call", "amount": pay})

    elif action == "raise":
        target = max(amount, state["current_bet"] + state["min_raise"])
        add = target - p["bet_street"]
        add = min(add, p["stack"])
        p["stack"] -= add
        p["bet_street"] += add
        p["bet_hand"] += add
        state["pot"] += add
        if add > 0:
            state["min_raise"] = max(state["min_raise"], p["bet_street"] - state["current_bet"])
        state["current_bet"] = max(state["current_bet"], p["bet_street"])
        state["last_aggressor"] = seat_idx
        if p["stack"] == 0:
            p["all_in"] = True
        _emit(state, "action", {"seat_index": seat_idx, "name": p["name"], "action": "raise", "amount": add, "total": p["bet_street"]})

    elif action == "all_in":
        pay = p["stack"]
        p["stack"] = 0
        p["bet_street"] += pay
        p["bet_hand"] += pay
        state["pot"] += pay
        p["all_in"] = True
        if p["bet_street"] > state["current_bet"]:
            state["min_raise"] = max(state["min_raise"], p["bet_street"] - state["current_bet"])
            state["current_bet"] = p["bet_street"]
            state["last_aggressor"] = seat_idx
        _emit(state, "action", {"seat_index": seat_idx, "name": p["name"], "action": "all_in", "amount": pay})

    else:
        return {"ok": False, "error": "未知动作"}

    if seat_idx not in state["acted_this_street"]:
        state["acted_this_street"].append(seat_idx)

    _advance_after_action(state)
    return {"ok": True}


def _active_bettors(state: dict) -> list[dict]:
    return [p for p in state["players"] if not p["folded"] and not p["eliminated"] and (p["stack"] > 0 or p["all_in"])]


def _street_settled(state: dict) -> bool:
    active = [p for p in state["players"] if not p["folded"] and not p["eliminated"]]
    if len(active) <= 1:
        return True
    can = [p for p in active if _can_act(p)]
    if not can:
        return True
    for p in can:
        if p["bet_street"] < state["current_bet"]:
            return False
        if p["seat_index"] not in state["acted_this_street"]:
            return False
    return True


def _advance_after_action(state: dict) -> None:
    active = [p for p in state["players"] if not p["folded"] and not p["eliminated"]]
    if len(active) == 1:
        _award_uncontested(state, active[0])
        return

    if _street_settled(state):
        _advance_street(state)
        return

    nxt = _next_seat(state, state["actor_index"], lambda p: _can_act(p))
    state["actor_index"] = nxt if nxt is not None else -1


def _advance_street(state: dict) -> None:
    for p in state["players"]:
        p["bet_street"] = 0
    state["current_bet"] = 0
    state["min_raise"] = state["big_blind"]
    state["acted_this_street"] = []
    state["last_aggressor"] = -1

    phase = state["phase"]
    if phase == "preflop":
        state["community"].extend([state["deck"].pop() for _ in range(3)])
        state["phase"] = "flop"
        _emit(state, "street", {"phase": "flop", "community": list(state["community"])})
    elif phase == "flop":
        state["community"].append(state["deck"].pop())
        state["phase"] = "turn"
        _emit(state, "street", {"phase": "turn", "community": list(state["community"])})
    elif phase == "turn":
        state["community"].append(state["deck"].pop())
        state["phase"] = "river"
        _emit(state, "street", {"phase": "river", "community": list(state["community"])})
    elif phase == "river":
        _run_showdown(state)
        return
    else:
        return

    can = [p for p in state["players"] if _can_act(p)]
    if not can:
        _advance_street(state)
        return
    first = _next_seat(state, state["button_index"], lambda p: _can_act(p))
    state["actor_index"] = first if first is not None else -1


def _award_uncontested(state: dict, winner: dict) -> None:
    win_amt = state["pot"]
    winner["stack"] += win_amt
    state["winners_last_hand"] = [{"seat_index": winner["seat_index"], "name": winner["name"], "amount": win_amt}]
    _emit(state, "win", {"seat_index": winner["seat_index"], "name": winner["name"], "amount": win_amt, "reason": "fold"})
    state["pot"] = 0
    state["phase"] = "showdown"
    _finish_hand(state)


def _run_showdown(state: dict) -> None:
    state["phase"] = "showdown"
    contenders = [p for p in state["players"] if not p["folded"] and not p["eliminated"]]
    if not contenders:
        _finish_hand(state)
        return

    ranked = []
    for p in contenders:
        score, best = evaluate_best(p["hole_cards"] + state["community"])
        ranked.append((p, score, best))

    ranked.sort(key=lambda x: x[1], reverse=True)
    best_score = ranked[0][1]
    winners = [x for x in ranked if compare_hands(x[1], best_score) == 0]

    pot = state["pot"]
    share = pot // len(winners)
    extra = pot - share * len(winners)
    state["winners_last_hand"] = []
    for i, (p, score, best) in enumerate(winners):
        amt = share + (1 if i < extra else 0)
        p["stack"] += amt
        state["winners_last_hand"].append({
            "seat_index": p["seat_index"],
            "name": p["name"],
            "amount": amt,
            "hand_name": hand_name(score),
            "hand_combo": hand_combo(score, best),
            "hole_cards": p["hole_cards"],
            "best_cards": best,
            "score": score_to_display(score),
        })
        _emit(state, "showdown", {
            "seat_index": p["seat_index"],
            "name": p["name"],
            "amount": amt,
            "hand_name": hand_name(score),
            "hole_cards": p["hole_cards"],
            "best_cards": best,
        })

    state["pot"] = 0
    _finish_hand(state)


def _finish_hand(state: dict) -> None:
    for p in state["players"]:
        if p["stack"] <= 0 and not p["eliminated"]:
            p["eliminated"] = True
            _emit(state, "eliminated", {"seat_index": p["seat_index"], "name": p["name"]})

    alive = _alive_players(state)
    if len(alive) <= 1:
        state["status"] = "tournament_complete"
        state["phase"] = "complete"
        if alive:
            _emit(state, "tournament_end", {"winner": alive[0]["name"], "seat_index": alive[0]["seat_index"]})
        return

    state["phase"] = "between_hands"
    state["actor_index"] = -1


def resolve_stuck_state(state: dict) -> bool:
    """解除 actor_index=-1 或 phase=showdown 等僵局，返回是否改动了状态"""
    if state["status"] != "playing":
        return False

    if state["phase"] == "showdown":
        state["phase"] = "between_hands"
        state["actor_index"] = -1
        return True

    if state["phase"] in ("between_hands", "waiting", "complete"):
        return False

    if state.get("actor_index", -1) >= 0:
        return False

    if _street_settled(state):
        _advance_street(state)
        return True

    can = [p for p in state["players"] if _can_act(p)]
    for p in can:
        if p["bet_street"] < state["current_bet"] or p["seat_index"] not in state["acted_this_street"]:
            state["actor_index"] = p["seat_index"]
            return True

    if not can:
        _advance_street(state)
        return True

    first = _next_seat(state, state["button_index"], lambda p: _can_act(p))
    if first is not None:
        state["actor_index"] = first
        return True

    _advance_street(state)
    return True


def start_next_hand_if_ready(state: dict) -> dict:
    if state["status"] == "tournament_complete":
        return state
    if state["phase"] == "showdown":
        state["phase"] = "between_hands"
        state["actor_index"] = -1
    if state["phase"] not in ("between_hands", "waiting", "complete"):
        return state
    return start_new_hand(state)


def public_state(state: dict, viewer_user_id: str | None = None, since_seq: int = 0, spectator_mode: bool = False) -> dict:
    """观赛视角 — 观赛模式公开所有底牌，便于理解决策"""
    show_all_holes = spectator_mode or state["phase"] in ("showdown", "complete", "between_hands")
    players_out = []
    for p in state["players"]:
        has_cards = bool(p.get("hole_cards")) and p["hole_cards"][0] != "??"
        reveal = show_all_holes or (not p["folded"] and state["phase"] == "showdown")
        if not reveal and viewer_user_id and p["user_id"] == viewer_user_id:
            reveal = True
        hole = list(p["hole_cards"]) if (reveal and has_cards) else (["??", "??"] if p.get("hole_cards") else [])
        players_out.append({
            "seat_index": p["seat_index"],
            "user_id": p["user_id"],
            "agent_id": p["agent_id"],
            "seat_id": p["seat_id"],
            "name": p["name"],
            "is_npc": p["is_npc"],
            "stack": p["stack"],
            "hole_cards": hole,
            "folded": p["folded"],
            "all_in": p["all_in"],
            "bet_street": p["bet_street"],
            "eliminated": p["eliminated"],
            "poker_preset": (p.get("poker_profile") or {}).get("preset", "tag"),
        })
    events = [e for e in state["events"] if e.get("seq", 0) >= since_seq]
    return {
        "room_id": state["room_id"],
        "buy_in": state["buy_in"],
        "hand_number": state["hand_number"],
        "phase": state["phase"],
        "status": state["status"],
        "community": list(state["community"]),
        "pot": state["pot"],
        "current_bet": state["current_bet"],
        "actor_index": state["actor_index"],
        "actor_name": state["players"][state["actor_index"]]["name"] if state["actor_index"] >= 0 else "",
        "button_index": state["button_index"],
        "big_blind": state["big_blind"],
        "small_blind": state["small_blind"],
        "players": players_out,
        "winners_last_hand": state.get("winners_last_hand") or [],
        "events": events,
        "event_count": len(state["events"]),
        "last_reasoning": state.get("last_reasoning") or {},
    }


def clone_state(state: dict) -> dict:
    return copy.deepcopy(state)
