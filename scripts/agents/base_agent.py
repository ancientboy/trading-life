"""
Agent基类 - 所有策略Agent的父类

提供：
- 独立资金池管理
- 独立持仓管理
- 独立熔断机制
- 信号记录
"""

import json
import logging
import asyncio
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import DATA_DIR

logger = logging.getLogger("BaseAgent")


@dataclass
class Position:
    symbol: str
    direction: str
    entry_price: float
    quantity: float
    leverage: int
    stop_loss: float
    take_profit: List[float]
    opened_at: str
    agent_type: str = ""
    entry_type: str = ""
    entry_reasoning: str = ""


class BaseAgent:
    """策略Agent基类"""
    
    def __init__(
        self,
        agent_type: str,
        capital: float,
        max_positions: int = 3,
        max_single_risk_pct: float = 0.03,
        max_position_pct: float = 0.10,
        circuit_break_limit: int = 6,
    ):
        self.agent_type = agent_type
        self.capital = capital
        self.initial_capital = capital
        self.max_positions = max_positions
        self.max_single_risk_pct = max_single_risk_pct
        self.max_position_pct = max_position_pct
        self.circuit_break_limit = circuit_break_limit
        
        self.positions: Dict[str, Position] = {}
        self.trade_history: List[dict] = []
        self.consecutive_losses = 0
        self.is_circuit_break = False
        self.total_trades = 0
        self.total_wins = 0
        self.total_losses = 0
        self.total_pnl = 0.0
        
        self._state_file = DATA_DIR / f"agent_{agent_type}_state.json"
        self._load_state()
    
    def _load_state(self):
        if not self._state_file.exists():
            return
        try:
            d = json.loads(self._state_file.read_text())
            self.capital = d.get("capital", self.capital)
            self.consecutive_losses = d.get("consecutive_losses", 0)
            self.is_circuit_break = d.get("is_circuit_break", False)
            self.total_trades = d.get("total_trades", 0)
            self.total_wins = d.get("total_wins", 0)
            self.total_losses = d.get("total_losses", 0)
            self.total_pnl = d.get("total_pnl", 0)
            for sym, p in d.get("positions", {}).items():
                self.positions[sym] = Position(**p)
            self.trade_history = d.get("trade_history", [])
        except Exception as e:
            logger.warning(f"{self.agent_type} 状态加载失败: {e}")
    
    def _save_state(self):
        d = {
            "agent_type": self.agent_type,
            "capital": self.capital,
            "initial_capital": self.initial_capital,
            "consecutive_losses": self.consecutive_losses,
            "is_circuit_break": self.is_circuit_break,
            "total_trades": self.total_trades,
            "total_wins": self.total_wins,
            "total_losses": self.total_losses,
            "total_pnl": self.total_pnl,
            "positions": {sym: asdict(p) for sym, p in self.positions.items()},
            "trade_history": self.trade_history[-50:],  # 只保留最近50条
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._state_file.write_text(json.dumps(d, ensure_ascii=False, indent=2))
    
    def can_open(self) -> bool:
        """是否能开仓"""
        # ★ 熔断暂时禁用，确保Agent持续运行
        # if self.is_circuit_break:
        #     return False
        if len(self.positions) >= self.max_positions:
            return False
        if self.capital < self.initial_capital * 0.2:
            return False  # 资金不足20%停止
        return True
    
    def calc_position_size(self, entry_price: float, stop_loss: float, leverage: int) -> dict:
        """计算仓位"""
        if entry_price <= 0:
            return {"quantity": 0, "margin": 0, "leverage": leverage}
        
        risk_dist = abs(entry_price - stop_loss)
        risk_pct = risk_dist / entry_price if entry_price > 0 else 1
        
        risk_amount = self.capital * self.max_single_risk_pct
        max_margin = self.capital * self.max_position_pct
        
        # 连续亏损减仓
        if self.consecutive_losses >= 3:
            risk_amount *= 0.5
            max_margin *= 0.5
        
        quantity_by_risk = risk_amount / risk_dist if risk_dist > 0 else 0
        quantity_by_margin = max_margin * leverage / entry_price
        
        quantity = min(quantity_by_risk, quantity_by_margin)
        margin = quantity * entry_price / leverage
        margin_pct = margin / self.capital * 100
        
        if margin_pct > self.max_position_pct * 100:
            quantity = max_margin * leverage / entry_price
        
        return {
            "quantity": quantity,
            "margin": quantity * entry_price / leverage,
            "leverage": leverage,
            "margin_pct": margin / self.capital * 100,
        }
    
    # Pump/疯狂环境下禁止开仓的信号类型
    PUMP_BLOCKED_TYPES = {'prelaunch_ambush', 'breakout', 'newcoin_surge', 'newcoin_bottom', 'short_squeeze', 'watch_pool_breakout'}  # surge_chase NOT blocked - 动量追涨在pump环境也能做
    
    def open_position(self, symbol: str, direction: str, entry_price: float,
                       stop_loss: float, leverage: int, entry_type: str = "",
                       take_profit: List[float] = None, reasoning: str = "",
                       klines_4h: list = None) -> bool:
        """开仓 - 增强版：市场环境检测+波动率适配"""
        if not self.can_open():
            return False
        if symbol in self.positions:
            return False
        
        old_risk = None
        # === 市场环境检测 ===
        if klines_4h:
            try:
                from enhancer import MarketRegimeDetector, PairParameterAdapter
                regime = MarketRegimeDetector.detect(klines_4h, symbol)
                blocked, block_reason = MarketRegimeDetector.should_block_entry(regime, entry_type)
                if blocked:
                    logger.info(f"🚫 [{self.agent_type}] {symbol} {entry_type} 拦截: {block_reason}")
                    return False
                
                # 波动率适配
                pair_params = PairParameterAdapter.get_params(symbol, klines_4h, leverage)
                leverage = pair_params["leverage"]
                if pair_params["risk_mult"] < 1.0:
                    old_risk = self.max_single_risk_pct
                    self.max_single_risk_pct *= pair_params["risk_mult"]
            except Exception as e:
                logger.debug(f"增强检测跳过: {e}")
        
        sizing = self.calc_position_size(entry_price, stop_loss, leverage)
        if sizing["quantity"] <= 0:
            if old_risk is not None:
                self.max_single_risk_pct = old_risk
            return False
        
        pos = Position(
            symbol=symbol, direction=direction,
            entry_price=entry_price, quantity=sizing["quantity"],
            leverage=leverage, stop_loss=stop_loss,
            take_profit=take_profit or [],
            opened_at=datetime.now(timezone.utc).isoformat(),
            agent_type=self.agent_type, entry_type=entry_type,
            entry_reasoning=reasoning[:200],
        )
        
        if old_risk is not None:
            self.max_single_risk_pct = old_risk
        
        self.positions[symbol] = pos
        self._save_state()
        logger.info(f"✅ [{self.agent_type}] 开仓: {symbol} {direction} @{entry_price:.4f} {leverage}x ({entry_type})")
        return True
    
    def close_position(self, symbol: str, exit_price: float, reason: str = "",
                         klines_4h: list = None) -> Optional[dict]:
        """平仓 - 增强版：自动反馈分类"""
        pos = self.positions.pop(symbol, None)
        if not pos:
            return None
        
        pnl_pct = (exit_price / pos.entry_price - 1) * 100 * pos.leverage
        if pos.direction == "SHORT":
            pnl_pct = -pnl_pct
        
        pnl_amount = pos.quantity * pos.entry_price * pnl_pct / 100 / pos.leverage
        self.capital += pnl_amount
        self.total_pnl += pnl_amount
        self.total_trades += 1
        
        is_win = pnl_amount > 0
        if is_win:
            self.total_wins += 1
            self.consecutive_losses = 0
        else:
            self.total_losses += 1
            self.consecutive_losses += 1
        
        # ★ 熔断暂时禁用
        # if self.consecutive_losses >= self.circuit_break_limit:
        #     self.is_circuit_break = True
        #     logger.warning(f"🚨 [{self.agent_type}] 熔断: 连亏{self.consecutive_losses}笔")
        
        trade = {
            "symbol": symbol, "direction": pos.direction,
            "entry_price": pos.entry_price, "exit_price": exit_price,
            "quantity": pos.quantity, "leverage": pos.leverage,
            "pnl_pct": round(pnl_pct, 2), "pnl_amount": round(pnl_amount, 2),
            "entry_type": pos.entry_type, "reason": reason,
            "opened_at": pos.opened_at,
            "closed_at": datetime.now(timezone.utc).isoformat(),
            "agent_type": self.agent_type,
        }
        self.trade_history.append(trade)
        self._save_state()
        
        # === 自动反馈分类 ===
        try:
            from enhancer import FeedbackClassifier
            fb = FeedbackClassifier.classify(trade, klines_4h)
            FeedbackClassifier.save(fb)
            logger.info(f"📝 反馈: {fb.category} [{fb.severity}] {fb.notes}")
        except Exception as e:
            logger.debug(f"反馈分类跳过: {e}")
        
        emoji = "🏆" if is_win else "💀"
        logger.info(f"{emoji} [{self.agent_type}] 平仓: {symbol} {pnl_pct:+.1f}% ({reason})")
        return trade
    
    def check_stop_loss(self, symbol: str, current_price: float) -> bool:
        """检查止损"""
        pos = self.positions.get(symbol)
        if not pos:
            return False
        if pos.direction == "LONG" and current_price <= pos.stop_loss:
            return True
        if pos.direction == "SHORT" and current_price >= pos.stop_loss:
            return True
        return False
    
    def check_take_profit(self, symbol: str, current_price: float) -> bool:
        """检查止盈 - 旧版固定百分比（已弃用，由结构止盈替代）"""
        return False
    
    @staticmethod
    def calc_atr_stop_loss(klines: list, price: float, direction: str, atr_mult: float = 2.0) -> float:
        """ATR动态止损 - 替代固定百分比止损
        
        atr_mult: ATR倍数，越大止损越宽
        默认2.0倍ATR（中等宽度）
        """
        if len(klines) < 14:
            # 数据不足，用固定6%兜底
            return price * 0.94 if direction == 'LONG' else price * 1.06
        
        highs = [float(k['high']) for k in klines[-14:]]
        lows = [float(k['low']) for k in klines[-14:]]
        closes = [float(k['close']) for k in klines[-14:]]
        
        # 计算ATR(14)
        tr_list = []
        for i in range(1, len(closes)):
            tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
            tr_list.append(tr)
        atr = sum(tr_list) / len(tr_list) if tr_list else price * 0.01
        
        stop_dist = atr * atr_mult
        
        # 限制范围：最小3%，最大10%
        min_stop = price * 0.03
        max_stop = price * 0.10
        stop_dist = max(min_stop, min(stop_dist, max_stop))
        
        if direction == 'LONG':
            return price - stop_dist
        else:
            return price + stop_dist

    @staticmethod
    def check_structure_exit(klines, direction: str, current_price: float) -> dict:
        """
        改进版结构止盈判断 v2
        
        LONG止盈条件（满足任一）：
        1. 跌破EMA10（短期趋势破位，比EMA20更灵敏）
        2. 放量阴线跌破前低（结构破位）
        3. 量价背离+顶部K线
        4. RSI超买回落（>70后跌破60）
        
        SHORT止盈条件（满足任一）：
        1. 突破EMA10
        2. 放量阳线突破前高
        3. 量价背离+底部K线
        4. RSI超卖回升（<30后突破40）
        """
        if len(klines) < 20:
            return {"exit": False, "reason": "数据不足"}
        
        closes = [float(k['close']) for k in klines]
        highs = [float(k['high']) for k in klines]
        lows = [float(k['low']) for k in klines]
        volumes = [float(k['volume']) for k in klines]
        
        def calc_ema(data, period):
            if len(data) < period:
                return data[-1]
            k = 2 / (period + 1)
            ema = sum(data[:period]) / period
            for v in data[period:]:
                ema = v * k + ema * (1 - k)
            return ema
        
        def calc_rsi(data, period=14):
            if len(data) < period + 1:
                return 50
            gains, losses = [], []
            for i in range(1, len(data)):
                d = data[i] - data[i-1]
                gains.append(max(0, d))
                losses.append(max(0, -d))
            if len(gains) < period: return 50
            ag = sum(gains[:period]) / period
            al = sum(losses[:period]) / period
            for i in range(period, len(gains)):
                ag = (ag*(period-1)+gains[i])/period
                al = (al*(period-1)+losses[i])/period
            if al == 0: return 100
            return 100 - 100/(1+ag/al)
        
        ema10 = calc_ema(closes, 10)
        ema20 = calc_ema(closes, 20)
        rsi = calc_rsi(closes)
        
        recent_closes = closes[-5:]
        recent_highs = highs[-5:]
        recent_lows = lows[-5:]
        recent_volumes = volumes[-5:]
        avg_volume = sum(volumes[-20:]) / 20
        
        if direction == "LONG":
            # 1. 跌破EMA10（更灵敏）
            if current_price < ema10:
                return {"exit": True, "reason": f"跌破EMA10({ema10:.4f})，短期趋势破位"}
            
            # 2. 放量阴线跌破前低
            prev_low = min(recent_lows[:-1])
            last_close = recent_closes[-1]
            last_open = float(klines[-1].get('open', (float(klines[-1]['high'])+float(klines[-1]['low']))/2))
            last_volume = recent_volumes[-1]
            
            if last_close < prev_low and last_volume > avg_volume * 1.3 and last_close < last_open:
                return {"exit": True, "reason": f"放量跌破前低({prev_low:.4f})，结构破位"}
            
            # 3. 量价背离 + 顶部信号
            if len(recent_highs) >= 3:
                price_higher = recent_highs[-1] > recent_highs[-2] > recent_highs[-3]
                volume_lower = recent_volumes[-1] < recent_volumes[-2] and recent_volumes[-1] < avg_volume * 0.7
                body = abs(last_close - last_open)
                upper_wick = recent_highs[-1] - max(last_close, last_open)
                has_rejection = upper_wick > body * 2
                
                if price_higher and volume_lower and has_rejection:
                    return {"exit": True, "reason": "量价背离+长上影线，见顶信号"}
            
            # 4. RSI超买回落
            if rsi < 60 and len(closes) >= 2:
                prev_rsi = calc_rsi(closes[:-1])
                if prev_rsi > 70:
                    return {"exit": True, "reason": f"RSI从{prev_rsi:.0f}回落至{rsi:.0f}，动能衰退"}
            
            return {"exit": False, "reason": "趋势完好"}
        
        elif direction == "SHORT":
            # 1. 突破EMA10
            if current_price > ema10:
                return {"exit": True, "reason": f"突破EMA10({ema10:.4f})，短期趋势破位"}
            
            # 2. 放量阳线突破前高
            prev_high = max(recent_highs[:-1])
            if last_close > prev_high and last_volume > avg_volume * 1.3 and last_close > last_open:
                return {"exit": True, "reason": f"放量突破前高({prev_high:.4f})，结构破位"}
            
            # 3. 量价背离
            if len(recent_lows) >= 3:
                price_lower = recent_lows[-1] < recent_lows[-2] < recent_lows[-3]
                volume_lower = recent_volumes[-1] < recent_volumes[-2] and recent_volumes[-1] < avg_volume * 0.7
                body = abs(last_close - last_open)
                lower_wick = min(last_close, last_open) - recent_lows[-1]
                has_rejection = lower_wick > body * 2
                
                if price_lower and volume_lower and has_rejection:
                    return {"exit": True, "reason": "量价背离+长下影线，见底信号"}
            
            # 4. RSI超卖回升
            if rsi > 40 and len(closes) >= 2:
                prev_rsi = calc_rsi(closes[:-1])
                if prev_rsi < 30:
                    return {"exit": True, "reason": f"RSI从{prev_rsi:.0f}回升至{rsi:.0f}，下跌动能衰退"}
            
            return {"exit": False, "reason": "趋势完好"}
        
        return {"exit": False, "reason": "未知方向"}
    
    def get_status(self) -> str:
        """获取状态报告"""
        wr = self.total_wins / self.total_trades * 100 if self.total_trades > 0 else 0
        lines = [
            f"📊 **{self.agent_type} Agent**",
            f"资金: ${self.capital:,.2f} (初始${self.initial_capital:,.0f})",
            f"PnL: ${self.total_pnl:+,.2f} | 交易{self.total_trades}笔 | 胜率{wr:.0f}%",
            f"连亏: {self.consecutive_losses} | 熔断: {'是' if self.is_circuit_break else '否'}",
            f"持仓: {len(self.positions)}个",
        ]
        for sym, p in self.positions.items():
            lines.append(f"  {sym} {p.direction} @{p.entry_price:.4f} {p.leverage}x [{p.entry_type}]")
        return "\n".join(lines)
