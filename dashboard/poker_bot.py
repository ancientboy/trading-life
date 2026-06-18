"""德州扑克 AI 决策 — 参数化风格 + 可选 LLM 辅助"""
from __future__ import annotations

import random
from typing import Any

from poker_hands import evaluate_best, rank_index, RANKS

POKER_PRESETS: dict[str, dict[str, Any]] = {
    "tag": {"label": "紧凶 TAG", "vpip": 0.22, "pfr": 0.18, "aggression": 0.72, "bluff_freq": 0.08, "fold_to_raise": 0.55},
    "lag": {"label": "松凶 LAG", "vpip": 0.38, "pfr": 0.28, "aggression": 0.82, "bluff_freq": 0.18, "fold_to_raise": 0.38},
    "tight": {"label": "紧弱 Rock", "vpip": 0.14, "pfr": 0.10, "aggression": 0.35, "bluff_freq": 0.03, "fold_to_raise": 0.68},
    "loose": {"label": "松弱 Fish", "vpip": 0.48, "pfr": 0.12, "aggression": 0.28, "bluff_freq": 0.10, "fold_to_raise": 0.25},
    "maniac": {"label": "疯子 Maniac", "vpip": 0.62, "pfr": 0.45, "aggression": 0.95, "bluff_freq": 0.35, "fold_to_raise": 0.15},
    "balanced": {"label": "均衡 Pro", "vpip": 0.26, "pfr": 0.20, "aggression": 0.58, "bluff_freq": 0.12, "fold_to_raise": 0.48},
}

# 翻前起手牌强度 (0-1)
_PREMIUM = {"AA", "KK", "QQ", "JJ", "AKs", "AKo", "AQs"}
_STRONG = _PREMIUM | {"TT", "99", "AJs", "KQs", "AQo", "ATs", "KJs"}
_PLAYABLE = _STRONG | {"88", "77", "66", "A9s", "A8s", "QJs", "JTs", "T9s", "KQo", "AJo"}


def default_profile(preset: str = "tag") -> dict[str, Any]:
    base = dict(POKER_PRESETS.get(preset, POKER_PRESETS["tag"]))
    base["preset"] = preset
    base["notes"] = ""
    base["stats"] = {"hands": 0, "wins": 0, "vpip_hits": 0, "pfr_hits": 0}
    return base


def merge_profile(raw: dict | None) -> dict[str, Any]:
    if not raw:
        return default_profile()
    preset = raw.get("preset") or "tag"
    out = default_profile(preset)
    for k in ("vpip", "pfr", "aggression", "bluff_freq", "fold_to_raise", "notes"):
        if k in raw and raw[k] is not None:
            out[k] = raw[k]
    if "stats" in raw and isinstance(raw["stats"], dict):
        out["stats"] = {**out["stats"], **raw["stats"]}
    return out


def _hole_key(cards: list[str]) -> str:
    if len(cards) < 2 or cards[0] == "??":
        return "??"
    r1, r2 = rank_index(cards[0]), rank_index(cards[1])
    s1, s2 = cards[0][1], cards[1][1]
    hi, lo = (r1, r2) if r1 >= r2 else (r2, r1)
    suited = "s" if s1 == s2 else "o"
    if hi == lo:
        return RANKS[hi] * 2
    return RANKS[hi] + RANKS[lo] + suited


def preflop_strength(cards: list[str]) -> float:
    key = _hole_key(cards)
    if key in _PREMIUM:
        return 0.95
    if key in _STRONG:
        return 0.78
    if key in _PLAYABLE:
        return 0.55
    if key == "??":
        return 0.5
    hi = max(rank_index(cards[0]), rank_index(cards[1]))
    if hi >= 10:
        return 0.35
    return 0.15 + random.uniform(0, 0.1)


def hand_strength(state: dict, seat_idx: int) -> float:
    p = state["players"][seat_idx]
    cards = p["hole_cards"]
    if not cards or cards[0] == "??":
        return 0.5
    comm = state.get("community") or []
    if not comm:
        return preflop_strength(cards)
    score, _ = evaluate_best(cards + comm)
    cat = score[0]
    return min(0.99, 0.12 + cat * 0.09 + (score[1] if len(score) > 1 else 0) * 0.004)


def _score_action(action: str, amount: int, ctx: dict, profile: dict) -> float:
    strength = ctx["strength"]
    pot_odds = ctx["pot_odds"]
    to_call = ctx["to_call"]
    aggression = profile["aggression"]
    bluff = profile["bluff_freq"]
    fold_to = profile["fold_to_raise"]

    if action == "fold":
        if strength < 0.25 and to_call > ctx["bb"]:
            return 0.7 + fold_to * 0.2
        if to_call > ctx["stack"] * 0.4 and strength < 0.5:
            return 0.6
        return 0.15

    if action == "check":
        if to_call > 0:
            return -1
        if strength < 0.4:
            return 0.55
        return 0.35

    if action == "call":
        if strength + 0.08 >= pot_odds:
            return 0.5 + strength * 0.5
        if strength > 0.35 and to_call < ctx["pot"] * 0.25:
            return 0.45
        return 0.2

    if action == "raise":
        if strength > 0.72:
            return 0.85 + aggression * 0.1
        if strength > 0.45 and aggression > 0.5:
            return 0.55 + aggression * 0.25
        if strength < 0.3 and bluff > random.random():
            return 0.4 + bluff
        return 0.1

    if action == "all_in":
        if strength > 0.88:
            return 0.95
        if strength > 0.6 and ctx["stack"] < ctx["bb"] * 8:
            return 0.75
        if strength < 0.35:
            return 0.05 + bluff * 0.3
        return 0.35 + aggression * 0.2

    return 0


def decide_action(state: dict, seat_idx: int, profile: dict | None = None) -> tuple[str, int, str]:
    """返回 (action, amount, reasoning)"""
    from poker_engine import legal_actions

    profile = merge_profile(profile)
    acts = legal_actions(state, seat_idx)
    if not acts:
        return "check", 0, "无合法动作"

    p = state["players"][seat_idx]
    to_call = state["current_bet"] - p["bet_street"]
    pot = state["pot"] + to_call
    pot_odds = to_call / (pot + to_call) if to_call > 0 else 0
    strength = hand_strength(state, seat_idx)
    phase = state["phase"]

    ctx = {
        "strength": strength,
        "pot_odds": pot_odds,
        "to_call": to_call,
        "pot": state["pot"],
        "bb": state["big_blind"],
        "stack": p["stack"],
        "phase": phase,
    }

    # 翻前紧弱过滤
    if phase == "preflop" and strength < profile["vpip"] * 0.55:
        fold_act = next((a for a in acts if a["action"] == "fold"), None)
        if fold_act and to_call > 0:
            return "fold", 0, f"翻前牌力不足({strength:.0%})，弃牌"

    scored = []
    for a in acts:
        act = a["action"]
        amt = a.get("amount", 0)
        if act == "raise":
            amt = a.get("min", state["current_bet"] + state["min_raise"])
        s = _score_action(act, amt, ctx, profile)
        scored.append((s, act, amt, a))

    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[0]
    # 轻微随机 — 同风格也有差异
    if len(scored) > 1 and scored[1][0] > best[0] - 0.12 and random.random() < 0.22:
        best = scored[1]

    action, amount = best[1], best[2]
    if action == "raise":
        raise_total = best[3].get("min", state["current_bet"] + state["min_raise"])
        jitter = random.randint(0, state["min_raise"])
        amount = min(p["stack"] + p["bet_street"], raise_total + jitter)

    reason = f"{profile.get('preset', 'tag')} · 牌力{strength:.0%} · {action}"
    if action == "call":
        reason += f" {amount}"
    elif action == "raise":
        reason += f" 至{amount}"
    return action, amount, reason


async def decide_with_llm(
    state: dict,
    seat_idx: int,
    profile: dict,
    soul_md: str = "",
) -> tuple[str, int, str]:
    """LLM 在合法动作中选 — 失败则回退规则 bot"""
    from life_game import _zhipu_key
    from poker_engine import legal_actions

    acts = legal_actions(state, seat_idx)
    if not acts:
        return decide_action(state, seat_idx, profile)

    if not _zhipu_key:
        return decide_action(state, seat_idx, profile)

    p = state["players"][seat_idx]
    strength = hand_strength(state, seat_idx)
    act_desc = ", ".join(a["action"] for a in acts)
    prompt = (
        f"你是德州扑克选手。风格:{profile.get('preset')} aggression={profile.get('aggression')}\n"
        f"SOUL:{soul_md[:200]}\n"
        f"阶段:{state['phase']} 底池:{state['pot']} 跟注:{state['current_bet'] - p['bet_street']} "
        f"筹码:{p['stack']} 牌力估计:{strength:.0%}\n"
        f"合法动作:[{act_desc}]\n"
        "只输出 JSON: {\"action\":\"fold|check|call|raise|all_in\",\"amount\":0,\"reason\":\"10字内\"}"
    )
    try:
        import aiohttp
        import json as _json

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
                headers={"Authorization": f"Bearer {_zhipu_key}"},
                json={
                    "model": "glm-4-flash",
                    "messages": [
                        {"role": "system", "content": "只输出 JSON。"},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 120,
                },
                timeout=aiohttp.ClientTimeout(total=8),
            ) as resp:
                data = await resp.json()
                text = data["choices"][0]["message"]["content"].strip()
                if text.startswith("```"):
                    text = text.split("```")[1]
                    if text.startswith("json"):
                        text = text[4:]
                parsed = _json.loads(text)
                action = parsed.get("action", "fold")
                amount = int(parsed.get("amount") or 0)
                reason = parsed.get("reason") or "LLM决策"
                legal_names = {a["action"] for a in acts}
                if action not in legal_names:
                    return decide_action(state, seat_idx, profile)
                if action == "raise":
                    mn = next(a.get("min", state["big_blind"]) for a in acts if a["action"] == "raise")
                    amount = max(amount, mn)
                return action, amount, f"🧠 {reason}"
    except Exception:
        pass
    return decide_action(state, seat_idx, profile)


def should_use_llm(state: dict, seat_idx: int, profile: dict) -> bool:
    """关键决策点用 LLM：河牌 / 大额 pot"""
    p = state["players"][seat_idx]
    to_call = state["current_bet"] - p["bet_street"]
    if state["phase"] == "river" and (state["pot"] > state["buy_in"] * 0.3 or to_call > p["stack"] * 0.25):
        return True
    if to_call > state["big_blind"] * 6 and hand_strength(state, seat_idx) > 0.4:
        return True
    return False


def record_hand_stats(profile: dict, vpip: bool, pfr: bool, won: bool) -> dict:
    stats = dict(profile.get("stats") or {})
    stats["hands"] = stats.get("hands", 0) + 1
    if vpip:
        stats["vpip_hits"] = stats.get("vpip_hits", 0) + 1
    if pfr:
        stats["pfr_hits"] = stats.get("pfr_hits", 0) + 1
    if won:
        stats["wins"] = stats.get("wins", 0) + 1
    out = dict(profile)
    out["stats"] = stats
    return out
