"""
三层 Agent 智能体大脑 — 对标 AI 坦克「感知 → 决策 → 执行」

三层结构：
  1. 感知层 (Perception) — 压力、区域、附近 Agent、频道上下文
  2. 决策层 (Decision)   — 三套自由逻辑：社交驱动 / 漫游探索 / 自我调节
  3. 执行层 (Action)     — 台词生成、频道发言、@ 回复

前端 characterSimLoop 负责移动与活动执行；本模块负责语言与社交持久化。
"""
from __future__ import annotations

import hashlib
import random
import re
from typing import Any, Optional

# ─── 性格维度（0–100）────────────────────────────────────────────

DEFAULT_TRAITS = {
    "social": 50,
    "curiosity": 50,
    "self_care": 50,
    "randomness": 45,
    "patience": 50,
}


def _clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, v))


def derive_traits(soul_md: str, agent_type: str = "entertainment", agent_id: str = "") -> dict:
    """从 SOUL 文档 + Agent 类型推导稳定性格（同 Agent 每次一致，带关键词微调）。"""
    seed = f"{agent_id}:{soul_md or ''}:{agent_type}"
    h = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
    traits = {
        "social": 35 + (h % 45),
        "curiosity": 35 + ((h >> 4) % 45),
        "self_care": 35 + ((h >> 8) % 45),
        "randomness": 30 + ((h >> 12) % 50),
        "patience": 35 + ((h >> 16) % 45),
    }
    text = (soul_md or "").lower()
    boosts = [
        (r"活泼|热情|社交|陪伴|幽默|外向", {"social": 18, "curiosity": 8}),
        (r"冷静|理性|专注|观望|纪律", {"social": -12, "self_care": 8, "patience": 15}),
        (r"冒险|激进|冲动|高波动", {"randomness": 20, "curiosity": 12, "self_care": -10}),
        (r"休息|按摩|放松|休闲|扑克|德州", {"self_care": 15, "curiosity": 5}),
        (r"好奇|探索|闲逛|见闻", {"curiosity": 20, "social": 5}),
    ]
    for pattern, delta in boosts:
        if re.search(pattern, soul_md or "", re.I):
            for k, v in delta.items():
                traits[k] = traits.get(k, 50) + v
    if agent_type == "entertainment":
        traits["social"] += 22
        traits["curiosity"] += 12
    else:
        traits["social"] -= 15
        traits["patience"] += 10
        traits["self_care"] += 5
    return {k: round(_clamp(v)) for k, v in traits.items()}


def mood_tag_from_stress(stress: float) -> str:
    if stress >= 75:
        return "anxious"
    if stress >= 55:
        return "tired"
    if stress <= 25:
        return "relaxed"
    return "neutral"


def pick_decision_mode(traits: dict, stress: float, nearby_count: int, state: str = "idle") -> str:
    """
    决策层 — 三套自由逻辑（对标 AI 坦克 Hunt / Patrol / Retreat）：
      social    ≈ 狩猎/社交 — 主动找人互动
      explore   ≈ 巡逻/漫游 — 按好奇心探索区域
      self_care ≈ 撤退/恢复 — 压力高时自我调节
    """
    social = traits.get("social", 50) * 0.45 + nearby_count * 12
    explore = traits.get("curiosity", 50) * 0.55
    self_care = traits.get("self_care", 50) * 0.4 + stress * 0.55
    if state == "panic":
        self_care += 45
    elif state == "trading":
        explore -= 25
        social -= 15
    if stress > 65:
        self_care += 20
    if nearby_count > 0:
        social += 28
    if stress < 35:
        explore += 12
    noise = traits.get("randomness", 45) / 100
    scores = {
        "social": social + random.uniform(-noise, noise) * 30,
        "explore": explore + random.uniform(-noise, noise) * 30,
        "self_care": self_care + random.uniform(-noise, noise) * 30,
    }
    return max(scores, key=scores.get)


def find_mentioned_agents(text: str, agents: dict[str, Any]) -> list[tuple[str, dict]]:
    """解析 @名称 或消息中出现的 Agent 名。"""
    if not text or not agents:
        return []
    found: list[tuple[str, dict]] = []
    seen: set[str] = set()
    for m in re.finditer(r"@([\w\u4e00-\u9fff\-]+)", text):
        key = m.group(1).strip().lower()
        for aid, meta in agents.items():
            name = (meta.get("name") or meta.get("data", {}).get("name") or aid).lower()
            if key in name or name.startswith(key):
                if aid not in seen:
                    seen.add(aid)
                    found.append((aid, meta if isinstance(meta, dict) else {}))
    if found:
        return found
    lower = text.lower()
    for aid, meta in agents.items():
        name = meta.get("name") or (meta.get("data") or {}).get("name") or ""
        if len(name) >= 2 and name.lower() in lower:
            if aid not in seen:
                seen.add(aid)
                found.append((aid, meta))
    return found


MODE_CONTEXT = {
    "social": "social_approach",
    "explore": "wandering",
    "self_care": "self_care",
    "chat_reply": "chat_reply",
    "agent_to_agent": "agent_to_agent",
    "tea_party": "tea_party",
}


def build_speak_context(
    decision_mode: str = "greeting",
    activity: Optional[str] = None,
    stress: float = 0,
    mood_tag: str = "neutral",
    nearby_names: Optional[list[str]] = None,
    user_message: str = "",
    target_name: str = "",
) -> str:
    """组装 LLM 场景 context 字符串。"""
    parts = [MODE_CONTEXT.get(decision_mode, decision_mode)]
    if activity:
        parts.append(f"activity:{activity}")
    if stress >= 55:
        parts.append(f"stress:{int(stress)}")
    if mood_tag != "neutral":
        parts.append(f"mood:{mood_tag}")
    if nearby_names:
        parts.append(f"nearby:{','.join(nearby_names[:3])}")
    if user_message:
        parts.append(f"reply_to:{user_message[:80]}")
    if target_name:
        parts.append(f"talking_to:{target_name}")
    return "|".join(parts)
