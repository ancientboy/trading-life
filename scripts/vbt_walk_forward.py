#!/usr/bin/env python3
"""Walk-Forward验证：40%训练 + 60%测试"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from vbt_backtest import *

def walk_forward_validate(strategy: str, train_pct: float = 0.4, days: int = 90, top_n: int = 12):
    """Walk-Forward验证"""
    print(f"🔬 Walk-Forward: {strategy} ({days}天, {train_pct*100:.0f}%训练)")
    
    # 下载数据
    from harness import DataLoader
    loader = DataLoader()
    symbols = loader.get_top_symbols(top_n)
    data = fetch_klines_batch(symbols, "4h", days)
    
    # 分割数据
    train_data = {}
    test_data = {}
    for sym, df in data.items():
        split = int(len(df) * train_pct)
        train_data[sym] = df.iloc[:split]
        test_data[sym] = df.iloc[split:]
    
    print(f"  训练: {len(train_data)}币, 测试: {len(test_data)}币")
    
    # 生成参数网格
    grid = generate_param_grid(strategy)
    
    # 选择回测函数
    fn = vectorized_quick_backtest if strategy == "momentum_quick" else vectorized_wave_backtest
    
    # 训练阶段：找最优参数
    best_train = None
    for sym, df in train_data.items():
        results = fn(df, sym, grid)
        for r in results:
            if best_train is None or r.score > best_train.score:
                best_train = r
    
    if not best_train:
        print("  ❌ 训练阶段无结果")
        return None
    
    print(f"  训练最优: Score={best_train.score:.0f} PnL={best_train.pnl_pct:+.1f}% WR={best_train.win_rate:.1f}%")
    print(f"  参数: {best_train.params}")
    
    # 测试阶段：用训练参数在测试数据上验证
    test_results = []
    for sym, df in test_data.items():
        results = fn(df, sym, [best_train.params])
        test_results.extend(results)
    
    if not test_results:
        print("  ❌ 测试阶段无结果")
        return None
    
    avg_test_pnl = sum(r.pnl_pct for r in test_results) / len(test_results)
    avg_test_wr = sum(r.win_rate for r in test_results) / len(test_results)
    
    # 过拟合检测
    train_pnl = best_train.pnl_pct
    test_pnl = avg_test_pnl
    degradation = (train_pnl - test_pnl) / train_pnl * 100 if train_pnl > 0 else 999
    overfit = degradation > 30  # 超过30%衰减视为过拟合
    
    print(f"\n  测试结果: PnL={avg_test_pnl:+.1f}% WR={avg_test_wr:.1f}%")
    print(f"  衰减: {degradation:.1f}% {'⚠️ 过拟合!' if overfit else '✅ 稳健'}")
    
    return {
        'strategy': strategy,
        'train_score': best_train.score,
        'train_pnl': best_train.pnl_pct,
        'train_wr': best_train.win_rate,
        'test_pnl': avg_test_pnl,
        'test_wr': avg_test_wr,
        'degradation_pct': degradation,
        'overfit': overfit,
        'params': best_train.params,
    }

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--strategy', default='momentum_quick')
    p.add_argument('--days', type=int, default=90)
    p.add_argument('--top-n', type=int, default=12)
    args = p.parse_args()
    
    result = walk_forward_validate(args.strategy, days=args.days, top_n=args.top_n)
    if result:
        out = f"/opt/trading-agent/scripts/data/evolve/wf_{args.strategy}_{int(time.time())}.json"
        json.dump(result, open(out, 'w'), indent=2, default=str)
        print(f"\n保存: {out}")
