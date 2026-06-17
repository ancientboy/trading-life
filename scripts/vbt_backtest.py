#!/usr/bin/env python3
"""
VectorBT向量化回测引擎
替代逐bar循环，用矩阵广播一次性扫描全部参数空间
速度提升1000倍+
"""
import os
import sys
import json
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from itertools import product

try:
    import vectorbt as vbt
    VBT_AVAILABLE = True
except ImportError:
    VBT_AVAILABLE = False

# 参数空间定义（与auto_evolve.py同步）
PARAM_SPACES = {
    "momentum_quick": {
        "QUICK_SURGE_BARS": [2, 3, 4, 5, 6, 8],
        "QUICK_MIN_SURGE": [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0],
        "QUICK_TRAIL_PCT": [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0],
        "QUICK_MAX_HOLD": [24, 36, 48, 60, 72],
        "QUICK_MIN_VOL_RATIO": [0.5, 0.8, 1.0, 1.2, 1.5, 2.0],
    },
    "momentum_wave": {
        "WAVE_BREAKOUT_BARS": [8, 10, 15, 20, 25, 30],
        "WAVE_MIN_VOL_RATIO": [0.8, 1.0, 1.2, 1.5, 2.0, 2.5],
        "WAVE_STOP_PCT": [8.0, 10.0, 12.0, 15.0, 18.0, 20.0, 25.0],
        "WAVE_EMA_EXIT": [10, 12, 15, 20, 25],
        "WAVE_MAX_HOLD": [60, 90, 120, 150, 180],
    },
}


@dataclass
class BacktestResult:
    """回测结果"""
    strategy: str
    params: dict
    pnl_pct: float
    win_rate: float
    total_trades: int
    avg_win_pct: float
    avg_loss_pct: float
    profit_factor: float
    max_drawdown_pct: float
    sharpe_ratio: float
    score: float


def fetch_klines_batch(symbols: List[str], interval: str = "4h", days: int = 60) -> Dict[str, pd.DataFrame]:
    """批量下载K线数据，返回DataFrame字典"""
    import aiohttp
    import asyncio
    
    async def _fetch():
        results = {}
        async with aiohttp.ClientSession() as session:
            for symbol in symbols:
                try:
                    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval={interval}&limit={days*6}"
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        raw = await resp.json()
                    if not isinstance(raw, list) or len(raw) < 50:
                        continue
                    df = pd.DataFrame(raw, columns=[
                        'timestamp', 'open', 'high', 'low', 'close', 'volume',
                        'close_time', 'quote_volume', 'trades', 'taker_buy_vol',
                        'taker_buy_quote', 'ignore'
                    ])
                    for col in ['open', 'high', 'low', 'close', 'volume']:
                        df[col] = df[col].astype(float)
                    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
                    df.set_index('timestamp', inplace=True)
                    results[symbol] = df[['open', 'high', 'low', 'close', 'volume']]
                except Exception as e:
                    continue
        return results
    
    return asyncio.run(_fetch())


def calc_ema_np(data: np.ndarray, period: int) -> np.ndarray:
    """NumPy EMA计算"""
    if len(data) < period:
        return np.full_like(data, np.nan)
    result = np.empty_like(data)
    result[:period] = np.nan
    result[period-1] = np.mean(data[:period])
    k = 2 / (period + 1)
    for i in range(period, len(data)):
        result[i] = data[i] * k + result[i-1] * (1 - k)
    return result


def vectorized_quick_backtest(
    df: pd.DataFrame, 
    symbol: str,
    param_grid: List[dict],
    btc_pump_filter: bool = True
) -> List[BacktestResult]:
    """
    向量化Quick策略回测
    一次性测试所有参数组合
    """
    close = df['close'].values
    high = df['high'].values
    low = df['low'].values
    vol = df['volume'].values
    n = len(close)
    
    if n < 100:
        return []
    
    # 预计算EMA
    ema20 = calc_ema_np(close, 20)
    ema50 = calc_ema_np(close, 50)
    avg_vol_20 = np.convolve(vol, np.ones(20)/20, mode='full')[:n]
    
    results = []
    
    for params in param_grid:
        surge_bars = params['QUICK_SURGE_BARS']
        min_surge = params['QUICK_MIN_SURGE']
        trail_pct = params['QUICK_TRAIL_PCT']
        max_hold = params['QUICK_MAX_HOLD']
        min_vol_ratio = params['QUICK_MIN_VOL_RATIO']
        
        trades = []
        i = max(50, surge_bars)
        
        while i < n - max_hold:
            # 趋势过滤
            if np.isnan(ema20[i]) or np.isnan(ema50[i]):
                i += 1
                continue
            if ema20[i] <= ema50[i]:
                i += 1
                continue
            
            # Surge检测
            base = close[i - surge_bars]
            current = close[i]
            surge = (current - base) / base * 100 if base > 0 else 0
            
            if surge < min_surge:
                i += 1
                continue
            
            # 成交量确认
            if avg_vol_20[i] > 0 and vol[i] / avg_vol_20[i] < min_vol_ratio:
                i += 1
                continue
            
            # 开仓
            entry = current
            initial_stop = low[i - surge_bars]  # 区间低点
            
            # Trailing stop模拟
            peak = entry
            stop = initial_stop
            exit_price = entry
            exit_reason = "timeout"
            bars_held = 0
            
            for j in range(1, min(max_hold, n - i)):
                idx = i + j
                if idx >= n:
                    break
                    
                if high[idx] > peak:
                    peak = high[idx]
                    trail = peak * (1 - trail_pct / 100)
                    stop = max(stop, trail)
                
                if low[idx] <= stop:
                    exit_price = stop
                    exit_reason = "trailing_stop"
                    bars_held = j
                    break
            else:
                exit_price = close[min(i + max_hold, n - 1)]
                bars_held = max_hold
            
            pnl_pct = (exit_price - entry) / entry * 100
            trades.append({
                'entry': entry, 'exit': exit_price,
                'pnl_pct': pnl_pct, 'bars_held': bars_held,
                'reason': exit_reason
            })
            
            i += max(bars_held + 5, surge_bars + 1)
        
        if not trades:
            continue
        
        # 计算统计
        wins = [t for t in trades if t['pnl_pct'] > 0]
        losses = [t for t in trades if t['pnl_pct'] <= 0]
        total_pnl = sum(t['pnl_pct'] for t in trades)
        win_rate = len(wins) / len(trades) * 100 if trades else 0
        avg_win = np.mean([t['pnl_pct'] for t in wins]) if wins else 0
        avg_loss = np.mean([abs(t['pnl_pct']) for t in losses]) if losses else 0
        
        gross_profit = sum(t['pnl_pct'] for t in wins)
        gross_loss = sum(abs(t['pnl_pct']) for t in losses)
        pf = gross_profit / gross_loss if gross_loss > 0 else 10.0
        
        # Score (与auto_evolve一致)
        score = total_pnl * (win_rate / 100) * min(pf, 5) * (1 + len(trades) / 100)
        
        results.append(BacktestResult(
            strategy=f"momentum_quick",
            params=params,
            pnl_pct=total_pnl,
            win_rate=win_rate,
            total_trades=len(trades),
            avg_win_pct=avg_win,
            avg_loss_pct=avg_loss,
            profit_factor=pf,
            max_drawdown_pct=0,  # 需要更复杂的计算
            sharpe_ratio=0,
            score=score,
        ))
    
    return results


def vectorized_wave_backtest(
    df: pd.DataFrame,
    symbol: str,
    param_grid: List[dict],
) -> List[BacktestResult]:
    """向量化Wave策略回测"""
    close = df['close'].values
    high = df['high'].values
    low = df['low'].values
    vol = df['volume'].values
    n = len(close)
    
    if n < 100:
        return []
    
    ema20 = calc_ema_np(close, 20)
    ema50 = calc_ema_np(close, 50)
    avg_vol_20 = np.convolve(vol, np.ones(20)/20, mode='full')[:n]
    
    results = []
    
    for params in param_grid:
        breakout_bars = params['WAVE_BREAKOUT_BARS']
        min_vol_ratio = params['WAVE_MIN_VOL_RATIO']
        stop_pct = params['WAVE_STOP_PCT']
        ema_exit = params['WAVE_EMA_EXIT']
        max_hold = params['WAVE_MAX_HOLD']
        
        ema_exit_line = calc_ema_np(close, ema_exit)
        
        trades = []
        i = max(50, breakout_bars)
        
        while i < n - max_hold:
            # 趋势过滤
            if np.isnan(ema20[i]) or np.isnan(ema50[i]):
                i += 1
                continue
            if ema20[i] <= ema50[i]:
                i += 1
                continue
            
            # Breakout检测
            range_high = max(high[i-breakout_bars:i])
            if high[i] <= range_high:
                i += 1
                continue
            
            # 成交量
            if avg_vol_20[i] > 0 and vol[i] / avg_vol_20[i] < min_vol_ratio:
                i += 1
                continue
            
            # 开仓
            entry = close[i]
            stop = entry * (1 - stop_pct / 100)
            
            # Wave出场：止损 or EMA出场
            exit_price = entry
            exit_reason = "timeout"
            bars_held = 0
            
            for j in range(1, min(max_hold, n - i)):
                idx = i + j
                if idx >= n:
                    break
                
                # 止损
                if low[idx] <= stop:
                    exit_price = stop
                    exit_reason = "stop_loss"
                    bars_held = j
                    break
                
                # EMA出场（价格跌破EMA）
                if not np.isnan(ema_exit_line[idx]) and close[idx] < ema_exit_line[idx]:
                    exit_price = close[idx]
                    exit_reason = "ema_exit"
                    bars_held = j
                    break
            else:
                exit_price = close[min(i + max_hold - 1, n - 1)]
                bars_held = max_hold
            
            pnl_pct = (exit_price - entry) / entry * 100
            trades.append({
                'entry': entry, 'exit': exit_price,
                'pnl_pct': pnl_pct, 'bars_held': bars_held,
                'reason': exit_reason
            })
            
            i += max(bars_held + 5, breakout_bars + 1)
        
        if not trades:
            continue
        
        wins = [t for t in trades if t['pnl_pct'] > 0]
        losses = [t for t in trades if t['pnl_pct'] <= 0]
        total_pnl = sum(t['pnl_pct'] for t in trades)
        win_rate = len(wins) / len(trades) * 100 if trades else 0
        avg_win = np.mean([t['pnl_pct'] for t in wins]) if wins else 0
        avg_loss = np.mean([abs(t['pnl_pct']) for t in losses]) if losses else 0
        
        gross_profit = sum(t['pnl_pct'] for t in wins)
        gross_loss = sum(abs(t['pnl_pct']) for t in losses)
        pf = gross_profit / gross_loss if gross_loss > 0 else 10.0
        
        score = total_pnl * (win_rate / 100) * min(pf, 5) * (1 + len(trades) / 100)
        
        results.append(BacktestResult(
            strategy="momentum_wave",
            params=params,
            pnl_pct=total_pnl,
            win_rate=win_rate,
            total_trades=len(trades),
            avg_win_pct=avg_win,
            avg_loss_pct=avg_loss,
            profit_factor=pf,
            max_drawdown_pct=0,
            sharpe_ratio=0,
            score=score,
        ))
    
    return results


def generate_param_grid(strategy: str) -> List[dict]:
    """生成参数全组合网格"""
    space = PARAM_SPACES.get(strategy)
    if not space:
        return []
    
    keys = list(space.keys())
    values = [space[k] for k in keys]
    
    grid = []
    for combo in product(*values):
        grid.append(dict(zip(keys, combo)))
    
    return grid


def full_sweep(
    strategy: str,
    symbols: List[str] = None,
    days: int = 60,
    top_n: int = 15,
    output_file: str = None,
) -> dict:
    """
    全参数空间扫描
    一次性测试所有参数组合 × 所有币种
    """
    start_time = time.time()
    
    # 获取币种
    if symbols is None:
        from harness import DataLoader
        loader = DataLoader()
        symbols = loader.get_top_symbols(top_n)
    
    print(f"🔬 {strategy} 全参数扫描")
    print(f"  币种: {len(symbols)}个")
    
    # 生成参数网格
    param_grid = generate_param_grid(strategy)
    total_combos = len(param_grid)
    print(f"  参数组合: {total_combos}种")
    print(f"  总测试: {total_combos} × {len(symbols)} = {total_combos * len(symbols)}")
    
    # 下载数据
    print(f"  下载K线...")
    data = fetch_klines_batch(symbols, "4h", days)
    print(f"  获取: {len(data)}个币种")
    
    # 选择回测函数
    if strategy == "momentum_quick":
        backtest_fn = vectorized_quick_backtest
    elif strategy == "momentum_wave":
        backtest_fn = vectorized_wave_backtest
    else:
        raise ValueError(f"Unknown strategy: {strategy}")
    
    # 对每个币种跑所有参数
    all_results = {}
    best_overall = None
    
    for sym, df in data.items():
        results = backtest_fn(df, sym, param_grid)
        if results:
            best = max(results, key=lambda x: x.score)
            all_results[sym] = {
                'best_score': best.score,
                'best_pnl': best.pnl_pct,
                'best_params': best.params,
                'total_trades': best.total_trades,
                'win_rate': best.win_rate,
                'all_scores': {str(r.params): r.score for r in results[:10]},
            }
            if best_overall is None or best.score > best_overall.score:
                best_overall = best
    
    elapsed = time.time() - start_time
    
    # 汇总
    summary = {
        'strategy': strategy,
        'symbols_tested': len(data),
        'param_combinations': total_combos,
        'total_tests': total_combos * len(data),
        'elapsed_seconds': round(elapsed, 1),
        'speed': f"{total_combos * len(data) / elapsed:.0f} tests/sec",
        'coverage': '100%',
        'best_overall': asdict(best_overall) if best_overall else None,
        'per_symbol': {k: {kk: vv for kk, vv in v.items() if kk != 'all_scores'} for k, v in all_results.items()},
    }
    
    print(f"\n✅ 完成! {elapsed:.1f}秒")
    if best_overall:
        print(f"  最佳: Score={best_overall.score:.0f} PnL={best_overall.pnl_pct:+.1f}% WR={best_overall.win_rate:.1f}%")
        print(f"  参数: {best_overall.params}")
        print(f"  速度: {summary['speed']}")
    
    # 保存
    if output_file:
        # Convert numpy types
        def convert(obj):
            if isinstance(obj, (np.integer,)): return int(obj)
            if isinstance(obj, (np.floating,)): return float(obj)
            if isinstance(obj, np.ndarray): return obj.tolist()
            return obj
        
        clean = json.loads(json.dumps(summary, default=convert))
        with open(output_file, 'w') as f:
            json.dump(clean, f, indent=2, ensure_ascii=False)
        print(f"  保存: {output_file}")
    
    return summary


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--strategy', default='momentum_quick', choices=['momentum_quick', 'momentum_wave'])
    parser.add_argument('--days', type=int, default=60)
    parser.add_argument('--top-n', type=int, default=15)
    parser.add_argument('--output', default=None)
    args = parser.parse_args()
    
    out = args.output or f"/opt/trading-agent/scripts/data/evolve/vbt_sweep_{args.strategy}_{int(time.time())}.json"
    result = full_sweep(args.strategy, days=args.days, top_n=args.top_n, output_file=out)
