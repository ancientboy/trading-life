"""扑克风格档案 — 解析、预设、统计进化"""
from __future__ import annotations

from poker_bot import POKER_PRESETS, default_profile, merge_profile

ADVANCED_BUY_INS = [1000, 5000, 10000]

CLASSIC_BUY_INS = [30, 80, 200]

AI_BOT_ROSTER = [
    ("ai_tag_1", "冷面 TAG", "tag"),
    ("ai_lag_1", "狂徒 LAG", "lag"),
    ("ai_rock_1", "岩石 Rock", "tight"),
    ("ai_fish_1", "鱼王 Fish", "loose"),
    ("ai_maniac_1", "疯子 Max", "maniac"),
    ("ai_pro_1", "均衡 Pro", "balanced"),
]


def _parse_rules(text: str) -> dict:
    t = text.lower()
    preset = "tag"
    if any(k in text for k in ("松", "浪", "激进", "lag", "疯狂", "疯子")):
        preset = "lag" if "紧" not in text else "maniac"
    if any(k in text for k in ("紧", "保守", "rock", "岩石")):
        preset = "tight"
    if any(k in text for k in ("鱼", "跟注站", "fish")):
        preset = "loose"
    if any(k in text for k in ("均衡", "职业", "pro")):
        preset = "balanced"
    if "maniac" in t or "全押" in text:
        preset = "maniac"

    out = default_profile(preset)
    out["notes"] = text[:500]
    if any(k in text for k in ("多诈唬", "诈唬", "bluff")):
        out["bluff_freq"] = min(0.45, out["bluff_freq"] + 0.12)
    if any(k in text for k in ("少诈唬", "不诈唬")):
        out["bluff_freq"] = max(0.02, out["bluff_freq"] - 0.08)
    if any(k in text for k in ("凶", "激进", "加注多")):
        out["aggression"] = min(0.98, out["aggression"] + 0.15)
    if any(k in text for k in ("怂", "保守", "少加注")):
        out["aggression"] = max(0.15, out["aggression"] - 0.15)
    return out


async def parse_poker_style(text: str) -> dict:
    from life_game import _zhipu_key

    cleaned = (text or "").strip()
    if len(cleaned) < 4:
        return {"ok": False, "error": "请至少输入 4 个字描述扑克风格"}

    if not _zhipu_key:
        parsed = _parse_rules(cleaned)
        return {"ok": True, "profile": parsed, "source": "rules", "message": "已按关键词解析（未配置 LLM）"}

    preset_ids = list(POKER_PRESETS.keys())
    prompt = (
        "你是德州扑克教练。用户描述打牌风格，输出唯一 JSON，不要 markdown。\n"
        f"可选 preset: {preset_ids}\n"
        "字段: preset, vpip(0.1-0.7), pfr(0.08-0.5), aggression(0.2-0.98), bluff_freq(0.02-0.4), "
        "fold_to_raise(0.15-0.75), notes(风格摘要20字内)\n"
        f"用户: {cleaned}"
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
                        {"role": "system", "content": "只输出合法 JSON。"},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 300,
                },
                timeout=aiohttp.ClientTimeout(total=20),
            ) as resp:
                data = await resp.json()
                raw = data["choices"][0]["message"]["content"].strip()
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                obj = _json.loads(raw)
                base = default_profile(obj.get("preset", "tag"))
                for k in ("vpip", "pfr", "aggression", "bluff_freq", "fold_to_raise", "notes"):
                    if k in obj:
                        base[k] = obj[k]
                base["notes"] = obj.get("notes") or cleaned[:200]
                return {"ok": True, "profile": base, "source": "llm"}
    except Exception:
        pass

    parsed = _parse_rules(cleaned)
    return {"ok": True, "profile": parsed, "source": "rules", "message": "LLM 解析失败，已使用规则兜底"}


def apply_style_feedback(profile: dict, feedback: str) -> dict:
    """用户反馈微调风格 — Phase 4 轻量进化"""
    out = merge_profile(profile)
    fb = feedback.strip()
    if any(k in fb for k in ("太怂", "太保守", "不够凶")):
        out["aggression"] = min(0.98, out["aggression"] + 0.08)
        out["bluff_freq"] = min(0.4, out["bluff_freq"] + 0.04)
    if any(k in fb for k in ("太浪", "太凶", "乱打")):
        out["aggression"] = max(0.2, out["aggression"] - 0.1)
        out["vpip"] = max(0.1, out["vpip"] - 0.06)
    if any(k in fb for k in ("多诈唬", "该 bluff")):
        out["bluff_freq"] = min(0.45, out["bluff_freq"] + 0.1)
    if any(k in fb for k in ("少诈唬", "别 bluff")):
        out["bluff_freq"] = max(0.02, out["bluff_freq"] - 0.08)
    out["notes"] = (out.get("notes") or "") + f" | 反馈:{fb[:80]}"
    return out


def catalog_presets() -> list[dict]:
    return [{"id": k, **v} for k, v in POKER_PRESETS.items()]
