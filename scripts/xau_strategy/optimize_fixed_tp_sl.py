"""
XAU布林带策略 - 中轨开仓 + 固定止盈止损 参数优化
逻辑：
  - 上涨趋势 + 价格在中轨下方 + SRSI超卖 → 分单挂多单
  - 下跌趋势 + 价格在中轨上方 + SRSI超买 → 分单挂空单
  - 纯固定 TP/SL，无 trailing
"""
import json, time, math
import numpy as np
from pathlib import Path
from itertools import product

DATA_DIR = Path(__file__).parent / "data"


def load_data():
    candles = json.load(open(DATA_DIR / "xauusdt_1m.json"))
    return {
        "open": np.array([c["o"] for c in candles], dtype=float),
        "high": np.array([c["h"] for c in candles], dtype=float),
        "low": np.array([c["l"] for c in candles], dtype=float),
        "close": np.array([c["c"] for c in candles], dtype=float),
        "volume": np.array([c["v"] for c in candles], dtype=float),
    }


def calc_indicators(close, boll_period=30, boll_std=1.5, ema_fast=20, ema_slow=50,
                    rsi_period=14, stoch_period=14, k_smooth=3):
    n = len(close)

    # EMA
    def ema(arr, p):
        e = np.empty(n, dtype=float)
        e[:p] = np.nan
        e[p-1] = np.mean(arr[:p])
        k = 2.0 / (p + 1)
        for i in range(p, n):
            e[i] = arr[i] * k + e[i-1] * (1 - k)
        return e

    ema_f = ema(close, ema_fast)
    ema_s = ema(close, ema_slow)

    # Bollinger
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
    srsi = np.full(n, np.nan)
    for i in range(k_smooth-1, n):
        w = stoch[i-k_smooth+1:i+1]
        if not np.any(np.isnan(w)):
            srsi[i] = np.mean(w)

    return {
        "ema_f": ema_f, "ema_s": ema_s,
        "trend_up": ema_f > ema_s,
        "trend_down": ema_f < ema_s,
        "boll_mid": mid, "boll_upper": upper, "boll_lower": lower,
        "srsi": srsi,
    }


def backtest(data, tp, sl, boll_period=30, boll_std=1.5,
             srsi_lower=8, srsi_upper=97,
             lots=5.0, max_pos=30, max_pending=30,
             orders_per_signal=15, order_spacing=1.0,
             pending_valid=20, max_hold=240, offset=0.1):
    """纯固定止盈止损回测"""
    close = data["close"]
    high = data["high"]
    low = data["low"]
    n = len(close)
    warmup = 100

    ind = calc_indicators(close, boll_period, boll_std)
    trend_up = ind["trend_up"]
    trend_down = ind["trend_down"]
    boll_mid = ind["boll_mid"]
    boll_lower = ind["boll_lower"]
    boll_upper = ind["boll_upper"]
    srsi = ind["srsi"]

    total_pnl = 0.0
    wins = 0
    total = 0
    sl_c = tp_c = tm_c = 0
    long_t = short_t = long_w = short_w = 0
    peak_pnl = 0.0
    max_dd = 0.0
    consec = 0
    max_consec = 0
    hold_sum = 0
    signals = 0
    trade_pnls = []
    equity_curve = []

    pending = []
    active = []

    for i in range(warmup, n):
        # === 处理持仓（固定TP/SL）===
        new_active = []
        for pos in active:
            d = pos["dir"]
            entry = pos["entry"]
            bar = pos["bar"]
            exited = False
            pnl = 0.0

            if d == 1:  # LONG
                raw = close[i] - entry
                # 先检查止盈（优先止盈）
                if high[i] >= entry + tp:
                    pnl = tp; tp_c += 1; exited = True
                elif low[i] <= entry - sl:
                    pnl = -sl; sl_c += 1; exited = True
                elif i - bar >= max_hold:
                    pnl = close[i] - entry; tm_c += 1; exited = True
            else:  # SHORT
                if low[i] <= entry - tp:
                    pnl = tp; tp_c += 1; exited = True
                elif high[i] >= entry + sl:
                    pnl = -sl; sl_c += 1; exited = True
                elif i - bar >= max_hold:
                    pnl = entry - close[i]; tm_c += 1; exited = True

            if exited:
                dollar = pnl * lots
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
                new_active.append(pos)
        active = new_active

        # === 处理挂单成交 ===
        new_pending = []
        for order in pending:
            if i >= order["expire"]:
                continue
            filled = False
            if order["dir"] == 1 and low[i] <= order["price"] and len(active) < max_pos:
                active.append({"dir": 1, "entry": order["price"], "bar": i})
                filled = True
            elif order["dir"] == -1 and high[i] >= order["price"] and len(active) < max_pos:
                active.append({"dir": -1, "entry": order["price"], "bar": i})
                filled = True
            if not filled:
                new_pending.append(order)
        pending = new_pending

        if len(active) + len(pending) >= max_pos + max_pending:
            continue

        # === 信号（中轨开仓）===
        if np.isnan(boll_mid[i]) or np.isnan(srsi[i]):
            continue

        # 做多：趋势向上 + 价格在中轨下方 + SRSI超卖
        if trend_up[i] and close[i] < boll_mid[i] and srsi[i] <= srsi_lower:
            signals += 1
            base = close[i] - offset
            for k in range(orders_per_signal):
                p2 = round(base - k * order_spacing, 2)
                if p2 > 0 and len(pending) < max_pending:
                    pending.append({"dir": 1, "price": p2, "expire": i + pending_valid})

        # 做空：趋势向下 + 价格在中轨上方 + SRSI超买
        elif trend_down[i] and close[i] > boll_mid[i] and srsi[i] >= srsi_upper:
            signals += 1
            base = close[i] + offset
            for k in range(orders_per_signal):
                if len(pending) < max_pending:
                    pending.append({"dir": -1, "price": round(base + k * order_spacing, 2),
                                    "expire": i + pending_valid})

    if total < 10:
        return None

    wr = wins / total * 100
    dd_pct = max_dd / 10000 * 100 if 10000 > 0 else 0
    avg_hold = hold_sum / total if total > 0 else 0

    sharpe = 0
    if len(trade_pnls) > 2:
        arr = np.array(trade_pnls)
        if np.std(arr) > 0:
            sharpe = float(np.mean(arr) / np.std(arr) * np.sqrt(252 * 24 * 60))

    # 盈亏比
    win_pnls = [p for p in trade_pnls if p > 0]
    lose_pnls = [p for p in trade_pnls if p < 0]
    avg_win = np.mean(win_pnls) if win_pnls else 0
    avg_loss = abs(np.mean(lose_pnls)) if lose_pnls else 1
    profit_factor = avg_win / avg_loss if avg_loss > 0 else 0

    return {
        "total": total, "wins": wins, "wr": round(wr, 1),
        "pnl": round(total_pnl, 2),
        "dd": round(max_dd, 2), "dd_pct": round(dd_pct, 1),
        "sharpe": round(sharpe, 2),
        "max_consec": max_consec,
        "avg_hold": round(avg_hold),
        "sl": sl_c, "tp": tp_c, "time": tm_c,
        "long": long_t, "long_w": long_w,
        "short": short_t, "short_w": short_w,
        "signals": signals,
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "profit_factor": round(profit_factor, 2),
    }


if __name__ == "__main__":
    print("📊 加载数据...")
    data = load_data()
    print(f"  {len(data['close'])} 条1m K线")

    # 核心：扫 TP/SL 参数空间
    tp_range = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0]
    sl_range = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0]

    results = []
    t0 = time.time()

    print(f"\n🔍 扫描 TP×SL = {len(tp_range)}×{len(sl_range)} = {len(tp_range)*len(sl_range)} 组")
    print(f"   固定: boll=30/1.5, srsi=8/97, lots=5, max_pos=30, 15单/信号, spacing=$1\n")

    for tp in tp_range:
        for sl in sl_range:
            r = backtest(data, tp=tp, sl=sl)
            if r is None:
                continue

            # 综合评分：胜率 + 盈利 + 夏普 - 回撤 - 连亏
            score = (r["wr"] * 0.2 +
                     r["pnl"] / 100 * 0.3 +
                     r["sharpe"] * 5 +
                     r["profit_factor"] * 10 -
                     r["dd_pct"] * 0.3 -
                     r["max_consec"] * 0.1)

            results.append((score, tp, sl, r))

    elapsed = time.time() - t0
    print(f"✅ {elapsed:.0f}s | {len(results)} 组盈利\n")

    results.sort(key=lambda x: x[0], reverse=True)

    print("=" * 90)
    print(f"{'#':>2} {'TP':>5} {'SL':>5} | {'笔数':>5} {'胜率':>6} {'PnL':>10} {'PF':>5} "
          f"{'回撤%':>6} {'连亏':>4} {'均持min':>7} {'SL':>5} {'TP':>5} {'Time':>5} {'信号':>5}")
    print("-" * 90)

    for j, (sc, tp, sl, r) in enumerate(results[:30]):
        print(f"{j+1:2d} ${tp:4.1f} ${sl:4.1f} | {r['total']:5d} {r['wr']:5.1f}% "
              f"${r['pnl']:+10,.0f} {r['profit_factor']:5.2f} "
              f"{r['dd_pct']:5.1f}% {r['max_consec']:4d} {r['avg_hold']:7.0f} "
              f"{r['sl']:5d} {r['tp']:5d} {r['time']:5d} {r['signals']:5d}")

    # 保存结果
    out = {
        "strategy": "中轨开仓+固定TP/SL",
        "params_fixed": {
            "boll": "30/1.5", "srsi": "8/97", "lots": 5, "max_pos": 30,
            "orders_per_signal": 15, "order_spacing": 1.0,
            "pending_valid": 20, "max_hold": 240,
        },
        "results": [{
            "rank": j+1, "score": round(sc, 1),
            "tp": tp, "sl": sl,
            **r
        } for j, (sc, tp, sl, r) in enumerate(results[:50])]
    }
    out_path = DATA_DIR / "fixed_tp_sl_optimize.json"
    json.dump(out, open(out_path, "w"), indent=2, ensure_ascii=False)
    print(f"\n💾 保存到 {out_path}")
