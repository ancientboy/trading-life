"""
TiMi启发的交易系统增强模块

1. 市场环境检测器 (Market Regime Detector)
2. 反馈分类器 (Feedback Classifier) 
3. 按币种参数适配器 (Pair Parameter Adapter)
4. 反馈反思Agent (Feedback Reflection Agent)
5. 三层优化器 (Hierarchical Optimizer)
"""

import json
import logging
import math
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict, field
from pathlib import Path
from enum import Enum

import sys
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR

logger = logging.getLogger("Enhancer")


# ============================================
# 1. 市场环境检测器
# ============================================

class MarketRegime(Enum):
    BULL = "bull"
    BEAR = "bear"
    CHOP = "chop"
    CRASH = "crash"
    PUMP = "pump"


class MarketRegimeDetector:
    """
    检测当前市场环境，用于：
    - Pump/暴涨环境下禁止开仓
    - 熊市下调整参数（更保守）
    - 为反馈分类提供上下文
    """
    
    # 缓存：{symbol: (timestamp, regime)}
    _cache: Dict[str, Tuple[float, str]] = {}
    CACHE_TTL = 300  # 5分钟缓存
    
    @classmethod
    def detect(cls, klines_4h: List[dict], symbol: str = "") -> MarketRegime:
        """检测市场环境"""
        # 缓存
        now = time.time()
        if symbol in cls._cache:
            ts, regime = cls._cache[symbol]
            if now - ts < cls.CACHE_TTL:
                return MarketRegime(regime)
        
        if len(klines_4h) < 30:
            regime = MarketRegime.CHOP
        else:
            closes = [float(k['close']) for k in klines_4h]
            volumes = [float(k['volume']) for k in klines_4h]
            
            # 最近30根 vs 前30根
            recent = closes[-30:]
            earlier = closes[-60:-30] if len(closes) >= 60 else closes[:30]
            
            if not earlier:
                regime = MarketRegime.CHOP
            else:
                price_change = (recent[-1] - earlier[0]) / earlier[0] * 100
                
                # EMA判断
                ema20 = cls._calc_ema(closes, 20)
                ema50 = cls._calc_ema(closes, 50) if len(closes) >= 50 else ema20
                
                # 暴涨/暴跌
                if price_change > 15:
                    regime = MarketRegime.PUMP
                elif price_change < -15:
                    regime = MarketRegime.CRASH
                elif ema20 > ema50 and closes[-1] > ema20:
                    regime = MarketRegime.BULL
                elif ema20 < ema50 and closes[-1] < ema20:
                    regime = MarketRegime.BEAR
                else:
                    regime = MarketRegime.CHOP
        
        if symbol:
            cls._cache[symbol] = (now, regime.value)
        return regime
    
    @classmethod
    def detect_btc(cls, klines_4h: List[dict]) -> str:
        """BTC趋势判断 (bullish/neutral/bearish)"""
        if len(klines_4h) < 50:
            return "neutral"
        closes = [float(k['close']) for k in klines_4h]
        ema20 = cls._calc_ema(closes, 20)
        ema50 = cls._calc_ema(closes, 50)
        price = closes[-1]
        
        # 多维度判断
        bull_signals = 0
        bear_signals = 0
        
        # 1. EMA排列
        if ema20 > ema50:
            bull_signals += 1
        elif ema20 < ema50:
            bear_signals += 1
        
        # 2. 价格位置
        if price > ema20 and price > ema50:
            bull_signals += 1
        elif price < ema20 and price < ema50:
            bear_signals += 1
        
        # 3. 趋势强度（EMA斜率）
        if len(closes) >= 10:
            recent_ema = cls._calc_ema(closes[-10:], min(10, len(closes[-10:])))
            older_ema = cls._calc_ema(closes[-20:-10], min(10, len(closes[-20:-10])))
            if older_ema > 0:
                slope = (recent_ema - older_ema) / older_ema * 100
                if slope > 0.5:
                    bull_signals += 1
                elif slope < -0.5:
                    bear_signals += 1
        
        if bull_signals >= 2:
            return "bullish"
        elif bear_signals >= 2:
            return "bearish"
        return "neutral"
    
    @staticmethod
    def _calc_ema(data: list, period: int) -> float:
        if len(data) < period:
            return data[-1] if data else 0
        k = 2 / (period + 1)
        ema = sum(data[:period]) / period
        for v in data[period:]:
            ema = v * k + ema * (1 - k)
        return ema
    
    @classmethod
    def should_block_entry(cls, regime: MarketRegime, entry_type: str) -> Tuple[bool, str]:
        """判断是否应该阻止入场"""
        BLOCKED_IN_PUMP = {
            'prelaunch_ambush', 'breakout', 'newcoin_surge', 
            'newcoin_bottom', 'short_squeeze', 'watch_pool_breakout'
        }
        BLOCKED_IN_CRASH = {
            'prelaunch_ambush', 'breakout', 'newcoin_surge',
        }
        # 非牛市环境禁止的信号（参数搜索最优结果：只有bull+prelaunch赚钱）
        BULL_ONLY_TYPES = {
            'prelaunch_ambush', 'breakout', 'watch_pool_breakout',
            'newcoin_surge', 'newcoin_bottom', 'newcoin_stable',
        }
        ALWAYS_BLOCKED = {'breakout', 'short_squeeze'}  # 回测证明持续亏钱
        
        if entry_type in ALWAYS_BLOCKED:
            return True, f"{entry_type}已被回测证明持续亏损，永久禁用"
        if regime == MarketRegime.PUMP and entry_type in BLOCKED_IN_PUMP:
            return True, f"Pump环境禁止{entry_type}入场"
        if regime == MarketRegime.CRASH and entry_type in BLOCKED_IN_CRASH:
            return True, f"Crash环境禁止{entry_type}做多入场"
        # 非牛市环境禁止做多入场
        if entry_type in BULL_ONLY_TYPES and regime not in (MarketRegime.BULL, MarketRegime.BEAR):
            return True, f"非牛/熊环境禁止{entry_type}入场(当前{regime.value})"
        
        return False, ""


# ============================================
# 2. 反馈分类器
# ============================================

@dataclass
class TradeFeedback:
    """交易反馈记录"""
    symbol: str
    agent_type: str
    entry_type: str
    direction: str
    pnl_pct: float
    pnl_dollar: float
    exit_reason: str       # stop_loss/structure_break/timeout
    bars_held: int = 0
    leverage: int = 0
    entry_score: float = 0
    market_regime: str = ""  # bull/bear/chop/crash/pump
    btc_trend: str = ""      # bullish/neutral/bearish
    
    # 分类结果
    category: str = ""       # good_trade/bad_entry/bad_exit/unexpected
    severity: str = ""       # low/medium/high/critical
    notes: str = ""


class FeedbackClassifier:
    """
    自动分类每笔交易反馈
    
    分类维度（TiMi启发）：
    - performance: 盈利能力
    - risk: 风控表现
    - stability: 策略稳定性
    - efficiency: 资金效率
    """
    
    FEEDBACK_DIR = DATA_DIR / "feedback"
    
    @classmethod
    def classify(cls, trade: dict, klines_4h: List[dict] = None) -> TradeFeedback:
        """分类单笔交易"""
        fb = TradeFeedback(
            symbol=trade.get('symbol', ''),
            agent_type=trade.get('agent_type', ''),
            entry_type=trade.get('entry_type', ''),
            direction=trade.get('direction', ''),
            pnl_pct=trade.get('pnl_pct', 0),
            pnl_dollar=trade.get('pnl_amount', 0),
            exit_reason=trade.get('reason', ''),
            leverage=trade.get('leverage', 0),
            entry_score=trade.get('entry_score', 0),
        )
        
        # 市场环境
        if klines_4h:
            regime = MarketRegimeDetector.detect(klines_4h, fb.symbol)
            fb.market_regime = regime.value
            if fb.symbol != "BTCUSDT":
                fb.btc_trend = MarketRegimeDetector.detect_btc(klines_4h)
        
        # === 分类逻辑 ===
        pnl = fb.pnl_pct
        reason = fb.exit_reason
        
        if pnl > 5:
            fb.category = "good_trade"
            fb.severity = "low"
            fb.notes = f"盈利{pnl:+.1f}%，策略有效"
        elif pnl > 0:
            fb.category = "good_trade"
            fb.severity = "low"
            fb.notes = f"小幅盈利{pnl:+.1f}%"
        elif pnl > -2 and reason == "stop_loss":
            fb.category = "bad_entry"
            fb.severity = "low"
            fb.notes = f"小止损{pnl:+.1f}%，入场时机稍差"
        elif pnl > -5 and reason == "stop_loss":
            fb.category = "bad_entry"
            fb.severity = "medium"
            fb.notes = f"中等止损{pnl:+.1f}%，入场信号有问题"
        elif pnl <= -5 and reason == "stop_loss":
            fb.category = "bad_entry"
            fb.severity = "high"
            fb.notes = f"大止损{pnl:+.1f}%，信号严重误判"
        elif reason == "timeout":
            if pnl > 0:
                fb.category = "good_trade"
                fb.severity = "low"
                fb.notes = f"超时盈利{pnl:+.1f}%，趋势抓到了"
            else:
                fb.category = "bad_exit"
                fb.severity = "medium"
                fb.notes = f"超时亏损{pnl:+.1f}%，持仓时间太长"
        else:
            fb.category = "unexpected"
            fb.severity = "low"
            fb.notes = f"其他: {reason} pnl={pnl:+.1f}%"
        
        # Pump环境下亏钱 → 额外标记
        if fb.market_regime == "pump" and pnl < 0:
            fb.severity = "high"
            fb.notes += " [Pump环境]"
        
        # 逆势交易亏钱
        if fb.btc_trend == "bearish" and fb.direction == "LONG" and pnl < 0:
            fb.severity = "medium" if fb.severity == "low" else fb.severity
            fb.notes += " [逆BTC趋势]"
        
        return fb
    
    @classmethod
    def save(cls, feedback: TradeFeedback):
        """保存反馈"""
        cls.FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        fb_file = cls.FEEDBACK_DIR / f"feedback_{date_str}.json"
        
        records = []
        if fb_file.exists():
            try:
                records = json.loads(fb_file.read_text())
            except:
                pass
        
        records.append(asdict(feedback))
        fb_file.write_text(json.dumps(records, ensure_ascii=False, indent=2))
    
    @classmethod
    def load_all(cls, days: int = 30) -> List[TradeFeedback]:
        """加载最近N天所有反馈"""
        records = []
        for i in range(days):
            date_str = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y%m%d")
            fb_file = cls.FEEDBACK_DIR / f"feedback_{date_str}.json"
            if fb_file.exists():
                try:
                    for r in json.loads(fb_file.read_text()):
                        records.append(TradeFeedback(**r))
                except:
                    pass
        return records
    
    @classmethod
    def get_summary(cls, days: int = 7) -> dict:
        """获取反馈摘要"""
        feedbacks = cls.load_all(days)
        if not feedbacks:
            return {"total": 0}
        
        total = len(feedbacks)
        by_category = {}
        by_severity = {}
        by_entry_type = {}
        by_regime = {}
        total_pnl = 0
        
        for fb in feedbacks:
            by_category[fb.category] = by_category.get(fb.category, 0) + 1
            by_severity[fb.severity] = by_severity.get(fb.severity, 0) + 1
            
            key = fb.entry_type or "unknown"
            if key not in by_entry_type:
                by_entry_type[key] = {"count": 0, "wins": 0, "pnl": 0}
            by_entry_type[key]["count"] += 1
            if fb.pnl_dollar > 0:
                by_entry_type[key]["wins"] += 1
            by_entry_type[key]["pnl"] += fb.pnl_dollar
            
            if fb.market_regime:
                by_regime[fb.market_regime] = by_regime.get(fb.market_regime, 0) + 1
            total_pnl += fb.pnl_dollar
        
        return {
            "total": total,
            "win_rate": sum(1 for fb in feedbacks if fb.pnl_dollar > 0) / total * 100,
            "total_pnl": round(total_pnl, 2),
            "by_category": by_category,
            "by_severity": by_severity,
            "by_entry_type": by_entry_type,
            "by_regime": by_regime,
        }


# ============================================
# 3. 按币种参数适配器
# ============================================

class PairParameterAdapter:
    """
    根据币种特性自动适配交易参数
    
    维度：
    - 波动率 → 止损距离、杠杆
    - 流动性 → 仓位大小
    - BTC相关性 → 入场门槛
    """
    
    # 波动率分档
    VOLATILITY_TIERS = {
        "ultra_low":  {"max_leverage": 20, "stop_loss_pct": 0.02, "risk_mult": 1.0},   # <1%
        "low":        {"max_leverage": 20, "stop_loss_pct": 0.03, "risk_mult": 1.0},   # 1-3%
        "medium":     {"max_leverage": 15, "stop_loss_pct": 0.04, "risk_mult": 0.8},   # 3-5%
        "high":       {"max_leverage": 10, "stop_loss_pct": 0.05, "risk_mult": 0.6},   # 5-10%
        "ultra_high": {"max_leverage": 5,  "stop_loss_pct": 0.08, "risk_mult": 0.4},   # >10%
    }
    
    @classmethod
    def get_params(cls, symbol: str, klines_4h: List[dict], base_leverage: int = 20) -> dict:
        """获取适配后的参数"""
        if len(klines_4h) < 20:
            return cls._default_params(base_leverage)
        
        closes = [float(k['close']) for k in klines_4h]
        volumes = [float(k['volume']) for k in klines_4h]
        
        # 波动率
        volatility = cls._calc_volatility(closes)
        tier = cls._get_tier(volatility)
        tier_params = cls.VOLATILITY_TIERS[tier]
        
        # 流动性调整
        avg_volume = sum(volumes[-7:]) / 7
        liquidity_mult = 1.0
        if avg_volume < 1_000_000:
            liquidity_mult = 0.5  # 低流动性减半仓位
        elif avg_volume < 10_000_000:
            liquidity_mult = 0.8
        
        # 杠杆不超过tier限制
        leverage = min(base_leverage, tier_params["max_leverage"])
        
        return {
            "leverage": leverage,
            "stop_loss_pct": tier_params["stop_loss_pct"],
            "risk_mult": tier_params["risk_mult"] * liquidity_mult,
            "volatility": round(volatility, 4),
            "volatility_tier": tier,
            "avg_volume_7d": round(avg_volume, 0),
            "liquidity_mult": liquidity_mult,
        }
    
    @classmethod
    def _calc_volatility(cls, closes: list) -> float:
        """计算20日波动率"""
        if len(closes) < 2:
            return 0
        returns = []
        for i in range(1, len(closes)):
            if closes[i-1] > 0:
                returns.append((closes[i] - closes[i-1]) / closes[i-1])
        if not returns:
            return 0
        avg = sum(returns) / len(returns)
        variance = sum((r - avg) ** 2 for r in returns) / len(returns)
        return math.sqrt(variance) * 100  # 百分比
    
    @classmethod
    def _get_tier(cls, volatility: float) -> str:
        if volatility < 1:
            return "ultra_low"
        elif volatility < 3:
            return "low"
        elif volatility < 5:
            return "medium"
        elif volatility < 10:
            return "high"
        return "ultra_high"
    
    @classmethod
    def _default_params(cls, base_leverage: int) -> dict:
        return {
            "leverage": base_leverage,
            "stop_loss_pct": 0.04,
            "risk_mult": 1.0,
            "volatility": 0,
            "volatility_tier": "unknown",
            "avg_volume_7d": 0,
            "liquidity_mult": 1.0,
        }


# ============================================
# 4. 反馈反思Agent
# ============================================

@dataclass
class OptimizationSuggestion:
    """优化建议"""
    level: str           # parameter / function / strategy
    entry_type: str
    current_value: str
    suggested_value: str
    reason: str
    confidence: float    # 0-1
    supporting_data: dict


class FeedbackReflectionAgent:
    """
    反馈反思Agent (TiMi的Afr启发)
    
    积累足够交易反馈后，自动分析并生成优化建议。
    三层优化：参数级 → 函数级 → 策略级
    """
    
    MIN_TRADES_FOR_ANALYSIS = 20  # 至少20笔才分析
    
    REFLECTION_DIR = DATA_DIR / "reflections"
    
    @classmethod
    def analyze(cls, days: int = 14) -> List[OptimizationSuggestion]:
        """分析近期反馈，生成优化建议"""
        feedbacks = FeedbackClassifier.load_all(days)
        
        if len(feedbacks) < cls.MIN_TRADES_FOR_ANALYSIS:
            logger.info(f"[Reflection] 交易不足{cls.MIN_TRADES_FOR_ANALYSIS}笔({len(feedbacks)}笔)，跳过分析")
            return []
        
        suggestions = []
        
        # 按entry_type分组分析
        by_type = {}
        for fb in feedbacks:
            key = fb.entry_type or "unknown"
            if key not in by_type:
                by_type[key] = []
            by_type[key].append(fb)
        
        for entry_type, trades in by_type.items():
            if len(trades) < 5:
                continue
            
            total = len(trades)
            wins = len([t for t in trades if t.pnl_dollar > 0])
            wr = wins / total * 100
            avg_pnl = sum(t.pnl_dollar for t in trades) / total
            total_pnl = sum(t.pnl_dollar for t in trades)
            avg_hold = sum(t.bars_held for t in trades) / total
            
            # 分析止损率
            stop_losses = len([t for t in trades if t.exit_reason == "stop_loss"])
            sl_rate = stop_losses / total * 100
            
            # 分析市场环境分布
            regime_dist = {}
            for t in trades:
                if t.market_regime:
                    regime_dist[t.market_regime] = regime_dist.get(t.market_regime, 0) + 1
            
            # === 规则1: 胜率太低 → 收紧入场条件 ===
            if wr < 30 and total >= 10:
                suggestions.append(OptimizationSuggestion(
                    level="parameter",
                    entry_type=entry_type,
                    current_value=f"当前胜率{wr:.0f}%",
                    suggested_value="提高入场评分阈值+10分",
                    reason=f"{entry_type} 胜率仅{wr:.0f}%({total}笔)，需收紧入场条件",
                    confidence=0.8 if total >= 15 else 0.6,
                    supporting_data={"win_rate": wr, "total_trades": total, "total_pnl": total_pnl}
                ))
            
            # === 规则2: 止损率太高 → 放宽止损或改善入场 ===
            if sl_rate > 60 and total >= 10:
                suggestions.append(OptimizationSuggestion(
                    level="parameter",
                    entry_type=entry_type,
                    current_value=f"止损率{sl_rate:.0f}%",
                    suggested_value="检查止损距离是否合理，或收紧入场条件减少假信号",
                    reason=f"{entry_type} 止损率{sl_rate:.0f}%过高，{stop_losses}/{total}笔止损",
                    confidence=0.7,
                    supporting_data={"sl_rate": sl_rate, "total_trades": total}
                ))
            
            # === 规则3: Pump环境亏钱 → 该环境禁止入场 ===
            pump_losses = [t for t in trades if t.market_regime == "pump" and t.pnl_dollar < 0]
            if len(pump_losses) >= 3:
                suggestions.append(OptimizationSuggestion(
                    level="function",
                    entry_type=entry_type,
                    current_value="Pump环境允许入场",
                    suggested_value="Pump环境禁止该类型入场",
                    reason=f"Pump环境下{len(pump_losses)}笔亏损，总计{sum(t.pnl_dollar for t in pump_losses):.0f}U",
                    confidence=0.9,
                    supporting_data={"pump_losses": len(pump_losses)}
                ))
            
            # === 规则4: 某环境特别赚钱 → 增加该环境权重 ===
            for regime, count in regime_dist.items():
                regime_trades = [t for t in trades if t.market_regime == regime]
                if len(regime_trades) >= 5:
                    regime_wr = len([t for t in regime_trades if t.pnl_dollar > 0]) / len(regime_trades) * 100
                    if regime_wr > 50:
                        suggestions.append(OptimizationSuggestion(
                            level="parameter",
                            entry_type=entry_type,
                            current_value=f"{regime}环境正常交易",
                            suggested_value=f"{regime}环境下增加仓位权重(×1.3)",
                            reason=f"{regime}环境胜率{regime_wr:.0f}%({len(regime_trades)}笔)，可加仓",
                            confidence=0.7,
                            supporting_data={"regime": regime, "win_rate": regime_wr}
                        ))
            
            # === 规则5: 总体亏损严重 → 考虑禁用该策略 ===
            if total_pnl < -500 and total >= 15 and wr < 35:
                suggestions.append(OptimizationSuggestion(
                    level="strategy",
                    entry_type=entry_type,
                    current_value=f"启用{entry_type}",
                    suggested_value=f"禁用{entry_type}或彻底重构",
                    reason=f"{entry_type} 总亏${total_pnl:.0f}，胜率{wr:.0f}%，需策略级调整",
                    confidence=0.85,
                    supporting_data={"total_pnl": total_pnl, "win_rate": wr}
                ))
            
            # === 规则6: 持仓时间太短（频繁止损）→ 入场时机差 ===
            if avg_hold < 5 and sl_rate > 50:
                suggestions.append(OptimizationSuggestion(
                    level="function",
                    entry_type=entry_type,
                    current_value=f"平均持仓{avg_hold:.1f}根4hK线",
                    suggested_value="增加多周期确认（4h+1h+15m），改善入场时机",
                    reason=f"平均持仓仅{avg_hold:.1f}根K线，频繁止损说明入场时机差",
                    confidence=0.7,
                    supporting_data={"avg_hold": avg_hold, "sl_rate": sl_rate}
                ))
        
        return suggestions
    
    @classmethod
    def save_reflection(cls, suggestions: List[OptimizationSuggestion]):
        """保存反思结果"""
        cls.REFLECTION_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
        rfile = cls.REFLECTION_DIR / f"reflection_{ts}.json"
        
        data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "suggestion_count": len(suggestions),
            "suggestions": [asdict(s) for s in suggestions],
        }
        rfile.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        logger.info(f"[Reflection] 保存到 {rfile}")
    
    @classmethod
    def get_latest_reflection(cls) -> Optional[dict]:
        """获取最近一次反思结果"""
        if not cls.REFLECTION_DIR.exists():
            return None
        files = sorted(cls.REFLECTION_DIR.glob("reflection_*.json"), reverse=True)
        if not files:
            return None
        return json.loads(files[0].read_text())


# ============================================
# 5. 三层优化闭环
# ============================================

class HierarchicalOptimizer:
    """
    三层优化闭环（TiMi启发）
    
    Level 1 - 参数级：调阈值、改百分比（自动应用）
    Level 2 - 函数级：换指标、改逻辑（生成建议，人工确认）
    Level 3 - 策略级：重构/禁用（生成建议，人工确认）
    """
    
    OPTIMIZATION_LOG = DATA_DIR / "optimization_log.json"
    
    @classmethod
    def run(cls, auto_apply_level1: bool = True) -> dict:
        """运行优化闭环"""
        suggestions = FeedbackReflectionAgent.analyze()
        
        if not suggestions:
            return {"status": "no_suggestions", "message": "暂无优化建议"}
        
        result = {
            "total_suggestions": len(suggestions),
            "by_level": {},
            "applied": [],
            "pending": [],
            "skipped": [],
        }
        
        for s in suggestions:
            level = s.level
            if level not in result["by_level"]:
                result["by_level"][level] = 0
            result["by_level"][level] += 1
            
            if level == "parameter" and auto_apply_level1 and s.confidence >= 0.8:
                # 高置信度参数级优化自动应用
                applied = cls._apply_parameter_optimization(s)
                if applied:
                    result["applied"].append(asdict(s))
                    logger.info(f"[Optimizer] ✅ 自动应用: {s.reason}")
                else:
                    result["pending"].append(asdict(s))
            else:
                # 函数级和策略级需要人工确认
                result["pending"].append(asdict(s))
        
        # 保存反思
        FeedbackReflectionAgent.save_reflection(suggestions)
        
        # 保存优化日志
        cls._log_optimization(result)
        
        return result
    
    @classmethod
    def _apply_parameter_optimization(cls, suggestion: OptimizationSuggestion) -> bool:
        """尝试自动应用参数级优化"""
        # 目前只记录，不自动修改代码（安全起见）
        # 未来可以接入自动参数调整
        return False
    
    @classmethod
    def _log_optimization(cls, result: dict):
        """记录优化日志"""
        records = []
        if cls.OPTIMIZATION_LOG.exists():
            try:
                records = json.loads(cls.OPTIMIZATION_LOG.read_text())
            except:
                pass
        
        records.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **result,
        })
        
        # 只保留最近20次
        records = records[-20:]
        cls.OPTIMIZATION_LOG.write_text(json.dumps(records, ensure_ascii=False, indent=2))
    
    @classmethod
    def get_optimization_report(cls) -> str:
        """生成优化报告"""
        latest = FeedbackReflectionAgent.get_latest_reflection()
        if not latest:
            return "暂无优化数据"
        
        lines = ["📊 优化报告\n"]
        for s in latest.get("suggestions", []):
            level_emoji = {"parameter": "🔧", "function": "⚡", "strategy": "🔥"}
            emoji = level_emoji.get(s["level"], "❓")
            conf_bar = "█" * int(s["confidence"] * 5) + "░" * (5 - int(s["confidence"] * 5))
            lines.append(
                f"{emoji} [{s['level'].upper()}] {s['entry_type']}\n"
                f"   {s['reason']}\n"
                f"   建议: {s['suggested_value']}\n"
                f"   置信度: {conf_bar} {s['confidence']:.0%}\n"
            )
        
        return "\n".join(lines)


# ============================================
# 便捷接口
# ============================================

def enhance_open_position(agent, symbol: str, direction: str, entry_price: float,
                          stop_loss: float, leverage: int, entry_type: str = "",
                          klines_4h: List[dict] = None, **kwargs) -> bool:
    """
    增强版开仓接口 - 在原有开仓前加入：
    1. 市场环境检测（Pump禁止）
    2. 波动率参数适配
    """
    # 1. 市场环境检测
    if klines_4h:
        regime = MarketRegimeDetector.detect(klines_4h, symbol)
        blocked, reason = MarketRegimeDetector.should_block_entry(regime, entry_type)
        if blocked:
            logger.info(f"🚫 [{agent.agent_type}] {symbol} {entry_type} 被拦截: {reason}")
            return False
        
        # 2. 波动率参数适配
        pair_params = PairParameterAdapter.get_params(symbol, klines_4h, leverage)
        leverage = pair_params["leverage"]
        # 风险系数调整
        if pair_params["risk_mult"] < 1.0:
            # 通过减少仓位来降低风险
            original_risk = agent.max_single_risk_pct
            agent.max_single_risk_pct *= pair_params["risk_mult"]
            result = agent.open_position(symbol, direction, entry_price, stop_loss, 
                                          leverage, entry_type, **kwargs)
            agent.max_single_risk_pct = original_risk
            return result
    
    return agent.open_position(symbol, direction, entry_price, stop_loss,
                                leverage, entry_type, **kwargs)


def enhance_close_position(agent, symbol: str, exit_price: float, reason: str = "",
                            klines_4h: List[dict] = None) -> dict:
    """
    增强版平仓接口 - 平仓后自动：
    1. 反馈分类
    2. 记录反馈
    """
    trade = agent.close_position(symbol, exit_price, reason)
    
    if trade:
        # 自动分类反馈
        fb = FeedbackClassifier.classify(trade, klines_4h)
        FeedbackClassifier.save(fb)
        logger.info(f"📝 反馈: {fb.category} [{fb.severity}] {fb.notes}")
    
    return trade
