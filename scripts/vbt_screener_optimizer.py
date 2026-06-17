#!/usr/bin/env python3
"""
选币参数向量化回测优化器
核心问题：什么样的选币条件能选出后市大涨/大跌的币？

方法：
1. 每天用一组选币参数筛选Top N币
2. 看这些币在未来3/7/14天的涨跌表现
3. 找到选币参数空间中最优组合
"""
import os, sys, json, time, asyncio, aiohttp
import numpy as np
import pandas as pd
from itertools import product
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(__file__))


# 选币参数空间
SCREENER_PARAM_SPACE = {
    "min_volume_usd": [1e6, 5e6, 10e6, 50e6, 100e6],
    "min_volatility": [1.0, 2.0, 3.0, 5.0, 8.0],
    "momentum_weight": [0, 5, 10, 15, 20],     # 24h涨跌权重
    "volatility_weight": [0, 5, 10, 15, 20],    # 波动率权重  
    "volume_weight": [0, 5, 10, 15],            # 成交量权重
    "funding_weight": [0, 5, 10],               # 资金费率权重
    "oversold_bonus": [0, 5, 10, 15, 20],       # 超跌加分
    "overbought_penalty": [0, -5, -10, -15],    # 超涨惩罚
    "top_n": [10, 20, 30, 50],                  # 选多少个
}


@dataclass
class ScreenerResult:
    """选币回测结果"""
    params: dict
    avg_forward_3d: float    # 选出后3天平均涨幅
    avg_forward_7d: float    # 选出后7天平均涨幅
    avg_forward_14d: float   # 选出后14天平均涨幅
    hit_rate_3d: float       # 3天内上涨概率
    hit_rate_7d: float       # 7天内上涨概率
    best_coin_avg: float     # S级币平均涨幅
    total_coins_selected: int
    diversity: float          # 选出的币的多样性（不同板块）
    score: float              # 综合评分


async def fetch_all_klines(symbols: List[str], interval: str = "4h", days: int = 90) -> Dict[str, pd.DataFrame]:
    """批量下载K线"""
    results = {}
    async with aiohttp.ClientSession() as session:
        sem = asyncio.Semaphore(5)
        for sym in symbols:
            async with sem:
                try:
                    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval={interval}&limit={days*6}"
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        raw = await resp.json()
                    if not isinstance(raw, list) or len(raw) < 100:
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
                    results[sym] = df[['open', 'high', 'low', 'close', 'volume']]
                except:
                    continue
    return results


def calc_ema(data, period):
    if len(data) < period: return np.full_like(data, np.nan)
    r = np.empty_like(data)
    r[:period] = np.nan
    r[period-1] = np.mean(data[:period])
    k = 2 / (period + 1)
    for i in range(period, len(data)):
        r[i] = data[i] * k + r[i-1] * (1 - k)
    return r


def score_coin_vectorized(
    change_24h: np.ndarray,    # 每根K线的24h涨跌
    volatility: np.ndarray,    # 波动率
    volume: np.ndarray,        # 成交额
    funding: np.ndarray,       # 资金费率
    params: dict,
) -> np.ndarray:
    """向量化评分，返回每根K线的评分"""
    score = np.full_like(change_24h, 50.0)
    
    # 动量
    mw = params.get('momentum_weight', 10)
    score += np.where(change_24h > 10, mw,
             np.where(change_24h > 5, mw * 0.7,
             np.where(change_24h > 2, mw * 0.3,
             np.where(change_24h > -2, 0,
             np.where(change_24h > -5, params.get('oversold_bonus', 10) * 0.5,
             np.where(change_24h > -10, params.get('oversold_bonus', 10),
                      params.get('oversold_bonus', 10) * 1.2))))))
    
    # 超涨惩罚
    score += np.where(change_24h > 15, params.get('overbought_penalty', -10), 0)
    
    # 波动率
    vw = params.get('volatility_weight', 10)
    score += np.where(volatility > 15, vw,
             np.where(volatility > 8, vw * 0.7,
             np.where(volatility > 5, vw * 0.4,
             np.where(volatility > 3, vw * 0.2, 0))))
    
    # 成交量
    volw = params.get('volume_weight', 5)
    score += np.where(volume > 1e9, volw,
             np.where(volume > 5e8, volw * 0.8,
             np.where(volume > 1e8, volw * 0.5,
             np.where(volume > 5e7, volw * 0.3, volw * 0.1))))
    
    # 资金费率
    fw = params.get('funding_weight', 5)
    score += np.where(np.abs(funding) > 0.001, fw,
             np.where(np.abs(funding) > 0.0005, fw * 0.7,
             np.where(np.abs(funding) > 0.0001, fw * 0.3, 0)))
    
    return np.clip(score, 0, 100)


def backtest_screener(
    all_data: Dict[str, pd.DataFrame],
    params: dict,
    forward_days: int = 7,
    rebalance_every: int = 6,  # 每6根4h K线（=1天）重新筛选
) -> Optional[ScreenerResult]:
    """回测一组选币参数"""
    
    top_n = params.get('top_n', 20)
    min_vol = params.get('min_volume_usd', 5e6)
    min_volatility = params.get('min_volatility', 2.0)
    
    # 预处理所有币的数据
    coin_features = {}
    for sym, df in all_data.items():
        close = df['close'].values
        high = df['high'].values
        low = df['low'].values
        vol = df['volume'].values
        n = len(close)
        if n < 50: continue
        
        # 计算24h涨跌（6根4h bar）
        change = np.zeros(n)
        change[6:] = (close[6:] - close[:-6]) / close[:-6] * 100
        
        # 波动率
        volatility = np.zeros(n)
        for i in range(6, n):
            volatility[i] = (high[i-6:i].max() - low[i-6:i].min()) / close[i] * 100
        
        # 成交额
        volume_24h = np.zeros(n)
        for i in range(6, n):
            volume_24h[i] = vol[i-6:i].sum() * close[i]
        
        # 资金费率模拟（用价格动量近似）
        funding = np.zeros(n)
        funding[12:] = (close[12:] - close[:-12]) / close[:-12] * 0.001
        
        # 评分
        scores = score_coin_vectorized(change, volatility, volume_24h, funding, params)
        
        coin_features[sym] = {
            'close': close, 'scores': scores,
            'change': change, 'volatility': volatility,
            'volume_24h': volume_24h,
        }
    
    if not coin_features:
        return None
    
    # 找最短的序列长度
    min_len = min(len(v['close']) for v in coin_features.values())
    
    # 在每个重平衡点选币
    forward_bars = forward_days * 6  # 4h bars
    forward_results = []  # 每次选币后的前向收益
    
    for t in range(50, min_len - forward_bars, rebalance_every):
        # 对每个币计算t时刻的评分
        scored = []
        for sym, feat in coin_features.items():
            if t >= len(feat['scores']): continue
            s = feat['scores'][t]
            vol24 = feat['volume_24h'][t]
            vola = feat['volatility'][t]
            
            # 基础过滤
            if vol24 < min_vol or vola < min_volatility:
                continue
            
            scored.append((sym, s, feat['close'][t]))
        
        if not scored:
            continue
        
        # 按评分排序选Top N
        scored.sort(key=lambda x: -x[1])
        selected = scored[:top_n]
        
        # 计算前向收益
        for sym, score, price_t in selected:
            feat = coin_features[sym]
            if t + forward_bars < len(feat['close']):
                fwd_return = (feat['close'][t + forward_bars] - price_t) / price_t * 100
                forward_results.append({
                    'sym': sym, 'score': score, 
                    'fwd_return': fwd_return,
                    'day': t // 6,
                })
    
    if not forward_results:
        return None
    
    returns = np.array([r['fwd_return'] for r in forward_results])
    scores_arr = np.array([r['score'] for r in forward_results])
    
    # S级币（Top 10 score）的前向收益
    s_mask = scores_arr >= np.percentile(scores_arr, 90)
    s_returns = returns[s_mask] if s_mask.any() else returns
    
    # 计算不同时间窗口（通过rebalance_every推算）
    avg_3d = np.mean(returns) if len(returns) > 0 else 0
    avg_7d = avg_3d  # 简化，实际用forward_days参数控制
    hit_rate = np.mean(returns > 0) * 100 if len(returns) > 0 else 0
    
    # 综合评分：前向收益 × 命中率 × S级加成
    s_bonus = np.mean(s_returns) / max(avg_3d, 0.1) if len(s_returns) > 0 else 1
    score = avg_3d * (hit_rate / 50) * min(s_bonus, 3) * (1 + len(forward_results) / 500)
    
    return ScreenerResult(
        params=params,
        avg_forward_3d=round(avg_3d, 2),
        avg_forward_7d=round(avg_7d, 2),
        avg_forward_14d=round(avg_3d, 2),
        hit_rate_3d=round(hit_rate, 1),
        hit_rate_7d=round(hit_rate, 1),
        best_coin_avg=round(np.mean(s_returns), 2) if len(s_returns) > 0 else 0,
        total_coins_selected=len(forward_results),
        diversity=0,
        score=round(score, 1),
    )


def generate_screener_grid(max_combos: int = 1000) -> List[dict]:
    """生成选币参数网格（采样避免爆炸）"""
    keys = list(SCREENER_PARAM_SPACE.keys())
    values = [SCREENER_PARAM_SPACE[k] for k in keys]
    
    total = 1
    for v in values:
        total *= len(v)
    
    if total <= max_combos:
        return [dict(zip(keys, combo)) for combo in product(*values)]
    
    # 随机采样
    np.random.seed(42)
    grid = []
    seen = set()
    while len(grid) < max_combos:
        combo = tuple(np.random.choice(v) for v in values)
        if combo not in seen:
            seen.add(combo)
            grid.append(dict(zip(keys, combo)))
    
    return grid


def optimize_screener(
    days: int = 90,
    top_n_symbols: int = 50,
    max_param_combos: int = 500,
    output_file: str = None,
) -> dict:
    """选币参数全优化"""
    start = time.time()
    
    print(f"🔍 选币参数优化")
    
    # 获取币种
    from harness import DataLoader
    loader = DataLoader()
    symbols = loader.get_top_symbols(top_n_symbols)
    print(f"  币种: {len(symbols)}个")
    
    # 下载K线
    print(f"  下载数据...")
    data = asyncio.run(fetch_all_klines(symbols, "4h", days))
    print(f"  获取: {len(data)}个币种")
    
    # 生成参数网格
    grid = generate_screener_grid(max_param_combos)
    print(f"  参数组合: {len(grid)}种")
    
    # 测试不同forward window
    best_by_window = {}
    for fwd_days in [3, 7, 14]:
        results = []
        for params in grid:
            r = backtest_screener(data, params, forward_days=fwd_days)
            if r:
                results.append(r)
        
        if results:
            best = max(results, key=lambda x: x.score)
            best_by_window[f'{fwd_days}d'] = best
            print(f"\n  {fwd_days}天前向最优:")
            print(f"    Score: {best.score:.0f}")
            print(f"    平均收益: {best.avg_forward_3d:+.2f}%")
            print(f"    命中率: {best.hit_rate_3d:.1f}%")
            print(f"    S级收益: {best.best_coin_avg:+.2f}%")
            print(f"    选币数: {best.total_coins_selected}")
            print(f"    参数: top_n={best.params.get('top_n')}, "
                  f"oversold={best.params.get('oversold_bonus')}, "
                  f"momentum_w={best.params.get('momentum_weight')}")
    
    elapsed = time.time() - start
    
    # 序列化结果
    summary = {
        'elapsed_seconds': round(elapsed, 1),
        'symbols_tested': len(data),
        'param_combos': len(grid),
        'best_by_window': {k: asdict(v) for k, v in best_by_window.items()},
    }
    
    if output_file:
        with open(output_file, 'w') as f:
            json.dump(summary, f, indent=2, default=str)
        print(f"\n保存: {output_file}")
    
    return summary


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--days', type=int, default=90)
    p.add_argument('--top-n', type=int, default=50)
    p.add_argument('--max-combos', type=int, default=500)
    p.add_argument('--output', default=None)
    args = p.parse_args()
    
    out = args.output or f"/opt/trading-agent/scripts/data/evolve/screener_opt_{int(time.time())}.json"
    optimize_screener(days=args.days, top_n_symbols=args.top_n, 
                      max_param_combos=args.max_combos, output_file=out)
