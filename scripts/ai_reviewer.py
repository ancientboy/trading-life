"""
AI复盘官 - 交易复盘与知识积累

每笔交易结束后自动复盘：
1. 分析为什么赢/为什么亏
2. 识别决策中的正确和错误
3. 提炼规律和教训
4. 写入知识库（系统越来越聪明）
5. 更新币种画像
"""
import json
import time
import logging
from typing import Optional, Dict, List
from dataclasses import dataclass, field

from ai_core import call_glm_json
from knowledge_base import (
    add_rule, add_lesson, update_coin_profile,
    get_coin_profile
)

logger = logging.getLogger("AIReviewer")

REVIEWER_SYSTEM_PROMPT = """你是一位严谨的加密货币交易复盘分析师。
你的任务是分析已完成的交易，找出成败原因，提炼经验教训。

## 分析维度
1. **入场时机**：当时的入场点是否合理？
2. **方向判断**：做多/做空的方向对了吗？
3. **仓位管理**：仓位大小是否合理？
4. **止损止盈**：止损是否合理？是否该更早止盈？
5. **市场环境**：当时的市场条件是否适合这笔交易？

## 输出格式（严格JSON）
{
    "trade_rating": "excellent" | "good" | "neutral" | "poor" | "terrible",
    "direction_correct": true/false,
    "entry_timing": "good" | "ok" | "bad",
    "position_sizing": "appropriate" | "too_large" | "too_small",
    "what_went_right": "做对了什么（一句话）",
    "what_went_wrong": "做错了什么（一句话，没有就写'无明显失误'）",
    "key_lesson": "最重要的一条教训（一句话）",
    "suggested_rules": [
        "基于这笔交易发现的规律/规则（0-3条）"
    ],
    "coin_insight": "这个币种的行为特征描述（例如：高波动、跟涨不跟跌等）",
    "market_pattern": "当时市场展现的模式（如果有）"
}"""


def _build_review_prompt(
    trade: dict,
    entry_briefing: str = "",
    exit_briefing: str = ""
) -> str:
    """构建复盘提示词"""
    
    parts = []
    
    # 交易基本信息
    parts.append(f"## 交易记录\n")
    parts.append(f"币种: {trade.get('symbol', '?')}")
    parts.append(f"方向: {trade.get('direction', '?')}")
    parts.append(f"开仓价: {trade.get('entry_price', '?')}")
    parts.append(f"平仓价: {trade.get('exit_price', '?')}")
    parts.append(f"持仓时间: {trade.get('duration', '?')}")
    parts.append(f"盈亏: {trade.get('pnl_pct', 0):+.2f}%")
    parts.append(f"最大浮盈: {trade.get('max_profit_pct', 0):+.2f}%")
    parts.append(f"最大浮亏: {trade.get('max_drawdown_pct', 0):+.2f}%")
    parts.append(f"仓位: {trade.get('position_pct', 0)}%")
    parts.append(f"杠杆: {trade.get('leverage', 0)}x")
    parts.append(f"平仓原因: {trade.get('close_reason', '?')}")
    
    if trade.get("reasoning"):
        parts.append(f"\n开仓理由: {trade['reasoning']}")
    
    if trade.get("ai_reasoning"):
        parts.append(f"AI决策理由: {trade['ai_reasoning']}")
    
    # 入场时的市场简报
    if entry_briefing:
        parts.append(f"\n## 入场时市场状况\n\n{entry_briefing}")
    
    # 出场时的市场简报
    if exit_briefing:
        parts.append(f"\n## 平仓时市场状况\n\n{exit_briefing}")
    
    # 币种历史画像
    symbol = trade.get("symbol", "")
    if symbol:
        profile = get_coin_profile(symbol)
        if profile and profile.get("character"):
            parts.append(f"\n## {symbol} 历史画像\n{profile.get('character', '暂无')}")
    
    parts.append("""
## 请复盘

分析这笔交易的成败，提炼经验教训。
请输出严格JSON格式。
""")
    
    return "\n\n".join(parts)


@dataclass
class ReviewResult:
    """复盘结果"""
    trade_id: str
    symbol: str
    rating: str = "neutral"
    direction_correct: bool = False
    entry_timing: str = "ok"
    what_went_right: str = ""
    what_went_wrong: str = ""
    key_lesson: str = ""
    suggested_rules: list = field(default_factory=list)
    coin_insight: str = ""
    market_pattern: str = ""
    raw_response: dict = field(default_factory=dict)


async def review_trade(
    trade: dict,
    entry_briefing: str = "",
    exit_briefing: str = ""
) -> Optional[ReviewResult]:
    """
    复盘单笔交易
    
    Args:
        trade: 交易记录 dict
        entry_briefing: 入场时的市场简报
        exit_briefing: 平仓时的市场简报
    
    Returns:
        ReviewResult 或 None
    """
    symbol = trade.get("symbol", "?")
    trade_id = trade.get("id", f"T{int(time.time())}")
    pnl = trade.get("pnl_pct", 0)
    
    logger.info(f"🔍 复盘 {symbol} PnL={pnl:+.2f}%...")
    
    result = ReviewResult(trade_id=trade_id, symbol=symbol)
    
    prompt = _build_review_prompt(trade, entry_briefing, exit_briefing)
    
    messages = [
        {"role": "system", "content": REVIEWER_SYSTEM_PROMPT},
        {"role": "user", "content": prompt}
    ]
    
    response = await call_glm_json(messages, temperature=0.2, max_tokens=1500, timeout=25)
    
    if not response:
        logger.warning(f"⚠️ 复盘API失败 {symbol}，使用简单规则")
        return _simple_review(trade)
    
    result.raw_response = response
    result.rating = response.get("trade_rating", "neutral")
    result.direction_correct = response.get("direction_correct", False)
    result.entry_timing = response.get("entry_timing", "ok")
    result.what_went_right = response.get("what_went_right", "")
    result.what_went_wrong = response.get("what_went_wrong", "")
    result.key_lesson = response.get("key_lesson", "")
    result.suggested_rules = response.get("suggested_rules", [])
    result.coin_insight = response.get("coin_insight", "")
    result.market_pattern = response.get("market_pattern", "")
    
    # === 写入知识库 ===
    _process_review(result, trade)
    
    logger.info(f"✅ 复盘完成 {symbol}: {result.rating} | {result.key_lesson[:50]}")
    
    return result


def _process_review(result: ReviewResult, trade: dict):
    """处理复盘结果，写入知识库"""
    pnl = trade.get("pnl_pct", 0)
    symbol = result.symbol
    
    # 1. 写入教训
    if result.key_lesson:
        context = f"{symbol} {trade.get('direction','')} PnL={pnl:+.1f}%"
        add_lesson(result.trade_id, result.key_lesson, context)
    
    # 2. 写入新规则
    for rule_text in result.suggested_rules:
        if rule_text and len(rule_text) > 5:
            rule_type = "positive" if pnl > 0 else "caution"
            confidence = 0.6 if pnl > 0 else 0.55
            add_rule(rule_text, rule_type, confidence, source="ai_review")
    
    # 3. 更新币种画像
    if result.coin_insight:
        existing = get_coin_profile(symbol)
        old_char = existing.get("character", "")
        new_char = result.coin_insight
        # 累积画像，不覆盖
        if old_char:
            new_char = f"{old_char}; {new_char}"
        update_coin_profile(symbol, character=new_char)
    
    # 4. 记录市场模式
    if result.market_pattern:
        update_coin_profile(symbol, pattern=f"模式: {result.market_pattern}")


def _simple_review(trade: dict) -> ReviewResult:
    """API失败时的简单规则复盘"""
    pnl = trade.get("pnl_pct", 0)
    symbol = trade.get("symbol", "?")
    trade_id = trade.get("id", f"T{int(time.time())}")
    
    result = ReviewResult(trade_id=trade_id, symbol=symbol)
    
    if pnl > 5:
        result.rating = "excellent"
        result.what_went_right = "盈利显著"
        result.key_lesson = f"{symbol} 顺势交易效果好"
    elif pnl > 2:
        result.rating = "good"
        result.what_went_right = "方向判断正确"
    elif pnl > -2:
        result.rating = "neutral"
        result.key_lesson = "小幅亏损，可能是震荡市"
    elif pnl > -5:
        result.rating = "poor"
        result.what_went_wrong = "亏损较大，止损可能不及时"
        result.key_lesson = "需更严格止损"
    else:
        result.rating = "terrible"
        result.what_went_wrong = "严重亏损"
        result.key_lesson = "入场时机或方向判断严重错误"
    
    # 写入教训
    if result.key_lesson:
        add_lesson(trade_id, result.key_lesson, f"{symbol} PnL={pnl:+.1f}%")
    
    return result


async def review_recent_trades(trades: List[dict]) -> List[ReviewResult]:
    """批量复盘最近平仓的交易"""
    import asyncio
    
    results = []
    for trade in trades:
        result = await review_trade(trade)
        if result:
            results.append(result)
        await asyncio.sleep(0.5)  # 避免API频率限制
    
    logger.info(f"📚 批量复盘完成: {len(results)}笔")
    return results
