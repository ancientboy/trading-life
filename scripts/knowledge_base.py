"""
知识库管理模块
AI交易系统的记忆 - 持续积累交易经验、规律、教训

存储结构:
{
    "meta": {"created": "...", "updated": "...", "version": 1},
    "rules": [
        {"id": "R001", "type": "positive|negative|caution",
         "content": "规则内容", "confidence": 0.8,
         "source": "ai_review|manual", "created": "...",
         "verified_count": 5, "failed_count": 1}
    ],
    "lessons": [
        {"id": "L001", "trade_id": "...", "content": "教训内容",
         "market_context": "...", "created": "..."}
    ],
    "coin_profiles": {
        "BTCUSDT": {"character": "...", "patterns": [...], "notes": "..."}
    }
}
"""
import json
import os
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict

logger = logging.getLogger("KnowledgeBase")

DATA_DIR = Path(os.environ.get("TRADING_DATA_DIR", "/opt/trading-agent/data"))
KB_FILE = DATA_DIR / "ai_knowledge_base.json"


def _load() -> dict:
    """加载知识库"""
    if KB_FILE.exists():
        try:
            with open(KB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            logger.warning("⚠️ 知识库损坏，重建")
    return _create_fresh()


def _create_fresh() -> dict:
    """创建空知识库（带初始化经验）"""
    return {
        "meta": {
            "created": time.strftime("%Y-%m-%d %H:%M"),
            "updated": time.strftime("%Y-%m-%d %H:%M"),
            "version": 1
        },
        "rules": [
            # 初始化一些基础交易常识
            {
                "id": "R0001",
                "type": "caution",
                "content": "24h涨幅超过30%的币种不追高，即使资金费率极端也谨慎做空（可能庄家控盘）",
                "confidence": 0.7,
                "source": "manual",
                "created": "2026-04-24",
                "verified_count": 0,
                "failed_count": 0
            },
            {
                "id": "R0002",
                "type": "positive",
                "content": "BTC下跌时山寨币普遍跟跌，山寨做多需BTC企稳确认",
                "confidence": 0.75,
                "source": "manual",
                "created": "2026-04-24",
                "verified_count": 0,
                "failed_count": 0
            },
            {
                "id": "R0003",
                "type": "positive",
                "content": "OI快速增加+价格横盘=变盘前兆，关注突破方向",
                "confidence": 0.65,
                "source": "manual",
                "created": "2026-04-24",
                "verified_count": 0,
                "failed_count": 0
            },
            {
                "id": "R0004",
                "type": "caution",
                "content": "资金费率极端(>0.1%或<-0.1%)时趋势可能延续也可能反转，需结合OI和价格行为判断",
                "confidence": 0.6,
                "source": "manual",
                "created": "2026-04-24",
                "verified_count": 0,
                "failed_count": 0
            }
        ],
        "lessons": [],
        "coin_profiles": {}
    }


def _save(kb: dict):
    """保存知识库"""
    kb["meta"]["updated"] = time.strftime("%Y-%m-%d %H:%M")
    KB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(KB_FILE, "w", encoding="utf-8") as f:
        json.dump(kb, f, ensure_ascii=False, indent=2)


def get_all_rules() -> List[dict]:
    """获取所有规则"""
    kb = _load()
    return kb.get("rules", [])


def get_relevant_rules(context: str = "", limit: int = 15) -> List[dict]:
    """
    获取与当前上下文相关的规则
    按置信度和验证次数排序
    """
    kb = _load()
    rules = kb.get("rules", [])
    
    # 简单关键词匹配（后续可以让AI做语义匹配）
    if context:
        scored = []
        ctx_lower = context.lower()
        for r in rules:
            score = r.get("confidence", 0.5)
            # 关键词匹配加分
            for word in r["content"].split():
                if len(word) > 2 and word.lower() in ctx_lower:
                    score += 0.1
            scored.append((score, r))
        scored.sort(key=lambda x: -x[0])
        return [r for _, r in scored[:limit]]
    
    # 无上下文时按置信度排序
    rules.sort(key=lambda x: -x.get("confidence", 0))
    return rules[:limit]


def get_recent_lessons(limit: int = 10) -> List[dict]:
    """获取最近的教训"""
    kb = _load()
    lessons = kb.get("lessons", [])
    return lessons[-limit:]


def get_coin_profile(symbol: str) -> dict:
    """获取币种画像"""
    kb = _load()
    return kb.get("coin_profiles", {}).get(symbol, {})


def add_rule(content: str, rule_type: str = "positive", 
             confidence: float = 0.6, source: str = "ai_review") -> str:
    """添加新规则"""
    kb = _load()
    rule_id = f"R{len(kb['rules'])+1:04d}"
    rule = {
        "id": rule_id,
        "type": rule_type,  # positive(应该做), negative(不该做), caution(注意)
        "content": content,
        "confidence": confidence,
        "source": source,
        "created": time.strftime("%Y-%m-%d %H:%M"),
        "verified_count": 0,
        "failed_count": 0
    }
    kb["rules"].append(rule)
    _save(kb)
    logger.info(f"📝 新增规则 {rule_id}: {content[:50]}...")
    return rule_id


def add_lesson(trade_id: str, content: str, market_context: str = "") -> str:
    """添加交易教训"""
    kb = _load()
    lesson_id = f"L{len(kb['lessons'])+1:04d}"
    lesson = {
        "id": lesson_id,
        "trade_id": trade_id,
        "content": content,
        "market_context": market_context,
        "created": time.strftime("%Y-%m-%d %H:%M")
    }
    kb["lessons"].append(lesson)
    # 教训数量上限50条，旧的自动淘汰
    if len(kb["lessons"]) > 50:
        kb["lessons"] = kb["lessons"][-50:]
    _save(kb)
    logger.info(f"📚 新增教训 {lesson_id}: {content[:50]}...")
    return lesson_id


def update_coin_profile(symbol: str, character: str = "", 
                        pattern: str = "", note: str = ""):
    """更新币种画像"""
    kb = _load()
    if "coin_profiles" not in kb:
        kb["coin_profiles"] = {}
    
    if symbol not in kb["coin_profiles"]:
        kb["coin_profiles"][symbol] = {
            "character": "", "patterns": [], "notes": []
        }
    
    profile = kb["coin_profiles"][symbol]
    if character:
        profile["character"] = character
    if pattern and pattern not in profile.get("patterns", []):
        if "patterns" not in profile:
            profile["patterns"] = []
        profile["patterns"].append(pattern)
        if len(profile["patterns"]) > 20:
            profile["patterns"] = profile["patterns"][-20:]
    if note:
        if "notes" not in profile:
            profile["notes"] = []
        profile["notes"].append({"text": note, "time": time.strftime("%Y-%m-%d %H:%M")})
        if len(profile["notes"]) > 20:
            profile["notes"] = profile["notes"][-20:]
    
    _save(kb)
    logger.info(f"🪙 更新币种画像 {symbol}")


def verify_rule(rule_id: str, success: bool):
    """验证规则（交易后回测）"""
    kb = _load()
    for r in kb["rules"]:
        if r["id"] == rule_id:
            if success:
                r["verified_count"] = r.get("verified_count", 0) + 1
                r["confidence"] = min(1.0, r.get("confidence", 0.5) + 0.02)
            else:
                r["failed_count"] = r.get("failed_count", 0) + 1
                r["confidence"] = max(0.1, r.get("confidence", 0.5) - 0.05)
            break
    _save(kb)


def get_knowledge_summary() -> str:
    """获取知识库摘要（给AI交易员看的）"""
    kb = _load()
    rules = kb.get("rules", [])
    lessons = kb.get("lessons", [])[-5:]  # 最近5条教训
    
    # 按类型分组
    positive = [r for r in rules if r["type"] == "positive" and r.get("confidence", 0) >= 0.5]
    negative = [r for r in rules if r["type"] == "negative" and r.get("confidence", 0) >= 0.5]
    caution = [r for r in rules if r["type"] == "caution" and r.get("confidence", 0) >= 0.5]
    
    lines = ["📚 ═══ 知识库摘要 ═══"]
    
    if positive:
        lines.append("\n✅ 验证有效的规律:")
        for r in sorted(positive, key=lambda x: -x.get("confidence", 0))[:8]:
            lines.append(f"  • [{r['confidence']:.0%}] {r['content']}")
    
    if negative:
        lines.append("\n❌ 应该避免的情况:")
        for r in sorted(negative, key=lambda x: -x.get("confidence", 0))[:5]:
            lines.append(f"  • [{r['confidence']:.0%}] {r['content']}")
    
    if caution:
        lines.append("\n⚠️ 需要注意:")
        for r in sorted(caution, key=lambda x: -x.get("confidence", 0))[:5]:
            lines.append(f"  • [{r['confidence']:.0%}] {r['content']}")
    
    if lessons:
        lines.append("\n📖 近期教训:")
        for l in lessons:
            lines.append(f"  • {l['content']}")
    
    return "\n".join(lines)


def get_stats() -> dict:
    """获取知识库统计"""
    kb = _load()
    rules = kb.get("rules", [])
    return {
        "total_rules": len(rules),
        "positive": len([r for r in rules if r["type"] == "positive"]),
        "negative": len([r for r in rules if r["type"] == "negative"]),
        "caution": len([r for r in rules if r["type"] == "caution"]),
        "total_lessons": len(kb.get("lessons", [])),
        "coin_profiles": len(kb.get("coin_profiles", {})),
        "updated": kb.get("meta", {}).get("updated", "unknown")
    }
