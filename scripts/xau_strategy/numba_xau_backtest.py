"""
XAU布林带挂单策略 - Numba加速回测引擎
核心交易循环用@jit(nopython=True)加速
指标预计算用NumPy向量化
"""
import json, time, random
import numpy as np
from numba import jit
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


@jit(nopython=True, cache=True)
def _trade_loop(close, high, low,
                trend_up, trend_down,
                boll_upper, boll_lower, srsi,
                offset, tp, sl, max_hold, pend_v,
                srsi_l, srsi_u, trailing, trail_pct,
                lots, leverage, max_pos, max_pending,
                orders_per_signal, order_spacing,
                warmup):
    """Numba加速的交易循环 - 所有数据必须是numpy数组"""
    n = len(close)
    
    total_pnl = 0.0
    wins = 0
    total = 0
    sl_c = 0; tp_c = 0; tm_c = 0; tr_c = 0
    long_t = 0; short_t = 0; long_w = 0; short_w = 0
    peak_pnl = 0.0
    max_dd = 0.0
    consec = 0
    max_consec = 0
    hold_sum = 0
    signals = 0
    
    # 挂单和持仓用固定大小数组（足够大）
    MAX_P = 200  # 最大持仓+挂单
    # pending: dir, price, expire
    p_dir = np.zeros(MAX_P, dtype=np.int32)
    p_price = np.zeros(MAX_P, dtype=np.float64)
    p_expire = np.zeros(MAX_P, dtype=np.int64)
    n_pending = 0
    
    # active: dir, entry, bar, highest, lowest
    a_dir = np.zeros(MAX_P, dtype=np.int32)
    a_entry = np.zeros(MAX_P, dtype=np.float64)
    a_bar = np.zeros(MAX_P, dtype=np.int64)
    a_highest = np.zeros(MAX_P, dtype=np.float64)
    a_lowest = np.zeros(MAX_P, dtype=np.float64)
    n_active = 0
    
    for i in range(warmup, n):
        # === 处理持仓 ===
        new_active = 0
        j = 0
        while j < n_active:
            d = a_dir[j]
            entry = a_entry[j]
            bar = a_bar[j]
            hi = max(a_highest[j], high[i])
            lo = min(a_lowest[j], low[i])
            exited = False
            pnl = 0.0
            
            if d == 1:  # LONG
                if lo <= entry - sl:
                    pnl = -sl; sl_c += 1; exited = True
                elif trailing == 1 and hi >= entry + tp:
                    if lo <= hi * (1.0 - trail_pct / 100.0):
                        pnl = close[i] - entry; tr_c += 1; exited = True
                elif trailing == 0 and hi >= entry + tp:
                    pnl = tp; tp_c += 1; exited = True
                elif i - bar >= max_hold:
                    pnl = close[i] - entry; tm_c += 1; exited = True
            else:  # SHORT
                if hi >= entry + sl:
                    pnl = -sl; sl_c += 1; exited = True
                elif trailing == 1 and lo <= entry - tp:
                    if hi >= lo * (1.0 + trail_pct / 100.0):
                        pnl = entry - close[i]; tr_c += 1; exited = True
                elif trailing == 0 and lo <= entry - tp:
                    pnl = tp; tp_c += 1; exited = True
                elif i - bar >= max_hold:
                    pnl = entry - close[i]; tm_c += 1; exited = True
            
            if exited:
                dollar = pnl * lots * leverage
                total += 1
                total_pnl += dollar
                hold_sum += i - bar
                if dollar > 0:
                    wins += 1; consec = 0
                else:
                    consec += 1
                    if consec > max_consec:
                        max_consec = consec
                if d == 1:
                    long_t += 1
                    if dollar > 0: long_w += 1
                else:
                    short_t += 1
                    if dollar > 0: short_w += 1
                if total_pnl > peak_pnl:
                    peak_pnl = total_pnl
                dd = peak_pnl - total_pnl
                if dd > max_dd:
                    max_dd = dd
            else:
                a_dir[new_active] = d
                a_entry[new_active] = entry
                a_bar[new_active] = bar
                a_highest[new_active] = hi
                a_lowest[new_active] = lo
                new_active += 1
            j += 1
        n_active = new_active
        
        if n_active >= max_pos:
            continue
        
        # === 处理挂单 ===
        new_pending = 0
        j = 0
        while j < n_pending:
            if i >= p_expire[j]:
                j += 1
                continue
            filled = False
            if p_dir[j] == 1 and low[i] <= p_price[j] and n_active < max_pos:
                a_dir[n_active] = 1
                a_entry[n_active] = p_price[j]
                a_bar[n_active] = i
                a_highest[n_active] = p_price[j]
                a_lowest[n_active] = p_price[j]
                n_active += 1
                filled = True
            elif p_dir[j] == -1 and high[i] >= p_price[j] and n_active < max_pos:
                a_dir[n_active] = -1
                a_entry[n_active] = p_price[j]
                a_bar[n_active] = i
                a_highest[n_active] = p_price[j]
                a_lowest[n_active] = p_price[j]
                n_active += 1
                filled = True
            if not filled:
                p_dir[new_pending] = p_dir[j]
                p_price[new_pending] = p_price[j]
                p_expire[new_pending] = p_expire[j]
                new_pending += 1
            j += 1
        n_pending = new_pending
        
        if n_active + n_pending >= max_pos + max_pending:
            continue
        
        # === 信号 ===
        if np.isnan(trend_up[i]) or np.isnan(srsi[i]) or np.isnan(boll_lower[i]):
            continue
        
        if trend_up[i] > 0.5 and low[i] <= boll_lower[i] and srsi[i] <= srsi_l:
            signals += 1
            base = boll_lower[i] - offset
            for k in range(orders_per_signal):
                p2 = base - k * order_spacing
                if p2 > 0 and n_pending < max_pending:
                    p_dir[n_pending] = 1
                    p_price[n_pending] = round(p2, 2)
                    p_expire[n_pending] = i + pend_v
                    n_pending += 1
        
        elif trend_down[i] > 0.5 and high[i] >= boll_upper[i] and srsi[i] >= srsi_u:
            signals += 1
            base = boll_upper[i] + offset
            for k in range(orders_per_signal):
                if n_pending < max_pending:
                    p_dir[n_pending] = -1
                    p_price[n_pending] = round(base + k * order_spacing, 2)
                    p_expire[n_pending] = i + pend_v
                    n_pending += 1
    
    return (total, wins, total_pnl, max_dd, max_consec, hold_sum,
            sl_c, tp_c, tm_c, tr_c, long_t, short_t, long_w, short_w, signals)


def calc_indicators(close, boll_period=30, boll_std=1.5,
                    ema_fast=20, ema_slow=50):
    n = len(close)
    
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
    trend_up = (ema_f > ema_s).astype(float)
    trend_down = (ema_f < ema_s).astype(float)
    
    upper = np.full(n, np.nan)
    lower = np.full(n, np.nan)
    for i in range(boll_period - 1, n):
        w = close[i-boll_period+1:i+1]
        m = np.mean(w)
        s = np.std(w, ddof=0)
        upper[i] = m + boll_std * s
        lower[i] = m - boll_std * s
    
    # StochRSI
    rsi_period = 14; stoch_period = 14; k_smooth = 3
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
        if np.any(np.isnan(w)): continue
        mn, mx = np.min(w), np.max(w)
        stoch[i] = (rsi[i]-mn)/(mx-mn)*100 if mx != mn else 50
    
    srsi = np.full(n, np.nan)
    for i in range(k_smooth-1, n):
        w = stoch[i-k_smooth+1:i+1]
        if not np.any(np.isnan(w)):
            srsi[i] = np.mean(w)
    
    return trend_up, trend_down, upper, lower, srsi


def main():
    candles = json.load(open(DATA_DIR / "xauusdt_1m.json"))
    close = np.array([c["c"] for c in candles], dtype=float)
    high = np.array([c["h"] for c in candles], dtype=float)
    low = np.array([c["l"] for c in candles], dtype=float)
    n = len(close)
    print(f"📊 {n} 条1m K线")
    
    # 预计算指标组合
    print("预计算指标...")
    t0 = time.time()
    ind_cache = {}
    for bp in [25, 30]:
        for bs in [1.5, 2.0, 2.5]:
            ind_cache[(bp,bs)] = calc_indicators(close, bp, bs)
    print(f"  {len(ind_cache)}组指标: {time.time()-t0:.1f}s")
    
    # JIT编译预热
    print("Numba JIT编译...")
    warmup_data = np.random.randn(100).cumsum() + 4500
    _, _, _, _, _ = calc_indicators(warmup_data, 20, 2.0)
    tu_w = np.ones(100); td_w = np.zeros(100)
    bu_w = warmup_data + 10; bl_w = warmup_data - 10; sr_w = np.ones(100) * 50
    _trade_loop(warmup_data, warmup_data+1, warmup_data-1,
                tu_w, td_w, bu_w, bl_w, sr_w,
                0.5, 5.0, 3.0, 120, 15,
                8.0, 97.0, 1, 0.3,
                0.05, 500, 10, 30, 10, 1.0, 80)
    print("  JIT编译完成")
    
    # 搜索
    random.seed(42)
    results = []
    t0 = time.time()
    
    param_grid = {
        "offset": [0.2, 0.5, 1.0],
        "tp": [1.0, 2.0, 3.0, 5.0, 8.0, 10.0],
        "sl": [2.0, 3.0, 5.0, 8.0],
        "trailing": [0, 1],  # 0=False, 1=True
        "trail_pct": [0.1, 0.2, 0.3, 0.5, 1.0],
        "srsi_lower": [3.0, 5.0, 8.0, 10.0],
        "srsi_upper": [85.0, 90.0, 92.0, 95.0, 97.0],
        "lots": [0.01, 0.02, 0.05, 0.1],
        "max_pos": [10, 20, 30, 50],
        "max_pending": [10, 20, 30, 50],
        "orders_per_signal": [5, 10, 15, 20, 30],
        "order_spacing": [0.2, 0.5, 1.0, 2.0],
        "pending_valid": [10, 15, 20, 30],
        "max_hold": [60, 120, 240],
    }
    
    total_space = 1
    for v in param_grid.values():
        total_space *= len(v)
    
    n_tests = min(3000, total_space)
    print(f"参数空间: {total_space:,} | 采样: {n_tests}")
    
    for test_i in range(n_tests):
        bp = random.choice([25, 30])
        bs = random.choice([1.5, 2.0, 2.5])
        trend_up, trend_down, boll_upper, boll_lower, srsi = ind_cache[(bp, bs)]
        
        p = {k: random.choice(v) for k, v in param_grid.items()}
        
        result = _trade_loop(close, high, low,
                             trend_up, trend_down, boll_upper, boll_lower, srsi,
                             p["offset"], p["tp"], p["sl"], p["max_hold"], p["pending_valid"],
                             p["srsi_lower"], p["srsi_upper"], p["trailing"], p["trail_pct"],
                             p["lots"], 500, p["max_pos"], p["max_pending"],
                             p["orders_per_signal"], p["order_spacing"], 100)
        
        total, wins, total_pnl, max_dd, max_consec, hold_sum, \
        sl_c, tp_c, tm_c, tr_c, long_t, short_t, long_w, short_w, sig = result
        
        if total < 30 or total_pnl <= 0:
            continue
        
        wr = wins / total * 100
        dd_pct = max_dd / 10000 * 100
        avg_hold = hold_sum / total
        
        # 简化夏普
        avg_trade = total_pnl / total
        sharpe_approx = avg_trade / (max_dd / total * 2) if total > 0 and max_dd > 0 else 0
        
        score = wr * 0.15 + total_pnl * 0.08 + sharpe_approx * 5 - dd_pct * 0.5 - max_consec * 0.1
        
        results.append((score, {
            "boll": f"{bp}/{bs}", **p,
        }, {
            "total": total, "wins": wins, "wr": round(wr, 1),
            "pnl": round(total_pnl, 2), "dd": round(max_dd, 2),
            "dd_pct": round(dd_pct, 1), "sharpe_approx": round(sharpe_approx, 2),
            "max_consec": int(max_consec), "avg_hold": round(avg_hold),
            "sl": int(sl_c), "tp": int(tp_c), "trail": int(tr_c), "time": int(tm_c),
            "long": int(long_t), "long_w": int(long_w),
            "short": int(short_t), "short_w": int(short_w),
            "signals": int(sig),
        }))
        
        if test_i > 0 and test_i % 500 == 0:
            elapsed = time.time() - t0
            print(f"  [{test_i}/{n_tests}] {elapsed:.0f}s 盈利{len(results)}")
    
    elapsed = time.time() - t0
    print(f"\n✅ {elapsed:.0f}s | {n_tests}测试 | 盈利{len(results)}")
    
    results.sort(key=lambda x: x[0], reverse=True)
    for j, (sc, p, r) in enumerate(results[:15]):
        ts = f'移动TP回撤{p["trail_pct"]}%' if p["trailing"] == 1 else "固定TP"
        print(f'\n#{j+1} score={sc:.1f}')
        print(f'  {r["total"]}笔 | WR={r["wr"]}% | PnL=${r["pnl"]:+,.0f} | 夏普≈{r["sharpe_approx"]}')
        print(f'  最大回撤: ${r["dd"]:,.0f} ({r["dd_pct"]}%) | 连亏{r["max_consec"]}')
        print(f'  均持{r["avg_hold"]}min | 信号{r["signals"]}')
        print(f'  Boll{p["boll"]} TP=${p["tp"]} SL=${p["sl"]} off=${p["offset"]} srsi={p["srsi_lower"]}/{p["srsi_upper"]}')
        print(f'  {ts} | lots={p["lots"]} | max_pos={p["max_pos"]} | pending={p["max_pending"]}')
        print(f'  每信号挂{p["orders_per_signal"]}单 | 间隔${p["order_spacing"]} | 有效{p["pending_valid"]}min')
        lwr = round(r['long_w'] / max(r['long'], 1) * 100)
        swr = round(r['short_w'] / max(r['short'], 1) * 100)
        print(f'  多{r["long"]}({lwr}%) 空{r["short"]}({swr}%) | 出场: sl={r["sl"]} tp={r["tp"]} trail={r["trail"]} time={r["time"]}')
    
    # 保存
    json.dump({"top15_numba": [{"score": sc, "params": p, "result": r} for sc, p, r in results[:15]]},
              open(DATA_DIR / "best_xau_params.json", "w"), indent=2, ensure_ascii=False)
    print(f'\n✅ 保存到 {DATA_DIR / "best_xau_params.json"}')


if __name__ == "__main__":
    main()
