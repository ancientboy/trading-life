#!/usr/bin/env python3
"""
Harness 完整工具箱
LLM大脑通过这些工具进行自助分析、回测、优化、部署

共11个工具，分4类：

📊 回测工具:
  1. backtest_strategy   — 回测单个策略参数
  2. sweep_params        — VBT全参数扫描（1000倍加速）
  3. walk_forward        — Walk-Forward过拟合验证
  4. compare_params      — 对比两组参数
  5. robust_sweep        — 稳健参数扫描（自动过滤过拟合）

🔍 分析工具:
  6. analyze_regime      — 市场状态分析（牛/熊/震荡）
  7. analyze_drawdown    — 最大回撤分析
  8. analyze_failure     — 亏损归因分析
  9. analyze_performance — 综合绩效总览

🚀 一键工具:
 10. optimize_screener   — 选币参数优化
 11. auto_improve        — 一键自动优化（发现问题→分析→建议）

使用方式:
  python3 harness_tools.py <tool_name> [--args]
  
  或 Python import:
  from harness_tools import analyze_regime, robust_sweep, ...
"""
import os, sys, json, time, argparse
sys.path.insert(0, os.path.dirname(__file__))

from typing import Dict, List


# ============================================================
# 回测工具 (1-5)
# ============================================================

def backtest_strategy(strategy: str, params: dict, symbols=None, days=60, top_n=15) -> dict:
    """工具1: 回测单个策略+参数"""
    from vbt_backtest import fetch_klines_batch, vectorized_quick_backtest, vectorized_wave_backtest
    
    if symbols is None:
        from harness import DataLoader
        symbols = DataLoader().get_top_symbols(top_n)
    
    data = fetch_klines_batch(symbols, "4h", days)
    fn = vectorized_quick_backtest if strategy == "momentum_quick" else vectorized_wave_backtest
    
    all_results = []
    for sym, df in data.items():
        results = fn(df, sym, [params])
        all_results.extend(results)
    
    if not all_results:
        return {"error": "no trades", "params": params}
    
    total_trades = sum(r.total_trades for r in all_results)
    total_pnl = sum(r.pnl_pct for r in all_results)
    best = max(all_results, key=lambda x: x.score)
    
    return {
        "strategy": strategy, "params": params,
        "total_trades": total_trades,
        "pnl_pct": round(total_pnl, 1),
        "win_rate": round(sum(r.win_rate * r.total_trades for r in all_results) / max(total_trades, 1), 1),
        "score": round(best.score, 0),
        "symbols_tested": len(data), "days": days,
    }


def sweep_params(strategy: str, days=60, top_n=12) -> dict:
    """工具2: VBT全参数空间扫描"""
    from vbt_backtest import full_sweep
    out = f"/opt/trading-agent/scripts/data/evolve/vbt_sweep_{strategy}_{int(time.time())}.json"
    return full_sweep(strategy, days=days, top_n=top_n, output_file=out)


def walk_forward(strategy: str, days=90, train_pct=0.4, top_n=12) -> dict:
    """工具3: Walk-Forward验证"""
    from vbt_walk_forward import walk_forward_validate
    return walk_forward_validate(strategy, train_pct=train_pct, days=days, top_n=top_n) or {"error": "failed"}


def compare_params(strategy: str, params_a: dict, params_b: dict, days=60, top_n=15) -> dict:
    """工具4: 对比两组参数"""
    ra = backtest_strategy(strategy, params_a, days=days, top_n=top_n)
    rb = backtest_strategy(strategy, params_b, days=days, top_n=top_n)
    winner = "a" if ra.get("score", 0) >= rb.get("score", 0) else "b"
    improvement = (ra.get("score", 0) - rb.get("score", 0)) / max(rb.get("score", 1), 1) * 100
    return {"a": ra, "b": rb, "winner": winner, "improvement_pct": round(improvement, 1)}


def robust_sweep(strategy: str, days=90, top_n=12, max_degradation=30.0, min_test_pnl=5.0) -> dict:
    """工具5: 稳健参数扫描（全扫+Walk-Forward+过拟合过滤）"""
    from harness_analyzer import robust_sweep as _rs
    return _rs(strategy, days=days, top_n=top_n, 
               max_degradation=max_degradation, min_test_pnl=min_test_pnl)


# ============================================================
# 分析工具 (6-9)
# ============================================================

def analyze_regime() -> dict:
    """工具6: 市场状态分析"""
    from harness_analyzer import analyze_regime as _ar
    return _ar()


def analyze_drawdown(days=30) -> dict:
    """工具7: 最大回撤分析"""
    from harness_analyzer import analyze_drawdown as _ad
    return _ad(days=days)


def analyze_failure(days=30, top_n=10) -> dict:
    """工具8: 亏损归因分析"""
    from harness_analyzer import analyze_failure as _af
    return _af(days=days, top_n=top_n)


def analyze_performance() -> dict:
    """工具9: 综合绩效总览"""
    from harness_analyzer import analyze_performance as _ap
    return _ap()


# ============================================================
# 一键工具 (10-11)
# ============================================================

def optimize_screener(days=90, top_n_symbols=50, max_combos=500) -> dict:
    """工具10: 选币参数优化"""
    from vbt_screener_optimizer import optimize_screener as _os
    out = f"/opt/trading-agent/scripts/data/evolve/screener_opt_{int(time.time())}.json"
    return _os(days=days, top_n_symbols=top_n_symbols, max_param_combos=max_combos, output_file=out)


def auto_improve(strategy="all") -> dict:
    """工具11: 一键自动优化（发现问题→分析→建议）"""
    from harness_analyzer import auto_improve as _ai
    return _ai(strategy=strategy)


# ============================================================
# 工具注册表
# ============================================================
TOOLS = {
    # 回测
    "backtest": (backtest_strategy, ["strategy", "params", "days", "top_n"]),
    "sweep": (sweep_params, ["strategy", "days", "top_n"]),
    "walk_forward": (walk_forward, ["strategy", "days"]),
    "compare": (compare_params, ["strategy", "params_a", "params_b", "days"]),
    "robust_sweep": (robust_sweep, ["strategy", "days"]),
    # 分析
    "regime": (analyze_regime, []),
    "drawdown": (analyze_drawdown, ["days"]),
    "failure": (analyze_failure, ["days", "top_n"]),
    "performance": (analyze_performance, []),
    # 一键
    "optimize_screener": (optimize_screener, ["days", "max_combos"]),
    "auto_improve": (auto_improve, ["strategy"]),
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Harness工具箱 (11个工具)")
    parser.add_argument("tool", choices=list(TOOLS.keys()), help="工具名称")
    parser.add_argument("--strategy", default="momentum_quick")
    parser.add_argument("--params", default='{}')
    parser.add_argument("--params-a", default='{}')
    parser.add_argument("--params-b", default='{}')
    parser.add_argument("--days", type=int, default=60)
    parser.add_argument("--top-n", type=int, default=12)
    parser.add_argument("--max-combos", type=int, default=500)
    args = parser.parse_args()
    
    fn, _ = TOOLS[args.tool]
    
    # 根据工具分发参数
    if args.tool == "backtest":
        result = fn(args.strategy, json.loads(args.params), days=args.days, top_n=args.top_n)
    elif args.tool == "sweep":
        result = fn(args.strategy, days=args.days, top_n=args.top_n)
    elif args.tool == "walk_forward":
        result = fn(args.strategy, days=args.days)
    elif args.tool == "compare":
        result = fn(args.strategy, json.loads(args.params_a), json.loads(args.params_b), days=args.days)
    elif args.tool == "robust_sweep":
        result = fn(args.strategy, days=args.days)
    elif args.tool == "regime":
        result = fn()
    elif args.tool == "drawdown":
        result = fn(days=args.days)
    elif args.tool == "failure":
        result = fn(days=args.days, top_n=args.top_n)
    elif args.tool == "performance":
        result = fn()
    elif args.tool == "optimize_screener":
        result = fn(days=args.days, max_combos=args.max_combos)
    elif args.tool == "auto_improve":
        result = fn(args.strategy)
    
    print(json.dumps(result, indent=2, default=str, ensure_ascii=False))
