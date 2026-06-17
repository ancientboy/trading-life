"""
小风交易系统 - Phase 3 复盘系统

职责：
1. 交易回顾 — 每笔交易的详细复盘
2. 绩效统计 — 胜率/盈亏比/最大回撤
3. 策略评估 — 哪类信号赚钱，哪类亏钱
4. 定期报告 — 日/周/月报
"""
import json
import logging
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
logger = logging.getLogger("Review")


class ReviewSystem:
    """复盘系统"""

    def __init__(self):
        self.trade_log = DATA_DIR / "trade-log.jsonl"
        self.risk_state = DATA_DIR / "risk_state.json"

    def _load_trades(self) -> List[dict]:
        """加载所有交易记录"""
        if not self.trade_log.exists():
            return []
        trades = []
        with open(self.trade_log) as f:
            for line in f:
                try:
                    trades.append(json.loads(line))
                except:
                    pass
        return trades

    def _load_risk_state(self) -> dict:
        if not self.risk_state.exists():
            return {}
        try:
            return json.loads(self.risk_state.read_text())
        except:
            return {}

    # ---- 绩效概览 ----
    def performance(self) -> str:
        """生成绩效统计报告"""
        trades = self._load_trades()
        closes = [t for t in trades if t.get("action") == "CLOSE"]

        if not closes:
            return "📭 暂无已平仓记录，无法生成绩效报告"

        # 基本统计
        total = len(closes)
        wins = [t for t in closes if t.get("pnl_pct", 0) >= 0]
        losses = [t for t in closes if t.get("pnl_pct", 0) < 0]
        win_rate = len(wins) / total * 100

        # 盈亏比
        avg_win = sum(t.get("pnl_pct", 0) for t in wins) / len(wins) if wins else 0
        avg_loss = abs(sum(t.get("pnl_pct", 0) for t in losses) / len(losses)) if losses else 0
        profit_factor = avg_win / avg_loss if avg_loss > 0 else float('inf')

        # 最大单笔盈亏
        best = max(closes, key=lambda t: t.get("pnl_pct", 0))
        worst = min(closes, key=lambda t: t.get("pnl_pct", 0))

        # 总盈亏
        total_pnl = sum(t.get("pnl_pct", 0) for t in closes)

        # 方向统计
        longs = [t for t in closes if t.get("direction") == "LONG"]
        shorts = [t for t in closes if t.get("direction") == "SHORT"]
        long_wr = len([t for t in longs if t.get("pnl_pct", 0) >= 0]) / len(longs) * 100 if longs else 0
        short_wr = len([t for t in shorts if t.get("pnl_pct", 0) >= 0]) / len(shorts) * 100 if shorts else 0

        # 连胜/连亏
        max_streak_w = 0
        max_streak_l = 0
        cur_w = 0
        cur_l = 0
        for t in closes:
            if t.get("pnl_pct", 0) >= 0:
                cur_w += 1
                cur_l = 0
                max_streak_w = max(max_streak_w, cur_w)
            else:
                cur_l += 1
                cur_w = 0
                max_streak_l = max(max_streak_l, cur_l)

        # 币种统计
        by_symbol = defaultdict(list)
        for t in closes:
            by_symbol[t.get("symbol", "?")].append(t)

        # 当前资金
        state = self._load_risk_state()
        capital = state.get("capital", 100000)
        initial = state.get("initial_capital", 100000) or 100000

        report = (
            f"📊 *绩效报告*\n\n"
            f"💰 资金: ${capital:,.0f} (初始 ${initial:,.0f})\n"
            f"📈 总收益: ${capital - initial:+,.0f} ({(capital/initial-1)*100:+.1f}%)\n\n"
            f"📋 *交易统计*\n"
            f"  总交易: {total}笔\n"
            f"  胜率: {win_rate:.0f}% ({len(wins)}胜/{len(losses)}负)\n"
            f"  盈亏比: {profit_factor:.1f}:1\n"
            f"  平均盈利: {avg_win:+.2f}%\n"
            f"  平均亏损: -{avg_loss:.2f}%\n\n"
            f"🏆 *最佳/最差*\n"
            f"  最佳: {best.get('symbol','').replace('USDT','')} {best.get('pnl_pct',0):+.2f}%\n"
            f"  最差: {worst.get('symbol','').replace('USDT','')} {worst.get('pnl_pct',0):+.2f}%\n\n"
            f"📊 *方向统计*\n"
            f"  做多: {len(longs)}笔 胜率{long_wr:.0f}%\n"
            f"  做空: {len(shorts)}笔 胜率{short_wr:.0f}%\n\n"
            f"📈 *连续纪录*\n"
            f"  最长连胜: {max_streak_w}笔\n"
            f"  最长连亏: {max_streak_l}笔\n"
        )

        # 币种表现 TOP 5
        if by_symbol:
            sym_stats = []
            for sym, ts in by_symbol.items():
                wr = len([t for t in ts if t.get("pnl_pct", 0) >= 0]) / len(ts) * 100
                avg_p = sum(t.get("pnl_pct", 0) for t in ts) / len(ts)
                sym_stats.append((sym, len(ts), wr, avg_p))

            sym_stats.sort(key=lambda x: x[3], reverse=True)
            report += "\n🏆 *币种表现*\n"
            for sym, cnt, wr, avg in sym_stats[:5]:
                emoji = "🟢" if avg >= 0 else "🔴"
                report += f"  {emoji} {sym.replace('USDT','')} {cnt}笔 胜率{wr:.0f}% 平均{avg:+.2f}%\n"

        return report

    # ---- 交易明细 ----
    def trade_detail(self, limit: int = 20) -> str:
        """交易明细列表"""
        trades = self._load_trades()
        closes = [t for t in trades if t.get("action") == "CLOSE"][-limit:]

        if not closes:
            return "📭 暂无交易明细"

        lines = [f"📋 *交易明细* (最近{len(closes)}笔)\n"]
        for t in reversed(closes):
            emoji = "✅" if t.get("pnl_pct", 0) >= 0 else "❌"
            ts = t.get("timestamp", "")[:16]
            sym = t.get("symbol", "").replace("USDT", "")
            d = t.get("direction", "?")
            pnl = t.get("pnl_pct", 0)
            reason = t.get("reason", "")
            lines.append(f"{emoji} {ts} {sym} {d} {pnl:+.2f}%")
            if reason:
                lines[-1] += f" _{reason}_"

        return "\n".join(lines)

    # ---- 日报 ----
    def daily_report(self) -> str:
        """今日交易日报"""
        trades = self._load_trades()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        today_trades = [t for t in trades if t.get("timestamp", "").startswith(today) and t.get("action") == "CLOSE"]

        state = self._load_risk_state()
        capital = state.get("capital", 100000)
        daily_pnl = state.get("daily_pnl", 0)

        opens = [t for t in trades if t.get("timestamp", "").startswith(today) and t.get("action") == "OPEN"]

        report = (
            f"📰 *日报* {today}\n\n"
            f"💰 资金: ${capital:,.0f}\n"
            f"📊 日盈亏: ${daily_pnl:+,.0f} ({daily_pnl/capital*100:+.2f}%)\n"
            f"📈 开仓: {len(opens)}笔 | 平仓: {len(today_trades)}笔\n"
        )

        if today_trades:
            wins = len([t for t in today_trades if t.get("pnl_pct", 0) >= 0])
            total_pnl = sum(t.get("pnl_pct", 0) for t in today_trades)
            report += f"📊 今日胜率: {wins/len(today_trades)*100:.0f}% | 总盈亏: {total_pnl:+.2f}%\n\n"

            for t in today_trades:
                emoji = "✅" if t.get("pnl_pct", 0) >= 0 else "❌"
                report += (
                    f"{emoji} {t.get('symbol','').replace('USDT','')} "
                    f"{t.get('direction','')} {t.get('pnl_pct',0):+.2f}% "
                    f"_{t.get('timestamp','')[11:16]}_\n"
                )
        else:
            report += "\n📭 今日无平仓记录"

        # 当前持仓
        positions = state.get("positions", {})
        if positions:
            report += f"\n📊 *当前持仓:* {len(positions)}笔\n"
            for sym, p in positions.items():
                report += f"  • {sym.replace('USDT','')} {p.get('direction','')} {p.get('leverage',1)}x @${p.get('entry_price',0):,.2f}\n"

        return report

    # ---- 周报 ----
    def weekly_report(self) -> str:
        """本周交易周报"""
        trades = self._load_trades()
        now = datetime.now(timezone.utc)
        week_start = now - timedelta(days=now.weekday())

        week_trades = []
        for t in trades:
            if t.get("action") != "CLOSE":
                continue
            try:
                ts = datetime.fromisoformat(t.get("timestamp", ""))
                if ts >= week_start:
                    week_trades.append(t)
            except:
                pass

        state = self._load_risk_state()
        capital = state.get("capital", 100000)
        wk_start = state.get("weekly_start_capital", capital)
        wk_dd = (wk_start - capital) / wk_start * 100 if wk_start > 0 else 0

        if not week_trades:
            return (
                f"📰 *周报* {week_start.strftime('%m/%d')} - {now.strftime('%m/%d')}\n\n"
                f"💰 资金: ${capital:,.0f}\n"
                f"📉 周回撤: {wk_dd:.2f}%\n"
                f"📭 本周无平仓记录"
            )

        wins = [t for t in week_trades if t.get("pnl_pct", 0) >= 0]
        total_pnl = sum(t.get("pnl_pct", 0) for t in week_trades)

        report = (
            f"📰 *周报* {week_start.strftime('%m/%d')} - {now.strftime('%m/%d')}\n\n"
            f"💰 资金: ${capital:,.0f}\n"
            f"📊 交易: {len(week_trades)}笔 | 胜率: {len(wins)/len(week_trades)*100:.0f}%\n"
            f"📈 累计盈亏: {total_pnl:+.2f}%\n"
            f"📉 周回撤: {wk_dd:.2f}%\n\n"
        )

        for t in week_trades:
            emoji = "✅" if t.get("pnl_pct", 0) >= 0 else "❌"
            report += (
                f"{emoji} {t.get('symbol','').replace('USDT','')} "
                f"{t.get('direction','')} {t.get('pnl_pct',0):+.2f}% "
                f"_{t.get('timestamp','')[:10]}_\n"
            )

        return report

    # ---- 生成全量报告 ----
    def full_report(self) -> str:
        """完整复盘报告"""
        return (
            f"{self.performance()}\n"
            f"{'='*30}\n"
            f"{self.daily_report()}"
        )


# ============================================
# 测试
# ============================================
if __name__ == "__main__":
    rv = ReviewSystem()
    print("=== 绩效 ===")
    print(rv.performance())
    print("\n=== 日报 ===")
    print(rv.daily_report())
    print("\n=== 周报 ===")
    print(rv.weekly_report())
    print("\n=== 明细 ===")
    print(rv.trade_detail())
