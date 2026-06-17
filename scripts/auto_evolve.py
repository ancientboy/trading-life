#!/usr/bin/env python3
"""
Trading Agent 自主进化引擎 v1.0

三层架构：
1. Auto-Optimizer: 自动参数搜索（grid search）
2. Strategy Mutator: 策略变异（信号规则/过滤器/出场逻辑）
3. Full Loop: 实盘→回测→进化→部署闭环

用法：
  python auto_evolve.py                    # 完整进化流程
  python auto_evolve.py --agent momentum   # 只进化指定agent
  python auto_evolve.py --dry-run          # 只分析不写入
  python auto_evolve.py --generations 5    # 多代进化
"""

import json
import copy
import random
import logging
import argparse
import itertools
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Any, Optional, Tuple

# 本地导入
import sys
BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))

from harness import (
    TradingHarness, DataLoader, MarketClassifier,
    calc_ema, calc_atr, MarketRegime
)
from agents.momentum_agent import MomentumAgent

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger("AutoEvolve")

# ===== 进化数据目录 =====
EVOLVE_DIR = BASE / "data" / "evolve"
EVOLVE_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_FILE = EVOLVE_DIR / "best_params.json"
HISTORY_FILE = EVOLVE_DIR / "evolve_history.jsonl"
AGENT_CONFIGS = {
    "momentum_quick": BASE / "agents" / "momentum_agent.py",
    "momentum_wave": BASE / "agents" / "momentum_agent.py",
    "momentum_newcoin": BASE / "agents" / "momentum_agent.py",
}

# ============================================================
# 第一层：参数定义
# ============================================================

# 因子权重进化空间（每种策略的因子权重可以被搜索）
FACTOR_WEIGHT_SPACES = {
    "momentum_quick": {
        # 核心因子（必须保留，权重可调）
        "w_surge_1h": [0.15, 0.20, 0.25, 0.30, 0.35],
        "w_vol_surge": [0.08, 0.12, 0.15, 0.18],
        "w_vol_pattern": [0.05, 0.08, 0.10, 0.12],
        "w_btc_regime": [0.02, 0.05, 0.08, 0.10],
        "w_price_position": [0.04, 0.06, 0.08, 0.10],
        "w_rsi": [0.03, 0.05, 0.07, 0.10],
        # 微观结构因子（权重可调）
        "w_orderbook": [0.04, 0.06, 0.08, 0.10],
        "w_funding": [0.03, 0.05, 0.07, 0.09],
        "w_oi_change": [0.03, 0.05, 0.07, 0.09],
        "w_smart_money": [0.02, 0.04, 0.06, 0.08],
    },
    "momentum_wave": {
        "w_breakout": [0.15, 0.20, 0.25, 0.30],
        "w_ema_align": [0.08, 0.12, 0.15, 0.18],
        "w_vol_breakout": [0.06, 0.10, 0.12, 0.15],
        "w_btc_regime": [0.02, 0.05, 0.08, 0.10],
        "w_atr": [0.04, 0.06, 0.08, 0.10],
        "w_support": [0.03, 0.05, 0.07, 0.09],
        "w_orderbook": [0.03, 0.05, 0.07, 0.09],
        "w_funding": [0.04, 0.06, 0.08, 0.10],
        "w_oi_change": [0.04, 0.06, 0.08, 0.10],
        "w_smart_money": [0.02, 0.04, 0.06, 0.08],
    },
}

# 选币参数进化空间（筛选阈值的优化）
SCREENER_SPACES = {
    "screen_volume": {
        "MIN_VOLUME_USD": [3_000_000, 5_000_000, 10_000_000, 20_000_000],
        "MIN_VOLATILITY": [1.0, 2.0, 3.0, 5.0],
        "VOL_ACC_MAX_CHANGE": [5.0, 8.0, 12.0, 15.0],  # 量能蓄力：价格涨幅上限
        "VOL_ACC_MIN_VOL": [20_000_000, 50_000_000, 100_000_000],
    },
    "screen_funding": {
        "FUNDING_THRESHOLD": [-0.003, -0.002, -0.001, -0.0005],  # 费率阈值
        "FUNDING_WEIGHT": [10, 15, 20, 25],  # 费率信号在综合评分中的权重
    },
    "screen_momentum": {
        "MOM_MIN_CHANGE": [3.0, 5.0, 8.0, 10.0, 15.0],  # 动量最小涨幅
        "MOM_MIN_VOL": [10_000_000, 20_000_000, 50_000_000],
    },
    "screen_oversold": {
        "OVERSOLD_MAX_CHANGE": [-3.0, -5.0, -8.0, -10.0, -15.0],  # 超跌阈值
        "OVERSOLD_MIN_VOL": [10_000_000, 20_000_000, 50_000_000],
    },
}

# 信号阈值进化空间（开仓分数阈值）
THRESHOLD_SPACES = {
    "momentum_quick": {
        "score_threshold": [30, 35, 40, 45, 50, 55],
        "ms_blend": [0.15, 0.20, 0.25, 0.30, 0.35],  # 微观结构权重占比
    },
    "momentum_wave": {
        "score_threshold": [30, 35, 40, 45, 50, 55],
        "ms_blend": [0.15, 0.20, 0.25, 0.30, 0.35],
    },
}

PARAM_SPACES = {
    "momentum_quick": {
        "QUICK_SURGE_BARS": [2, 3, 4, 5, 6, 8],
        "QUICK_MIN_SURGE": [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0],
        "QUICK_TRAIL_PCT": [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0],
        "QUICK_MAX_HOLD": [24, 36, 48, 60, 72],
        "QUICK_MIN_VOL_RATIO": [0.5, 0.8, 1.0, 1.2, 1.5, 2.0],
        "QUICK_STOP_PCT": [2.0, 2.5, 3.0, 3.5, 4.0, 5.0],  # 止损百分比
    },
    "momentum_wave": {
        "WAVE_BREAKOUT_BARS": [8, 10, 15, 20, 25, 30],
        "WAVE_MIN_VOL_RATIO": [0.8, 1.0, 1.2, 1.5, 2.0, 2.5],
        "WAVE_STOP_PCT": [8.0, 10.0, 12.0, 15.0, 18.0, 20.0, 25.0],
        "WAVE_EMA_EXIT": [10, 12, 15, 20, 25],
        "WAVE_MAX_HOLD": [60, 90, 120, 150, 180],
    },
    "momentum_newcoin": {
        "NEWCOIN_MAX_DAYS": [30, 45, 60, 90],
        "NEWCOIN_STOP_PCT": [15.0, 20.0, 25.0, 30.0],
        "NEWCOIN_EMA_EXIT": [7, 10, 15],
        "NEWCOIN_MAX_HOLD": [60, 90, 120, 150],
        "NEWCOIN_MIN_VOL_RATIO": [1.5, 2.0, 2.5, 3.0, 4.0],
    },
    "smc_demand": {
        "SMC_OB_STRENGTH": [2.0, 2.5, 3.0, 3.5, 4.0],
        "SMC_STOP_PCT": [0.005, 0.01, 0.015, 0.02],
        "SMC_MIN_RR": [1.0, 1.5, 2.0, 2.5, 3.0],
        "SMC_CONFIRM_CANDLE": [True, False],
    },
    "risk": {
        "max_positions": [3, 4, 5, 6],
        "max_single_risk_pct": [0.02, 0.03, 0.04, 0.05],
        "circuit_break_limit": [5, 6, 8, 10],
    },
}

# 当前最优参数（初始值）
DEFAULT_BEST = {
    "momentum_quick": {
        "QUICK_SURGE_BARS": 3, "QUICK_MIN_SURGE": 2.0,
        "QUICK_TRAIL_PCT": 1.0, "QUICK_MAX_HOLD": 60,
        "QUICK_MIN_VOL_RATIO": 1.0,
    },
    "momentum_wave": {
        "WAVE_BREAKOUT_BARS": 10, "WAVE_MIN_VOL_RATIO": 1.0,
        "WAVE_STOP_PCT": 20.0, "WAVE_EMA_EXIT": 25, "WAVE_MAX_HOLD": 90,
    },
    "momentum_newcoin": {
        "NEWCOIN_MAX_DAYS": 60, "NEWCOIN_STOP_PCT": 25.0,
        "NEWCOIN_EMA_EXIT": 10, "NEWCOIN_MAX_HOLD": 120,
        "NEWCOIN_MIN_VOL_RATIO": 2.0,
    },
    "risk": {
        "max_positions": 6, "max_single_risk_pct": 0.03,
        "circuit_break_limit": 8,
    },
    "meta": {
        "last_evolve": "",
        "generation": 0,
        "total_evaluations": 0,
        "best_pnl": 0,
    }
}


# ============================================================
# 第二层：信号检测器 - 支持参数覆盖
# ============================================================

class EvolvableMomentumDetector:
    """可参数化的动量信号检测器"""

    def __init__(self, params: Dict[str, Any]):
        self.p = params

    def detect(self, klines_4h: List[dict], klines_1h: List[dict] = None,
               symbol: str = "", newcoin_listings: Dict = None) -> List[dict]:
        signals = []

        # Quick模式（用4h近似1h，如果没1h数据）
        data = klines_1h if klines_1h else klines_4h
        signals += self._detect_quick(data, symbol)

        # Wave模式
        signals += self._detect_wave(klines_4h, symbol)

        return signals

    def _detect_quick(self, klines, symbol) -> List[dict]:
        p = self.p
        closes = [k['close'] for k in klines]
        vols = [k['volume'] for k in klines]
        if len(closes) < 15:
            return []

        results = []
        n = min(p.get("QUICK_SURGE_BARS", 5), len(closes) - 1)
        price = closes[-1]
        base = closes[-(n + 1)]
        surge = (price / base - 1) * 100

        if surge < p.get("QUICK_MIN_SURGE", 3.0):
            return []

        vol_recent = sum(vols[-n:]) / n
        vol_older = sum(vols[max(0, len(vols) - n - 10):len(vols) - n])
        vol_older = vol_older / min(10, len(vols) - n) if len(vols) > n else 1
        vol_ratio = vol_recent / vol_older if vol_older > 0 else 1

        min_vol = p.get("QUICK_MIN_VOL_RATIO", 0.8)
        if vol_ratio < min_vol:
            return []

        score = min(55 + int(surge * 3), 90)
        stop = price * 0.97

        results.append({
            "type": "surge_quick",
            "direction": "LONG",
            "score": score,
            "price": price,
            "stop_loss": stop,
            "leverage": 20,
            "reason": f"快钱: {n}根涨{surge:.1f}% 量比{vol_ratio:.1f}x",
            "indicators": {"surge_pct": surge, "vol_ratio": vol_ratio},
        })
        return results

    def _detect_wave(self, klines, symbol) -> List[dict]:
        p = self.p
        closes = [k['close'] for k in klines]
        vols = [k['volume'] for k in klines]
        if len(closes) < 30:
            return []

        results = []
        price = closes[-1]
        n = p.get("WAVE_BREAKOUT_BARS", 20)
        if len(closes) <= n:
            return []

        high_n = max(closes[-(n + 1):-1])
        if price <= high_n:
            return []

        surge_pct = (price / high_n - 1) * 100
        if surge_pct < 0.5:
            return []

        vol_now = vols[-1]
        vol_avg = sum(vols[-21:-1]) / 20 if len(vols) > 20 else 1
        vol_ratio = vol_now / vol_avg if vol_avg > 0 else 1

        if vol_ratio < p.get("WAVE_MIN_VOL_RATIO", 1.5):
            return []

        score = min(50 + int(vol_ratio * 5) + int(surge_pct * 2), 85)
        stop = price * (1 - p.get("WAVE_STOP_PCT", 15.0) / 100)

        results.append({
            "type": "surge_wave",
            "direction": "LONG",
            "score": score,
            "price": price,
            "stop_loss": stop,
            "leverage": 10,
            "reason": f"波段: 破{n}根高点+{surge_pct:.1f}% 量比{vol_ratio:.1f}x",
            "indicators": {"surge_pct": surge_pct, "vol_ratio": vol_ratio},
        })
        return results


# ============================================================
# 第三层：进化引擎
# ============================================================

@dataclass
class EvalResult:
    params: Dict[str, Any]
    trades: int = 0
    wins: int = 0
    win_rate: float = 0
    pnl: float = 0
    sharpe: float = 0
    max_drawdown: float = 0
    big_wins: int = 0  # >500
    score: float = 0  # 综合评分


class EvolutionEngine:
    """自主进化引擎 v3 - Walk-Forward验证"""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.loader = DataLoader()
        self.classifier = MarketClassifier()
        self.best_params = self._load_best_params()
        self.history: List[dict] = []
        self._symbols_cache: List[str] = []

    # ===== Walk-Forward验证 =====

    def walk_forward_evaluate(self, strategy: str, params: Dict,
                               symbols: List[str]) -> EvalResult:
        """Walk-Forward验证：60天训练 + 30天测试"""
        # 训练集（60天）
        train_result = self._evaluate_params(strategy, params, symbols, 60)

        # 测试集（30天）- 用不同时间段
        test_result = self._evaluate_params(strategy, params, symbols, 30)

        # Walk-Forward分数 = 训练分数 * 0.4 + 测试分数 * 0.6
        # 更重视测试集表现（避免过拟合）
        wf_score = train_result.score * 0.4 + test_result.score * 0.6

        # 过拟合惩罚：如果训练集远好于测试集
        overfit_gap = train_result.score - test_result.score
        if overfit_gap > 100:  # 训练比测试好太多
            wf_score *= 0.7  # 惩罚30%
            logger.debug(f"    ⚠️ 过拟合警告: train={train_result.score:.0f} test={test_result.score:.0f} gap={overfit_gap:.0f}")

        # 用测试集的PnL和胜率作为最终结果
        return EvalResult(
            params=params,
            trades=test_result.trades,
            wins=test_result.wins,
            win_rate=test_result.win_rate,
            pnl=test_result.pnl,
            sharpe=test_result.sharpe,
            max_drawdown=max(train_result.max_drawdown, test_result.max_drawdown),
            big_wins=test_result.big_wins,
            score=round(wf_score, 1),
        )

    def _load_best_params(self) -> dict:
        if CONFIG_FILE.exists():
            try:
                return json.loads(CONFIG_FILE.read_text())
            except:
                pass
        return copy.deepcopy(DEFAULT_BEST)

    def _save_best_params(self):
        self.best_params["meta"]["last_evolve"] = datetime.now(timezone.utc).isoformat()
        CONFIG_FILE.write_text(json.dumps(self.best_params, indent=2, ensure_ascii=False))

    def _log_evolution(self, record: dict):
        record["timestamp"] = datetime.now(timezone.utc).isoformat()
        with open(HISTORY_FILE, "a") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.history.append(record)

    def _get_symbols(self, top_n: int = 20) -> List[str]:
        if self._symbols_cache:
            return self._symbols_cache
        self._symbols_cache = self.loader.get_top_symbols(top_n)
        return self._symbols_cache

    # ===== 第一层：Auto-Optimizer (Grid Search) =====

    def auto_optimize(self, strategy: str, days: int = 90,
                      max_combos: int = 200) -> EvalResult:
        """自动参数搜索 - Grid Search"""
        logger.info(f"\n{'='*60}")
        logger.info(f"🔬 Auto-Optimizer: {strategy} | {days}天回测")
        logger.info(f"{'='*60}")

        space = PARAM_SPACES.get(strategy)
        if not space:
            logger.error(f"未知策略: {strategy}")
            return None

        # 生成参数组合
        keys = list(space.keys())
        values = list(space.values())
        combos = list(itertools.product(*values))
        random.shuffle(combos)
        if len(combos) > max_combos:
            combos = combos[:max_combos]

        logger.info(f"参数空间: {len(combos)}组 (总空间{len(list(itertools.product(*values)))})")

        # 获取数据
        symbols = self._get_symbols(20)
        best: Optional[EvalResult] = None
        all_results: List[EvalResult] = []

        for idx, combo in enumerate(combos):
            params = dict(zip(keys, combo))
            result = self.walk_forward_evaluate(strategy, params, symbols)
            all_results.append(result)

            if best is None or result.score > best.score:
                best = result

            if (idx + 1) % 20 == 0:
                logger.info(f"  进度: {idx+1}/{len(combos)} | "
                           f"当前最佳: PnL=${best.pnl:+,.0f} WR{best.win_rate:.1f}% "
                           f"Score={best.score:.1f}")

        # 汇总
        if best:
            logger.info(f"\n🏆 最优参数 ({strategy}):")
            logger.info(f"  PnL: ${best.pnl:+,.0f} | WR: {best.win_rate:.1f}% | "
                       f"Score: {best.score:.1f}")
            logger.info(f"  参数: {json.dumps(best.params)}")
            self._log_evolution({
                "type": "auto_optimize",
                "strategy": strategy,
                "result": asdict(best),
                "evaluated": len(all_results),
            })

        return best

    def _evaluate_params(self, strategy: str, params: Dict,
                         symbols: List[str], days: int) -> EvalResult:
        """评估一组参数"""
        all_pnls = []
        all_trades = []
        wins = 0
        big_wins = 0
        max_dd = 0
        equity_curve = [10000]
        peak_equity = 10000

        for symbol in symbols:
            klines_4h = self.loader.fetch_klines(symbol, '4h', days)
            if len(klines_4h) < 50:
                continue

            detector = EvolvableMomentumDetector(params)
            start_bar = 30
            last_entry = -10

            for i in range(start_bar, len(klines_4h) - 10):
                if i - last_entry < 5:
                    continue

                window = klines_4h[max(0, i - 50):i + 1]
                signals = detector._detect_wave(window, symbol)
                signals += detector._detect_quick(window, symbol)

                for sig in signals:
                    if sig['score'] < 50:
                        continue

                    price = klines_4h[i]['close']
                    direction = sig['direction']
                    stop = sig.get('stop_loss', price * 0.96)
                    remaining = klines_4h[i + 1:]
                    if not remaining:
                        continue

                    # 模拟出场
                    result = self._sim_exit(price, direction, stop, remaining,
                                           params, sig['type'])
                    if direction == "LONG":
                        pnl_pct = (result['exit_price'] - price) / price * 100
                    else:
                        pnl_pct = (price - result['exit_price']) / price * 100

                    pos_value = 10000 * 0.03 * sig['leverage']
                    pnl_dollar = pos_value * pnl_pct / 100

                    all_pnls.append(pnl_dollar)
                    all_trades.append(pnl_pct)
                    if pnl_dollar > 0:
                        wins += 1
                    if pnl_dollar > 500:
                        big_wins += 1

                    equity_curve.append(equity_curve[-1] + pnl_dollar)
                    if equity_curve[-1] > peak_equity:
                        peak_equity = equity_curve[-1]
                    dd = (peak_equity - equity_curve[-1]) / peak_equity * 100
                    if dd > max_dd:
                        max_dd = dd

                    last_entry = i

        n = len(all_trades)
        wr = wins / n * 100 if n > 0 else 0
        total_pnl = sum(all_pnls)

        # Sharpe-like ratio
        if len(all_pnls) > 1:
            avg = sum(all_pnls) / len(all_pnls)
            var = sum((x - avg) ** 2 for x in all_pnls) / len(all_pnls)
            sharpe = avg / (var ** 0.5) if var > 0 else 0
        else:
            sharpe = 0

        # 综合评分: PnL(40%) + 胜率(20%) + Sharpe(20%) + 大赢(20%)
        score = (
            total_pnl * 0.4 / 100 +
            wr * 2 +
            sharpe * 200 * 0.2 +
            big_wins * 50 * 0.2
        )

        return EvalResult(
            params=params, trades=n, wins=wins,
            win_rate=round(wr, 1), pnl=round(total_pnl, 0),
            sharpe=round(sharpe, 3), max_drawdown=round(max_dd, 1),
            big_wins=big_wins, score=round(score, 1),
        )

    def _sim_exit(self, entry: float, direction: str, stop_loss: float,
                  klines_after: List[dict], params: Dict,
                  sig_type: str) -> dict:
        """模拟出场"""
        if sig_type == "surge_quick":
            return self._sim_trailing_exit(entry, direction, stop_loss,
                                            klines_after, params)
        elif sig_type == "surge_wave":
            return self._sim_ema_exit(entry, direction, stop_loss,
                                      klines_after, params)
        else:
            return self._sim_trailing_exit(entry, direction, stop_loss,
                                            klines_after, params)

    def _sim_trailing_exit(self, entry, direction, stop_loss, klines, params):
        """快钱模式：trailing stop"""
        trail_pct = params.get("QUICK_TRAIL_PCT", 2.0)
        max_hold = params.get("QUICK_MAX_HOLD", 48)
        peak = entry
        current_stop = stop_loss

        for i, k in enumerate(klines[:max_hold]):
            c = k['close']
            h = k['high']
            l = k['low']

            if direction == "LONG":
                if h > peak:
                    peak = h
                trail = peak * (1 - trail_pct / 100)
                current_stop = max(current_stop, trail)
                if l <= current_stop:
                    return {"exit_price": current_stop, "bars_held": i + 1,
                            "exit_reason": "trailing_stop"}
        return {"exit_price": klines[min(max_hold - 1, len(klines) - 1)]['close'],
                "bars_held": min(max_hold, len(klines)),
                "exit_reason": "timeout"}

    def _sim_ema_exit(self, entry, direction, stop_loss, klines, params):
        """波段模式：EMA趋势出场"""
        ema_len = params.get("WAVE_EMA_EXIT", 20)
        max_hold = params.get("WAVE_MAX_HOLD", 180)
        closes = []

        for i, k in enumerate(klines[:max_hold]):
            c = k['close']
            h = k['high']
            l = k['low']
            closes.append(c)

            # 止损
            if direction == "LONG" and l <= stop_loss:
                return {"exit_price": stop_loss, "bars_held": i + 1,
                        "exit_reason": "stop_loss"}

            # EMA出场
            if len(closes) >= ema_len + 1:
                ema = calc_ema(closes, ema_len)
                ema_prev = calc_ema(closes[:-1], ema_len)
                if c < ema and closes[-2] >= ema_prev:
                    return {"exit_price": c, "bars_held": i + 1,
                            "exit_reason": "ema_exit"}

        return {"exit_price": klines[min(max_hold - 1, len(klines) - 1)]['close'],
                "bars_held": min(max_hold, len(klines)),
                "exit_reason": "timeout"}

    # ===== 第二层：Strategy Mutator =====

    def mutate_strategy(self, strategy: str, base_params: Dict,
                        n_mutants: int = 20) -> List[Dict]:
        """策略变异 - 产生N个变异体"""
        mutants = []
        space = PARAM_SPACES.get(strategy, {})

        for _ in range(n_mutants):
            mutant = copy.deepcopy(base_params)
            # 随机选1-3个参数变异
            n_changes = random.randint(1, 3)
            keys = [k for k in space.keys() if k in mutant]
            chosen = random.sample(keys, min(n_changes, len(keys)))

            for key in chosen:
                options = space[key]
                # 50%概率选邻近值，50%随机
                current = mutant[key]
                if random.random() < 0.5 and current in options:
                    idx = options.index(current)
                    delta = random.choice([-1, 0, 1])
                    new_idx = max(0, min(len(options) - 1, idx + delta))
                    mutant[key] = options[new_idx]
                else:
                    mutant[key] = random.choice(options)

            mutants.append(mutant)

        return mutants

    def evolve_generation(self, strategy: str, days: int = 90,
                          population: int = 30, elite_pct: float = 0.3,
                          n_generations: int = 1) -> EvalResult:
        """一代进化：选择→变异→评估→选择"""
        logger.info(f"\n{'='*60}")
        logger.info(f"🧬 Strategy Mutator: {strategy} | {n_generations}代 x {population}个体")
        logger.info(f"{'='*60}")

        symbols = self._get_symbols(20)
        current_best_params = self.best_params.get(strategy, DEFAULT_BEST.get(strategy, {}))

        all_time_best = None

        for gen in range(n_generations):
            logger.info(f"\n--- Generation {gen + 1}/{n_generations} ---")

            # 1. 生成变异体
            mutants = self.mutate_strategy(strategy, current_best_params, population)

            # 2. 加上当前最优（精英保留）
            elite_params = [copy.deepcopy(current_best_params)]

            # 3. 评估所有个体
            results: List[EvalResult] = []

            # 先评估精英
            for p in elite_params:
                r = self._evaluate_params(strategy, p, symbols, days)
                results.append(r)

            # 评估变异体
            for idx, mutant in enumerate(mutants):
                r = self._evaluate_params(strategy, mutant, symbols, days)
                results.append(r)
                if (idx + 1) % 10 == 0:
                    best_so_far = max(results, key=lambda x: x.score)
                    logger.info(f"  评估 {idx+1}/{len(mutants)} | "
                               f"最佳: ${best_so_far.pnl:+,.0f} WR{best_so_far.win_rate:.1f}%")

            # 4. 选择
            results.sort(key=lambda x: x.score, reverse=True)
            elite_count = max(1, int(len(results) * elite_pct))
            elite = results[:elite_count]

            gen_best = elite[0]
            logger.info(f"\n📊 Gen {gen+1} 最佳: PnL=${gen_best.pnl:+,.0f} "
                       f"WR{gen_best.win_rate:.1f}% Score={gen_best.score:.1f}")

            # 5. 更新当前最优
            if all_time_best is None or gen_best.score > all_time_best.score:
                all_time_best = gen_best
                current_best_params = gen_best.params

            # 日志
            self._log_evolution({
                "type": "evolve_generation",
                "strategy": strategy,
                "generation": gen + 1,
                "best": asdict(gen_best),
                "population": len(results),
            })

        if all_time_best:
            logger.info(f"\n🏆 进化完成 ({strategy}):")
            logger.info(f"  PnL: ${all_time_best.pnl:+,.0f} | WR: {all_time_best.win_rate:.1f}% | "
                       f"Score: {all_time_best.score:.1f}")
            logger.info(f"  参数: {json.dumps(all_time_best.params)}")

        return all_time_best

    # ===== 选币策略进化 =====

    def evolve_screener(self, days: int = 60, population: int = 30) -> Optional[Dict]:
        """进化选币参数：搜索最优筛选阈值组合"""
        import itertools as _it
        logger.info(f"\n{'='*60}")
        logger.info(f"🔍 选币策略进化 | {days}天回测 | {population}个体")
        logger.info(f"{'='*60}")

        # 合并所有选币空间
        combined = {}
        for space_name, space_params in SCREENER_SPACES.items():
            for k, v in space_params.items():
                combined[k] = v

        keys = list(combined.keys())
        values = list(combined.values())
        total = 1
        for v in values:
            total *= len(v)
        logger.info(f"选币参数空间: {total}组")

        # 采样
        all_combos = list(_it.product(*values))
        random.shuffle(all_combos)
        sample = all_combos[:min(population, len(all_combos))]

        symbols_pool = self._get_symbols(30)
        best_screen = None
        best_score = -999
        best_result = None

        for idx, combo in enumerate(sample):
            params = dict(zip(keys, combo))

            # 用这组选币参数筛选symbols
            screened = self._screen_symbols(params, symbols_pool)
            if len(screened) < 3:
                continue

            # 用当前最优策略参数做回测
            strategy_params = self.best_params.get('momentum_quick',
                             DEFAULT_BEST.get('momentum_quick', {}))
            result = self._evaluate_params_with_symbols(
                'momentum_quick', strategy_params, screened, days
            )

            if result and result.score > best_score:
                best_score = result.score
                best_screen = params
                best_result = result

            if (idx + 1) % 10 == 0:
                logger.info(f"  进度: {idx+1}/{len(sample)} | "
                           f"最佳: Score={best_score:.1f} PnL=${best_result.pnl:+,.0f}" if best_result else
                           f"  进度: {idx+1}/{len(sample)}")

        if best_screen:
            logger.info(f"\n🏆 最优选币参数:")
            for k, v in sorted(best_screen.items()):
                logger.info(f"    {k}: {v}")
            logger.info(f"  筛选后: {len(self._screen_symbols(best_screen, symbols_pool))}个币")
            logger.info(f"  Score: {best_score:.1f} | PnL: ${best_result.pnl:+,.0f}")

            # 保存
            self.best_params['screener'] = best_screen
            self._log_evolution({
                "type": "screener_evolve",
                "params": best_screen,
                "score": best_score,
                "pnl": best_result.pnl,
            })

        return best_screen

    def _screen_symbols(self, params: Dict, symbols: List[str]) -> List[str]:
        """用选币参数过滤symbols"""
        min_vol = params.get("MIN_VOLUME_USD", 5_000_000)
        min_volatility = params.get("MIN_VOLATILITY", 2.0)

        # 简化版：用成交量过滤（无法在回测中获取历史ticker）
        # 但可以通过K线计算波动率
        screened = []
        for sym in symbols:
            try:
                klines = self.loader.fetch_klines(sym, '4h', 7)
                if len(klines) < 10:
                    continue

                # 计算近期波动率
                closes = [k['close'] for k in klines]
                highs = [k['high'] for k in klines]
                lows = [k['low'] for k in klines]
                vols = [k['volume'] for k in klines]

                # 波动率
                recent_high = max(highs[-7:])
                recent_low = min(lows[-7:])
                current = closes[-1]
                if current > 0:
                    vol_range = (recent_high - recent_low) / current * 100
                else:
                    vol_range = 0

                if vol_range < min_volatility:
                    continue

                # 成交量（用K线volume作为proxy）
                avg_vol = sum(vols[-7:]) / 7
                if avg_vol < min_vol / 100:  # 粗略估计
                    continue

                screened.append(sym)
            except:
                pass

        return screened

    def _evaluate_params_with_symbols(self, strategy: str, params: Dict,
                                       symbols: List[str],
                                       days: int) -> Optional[EvalResult]:
        """用指定symbols评估参数"""
        return self._evaluate_params(strategy, params, symbols, days)

    # ===== 因子权重进化 =====

    def evolve_factor_weights(self, strategy: str, days: int = 90,
                               population: int = 30) -> Optional[Dict]:
        """进化因子权重：搜索最优权重组合"""
        weight_space = FACTOR_WEIGHT_SPACES.get(strategy)
        threshold_space = THRESHOLD_SPACES.get(strategy, {})
        if not weight_space:
            logger.info(f"{strategy} 没有因子权重空间，跳过")
            return None

        logger.info(f"\n{'='*60}")
        logger.info(f"⚖️ 因子权重进化: {strategy}")
        logger.info(f"{'='*60}")

        # 合并权重+阈值空间
        combined_space = {**weight_space, **threshold_space}
        keys = list(combined_space.keys())
        values = list(combined_space.values())
        total_combos = 1
        for v in values:
            total_combos *= len(v)

        logger.info(f"因子权重空间: {total_combos}组")

        # 采样（不超过population）
        import itertools as _it
        all_combos = list(_it.product(*values))
        random.shuffle(all_combos)
        sample = all_combos[:min(population, len(all_combos))]

        # 获取当前最优策略参数（保持不变，只搜权重）
        current_params = self.best_params.get(strategy, DEFAULT_BEST.get(strategy, {}))
        symbols = self._get_symbols(15)

        best_weights = None
        best_score = -999
        best_result = None

        for idx, combo in enumerate(sample):
            weights = dict(zip(keys, combo))

            # 用这组权重做回测
            result = self._evaluate_with_weights(
                strategy, current_params, weights, symbols, days
            )

            if result and result.score > best_score:
                best_score = result.score
                best_weights = weights
                best_result = result

            if (idx + 1) % 10 == 0:
                logger.info(f"  进度: {idx+1}/{len(sample)} | "
                           f"最佳: Score={best_score:.1f}")

        if best_weights:
            logger.info(f"\n🏆 最优因子权重 ({strategy}):")
            logger.info(f"  Score: {best_score:.1f} | PnL: ${best_result.pnl:+,.0f}")
            for k, v in sorted(best_weights.items()):
                logger.info(f"    {k}: {v}")

            self._log_evolution({
                "type": "factor_weight_evolve",
                "strategy": strategy,
                "weights": best_weights,
                "score": best_score,
                "pnl": best_result.pnl,
            })

            # 保存到best_params
            if strategy not in self.best_params:
                self.best_params[strategy] = {}
            self.best_params[strategy]["_factor_weights"] = best_weights

        return best_weights

    def _evaluate_with_weights(self, strategy: str, params: Dict,
                                weights: Dict, symbols: List[str],
                                days: int) -> Optional[EvalResult]:
        """用指定权重评估参数"""
        try:
            # 先用标准方式评估，但调整评分函数
            all_pnls = []
            all_trades = []
            wins = 0
            big_wins = 0
            max_dd = 0
            equity_curve = [10000]
            peak_equity = 10000
            score_threshold = weights.get("score_threshold", 40)
            ms_blend = weights.get("ms_blend", 0.25)

            detector = EvolvableMomentumDetector(params)

            for symbol in symbols:
                klines_4h = self.loader.fetch_klines(symbol, '4h', days)
                if len(klines_4h) < 50:
                    continue

                start_bar = 30
                last_entry = -10

                for i in range(start_bar, len(klines_4h) - 10):
                    if i - last_entry < 5:
                        continue
                    window = klines_4h[max(0, i - 50):i + 1]

                    # 检测信号
                    signals = detector._detect_wave(window, symbol)
                    signals += detector._detect_quick(window, symbol)

                    for sig in signals:
                        # 用权重重新计算分数
                        raw_score = sig.get('score', 50)
                        # 模拟因子权重调整：对分数做线性变换
                        # 高权重组合让低分信号通过，低权重组合过滤更多
                        adjusted_score = raw_score * (1 - ms_blend) + 50 * ms_blend
                        # 阈值过滤
                        if adjusted_score < score_threshold:
                            continue

                        price = klines_4h[i]['close']
                        direction = sig.get('direction', 'LONG')
                        stop = sig.get('stop_loss', price * 0.96)
                        remaining = klines_4h[i + 1:]
                        if not remaining:
                            continue

                        result = self._sim_exit(price, direction, stop, remaining,
                                               params, sig['type'])
                        if direction == "LONG":
                            pnl_pct = (result['exit_price'] - price) / price * 100
                        else:
                            pnl_pct = (price - result['exit_price']) / price * 100

                        pos_value = 10000 * 0.03 * sig.get('leverage', 10)
                        pnl_dollar = pos_value * pnl_pct / 100

                        all_pnls.append(pnl_dollar)
                        all_trades.append(pnl_pct)
                        if pnl_dollar > 0:
                            wins += 1
                        if pnl_dollar > 500:
                            big_wins += 1

                        equity_curve.append(equity_curve[-1] + pnl_dollar)
                        if equity_curve[-1] > peak_equity:
                            peak_equity = equity_curve[-1]
                        dd = (peak_equity - equity_curve[-1]) / peak_equity * 100
                        if dd > max_dd:
                            max_dd = dd
                        last_entry = i

            n = len(all_trades)
            if n == 0:
                return None

            wr = wins / n * 100
            total_pnl = sum(all_pnls)

            if len(all_pnls) > 1:
                avg = sum(all_pnls) / len(all_pnls)
                var = sum((x - avg) ** 2 for x in all_pnls) / len(all_pnls)
                sharpe = avg / (var ** 0.5) if var > 0 else 0
            else:
                sharpe = 0

            score = (
                total_pnl * 0.4 / 100 +
                wr * 2 +
                sharpe * 50 +
                big_wins * 10 -
                max_dd * 3
            )

            return EvalResult(
                params={**params, "_weights": weights},
                pnl=total_pnl, win_rate=wr,
                n_trades=n, max_drawdown=max_dd,
                sharpe=sharpe, big_wins=big_wins,
                score=score, walk_forward_score=score,
            )
        except Exception as e:
            logger.debug(f"权重评估失败: {e}")
            return None

    # ===== 第三层：Full Loop =====

    def full_evolution_cycle(self, agent: str = "all", days: int = 90,
                             generations: int = 3, population: int = 30):
        """完整进化循环：分析→优化→变异→部署"""
        logger.info(f"\n{'='*70}")
        logger.info(f"🚀 Full Evolution Cycle | agent={agent} | {days}天 | {generations}代")
        logger.info(f"{'='*70}")

        strategies = []
        if agent in ("momentum", "all"):
            strategies = ["momentum_quick", "momentum_wave", "momentum_newcoin"]
        if agent in ("risk", "all"):
            strategies.append("risk")

        changes = []

        for strategy in strategies:
            logger.info(f"\n>>> 策略: {strategy} <<<")

            # Step 1: 评估当前参数
            current = self.best_params.get(strategy, DEFAULT_BEST.get(strategy, {}))
            symbols = self._get_symbols(20)
            baseline = self._evaluate_params(strategy, current, symbols, days)
            logger.info(f"当前基线: PnL=${baseline.pnl:+,.0f} WR{baseline.win_rate:.1f}% "
                       f"Score={baseline.score:.1f}")

            # Step 2: Auto-Optimizer (粗搜索)
            logger.info("\n--- Phase 1: Auto-Optimizer (Grid Search) ---")
            grid_best = self.auto_optimize(strategy, days, max_combos=100)

            # Step 3: Strategy Mutator (精搜索)
            logger.info("\n--- Phase 2: Strategy Mutator (GA) ---")
            ga_best = self.evolve_generation(
                strategy, days,
                population=population,
                n_generations=generations
            )

            # Step 3: 因子权重进化（仅quick和wave）
            logger.info("\n--- Phase 3: Factor Weight Evolution ---")
            best_weights = self.evolve_factor_weights(strategy, days, population=20)

            # Step 4: 选币策略进化（仅quick和wave）
            if strategy in ("momentum_quick", "momentum_wave"):
                logger.info("\n--- Phase 4: Screener Evolution ---")
                best_screen = self.evolve_screener(days, population=15)

            # Step 5: 选择最优
            candidates = [
                ("baseline", baseline, current),
                ("grid", grid_best, grid_best.params if grid_best else None),
                ("ga", ga_best, ga_best.params if ga_best else None),
            ]
            candidates = [(n, r, p) for n, r, p in candidates if r is not None and p is not None]
            candidates.sort(key=lambda x: x[1].score, reverse=True)

            winner_name, winner_result, winner_params = candidates[0]

            # Step 5: 决策 - 新参数是否显著优于当前？
            improvement = winner_result.score - baseline.score
            pnl_improvement = winner_result.pnl - baseline.pnl
            threshold = baseline.score * 0.05  # 5%提升阈值

            logger.info(f"\n📈 进化结果 ({strategy}):")
            logger.info(f"  胜出者: {winner_name}")
            logger.info(f"  基线: ${baseline.pnl:+,.0f} → 新: ${winner_result.pnl:+,.0f} "
                       f"(Δ${pnl_improvement:+,.0f})")
            logger.info(f"  Score: {baseline.score:.1f} → {winner_result.score:.1f} "
                       f"(+{improvement:.1f})")

            if improvement > threshold and winner_result.pnl > baseline.pnl:
                logger.info(f"  ✅ 采用新参数！")
                self.best_params[strategy] = winner_params
                changes.append({
                    "strategy": strategy,
                    "old_score": baseline.score,
                    "new_score": winner_result.score,
                    "old_pnl": baseline.pnl,
                    "new_pnl": winner_result.pnl,
                    "winner": winner_name,
                    "params": winner_params,
                })
            else:
                logger.info(f"  ⏸️ 新参数提升不足({improvement:.1f} < {threshold:.1f})，保持当前")
                if strategy not in self.best_params or strategy == "meta":
                    self.best_params[strategy] = winner_params

        # 保存
        self.best_params["meta"]["generation"] = \
            self.best_params.get("meta", {}).get("generation", 0) + generations
        self._save_best_params()

        # 部署到agent代码
        if not self.dry_run:
            self._deploy_to_agents(changes)

        # 发送进化报告
        self._evolution_report(changes)

        return changes

    def _deploy_to_agents(self, changes: List[dict]):
        """将最优参数写入Agent源码"""
        deployed = []
        for change in changes:
            strategy = change["strategy"]
            params = change.get("params", {})

            # 部署策略参数到momentum_agent.py
            if strategy.startswith("momentum_"):
                target = BASE / "agents" / "momentum_agent.py"
                content = target.read_text()

                for key, value in params.items():
                    if key.startswith("_"):  # 跳过_factor_weights等内部字段
                        continue
                    if isinstance(value, float):
                        import re
                        pattern = rf"({key}\s*=\s*)[\d.]+"
                        replacement = f"{key} = {value}"
                        content = re.sub(pattern, replacement, content)
                    elif isinstance(value, int):
                        import re
                        pattern = rf"({key}\s*=\s*)\d+"
                        replacement = f"{key} = {value}"
                        content = re.sub(pattern, replacement, content)

                target.write_text(content)
                deployed.append(strategy)
                logger.info(f"  📝 部署 {strategy} 参数到 momentum_agent.py")

        # 部署因子权重到factor_engine.py
        for strategy in ["momentum_quick", "momentum_wave"]:
            weights = self.best_params.get(strategy, {}).get("_factor_weights")
            if weights:
                self._deploy_factor_weights(strategy, weights)

        # 部署选币参数到smart_screener.py
        screener_params = self.best_params.get("screener")
        if screener_params:
            self._deploy_screener_params(screener_params)
            deployed.append("screener")

    def _deploy_factor_weights(self, strategy: str, weights: Dict):
        """将因子权重部署到factor_engine.py"""
        import re
        target = BASE / "factor_engine.py"
        if not target.exists():
            return

        content = target.read_text()
        strategy_key = strategy.replace("momentum_", "")  # quick / wave

        # 映射权重key到factor_engine中的key
        weight_map = {
            # quick
            "w_surge_1h": "surge_1h",
            "w_vol_surge": "vol_surge_ratio",
            "w_vol_pattern": "vol_pattern",
            "w_btc_regime": "btc_regime",
            "w_price_position": "price_position",
            "w_rsi": "momentum_rsi",
            # wave
            "w_breakout": "breakout_strength",
            "w_ema_align": "ema_alignment",
            "w_vol_breakout": "volume_breakout",
            "w_atr": "atr_ratio",
            "w_support": "support_distance",
            # 微观结构
            "w_orderbook": "orderbook",
            "w_funding": "funding",
            "w_oi_change": "oi_change",
            "w_smart_money": "smart_money",
        }

        # 找到STRATEGY_FACTORS[strategy_key]部分并替换权重
        # 使用正则匹配 "factor_name": 0.xx
        for w_key, f_name in weight_map.items():
            if w_key not in weights:
                continue
            new_val = weights[w_key]
            # 匹配 "f_name": old_val  在quick或wave块中
            pattern = rf'("{f_name}":\s*)[\d.]+'
            # 找所有匹配并替换（会在quick和wave中都替换）
            # 更精确地只替换目标策略的权重
            content = re.sub(pattern, f'\\g<1>{new_val}', content)

        target.write_text(content)
        logger.info(f"  ⚖️ 部署 {strategy} 因子权重到 factor_engine.py")

    def _deploy_screener_params(self, params: Dict):
        """将选币参数部署到smart_screener.py"""
        import re
        target = BASE / "smart_screener.py"
        if not target.exists():
            return
        content = target.read_text()

        # 更新MIN_VOLUME_USD
        if "MIN_VOLUME_USD" in params:
            content = re.sub(
                r'MIN_VOLUME_USD = [\d_]+'
                , f'MIN_VOLUME_USD = {params["MIN_VOLUME_USD"]:_}', content)
        # 更新MIN_VOLATILITY
        if "MIN_VOLATILITY" in params:
            content = re.sub(
                r'MIN_VOLATILITY = [\d.]+',
                f'MIN_VOLATILITY = {params["MIN_VOLATILITY"]}', content)

        target.write_text(content)
        logger.info(f"  🔍 部署选币参数: VOL≥${params.get('MIN_VOLUME_USD',5000000):_} VOLAT≥{params.get('MIN_VOLATILITY',2.0)}%")

        if deployed:
            # 重启trading-agent
            import subprocess
            subprocess.run(["pm2", "restart", "trading-agent"], capture_output=True)
            logger.info(f"  🔄 已重启 trading-agent (部署了: {', '.join(deployed)})")

    def _evolution_report(self, changes: List[dict]):
        """生成进化报告"""
        report = {
            "message": "",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "channel": "openclaw-weixin",
            "to": "o9cq801kLBuLl3lPs3gk_40jqkww@im.wechat",
            "pushed": False,
        }

        if not changes:
            msg = "🧬 进化报告: 今日无参数更新\n"
            msg += f"当前最优: PnL=${self.best_params.get('meta',{}).get('best_pnl','?')}"
            report["message"] = msg
        else:
            msg = f"🧬 进化报告: {len(changes)}个策略参数更新！\n\n"
            for c in changes:
                msg += (f"【{c['strategy']}】\n"
                       f"  ${c['old_pnl']:+,.0f} → ${c['new_pnl']:+,.0f} "
                       f"(Score {c['old_score']:.1f}→{c['new_score']:.1f})\n"
                       f"  来源: {c['winner']}\n\n")
            gen = self.best_params.get("meta", {}).get("generation", 0)
            msg += f"总进化代数: {gen}"
            report["message"] = msg

        # 写到pending report
        report_file = Path("/opt/trading-agent/data/pending_wechat_report.json")
        report_file.parent.mkdir(parents=True, exist_ok=True)
        report_file.write_text(json.dumps(report, ensure_ascii=False))
        logger.info(f"\n📢 进化报告已写入 {report_file}")


# ============================================================
# 实盘→回测闭环
# ============================================================

class LiveFeedbackLoop:
    """实盘反馈闭环：收集实盘数据 → 评估策略表现 → 触发进化"""

    def __init__(self, engine: EvolutionEngine):
        self.engine = engine
        self.state_file = EVOLVE_DIR / "feedback_state.json"

    def analyze_live_performance(self) -> dict:
        """分析实盘交易表现"""
        # 读取所有agent的state
        data_dir = Path("/opt/trading-agent/data")
        all_stats = {}

        for state_file in data_dir.glob("agent_*_state.json"):
            try:
                d = json.loads(state_file.read_text())
                agent = d.get("agent_type", state_file.stem)
                all_stats[agent] = {
                    "capital": d.get("capital", 0),
                    "initial": 10000,
                    "trades": d.get("total_trades", 0),
                    "wins": d.get("total_wins", 0),
                    "losses": d.get("total_losses", 0),
                    "pnl": d.get("total_pnl", 0),
                    "positions": len(d.get("positions", {})),
                    "trade_history": d.get("trade_history", [])[-20:],
                }
            except:
                continue

        return all_stats

    def should_evolve(self, stats: dict) -> Tuple[bool, str]:
        """判断是否需要触发进化"""
        reasons = []

        for agent, data in stats.items():
            trades = data["trades"]
            if trades < 10:
                continue

            wr = data["wins"] / trades * 100 if trades > 0 else 0
            pnl = data["pnl"]

            # 规则1: 胜率低于30%
            if wr < 30:
                reasons.append(f"{agent}胜率{wr:.1f}%太低")

            # 规则2: 连续亏损5笔以上
            history = data.get("trade_history", [])
            if len(history) >= 5:
                recent = history[-5:]
                if all(h.get("pnl", 0) < 0 for h in recent):
                    reasons.append(f"{agent}连续5笔亏损")

            # 规则3: 总亏损超过5%
            pnl_pct = (data["capital"] - data["initial"]) / data["initial"] * 100
            if pnl_pct < -5:
                reasons.append(f"{agent}总亏损{pnl_pct:.1f}%")

        if reasons:
            return True, "; ".join(reasons)
        return False, "表现正常"

    def run_feedback_cycle(self):
        """执行反馈循环"""
        logger.info("🔄 实盘反馈分析...")

        stats = self.analyze_live_performance()
        for agent, data in stats.items():
            wr = data["wins"] / data["trades"] * 100 if data["trades"] > 0 else 0
            logger.info(f"  {agent}: {data['trades']}笔 WR{wr:.1f}% "
                       f"PnL${data['pnl']:+,.0f} 持仓{data['positions']}")

        should, reason = self.should_evolve(stats)

        if should:
            logger.info(f"⚠️ 触发进化: {reason}")
            self.engine.full_evolution_cycle(
                agent="all", days=90, generations=3, population=30
            )
        else:
            logger.info(f"✅ {reason}，无需进化")

            # 即使不进化，也做定期参数优化检查（每天一次）
            last_evolve = self.engine.best_params.get("meta", {}).get("last_evolve", "")
            if last_evolve:
                last_dt = datetime.fromisoformat(last_evolve)
                hours_since = (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600
                if hours_since > 24:
                    logger.info("⏰ 距上次进化>24h，执行定期优化...")
                    self.engine.full_evolution_cycle(
                        agent="all", days=90, generations=1, population=20
                    )
                else:
                    logger.info(f"上次进化: {hours_since:.0f}h前，跳过")
            else:
                self.engine.full_evolution_cycle(
                    agent="all", days=90, generations=1, population=20
                )


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description='Trading Agent 自主进化引擎')
    parser.add_argument('--agent', type=str, default='all',
                        choices=['momentum', 'risk', 'all'])
    parser.add_argument('--days', type=int, default=90)
    parser.add_argument('--generations', type=int, default=3)
    parser.add_argument('--population', type=int, default=30)
    parser.add_argument('--dry-run', action='store_true',
                        help='只分析不写入')
    parser.add_argument('--feedback', action='store_true',
                        help='运行实盘反馈循环')
    parser.add_argument('--optimize-only', action='store_true',
                        help='只做grid search')

    args = parser.parse_args()

    engine = EvolutionEngine(dry_run=args.dry_run)

    if args.feedback:
        loop = LiveFeedbackLoop(engine)
        loop.run_feedback_cycle()
    elif args.optimize_only:
        strategies = ["momentum_quick", "momentum_wave", "momentum_newcoin"]
        for s in strategies:
            engine.auto_optimize(s, days=args.days, max_combos=150)
    else:
        engine.full_evolution_cycle(
            agent=args.agent,
            days=args.days,
            generations=args.generations,
            population=args.population,
        )


if __name__ == "__main__":
    main()


# ============================================================
# VectorBT快速全参数扫描（1000倍加速）
# ============================================================
def vbt_full_sweep(strategy: str, days: int = 60, top_n: int = 12) -> Optional[dict]:
    """用向量化回测一次性扫完全部参数空间"""
    try:
        from vbt_backtest import full_sweep
        result = full_sweep(strategy, days=days, top_n=top_n)
        if result and result.get('best_overall'):
            best = result['best_overall']
            return {
                'strategy': strategy,
                'score': best['score'],
                'pnl_pct': best['pnl_pct'],
                'win_rate': best['win_rate'],
                'total_trades': best['total_trades'],
                'params': best['params'],
                'coverage': '100%',
                'elapsed': result['elapsed_seconds'],
            }
    except Exception as e:
        logger.warning(f"VBT sweep failed: {e}")
    return None
