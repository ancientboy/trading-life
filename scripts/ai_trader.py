"""
AI交易员 - 纯做多系统 (v15)

阶段1: 方向判断 → 纯规则引擎(StochRSI+顶底结构+大小周期共振)，只做多
阶段2: 入场时机 → AI判断当前是否好的入场点，方向已锁定为LONG
"""

import json
import time
import logging
from typing import List
from dataclasses import dataclass, field

from ai_core import call_glm_json
from knowledge_base import get_knowledge_summary, get_coin_profile, get_recent_lessons
from direction_rules import judge_direction

logger = logging.getLogger("AITrader")


# ============================================
# 阶段2: 入场时机提示词（纯做多）
# ============================================
def _build_timing_prompt() -> str:
    """纯做多模式，AI只判断做多时机"""
    
    return """你是一位加密货币做多交易时机判断员。

## ⚡ 方向已由规则引擎确定: LONG (做多)
你的唯一任务是判断【当前时刻】是否适合做多入场。

### ✅ 适合入场的时机（优先判断）
- 简报中有波浪分析显示处于二浪回调区(Fib 50%/61.8%) → 最佳入场
- 简报中有波浪分析显示三浪刚启动 → 强入场信号
- 简报中有SMC入场区且价格在区间内 → 建议入场
- 近期有回调企稳迹象（价格止跌反弹）
- 大周期(4h)趋势向上，小周期(15m/1h)开始共振
- StochRSI从超卖区金叉向上
- 成交量温和或放量

### ✅ 可以追高的情况（关键！）
- 波浪分析显示当前处于上升浪（一浪/三浪）中，不是五浪末期
- 上涨有成交量配合，不是无量拉升
- 距离上方阻力位/止盈位还有足够空间
- 4h/1h 顶底结构仍在抬高中（Higher High + Higher Low）
→ 这种情况下即使短期涨幅较大，也可以在回调时入场

### ⚠️ 必须SKIP的情况
- 波浪分析显示已处于五浪末期或出现顶背离
- 4h趋势已经由上涨转为震荡/下跌
- StochRSI已进入超买区(K>80)且出现死叉
- 价格已远离任何支撑位且波浪已走完
- 涨幅巨大但无回调(直线拉升)，等回调再入场

## 简报中的参考信息
- 【波浪形态】→ 判断当前波浪位置（二浪回调/三浪启动/五浪末期）
- 【SMC关键价位】→ 提供入场区/止盈/止损/RR（纯价位参考）
- 【StochRSI信号】→ 多周期金叉/超卖
- 【顶底结构】→ 上涨趋势/底部抬高
- 其他数据 → 资金费率、成交量、大单等

## 输出格式（严格JSON）
{
    "action": "LONG" 或 "SKIP",
    "confidence": 0-100的整数,
    "position_size_pct": 1-10的整数（占总资金百分比）,
    "reasoning": "时机判断理由（中文，80字以内）",
    "key_factors": ["最关键的1-2个因素"],
    "stop_loss_pct": 2.0-10.0（止损百分比）,
    "expected_move": "预期走势描述",
    "risk_notes": "风险点"
}

**规则：**
- confidence<60时，action必须为SKIP
- 方向必须是LONG或SKIP！绝对不能输出SHORT！
- 不要无脑追高！如果波浪已走完或无量拉升，等回调
- 但如果波浪分析显示还在上升浪中，回调就是入场机会
- 严格按波浪位置判断：二浪回调/三浪启动=入场，五浪末期=SKIP"""


def _build_user_prompt(
    briefing: str,
    recent_trades: List[dict] = None,
    symbol: str = ""
) -> str:
    """构建用户提示词"""
    
    parts = []
    parts.append(f"## 当前市场数据\n\n{briefing}")
    
    # 知识库
    knowledge = get_knowledge_summary()
    if len(knowledge) > 50:
        parts.append(f"\n## 历史经验知识库\n\n{knowledge}")
    
    # 币种画像
    if symbol:
        profile = get_coin_profile(symbol)
        if profile:
            parts.append(f"\n## {symbol} 币种特征\n\n{json.dumps(profile, ensure_ascii=False, indent=2)}")
    
    # 近期交易记录
    if recent_trades:
        trade_lines = []
        for t in recent_trades[-5:]:
            sym = t.get("symbol", "?")
            direction = t.get("direction", "?")
            pnl = t.get("pnl_pct", 0)
            reason = t.get("reasoning", "")[:60]
            trade_lines.append(f"  {sym} {direction} PnL={pnl:+.1f}% | {reason}")
        
        if trade_lines:
            parts.append("\n## 近期交易记录（供参考）\n" + "\n".join(trade_lines))
    
    # 近期教训
    lessons = get_recent_lessons(3)
    if lessons:
        lesson_lines = [f"  • {l['content']}" for l in lessons]
        parts.append("\n## 近期教训（避免重复犯错）\n" + "\n".join(lesson_lines))
    
    return "\n\n".join(parts)


@dataclass
class AIDecision:
    """AI交易决策"""
    symbol: str
    action: str = "SKIP"  # LONG or SKIP
    confidence: int = 0
    position_pct: int = 0
    reasoning: str = ""
    key_factors: list = field(default_factory=list)
    stop_loss_pct: float = 3.0
    expected_move: str = ""
    risk_notes: str = ""
    timestamp: str = ""
    raw_response: dict = field(default_factory=dict)
    trend: str = "SIDEWAYS"  # 阶段1的趋势判断
    stop_loss_ref: float = 0  # 规则引擎给出的止损参考价（区间最低点）
    
    def is_tradeable(self) -> bool:
        return self.action == "LONG" and self.confidence >= 60
    
    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "action": self.action,
            "confidence": self.confidence,
            "position_pct": self.position_pct,
            "reasoning": self.reasoning,
            "key_factors": self.key_factors,
            "stop_loss_pct": self.stop_loss_pct,
            "expected_move": self.expected_move,
            "risk_notes": self.risk_notes,
            "timestamp": self.timestamp,
            "trend": self.trend,
            "stop_loss_ref": self.stop_loss_ref,
        }


async def ai_analyze(
    symbol: str,
    briefing: str,
    recent_trades: List[dict] = None,
    klines_15m: list = None,
    klines_1h: list = None,
    klines_4h: list = None,
) -> AIDecision:
    """
    AI交易员分析单个币种（v15 纯做多）
    
    阶段1: 纯规则引擎判断做多条件（StochRSI+顶底结构+共振）
    阶段2: AI在规则确认后判断入场时机
    """
    decision = AIDecision(symbol=symbol, timestamp=time.strftime("%Y-%m-%d %H:%M:%S"))
    
    # === 阶段1: 规则方向判断（纯做多）===
    rule_result = judge_direction(
        klines_15m=klines_15m or [],
        klines_1h=klines_1h or [],
        klines_4h=klines_4h or [],
    )
    
    rule_dir = rule_result["direction"]  # LONG or SKIP
    rule_score = rule_result["score"]
    rule_confidence = rule_result["confidence"]
    rule_reasoning = rule_result["reasoning"]
    rule_strategy = rule_result["strategy"]
    rule_indicators = rule_result.get("indicators", {})
    
    logger.info(f"📊 规则方向 {symbol}: {rule_dir} "
                f"得分={rule_score} 置信度={rule_confidence}% "
                f"策略={rule_strategy}")
    
    for r in rule_reasoning:
        logger.info(f"   → {r}")
    
    # 规则判断SKIP → 直接跳过，不调AI
    if rule_dir == "SKIP":
        decision.action = "SKIP"
        decision.trend = "SIDEWAYS"
        decision.reasoning = f"[规则引擎] {'; '.join(rule_reasoning)}"
        decision.raw_response = rule_result
        logger.info(f"📊 规则跳过 {symbol}: 做多信号不足(得分={rule_score})")
        return decision
    
    # v21: WAIT = 方向确认但StochRSI未到位 → 记录但不入场，等下一轮
    if rule_dir == "WAIT":
        decision.action = "SKIP"
        decision.trend = "UP"
        decision.reasoning = f"[等待入场时机] {'; '.join(rule_reasoning)}"
        decision.raw_response = rule_result
        decision.confidence = rule_result.get("confidence", 0)
        logger.info(f"⏳ 等待 {symbol}: 方向确认但StochRSI未到位(得分={rule_score})")
        return decision
    
    # 趋势=上涨
    decision.trend = "UP"
    
    # 提取止损参考价（区间最低点）
    # 优先用1h的Swing Low，其次4h，最后15m
    decision.stop_loss_ref = (
        rule_indicators.get('stop_loss_ref_1h') or 
        rule_indicators.get('stop_loss_ref_4h') or 
        rule_indicators.get('stop_loss_ref_15m') or 
        rule_indicators.get('stop_loss_ref') or 
        0
    )
    
    # === 阶段2: AI判断做多入场时机 ===
    timing_prompt = _build_timing_prompt()
    user_prompt = _build_user_prompt(briefing, recent_trades, symbol)
    
    # 注入规则方向到prompt
    rule_info = (
        f"\n\n## ⚡ 规则引擎方向判断（已确定，不可更改）\n"
        f"- 方向: LONG (只做多)\n"
        f"- 得分: {rule_score}\n"
        f"- 置信度: {rule_confidence}%\n"
        f"- 策略: {rule_strategy}\n"
        f"- 依据:\n"
    )
    for r in rule_reasoning:
        rule_info += f"  • {r}\n"
    
    # 止损参考信息
    if decision.stop_loss_ref > 0:
        rule_info += f"\n- 区间最低点(止损参考): ${decision.stop_loss_ref:.4f}\n"
    
    rule_info += (
        f"\n⚠️ 方向已确定=LONG，你只能选择LONG或SKIP！\n"
        f"你的任务是判断【当前时刻】是否适合做多入场。\n"
    )
    
    messages = [
        {"role": "system", "content": timing_prompt},
        {"role": "user", "content": user_prompt + rule_info}
    ]
    
    result = await call_glm_json(messages, temperature=0.3, max_tokens=1500, timeout=25)
    
    if not result:
        logger.warning(f"⚠️ AI分析 {symbol} API调用失败，默认SKIP")
        decision.reasoning = "AI API调用失败"
        return decision
    
    # 解析结果
    decision.raw_response = result
    # ★ v21-fix: 保留direction_rules的entry_wave_level（AI不返回此字段，会被覆盖为空）
    # v21.1-fix: AI可能返回空字符串，也要覆盖
    if (not result.get("entry_wave_level")) and rule_result.get("entry_wave_level"):
        decision.raw_response["entry_wave_level"] = rule_result["entry_wave_level"]
    decision.action = str(result.get("action") or "SKIP").upper()
    decision.confidence = int(result.get("confidence") or 0)
    decision.position_pct = int(result.get("position_size_pct") or 0)
    decision.reasoning = str(result.get("reasoning") or "")
    decision.key_factors = result.get("key_factors") or []
    decision.stop_loss_pct = float(result.get("stop_loss_pct") or 3.0)
    decision.expected_move = str(result.get("expected_move") or "")
    decision.risk_notes = str(result.get("risk_notes") or "")
    
    # 安全检查 — 只允许 LONG 或 SKIP
    if decision.action not in ["LONG", "SKIP"]:
        decision.action = "SKIP"
    
    if decision.confidence < 60:
        decision.action = "SKIP"
    
    # 绝对禁止做空
    if decision.action == "SHORT":
        logger.warning(f"⚠️ {symbol} AI输出SHORT，纯做多系统强制SKIP")
        decision.action = "SKIP"
        decision.reasoning = f"[安全阀] 纯做多系统，AI输出SHORT已拦截"
    
    # v21: 移除置信度覆写 — AI说SKIP就SKIP，不强制改LONG
    # 历史数据：覆写导致大量亏损单（AI已识别风险但被系统覆盖）
    
    decision.position_pct = max(1, min(10, decision.position_pct))
    decision.stop_loss_pct = max(2.0, min(10.0, decision.stop_loss_pct))
    
    # 日志
    if decision.is_tradeable():
        logger.info(f"🤖 AI决策 {symbol}: LONG "
                    f"置信度={decision.confidence}% 仓位={decision.position_pct}% "
                    f"止损参考=${decision.stop_loss_ref:.4f} | {decision.reasoning[:60]}")
    else:
        logger.info(f"🤖 AI决策 {symbol}: SKIP (置信度={decision.confidence}%) | {decision.reasoning[:60]}")
    
    return decision
