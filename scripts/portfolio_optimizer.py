#!/usr/bin/env python3
"""
多策略组合优化器 v1.0

功能：
1. 策略相关性分析（避免同向持仓）
2. 资金分配优化（根据策略表现动态分配）
3. 历史订单回放验证
4. 组合级别的风控
"""

import json
import math
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timezone

logger = logging.getLogger("PortfolioOptimizer")

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
EVOLVE_DIR = Path(__file__).parent / "data" / "evolve"


@dataclass
class StrategyStats:
    """策略统计"""
    name: str
    total_trades: int = 0
    wins: int = 0
    total_pnl: float = 0
    avg_pnl: float = 0
    win_rate: float = 0
    sharpe: float = 0
    max_drawdown: float = 0
    avg_hold_time: float = 0  # 小时
    capital_allocated: float = 0
    capital_return: float = 0  # 收益率
    correlation: Dict[str, float] = field(default_factory=dict)
    score: float = 0


class PortfolioOptimizer:
    """多策略组合优化器"""

    # 策略分类
    STRATEGIES = {
        "momentum_quick": {"type": "momentum", "timeframe": "1h", "max_positions": 2},
        "momentum_wave": {"type": "momentum", "timeframe": "4h", "max_positions": 2},
        "momentum_newcoin": {"type": "momentum", "timeframe": "4h", "max_positions": 1},
        "altcoin": {"type": "swing", "timeframe": "4h", "max_positions": 2},
        "major": {"type": "swing", "timeframe": "4h", "max_positions": 1},
        "newcoin": {"type": "swing", "timeframe": "4h", "max_positions": 1},
    }

    # 相关性阈值（高于此值视为高相关，需要限制）
    CORRELATION_THRESHOLD = 0.7

    def __init__(self):
        self.trade_log = self._load_trade_log()
        self.strategy_stats: Dict[str, StrategyStats] = {}

    def _load_trade_log(self) -> List[dict]:
        """加载历史交易记录"""
        trades = []
        log_path = DATA_DIR / "trade-log.jsonl"
        if not log_path.exists():
            return trades
        with open(log_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        trades.append(json.loads(line))
                    except:
                        pass
        return trades

    # ================================================================
    # 策略表现分析
    # ================================================================

    def analyze_strategies(self) -> Dict[str, StrategyStats]:
        """分析各策略表现"""
        # 按策略分组（通过symbol特征推断策略类型）
        strategy_trades = defaultdict(list)

        for t in self.trade_log:
            if t.get("action") != "CLOSE":
                continue
            # 推断策略（简化版：基于trade-log的现有字段）
            strategy = self._infer_strategy(t)
            strategy_trades[strategy].append(t)

        for name, trades in strategy_trades.items():
            stats = self._calc_stats(name, trades)
            self.strategy_stats[name] = stats

        # 计算策略间相关性
        self._calc_correlations()

        # 计算综合评分
        self._calc_scores()

        return self.strategy_stats

    def _infer_strategy(self, trade: dict) -> str:
        """推断交易属于哪个策略"""
        sym = trade.get("symbol", "")
        reason = trade.get("reason", "")
        direction = trade.get("direction", "")
        leverage = trade.get("leverage", 10)

        # 从reason推断
        if "surge" in reason.lower() or "快钱" in reason:
            return "momentum_quick"
        if "wave" in reason.lower() or "波段" in reason:
            return "momentum_wave"
        if "newcoin" in reason.lower() or "新币" in reason:
            return "momentum_newcoin"

        # 从leverage推断（高杠杆=短期策略）
        if leverage >= 20:
            return "momentum_quick"
        if leverage >= 10:
            return "altcoin"

        # 从symbol推断（大币=major）
        majors = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]
        if sym in majors:
            return "major"

        return "altcoin"  # 默认

    def _calc_stats(self, name: str, trades: List[dict]) -> StrategyStats:
        """计算策略统计"""
        n = len(trades)
        if n == 0:
            return StrategyStats(name=name)

        wins = sum(1 for t in trades if t.get("dollar_pnl", 0) > 0)
        total_pnl = sum(t.get("dollar_pnl", 0) for t in trades)
        pnls = [t.get("dollar_pnl", 0) for t in trades]

        # Sharpe
        if len(pnls) > 1:
            avg = sum(pnls) / len(pnls)
            var = sum((x - avg) ** 2 for x in pnls) / len(pnls)
            sharpe = avg / (var ** 0.5) if var > 0 else 0
        else:
            sharpe = 0

        # 最大回撤（简单版）
        equity = [0]
        for p in pnls:
            equity.append(equity[-1] + p)
        peak = 0
        max_dd = 0
        for e in equity:
            if e > peak:
                peak = e
            dd = (peak - e) / peak * 100 if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

        return StrategyStats(
            name=name,
            total_trades=n,
            wins=wins,
            total_pnl=round(total_pnl, 2),
            avg_pnl=round(total_pnl / n, 2),
            win_rate=round(wins / n * 100, 1),
            sharpe=round(sharpe, 3),
            max_drawdown=round(max_dd, 1),
        )

    def _calc_correlations(self):
        """计算策略间PnL相关性"""
        # 按日聚合各策略PnL
        daily_pnl = defaultdict(lambda: defaultdict(float))

        for t in self.trade_log:
            if t.get("action") != "CLOSE":
                continue
            strategy = self._infer_strategy(t)
            day = t.get("timestamp", "")[:10]
            daily_pnl[day][strategy] += t.get("dollar_pnl", 0)

        if not daily_pnl:
            return

        # 计算相关矩阵
        strategies = list(self.strategy_stats.keys())
        for i, s1 in enumerate(strategies):
            for j, s2 in enumerate(strategies):
                if i >= j:
                    continue
                # 获取两个策略的日PnL序列
                vals1 = []
                vals2 = []
                for day in sorted(daily_pnl.keys()):
                    vals1.append(daily_pnl[day].get(s1, 0))
                    vals2.append(daily_pnl[day].get(s2, 0))

                if len(vals1) < 3:
                    corr = 0
                else:
                    corr = self._pearson(vals1, vals2)

                self.strategy_stats[s1].correlation[s2] = round(corr, 3)
                self.strategy_stats[s2].correlation[s1] = round(corr, 3)

    def _pearson(self, x: List[float], y: List[float]) -> float:
        """皮尔逊相关系数"""
        n = len(x)
        if n < 2:
            return 0
        avg_x = sum(x) / n
        avg_y = sum(y) / n
        num = sum((x[i] - avg_x) * (y[i] - avg_y) for i in range(n))
        den_x = sum((x[i] - avg_x) ** 2 for i in range(n)) ** 0.5
        den_y = sum((y[i] - avg_y) ** 2 for i in range(n)) ** 0.5
        if den_x == 0 or den_y == 0:
            return 0
        return num / (den_x * den_y)

    def _calc_scores(self):
        """计算综合评分"""
        if not self.strategy_stats:
            return

        # 归一化各指标
        max_pnl = max(s.total_pnl for s in self.strategy_stats.values()) or 1
        max_wr = 100
        max_sharpe = max(abs(s.sharpe) for s in self.strategy_stats.values()) or 1

        for stats in self.strategy_stats.values():
            # 评分：PnL(30%) + 胜率(20%) + Sharpe(20%) + 交易数(15%) + 回撤(15%)
            pnl_score = stats.total_pnl / max_pnl * 30
            wr_score = stats.win_rate / max_wr * 20
            sharpe_score = (stats.sharpe / max_sharpe) * 20
            trade_score = min(stats.total_trades / 50, 1) * 15
            dd_score = max(0, 20 - stats.max_drawdown)

            stats.score = round(pnl_score + wr_score + sharpe_score + trade_score + dd_score, 1)

    # ================================================================
    # 资金分配优化
    # ================================================================

    def optimize_allocation(self, total_capital: float) -> Dict[str, float]:
        """基于策略评分分配资金"""
        if not self.strategy_stats:
            self.analyze_strategies()

        if not self.strategy_stats:
            # 没有数据时平均分配
            n = len(self.STRATEGIES)
            return {s: total_capital / n for s in self.STRATEGIES}

        # 评分加权分配
        total_score = sum(max(s.score, 0) for s in self.strategy_stats.values())
        if total_score == 0:
            n = len(self.strategy_stats)
            return {s: total_capital / n for s in self.strategy_stats}

        allocation = {}
        for name, stats in self.strategy_stats.items():
            weight = max(stats.score, 0) / total_score
            allocation[name] = round(total_capital * weight, 2)
            stats.capital_allocated = allocation[name]

        return allocation

    # ================================================================
    # 历史回放
    # ================================================================

    def replay_history(self, initial_capital: float = 18720,
                       days: int = 30) -> Dict:
        """回放历史订单，模拟资金曲线"""
        closes = [t for t in self.trade_log if t.get("action") == "CLOSE"]
        # 按时间排序
        closes.sort(key=lambda t: t.get("timestamp", ""))

        if not closes:
            return {"error": "no trades"}

        equity = initial_capital
        peak = initial_capital
        max_dd = 0
        equity_curve = [{"time": closes[0]["timestamp"][:10], "equity": equity}]
        daily_pnl = defaultdict(float)
        strategy_pnl = defaultdict(float)

        for t in closes:
            pnl = t.get("dollar_pnl", 0)
            equity += pnl
            day = t["timestamp"][:10]
            daily_pnl[day] += pnl

            strategy = self._infer_strategy(t)
            strategy_pnl[strategy] += pnl

            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak * 100 if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

            equity_curve.append({
                "time": day,
                "equity": round(equity, 2),
                "pnl": round(pnl, 2),
                "symbol": t.get("symbol"),
                "strategy": strategy,
            })

        total_pnl = equity - initial_capital
        return_pct = total_pnl / initial_capital * 100
        wins = sum(1 for t in closes if t.get("dollar_pnl", 0) > 0)

        return {
            "initial_capital": initial_capital,
            "final_equity": round(equity, 2),
            "total_pnl": round(total_pnl, 2),
            "return_pct": round(return_pct, 1),
            "total_trades": len(closes),
            "win_rate": round(wins / len(closes) * 100, 1),
            "max_drawdown": round(max_dd, 1),
            "daily_pnl": {k: round(v, 2) for k, v in sorted(daily_pnl.items())},
            "strategy_pnl": {k: round(v, 2) for k, v in sorted(strategy_pnl.items(),
                                                                 key=lambda x: -x[1])},
            "equity_curve": equity_curve[-10:],  # 只保留最后10个
        }

    # ================================================================
    # 组合风控
    # ================================================================

    def check_portfolio_risk(self, positions: Dict,
                              capital: float) -> Dict:
        """组合级风控检查"""
        alerts = []

        # 1. 检查同向持仓（避免过度集中）
        long_count = sum(1 for p in positions.values()
                        if p.get("direction") == "LONG")
        short_count = sum(1 for p in positions.values()
                         if p.get("direction") == "SHORT")

        if long_count >= 4:
            alerts.append({
                "level": "WARNING",
                "msg": f"多头持仓{long_count}个，过度集中",
            })

        # 2. 检查相关性（避免高相关持仓）
        syms = list(positions.keys())
        # 简化：同板块过多=高相关
        sectors = defaultdict(int)
        for sym in syms:
            # 按后缀分板块
            if "BTC" in sym: sectors["BTC系"] += 1
            elif "ETH" in sym or "DEFI" in sym: sectors["DeFi"] += 1
            elif "SOL" in sym: sectors["Solana"] += 1
            elif "DOGE" in sym or "SHIB" in sym or "PEPE" in sym: sectors["Meme"] += 1
            else: sectors["Other"] += 1

        for sector, count in sectors.items():
            if count >= 3:
                alerts.append({
                    "level": "WARNING",
                    "msg": f"{sector}板块{count}个持仓，高相关",
                })

        # 3. 总风险敞口
        total_margin = sum(p.get("margin", 0) for p in positions.values())
        if total_margin > capital * 0.3:
            alerts.append({
                "level": "CRITICAL",
                "msg": f"总保证金{total_margin/capital*100:.0f}%超过30%",
            })

        return {
            "alerts": alerts,
            "positions": len(positions),
            "long_count": long_count,
            "short_count": short_count,
            "total_margin": round(total_margin, 2),
            "margin_pct": round(total_margin / capital * 100, 1) if capital > 0 else 0,
        }

    # ================================================================
    # 报告
    # ================================================================

    def generate_report(self) -> str:
        """生成组合报告"""
        self.analyze_strategies()

        lines = ["📊 策略组合报告", "=" * 40]

        # 各策略表现
        lines.append("\n📈 策略表现:")
        for name, stats in sorted(self.strategy_stats.items(),
                                   key=lambda x: -x[1].score):
            lines.append(
                f"  {name}: PnL=${stats.total_pnl:+,.0f} "
                f"WR{stats.win_rate:.0f}% "
                f"Score={stats.score:.1f} "
                f"({stats.total_trades}笔)"
            )

        # 相关性
        lines.append("\n🔗 策略相关性:")
        for name, stats in self.strategy_stats.items():
            if stats.correlation:
                high_corr = {k: v for k, v in stats.correlation.items()
                            if abs(v) > self.CORRELATION_THRESHOLD}
                if high_corr:
                    lines.append(f"  {name}: 高相关→{high_corr}")

        # 资金分配建议
        allocation = self.optimize_allocation(18720)
        lines.append("\n💰 建议资金分配 (总$18,720):")
        for name, amount in sorted(allocation.items(), key=lambda x: -x[1]):
            pct = amount / 18720 * 100
            lines.append(f"  {name}: ${amount:,.0f} ({pct:.0f}%)")

        # 历史回放
        replay = self.replay_history()
        lines.append(f"\n📋 历史回放 (306笔):")
        lines.append(f"  初始: ${replay['initial_capital']:,.0f}")
        lines.append(f"  最终: ${replay['final_equity']:,.0f}")
        lines.append(f"  收益: {replay['return_pct']:+.1f}%")
        lines.append(f"  最大回撤: {replay['max_drawdown']:.1f}%")
        lines.append(f"  胜率: {replay['win_rate']:.1f}%")

        return "\n".join(lines)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                       format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
    opt = PortfolioOptimizer()
    print(opt.generate_report())
