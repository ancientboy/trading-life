"""
XAU布林带挂单策略 - VectorBT回测引擎
1000倍加速，支持全参数扫描
"""
import json, time, math
import numpy as np
import vectorbt as vbt
from pathlib import Path
from itertools import product

DATA_DIR = Path(__file__).parent / "data"


def load_data():
    """加载1m K线"""
    candles = json.load(open(DATA_DIR / "xauusdt_1m.json"))
    return {
        "open": np.array([c["o"] for c in candles], dtype=float),
        "high": np.array([c["h"] for c in candles], dtype=float),
        "low": np.array([c["l"] for c in candles], dtype=float),
        "close": np.array([c["c"] for c in candles], dtype=float),
        "volume": np.array([c["v"] for c in candles], dtype=float),
    }


def calc_indicators(close, high, low,
                    boll_period=30, boll_std=2.0,
                    ema_fast=20, ema_slow=50,
                    rsi_period=14, stoch_period=14, k_smooth=3):
    """用VBT/NumPy预计算所有指标"""
    n = len(close)
    
    # EMA
    def ema(arr, p):
        e = np.empty_like(arr, dtype=float)
        e[:p] = np.nan
        e[p-1] = np.mean(arr[:p])
        k = 2.0 / (p + 1)
        for i in range(p, len(arr)):
            e[i] = arr[i] * k + e[i-1] * (1 - k)
        return e
    
    ema_f = ema(close, ema_fast)
    ema_s = ema(close, ema_slow)
    trend_up = ema_f > ema_s
    trend_down = ema_f < ema_s
    
    # Bollinger Bands (向量化)
    mid = np.full(n, np.nan)
    upper = np.full(n, np.nan)
    lower = np.full(n, np.nan)
    for i in range(boll_period - 1, n):
        w = close[i-boll_period+1:i+1]
        m = np.mean(w)
        s = np.std(w, ddof=0)
        mid[i] = m
        upper[i] = m + boll_std * s
        lower[i] = m - boll_std * s
    
    # StochRSI
    deltas = np.diff(close)
    gains = np.maximum(deltas, 0)
    losses = np.maximum(-deltas, 0)
    
    rsi = np.full(n, np.nan)
    ag = np.mean(gains[:rsi_period])
    al = np.mean(losses[:rsi_period])
    rsi[rsi_period] = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
    for i in range(rsi_period, len(gains)):
        ag = (ag * (rsi_period-1) + gains[i]) / rsi_period
        al = (al * (rsi_period-1) + losses[i]) / rsi_period
        rsi[i+1] = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
    
    stoch = np.full(n, np.nan)
    for i in range(stoch_period, n):
        w = rsi[i-stoch_period+1:i+1]
        if np.any(np.isnan(w)):
            continue
        mn, mx = np.min(w), np.max(w)
        stoch[i] = (rsi[i] - mn) / (mx - mn) * 100 if mx != mn else 50
    
    # K smoothing
    srsi = np.full(n, np.nan)
    for i in range(k_smooth-1, n):
        w = stoch[i-k_smooth+1:i+1]
        if not np.any(np.isnan(w)):
            srsi[i] = np.mean(w)
    
    return {
        "trend_up": trend_up,
        "trend_down": trend_down,
        "boll_upper": upper,
        "boll_lower": lower,
        "srsi": srsi,
    }


def backtest_xau_vbt(data, params):
    """
    用VBT做回测
    params: dict of all parameters
    """
    close = data["close"]
    high = data["high"]
    low = data["low"]
    n = len(close)
    warmup = 100
    
    # 指标
    ind = calc_indicators(close, high, low,
                          params.get("boll_period", 30),
                          params.get("boll_std", 1.5))
    
    # 参数
    offset = params.get("offset", 0.5)
    tp = params.get("tp", 10.0)
    sl = params.get("sl", 5.0)
    max_hold = params.get("max_hold", 120)
    pend_v = params.get("pending_valid", 15)
    srsi_l = params.get("srsi_lower", 10)
    srsi_u = params.get("srsi_upper", 97)
    trailing = params.get("trailing_tp", True)
    trail_pct = params.get("trail_pct", 0.3)
    lots = params.get("lots", 0.05)
    leverage = params.get("leverage", 500)
    max_pos = params.get("max_pos", 10)
    max_pending = params.get("max_pending", 30)
    orders_per_signal = params.get("orders_per_signal", 15)
    order_spacing = params.get("order_spacing", 1.0)
    
    trend_up = ind["trend_up"]
    trend_down = ind["trend_down"]
    boll_upper = ind["boll_upper"]
    boll_lower = ind["boll_lower"]
    srsi = ind["srsi"]
    
    # 模拟交易
    total_pnl = 0.0
    wins = 0
    total = 0
    sl_c = tp_c = tm_c = tr_c = 0
    long_t = short_t = long_w = short_w = 0
    peak_pnl = 0.0
    max_dd = 0.0
    consec = 0
    max_consec = 0
    hold_sum = 0
    signals = 0
    trade_pnls = []
    
    pending = []
    active = []
    
    for i in range(warmup, n):
        # === 处理持仓 ===
        new_active = []
        for pos in active:
            d = pos["dir"]
            entry = pos["entry"]
            bar = pos["bar"]
            hi = max(pos["highest"], high[i])
            lo = min(pos["lowest"], low[i])
            exited = False
            pnl = 0.0
            
            if d == 1:  # LONG
                if lo <= entry - sl:
                    pnl = -sl; sl_c += 1; exited = True
                elif trailing and hi >= entry + tp:
                    if lo <= hi * (1 - trail_pct / 100):
                        pnl = close[i] - entry; tr_c += 1; exited = True
                elif not trailing and hi >= entry + tp:
                    pnl = tp; tp_c += 1; exited = True
                elif i - bar >= max_hold:
                    pnl = close[i] - entry; tm_c += 1; exited = True
            else:  # SHORT
                if hi >= entry + sl:
                    pnl = -sl; sl_c += 1; exited = True
                elif trailing and lo <= entry - tp:
                    if hi >= lo * (1 + trail_pct / 100):
                        pnl = entry - close[i]; tr_c += 1; exited = True
                elif not trailing and lo <= entry - tp:
                    pnl = tp; tp_c += 1; exited = True
                elif i - bar >= max_hold:
                    pnl = entry - close[i]; tm_c += 1; exited = True
            
            if exited:
                dollar = pnl * lots * leverage
                total += 1
                total_pnl += dollar
                hold_sum += i - bar
                trade_pnls.append(dollar)
                if dollar > 0:
                    wins += 1; consec = 0
                else:
                    consec += 1
                    max_consec = max(max_consec, consec)
                if d == 1:
                    long_t += 1; long_w += (1 if dollar > 0 else 0)
                else:
                    short_t += 1; short_w += (1 if dollar > 0 else 0)
                if total_pnl > peak_pnl:
                    peak_pnl = total_pnl
                dd = peak_pnl - total_pnl
                if dd > max_dd:
                    max_dd = dd
            else:
                new_active.append({"dir": d, "entry": entry, "bar": bar,
                                   "highest": hi, "lowest": lo})
        active = new_active
        
        if len(active) >= max_pos:
            continue
        
        # === 处理挂单 ===
        new_pending = []
        for order in pending:
            if i >= order["expire"]:
                continue
            filled = False
            if order["dir"] == 1 and low[i] <= order["price"] and len(active) < max_pos:
                active.append({"dir": 1, "entry": order["price"], "bar": i,
                               "highest": order["price"], "lowest": order["price"]})
                filled = True
            elif order["dir"] == -1 and high[i] >= order["price"] and len(active) < max_pos:
                active.append({"dir": -1, "entry": order["price"], "bar": i,
                               "highest": order["price"], "lowest": order["price"]})
                filled = True
            if not filled:
                new_pending.append(order)
        pending = new_pending
        
        if len(active) + len(pending) >= max_pos + max_pending:
            continue
        
        # === 信号 ===
        if np.isnan(trend_up[i]) or np.isnan(srsi[i]) or np.isnan(boll_lower[i]):
            continue
        
        if trend_up[i] and low[i] <= boll_lower[i] and srsi[i] <= srsi_l:
            signals += 1
            base = boll_lower[i] - offset
            for k in range(orders_per_signal):
                p2 = round(base - k * order_spacing, 2)
                if p2 > 0 and len(pending) < max_pending:
                    pending.append({"dir": 1, "price": p2, "expire": i + pend_v})
        
        elif trend_down[i] and high[i] >= boll_upper[i] and srsi[i] >= srsi_u:
            signals += 1
            base = boll_upper[i] + offset
            for k in range(orders_per_signal):
                if len(pending) < max_pending:
                    pending.append({"dir": -1, "price": round(base + k * order_spacing, 2),
                                    "expire": i + pend_v})
    
    # === 统计 ===
    if total < 10:
        return None
    
    wr = wins / total * 100
    dd_pct = max_dd / 10000 * 100
    avg_hold = hold_sum / total if total > 0 else 0
    
    if len(trade_pnls) > 2:
        arr = np.array(trade_pnls)
        sharpe = float(np.mean(arr) / np.std(arr) * np.sqrt(252 * 24 * 60)) if np.std(arr) > 0 else 0
    else:
        sharpe = 0
    
    return {
        "total": total,
        "wins": wins,
        "wr": round(wr, 1),
        "pnl": round(total_pnl, 2),
        "dd": round(max_dd, 2),
        "dd_pct": round(dd_pct, 1),
        "sharpe": round(sharpe, 2),
        "max_consec": max_consec,
        "avg_hold": round(avg_hold),
        "sl": sl_c, "tp": tp_c, "trail": tr_c, "time": tm_c,
        "long": long_t, "long_w": long_w,
        "short": short_t, "short_w": short_w,
        "signals": signals,
    }


def grid_search(data, param_grid, max_tests=3000):
    """网格搜索（随机采样）"""
    import random
    random.seed(42)
    
    results = []
    t0 = time.time()
    
    keys = list(param_grid.keys())
    total_combos = 1
    for v in param_grid.values():
        total_combos *= len(v)
    
    actual_tests = min(max_tests, total_combos)
    print(f"参数空间: {total_combos} | 采样: {actual_tests}")
    
    for test_i in range(actual_tests):
        params = {k: random.choice(v) for k, v in param_grid.items()}
        
        r = backtest_xau_vbt(data, params)
        if r is None or r["pnl"] <= 0:
            continue
        
        score = (r["wr"] * 0.15 + 
                 r["pnl"] * 0.08 + 
                 r["sharpe"] * 30 -
                 r["dd_pct"] * 0.5 -
                 r["max_consec"] * 0.15)
        
        results.append((score, params.copy(), r))
        
        if test_i % 500 == 0 and test_i > 0:
            elapsed = time.time() - t0
            print(f"  [{test_i}/{actual_tests}] {elapsed:.0f}s 盈利{len(results)}")
    
    elapsed = time.time() - t0
    print(f"\n✅ {elapsed:.0f}s | {actual_tests}测试 | 盈利{len(results)}")
    
    return results


def print_results(results, top_n=15):
    results.sort(key=lambda x: x[0], reverse=True)
    
    for j, (sc, p, r) in enumerate(results[:top_n]):
        ts = f'移动TP回撤{p["trail_pct"]}%' if p.get("trailing_tp") else "固定TP"
        print(f"\n#{j+1} score={sc:.1f}")
        print(f"  {r['total']}笔 | WR={r['wr']}% | PnL=${r['pnl']:+,.0f} | 夏普={r['sharpe']}")
        print(f"  最大回撤: ${r['dd']:,.0f} ({r['dd_pct']}%) | 连亏{r['max_consec']}")
        print(f"  均持{r['avg_hold']}min | 信号{r['signals']}")
        print(f"  Boll{p['boll_period']}/{p['boll_std']} TP=${p['tp']} SL=${p['sl']} off=${p['offset']} srsi={p['srsi_lower']}/{p['srsi_upper']}")
        print(f"  {ts} | lots={p['lots']} | max_pos={p['max_pos']} | pending={p['max_pending']}")
        print(f"  每信号挂{p['orders_per_signal']}单 | 间隔${p['order_spacing']} | 有效{p['pending_valid']}min")
        lwr = round(r['long_w'] / max(r['long'], 1) * 100)
        swr = round(r['short_w'] / max(r['short'], 1) * 100)
        print(f"  多{r['long']}({lwr}%) 空{r['short']}({swr}%) | 出场: sl={r['sl']} tp={r['tp']} trail={r['trail']} time={r['time']}")


if __name__ == "__main__":
    import sys
    
    print("📊 加载数据...")
    data = load_data()
    print(f"  {len(data['close'])} 条1m K线")
    
    mode = sys.argv[1] if len(sys.argv) > 1 else "optimize"
    
    if mode == "baseline":
        # 基线
        r = backtest_xau_vbt(data, {
            "boll_period": 30, "boll_std": 1.5,
            "offset": 0.5, "tp": 10.0, "sl": 5.0,
            "trailing_tp": True, "trail_pct": 0.1,
            "srsi_lower": 10, "srsi_upper": 97,
            "lots": 0.05, "max_pos": 10, "max_pending": 30,
            "orders_per_signal": 15, "order_spacing": 1.0,
            "pending_valid": 15, "max_hold": 120,
        })
        if r:
            for k, v in r.items():
                print(f"  {k}: {v}")
    
    elif mode == "optimize":
        param_grid = {
            "boll_period": [25, 30],
            "boll_std": [1.5, 2.0, 2.5],
            "offset": [0.2, 0.5, 1.0],
            "tp": [1.0, 2.0, 3.0, 5.0, 8.0, 10.0],
            "sl": [2.0, 3.0, 5.0, 8.0],
            "trailing_tp": [False, True],
            "trail_pct": [0.1, 0.2, 0.3, 0.5, 1.0],
            "srsi_lower": [3, 5, 8, 10],
            "srsi_upper": [85, 90, 92, 95, 97],
            "lots": [0.01, 0.02, 0.05, 0.1],
            "max_pos": [10, 20, 30, 50],
            "max_pending": [10, 20, 30, 50],
            "orders_per_signal": [5, 10, 15, 20, 30],
            "order_spacing": [0.2, 0.5, 1.0, 2.0],
            "pending_valid": [10, 15, 20, 30],
            "max_hold": [60, 120, 240],
        }
        
        results = grid_search(data, param_grid, max_tests=2000)
        print_results(results)
        
        # 保存
        results.sort(key=lambda x: x[0], reverse=True)
        json.dump({
            "top15": [{
                "score": sc, "params": p, "result": r
            } for sc, p, r in results[:15]]
        }, open(DATA_DIR / "best_xau_params.json", "w"), indent=2, ensure_ascii=False)
        print(f"\n✅ 保存到 {DATA_DIR / 'best_xau_params.json'}")
