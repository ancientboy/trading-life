#!/usr/bin/env python3
"""
选币回测器 v1.0

验证：不同选币策略选出来的币，在历史数据上的表现
对比：有选币 vs 无选币（随机选）的收益差异

选币策略：
1. 量能蓄力（放量不涨=吸筹）
2. 资金费率极端（空头拥挤）
3. OI异常（持仓量急变）
4. 新上市合约（高波动）
5. 组合选币（多维度共振）
"""

import json
import math
import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
from dataclasses import dataclass, field

import aiohttp

logger = logging.getLogger("ScreenerBacktest")

DATA_DIR = "/opt/trading-agent/data"


@dataclass
class ScreenResult:
    """选币回测结果"""
    strategy: str
    coins_found: int = 0
    total_trades: int = 0
    wins: int = 0
    total_pnl: float = 0
    win_rate: float = 0
    avg_pnl_per_trade: float = 0
    max_winner: float = 0
    max_loser: float = 0
    sharpe: float = 0
    hit_rate_vs_random: float = 0  # vs随机选币的提升
    best_coins: List[str] = field(default_factory=list)
    worst_coins: List[str] = field(default_factory=list)


class ScreenerBacktest:
    """选币回测器"""

    def __init__(self):
        self.loader = self._make_loader()

    def _make_loader(self):
        """创建DataLoader"""
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).parent))
        from harness import DataLoader
        return DataLoader()

    # ================================================================
    # 选币策略实现（独立版本，不依赖Redis/Stream）
    # ================================================================

    async def screen_volume_accumulation(self, session,
                                          tickers: List[dict],
                                          min_vol: float = 50_000_000,
                                          max_change: float = 8.0,
                                          min_change: float = -2.0) -> List[str]:
        """选币策略1：量能蓄力（放量但不涨=吸筹）"""
        results = []
        for t in tickers:
            sym = t.get("symbol", "")
            if not sym.endswith("USDT"):
                continue
            vol = float(t.get("quoteVolume", 0))
            change = float(t.get("priceChangePercent", 0))

            if vol < min_vol:
                continue
            if not (min_change < change <= max_change):
                continue

            # 量能/价格波动比 越大越好
            calm_score = max(0, 8 - abs(change))
            vol_score = min(10, vol / 100_000_000 * 2)

            if calm_score + vol_score >= 5:
                results.append(sym)

        return results

    async def screen_funding_extreme(self, session,
                                      funding_map: Dict[str, float],
                                      threshold: float = -0.001) -> List[str]:
        """选币策略2：资金费率极端（空头拥挤）"""
        results = []
        for sym, rate in funding_map.items():
            if rate < threshold:
                results.append(sym)
        return results

    async def screen_price_momentum(self, tickers: List[dict],
                                     min_change: float = 10.0,
                                     min_vol: float = 20_000_000) -> List[str]:
        """选币策略3：价格动量（涨幅>10%）"""
        results = []
        for t in tickers:
            sym = t.get("symbol", "")
            vol = float(t.get("quoteVolume", 0))
            change = float(t.get("priceChangePercent", 0))
            if vol >= min_vol and change >= min_change:
                results.append(sym)
        return results

    async def screen_oversold(self, tickers: List[dict],
                               max_change: float = -10.0,
                               min_vol: float = 20_000_000) -> List[str]:
        """选币策略4：超跌反弹"""
        results = []
        for t in tickers:
            sym = t.get("symbol", "")
            vol = float(t.get("quoteVolume", 0))
            change = float(t.get("priceChangePercent", 0))
            if vol >= min_vol and change <= max_change:
                results.append(sym)
        return results

    async def screen_combined(self, session, tickers: List[dict],
                               funding_map: Dict[str, float]) -> List[str]:
        """选币策略5：组合选币（多维度共振）"""
        # 各策略选币
        vol_acc = await self.screen_volume_accumulation(session, tickers)
        fund_ext = await self.screen_funding_extreme(session, funding_map, -0.0005)
        momentum = await self.screen_price_momentum(tickers, 5.0, 10_000_000)
        oversold = await self.screen_oversold(tickers, -5.0, 10_000_000)

        # 统计出现次数
        coin_count = defaultdict(int)
        coin_reasons = defaultdict(list)
        for sym in vol_acc:
            coin_count[sym] += 1
            coin_reasons[sym].append("量能蓄力")
        for sym in fund_ext:
            coin_count[sym] += 2  # 费率信号权重更高
            coin_reasons[sym].append("费率极端")
        for sym in momentum:
            coin_count[sym] += 1
            coin_reasons[sym].append("动量")
        for sym in oversold:
            coin_count[sym] += 1
            coin_reasons[sym].append("超跌")

        # 至少2个维度共振的币
        combined = []
        for sym, count in sorted(coin_count.items(), key=lambda x: -x[1]):
            if count >= 2:
                combined.append(sym)

        return combined

    # ================================================================
    # 回测：用选出的币做模拟交易
    # ================================================================

    def backtest_coins(self, symbols: List[str], days: int = 30,
                       hold_hours: int = 12, leverage: int = 10) -> ScreenResult:
        """对选出的币做回测"""
        all_pnls = []
        coin_pnls = defaultdict(list)

        for sym in symbols:
            try:
                klines = self.loader.fetch_klines(sym, '4h', days)
                if len(klines) < 20:
                    continue

                # 模拟：每个entry点持有hold_hours后卖出
                hold_bars = max(1, hold_hours // 4)

                for i in range(10, len(klines) - hold_bars):
                    # 入场
                    entry = klines[i]['close']
                    # 出场
                    exit_price = klines[i + hold_bars]['close']

                    # 止损检查
                    stop = entry * 0.95  # 5%止损
                    stopped = False
                    for j in range(i + 1, i + hold_bars + 1):
                        if klines[j]['low'] <= stop:
                            exit_price = stop
                            stopped = True
                            break

                    pnl_pct = (exit_price - entry) / entry * 100 * leverage / 10
                    all_pnls.append(pnl_pct)
                    coin_pnls[sym].append(pnl_pct)

            except Exception as e:
                pass

        n = len(all_pnls)
        if n == 0:
            return ScreenResult(strategy="", coins_found=len(symbols))

        wins = sum(1 for p in all_pnls if p > 0)
        total_pnl = sum(all_pnls)
        avg = total_pnl / n

        # Sharpe
        if len(all_pnls) > 1:
            var = sum((p - avg) ** 2 for p in all_pnls) / len(all_pnls)
            sharpe = avg / (var ** 0.5) if var > 0 else 0
        else:
            sharpe = 0

        # 最佳/最差币
        coin_avg = {sym: sum(pnls) / len(pnls) for sym, pnls in coin_pnls.items() if pnls}
        best = sorted(coin_avg.items(), key=lambda x: -x[1])[:5]
        worst = sorted(coin_avg.items(), key=lambda x: x[1])[:5]

        return ScreenResult(
            strategy="",
            coins_found=len(symbols),
            total_trades=n,
            wins=wins,
            total_pnl=round(total_pnl, 2),
            win_rate=round(wins / n * 100, 1),
            avg_pnl_per_trade=round(avg, 2),
            max_winner=round(max(all_pnls), 2),
            max_loser=round(min(all_pnls), 2),
            sharpe=round(sharpe, 3),
            best_coins=[f"{sym}({avg:+.1f}%)" for sym, avg in best],
            worst_coins=[f"{sym}({avg:+.1f}%)" for sym, avg in worst],
        )

    # ================================================================
    # 完整对比回测
    # ================================================================

    async def run_comparison(self, days: int = 60) -> Dict:
        """运行选币策略对比回测"""
        logger.info(f"🧪 选币回测对比 ({days}天)")

        # 1. 拉取当前数据
        async with aiohttp.ClientSession() as session:
            url_ticker = "https://fapi.binance.com/fapi/v1/ticker/24hr"
            url_funding = "https://fapi.binance.com/fapi/v1/premiumIndex"

            async with session.get(url_ticker, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                tickers = await resp.json()
            usdt_tickers = [t for t in tickers if t.get("symbol", "").endswith("USDT")]

            async with session.get(url_funding, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                premiums = await resp.json()
            funding_map = {p["symbol"]: float(p.get("lastFundingRate", 0)) for p in premiums}

            # 2. 各策略选币
            logger.info("📊 执行选币策略...")
            strategies = {
                "量能蓄力": await self.screen_volume_accumulation(session, usdt_tickers),
                "费率极端": await self.screen_funding_extreme(session, funding_map),
                "动量追涨": await self.screen_price_momentum(usdt_tickers, 5.0, 10_000_000),
                "超跌反弹": await self.screen_oversold(usdt_tickers, -5.0, 10_000_000),
                "组合共振": await self.screen_combined(session, usdt_tickers, funding_map),
            }

            # 随机选币（对照组）
            import random
            all_usdt = [t["symbol"] for t in usdt_tickers
                       if float(t.get("quoteVolume", 0)) > 5_000_000]
            random_coins = random.sample(all_usdt, min(30, len(all_usdt)))
            strategies["随机选币(对照)"] = random_coins

        # 3. 回测各策略
        logger.info("📈 回测各策略...")
        results = {}
        for name, coins in strategies.items():
            logger.info(f"  {name}: {len(coins)}个币 → 回测中...")
            r = self.backtest_coins(coins, days=days)
            r.strategy = name
            results[name] = r

        # 4. 计算vs随机提升
        random_wr = results.get("随机选币(对照)", ScreenResult("")).win_rate
        random_pnl = results.get("随机选币(对照)", ScreenResult("")).avg_pnl_per_trade

        for name, r in results.items():
            if random_wr > 0:
                r.hit_rate_vs_random = round(r.win_rate / random_wr * 100, 1)
            else:
                r.hit_rate_vs_random = 0

        # 5. 输出报告
        self._print_report(results)

        return {name: asdict(r) for name, r in results.items()}

    def _print_report(self, results: Dict[str, ScreenResult]):
        """打印对比报告"""
        lines = ["🧪 选币策略回测对比", "=" * 60]

        # 表头
        lines.append(f"{'策略':15s} {'币数':>4s} {'交易':>5s} {'胜率':>6s} "
                    f"{'总PnL':>10s} {'均PnL':>7s} {'Sharpe':>7s} {'vs随机':>6s}")
        lines.append("-" * 60)

        for name, r in sorted(results.items(), key=lambda x: -x[1].total_pnl):
            marker = "🏆" if r.hit_rate_vs_random > 120 else "  "
            lines.append(
                f"{marker}{name:13s} {r.coins_found:4d} {r.total_trades:5d} "
                f"{r.win_rate:5.1f}% {r.total_pnl:+9.1f}% "
                f"{r.avg_pnl_per_trade:+6.2f}% {r.sharpe:6.3f} "
                f"{r.hit_rate_vs_random:5.0f}%"
            )

        # 最佳策略详情
        best = max(results.items(), key=lambda x: x[1].total_pnl)
        lines.append(f"\n🏆 最佳策略: {best[0]}")
        r = best[1]
        lines.append(f"  选出: {r.coins_found}个币")
        lines.append(f"  交易: {r.total_trades}笔 | 胜率{r.win_rate:.1f}%")
        lines.append(f"  总PnL: {r.total_pnl:+.1f}% | Sharpe: {r.sharpe:.3f}")
        if r.best_coins:
            lines.append(f"  最佳币: {', '.join(r.best_coins[:5])}")
        if r.worst_coins:
            lines.append(f"  最差币: {', '.join(r.worst_coins[:5])}")

        report = "\n".join(lines)
        print(report)

        # 保存
        with open(f"{DATA_DIR}/screener_backtest_results.json", 'w') as f:
            json.dump({name: asdict(r) for name, r in results.items()}, f, indent=2)

        return report


async def main():
    bt = ScreenerBacktest()
    await bt.run_comparison(days=60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    asyncio.run(main())
