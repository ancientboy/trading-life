"""快速优化：预计算指标，只搜索交易参数"""
import json, math, time, random
import numpy as np
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

def calc_ema_np(arr, period):
    ema = np.empty_like(arr, dtype=float)
    ema[:period] = np.nan
    ema[period-1] = np.mean(arr[:period])
    k = 2.0 / (period + 1)
    for i in range(period, len(arr)):
        ema[i] = arr[i] * k + ema[i-1] * (1 - k)
    return ema

def calc_boll_np(arr, period, std_mult):
    n = len(arr)
    upper = np.full(n, np.nan)
    lower = np.full(n, np.nan)
    for i in range(period-1, n):
        w = arr[i-period+1:i+1]
        m = np.mean(w)
        s = np.std(w, ddof=0)
        upper[i] = m + std_mult * s
        lower[i] = m - std_mult * s
    return upper, lower

def calc_stochrsi_np(closes, rsi_period=14, stoch_period=14, k_smooth=3):
    n = len(closes)
    deltas = np.diff(closes.astype(float))
    gains = np.maximum(deltas, 0)
    losses = np.maximum(-deltas, 0)

    rsi = np.full(n, np.nan)
    avg_g = np.mean(gains[:rsi_period])
    avg_l = np.mean(losses[:rsi_period])
    rsi[rsi_period] = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1 + avg_g / avg_l)

    for i in range(rsi_period, len(gains)):
        avg_g = (avg_g * (rsi_period-1) + gains[i]) / rsi_period
        avg_l = (avg_l * (rsi_period-1) + losses[i]) / rsi_period
        rsi[i+1] = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1 + avg_g / avg_l)

    stoch = np.full(n, np.nan)
    for i in range(stoch_period, n):
        w = rsi[i-stoch_period+1:i+1]
        if np.any(np.isnan(w)):
            continue
        mn, mx = np.min(w), np.max(w)
        stoch[i] = (rsi[i] - mn) / (mx - mn) * 100 if mx != mn else 50.0

    if k_smooth > 1:
        smoothed = np.full(n, np.nan)
        for i in range(k_smooth-1, n):
            w = stoch[i-k_smooth+1:i+1]
            if not np.any(np.isnan(w)):
                smoothed[i] = np.mean(w)
        return smoothed
    return stoch


def fast_backtest(closes, highs, lows,
                  ema_fast, ema_slow,
                  boll_upper, boll_lower,
                  srsi,
                  pending_offset, take_profit, stop_loss,
                  max_hold, pending_valid,
                  srsi_lower, srsi_upper):
    """快速回测 - 返回详细统计"""
    n = len(closes)
    warmup = 100

    total_pnl = 0.0
    wins = 0
    total_trades = 0
    long_wins = 0
    long_total = 0
    short_wins = 0
    short_total = 0
    sl_count = 0
    tp_count = 0
    time_count = 0
    hold_bars_sum = 0

    peak = 0.0
    max_dd = 0.0
    consec = 0
    max_consec = 0

    pending_dir = 0
    pending_price = 0.0
    pending_expire = 0

    active_dir = 0
    active_entry = 0.0
    active_bar = 0

    for i in range(warmup, n):
        # 处理活跃仓位
        if active_dir != 0:
            exited = False
            pnl = 0.0

            if active_dir == 1:  # LONG
                if lows[i] <= active_entry - stop_loss:
                    pnl = -stop_loss; sl_count += 1; exited = True
                elif highs[i] >= active_entry + take_profit:
                    pnl = take_profit; tp_count += 1; exited = True
                elif i - active_bar >= max_hold:
                    pnl = closes[i] - active_entry; time_count += 1; exited = True
            else:  # SHORT
                if highs[i] >= active_entry + stop_loss:
                    pnl = -stop_loss; sl_count += 1; exited = True
                elif lows[i] <= active_entry - take_profit:
                    pnl = take_profit; tp_count += 1; exited = True
                elif i - active_bar >= max_hold:
                    pnl = active_entry - closes[i]; time_count += 1; exited = True

            if exited:
                total_trades += 1
                total_pnl += pnl
                hold_bars_sum += i - active_bar
                if pnl > 0:
                    wins += 1; consec = 0
                else:
                    consec += 1; max_consec = max(max_consec, consec)

                if active_dir == 1:
                    long_total += 1
                    if pnl > 0: long_wins += 1
                else:
                    short_total += 1
                    if pnl > 0: short_wins += 1

                active_dir = 0

                if total_pnl > peak: peak = total_pnl
                dd = peak - total_pnl
                if dd > max_dd: max_dd = dd
                continue

        # 处理挂单
        if pending_dir != 0:
            if i >= pending_expire:
                pending_dir = 0
            elif pending_dir == 1 and lows[i] <= pending_price:
                active_dir = 1; active_entry = pending_price; active_bar = i; pending_dir = 0
            elif pending_dir == -1 and highs[i] >= pending_price:
                active_dir = -1; active_entry = pending_price; active_bar = i; pending_dir = 0
            continue

        if active_dir != 0 or pending_dir != 0:
            continue

        # 信号检测
        if np.isnan(ema_fast[i]) or np.isnan(srsi[i]) or np.isnan(boll_lower[i]):
            continue

        trend_up = ema_fast[i] > ema_slow[i]
        trend_down = ema_fast[i] < ema_slow[i]

        # 上涨趋势 + 触布林下轨 + 超卖 → 挂多
        if trend_up and lows[i] <= boll_lower[i] and srsi[i] <= srsi_lower:
            pending_dir = 1
            pending_price = boll_lower[i] - pending_offset
            pending_expire = i + pending_valid
        # 下跌趋势 + 触布林上轨 + 超买 → 挂空
        elif trend_down and highs[i] >= boll_upper[i] and srsi[i] >= srsi_upper:
            pending_dir = -1
            pending_price = boll_upper[i] + pending_offset
            pending_expire = i + pending_valid

    wr = wins / total_trades * 100 if total_trades > 0 else 0
    avg_hold = hold_bars_sum / total_trades if total_trades > 0 else 0
    l_wr = long_wins / long_total * 100 if long_total > 0 else 0
    s_wr = short_wins / short_total * 100 if short_total > 0 else 0

    return {
        "total_trades": total_trades,
        "wins": wins,
        "win_rate": round(wr, 1),
        "total_pnl": round(total_pnl, 2),
        "max_dd": round(max_dd, 2),
        "max_consec": max_consec,
        "avg_hold_min": round(avg_hold, 0),
        "sl": sl_count, "tp": tp_count, "time": time_count,
        "long": long_total, "long_wr": round(l_wr, 1),
        "short": short_total, "short_wr": round(s_wr, 1),
    }


def main():
    candles = json.load(open(DATA_DIR / "xauusdt_1m.json"))
    closes = np.array([c["c"] for c in candles], dtype=float)
    highs = np.array([c["h"] for c in candles], dtype=float)
    lows = np.array([c["l"] for c in candles], dtype=float)
    n = len(closes)
    print(f"📊 {n} 条1m K线")

    # 预计算指标
    print("预计算指标...")
    t0 = time.time()

    emas = {
        (20, 50): (calc_ema_np(closes, 20), calc_ema_np(closes, 50)),
        (20, 100): (calc_ema_np(closes, 20), calc_ema_np(closes, 100)),
        (30, 50): (calc_ema_np(closes, 30), calc_ema_np(closes, 50)),
    }

    bolls = {}
    for bp in [15, 20, 30, 40]:
        for bs in [1.5, 2.0, 2.5, 3.0]:
            bolls[(bp, bs)] = calc_boll_np(closes, bp, bs)

    srsi = calc_stochrsi_np(closes, 14, 14, 3)

    print(f"指标预计算: {time.time()-t0:.1f}s | {len(bolls)} Boll组合")

    # 搜索空间
    random.seed(42)
    results = []
    best_score = -999
    best = None
    start = time.time()

    for test_i in range(5000):
        ema_key = random.choice(list(emas.keys()))
        ema_f, ema_s = emas[ema_key]

        bp = random.choice([15, 20, 30, 40])
        bs = random.choice([1.5, 2.0, 2.5, 3.0])
        boll_up, boll_lo = bolls[(bp, bs)]

        srsi_l = random.choice([3, 5, 8, 10, 15])
        srsi_u = random.choice([85, 90, 92, 95, 97])

        offset = random.choice([0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.0])
        tp = random.choice([0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0])
        sl = random.choice([0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0])
        max_h = random.choice([15, 30, 60, 90, 120, 180, 240])
        pend_v = random.choice([1, 3, 5, 8, 10, 15, 20])

        r = fast_backtest(closes, highs, lows,
                         ema_f, ema_s, boll_up, boll_lo, srsi,
                         offset, tp, sl, max_h, pend_v,
                         srsi_l, srsi_u)

        if r["total_trades"] < 15 or r["total_pnl"] <= 0:
            continue

        score = (r["win_rate"] * 0.3 +
                 r["total_pnl"] * 2.0 +
                 r["total_trades"] * 0.05 -
                 r["max_dd"] * 0.3)

        params = {
            "ema": f"{ema_key[0]}/{ema_key[1]}",
            "boll": f"{bp}/{bs}",
            "srsi": f"{srsi_l}/{srsi_u}",
            "offset": offset, "tp": tp, "sl": sl,
            "max_hold": max_h, "pending_valid": pend_v,
        }
        results.append((score, params, r))

        if score > best_score:
            best_score = score
            best = (score, params.copy(), r)

    elapsed = time.time() - start
    print(f"\n✅ {elapsed:.0f}s 测试5000组 | 盈利: {len(results)}")

    results.sort(key=lambda x: x[0], reverse=True)

    print(f"\n{'='*60}")
    print(f" Top 10 参数组合")
    print(f"{'='*60}")

    for j, (sc, p, r) in enumerate(results[:10]):
        wr = r["win_rate"]
        pnl = r["total_pnl"]
        dd = r["max_dd"]
        nt = r["total_trades"]
        avg_h = r["avg_hold_min"]
        tp_sl = f"tp={r['tp']}/sl={r['sl']}/time={r['time']}"
        print(f"\n  #{j+1} score={sc:.1f} | {nt}笔 WR={wr:.0f}% PnL=${pnl:+.2f} DD=${dd:.2f} 平均{avg_h:.0f}min")
        print(f"       {p['ema']} EMA | Boll {p['boll']} | SRSI {p['srsi']}")
        print(f"       offset={p['offset']} TP=${p['tp']} SL=${p['sl']} hold={p['max_hold']}min valid={p['pending_valid']}min")
        print(f"       做多{r['long']}笔({r['long_wr']}%) 做空{r['short']}笔({r['short_wr']}%)")
        print(f"       出场: {tp_sl}")

    # 保存最优
    if best:
        _, bp, br = best
        json.dump({"params": bp, "result": br, "top10": [
            {"score": sc, "params": p, "result": r} for sc, p, r in results[:10]
        ]}, open(DATA_DIR / "best_xau_params.json", "w"), indent=2, ensure_ascii=False)
        print(f"\n✅ 保存到 {DATA_DIR / 'best_xau_params.json'}")


if __name__ == "__main__":
    main()
