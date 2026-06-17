"""
XAU布林带挂单策略回测引擎
策略逻辑：
1. 判断大趋势（EMA）
2. 上涨趋势 + 价格触碰布林带下轨 + StochRSI<5 → 挂多单（下轨-价差）
3. 下跌趋势 + 价格触碰布林带上轨 + StochRSI>95 → 挂空单（上轨+价差）
4. 固定止盈止损
"""
import json, math
from pathlib import Path
from itertools import product
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

DATA_DIR = Path(__file__).parent / "data"

@dataclass
class Trade:
    entry_time: int
    entry_price: float
    direction: str  # LONG/SHORT
    exit_time: int = 0
    exit_price: float = 0
    exit_reason: str = ""  # tp/sl/time
    pnl: float = 0
    pnl_pct: float = 0

@dataclass
class BacktestResult:
    trades: List[Trade] = field(default_factory=list)
    total_pnl: float = 0
    win_rate: float = 0
    total_trades: int = 0
    winning_trades: int = 0
    avg_pnl_pct: float = 0
    max_drawdown_pct: float = 0
    sharpe: float = 0
    max_consecutive_losses: int = 0
    avg_hold_bars: float = 0
    params: dict = field(default_factory=dict)


def calc_ema(values, period):
    """计算EMA"""
    if len(values) < period:
        return [None] * len(values)
    ema = [None] * (period - 1)
    ema.append(sum(values[:period]) / period)
    k = 2 / (period + 1)
    for i in range(period, len(values)):
        ema.append(values[i] * k + ema[-1] * (1 - k))
    return ema


def calc_boll(values, period, std_mult):
    """计算布林带"""
    n = len(values)
    mid = [None] * (period - 1)
    upper = [None] * (period - 1)
    lower = [None] * (period - 1)
    for i in range(period - 1, n):
        window = values[i - period + 1:i + 1]
        m = sum(window) / period
        std = math.sqrt(sum((x - m) ** 2 for x in window) / period)
        mid.append(m)
        upper.append(m + std_mult * std)
        lower.append(m - std_mult * std)
    return mid, upper, lower


def calc_stochrsi(closes, rsi_period, stoch_period, k_smooth):
    """计算StochRSI"""
    n = len(closes)
    # RSI
    deltas = [closes[i] - closes[i - 1] for i in range(1, n)]
    gains = [max(d, 0) for d in deltas]
    losses = [abs(min(d, 0)) for d in deltas]
    
    rsi_vals = [None] * n
    if n < rsi_period + 1:
        return [None] * n
    
    avg_gain = sum(gains[:rsi_period]) / rsi_period
    avg_loss = sum(losses[:rsi_period]) / rsi_period
    rsi_vals[rsi_period] = 100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    
    for i in range(rsi_period, len(gains)):
        avg_gain = (avg_gain * (rsi_period - 1) + gains[i]) / rsi_period
        avg_loss = (avg_loss * (rsi_period - 1) + losses[i]) / rsi_period
        rsi_vals[i + 1] = 100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    
    # Stochastic of RSI
    stochrsi_k = [None] * n
    for i in range(rsi_period + stoch_period, n):
        window = [v for v in rsi_vals[i - stoch_period + 1:i + 1] if v is not None]
        if len(window) < stoch_period:
            continue
        mn = min(window)
        mx = max(window)
        if mx == mn:
            stochrsi_k[i] = 50
        else:
            stochrsi_k[i] = (rsi_vals[i] - mn) / (mx - mn) * 100
    
    # K smoothing
    if k_smooth > 1:
        smoothed = [None] * n
        for i in range(n):
            if stochrsi_k[i] is None:
                continue
            window_vals = [stochrsi_k[j] for j in range(max(0, i - k_smooth + 1), i + 1) if stochrsi_k[j] is not None]
            if len(window_vals) >= k_smooth:
                smoothed[i] = sum(window_vals) / len(window_vals)
        return smoothed
    return stochrsi_k


def backtest_xau(
    candles: list,
    # 趋势参数
    trend_ema_fast: int = 20,
    trend_ema_slow: int = 50,
    # 布林带参数
    boll_period: int = 20,
    boll_std: float = 2.0,
    # StochRSI参数
    stochrsi_rsi_period: int = 14,
    stochrsi_stoch_period: int = 14,
    stochrsi_k_smooth: int = 3,
    stochrsi_lower: float = 5.0,   # 做多阈值
    stochrsi_upper: float = 95.0,  # 做空阈值
    # 挂单参数
    pending_offset: float = 0.1,   # 挂单价差（$）
    # 止盈止损
    take_profit: float = 1.0,      # 止盈（$）
    stop_loss: float = 0.5,        # 止损（$）
    # 最大持仓时间（分钟）
    max_hold: int = 120,
    # 挂单有效期（分钟）
    pending_valid: int = 10,
    # 趋势强度过滤
    trend_filter: bool = True,
) -> BacktestResult:
    """
    回测XAU布林带挂单策略
    """
    closes = [c["c"] for c in candles]
    highs = [c["h"] for c in candles]
    lows = [c["l"] for c in candles]
    times = [c["t"] for c in candles]
    n = len(closes)
    
    # 预计算指标
    ema_fast = calc_ema(closes, trend_ema_fast)
    ema_slow = calc_ema(closes, trend_ema_slow)
    boll_mid, boll_upper, boll_lower = calc_boll(closes, boll_period, boll_std)
    srsi = calc_stochrsi(closes, stochrsi_rsi_period, stochrsi_stoch_period, stochrsi_k_smooth)
    
    trades: List[Trade] = []
    pending_order = None  # {direction, price, expire_bar}
    active_trade: Optional[Trade] = None
    
    equity_curve = [0.0]
    peak = 0.0
    max_dd = 0.0
    consec_losses = 0
    max_consec = 0
    
    warmup = max(trend_ema_slow + 20, boll_period + stochrsi_stoch_period + stochrsi_rsi_period)
    
    for i in range(warmup, n):
        # === 处理活跃持仓 ===
        if active_trade:
            bar_low = lows[i]
            bar_high = highs[i]
            
            if active_trade.direction == "LONG":
                # 止损
                if bar_low <= active_trade.entry_price - stop_loss:
                    active_trade.exit_price = active_trade.entry_price - stop_loss
                    active_trade.exit_reason = "sl"
                    active_trade.pnl = -stop_loss
                    active_trade.pnl_pct = -stop_loss / active_trade.entry_price * 100
                # 止盈
                elif bar_high >= active_trade.entry_price + take_profit:
                    active_trade.exit_price = active_trade.entry_price + take_profit
                    active_trade.exit_reason = "tp"
                    active_trade.pnl = take_profit
                    active_trade.pnl_pct = take_profit / active_trade.entry_price * 100
                # 超时
                elif i - active_trade.entry_time >= max_hold:
                    active_trade.exit_price = closes[i]
                    active_trade.exit_reason = "time"
                    active_trade.pnl = closes[i] - active_trade.entry_price
                    active_trade.pnl_pct = active_trade.pnl / active_trade.entry_price * 100
            else:  # SHORT
                # 止损
                if bar_high >= active_trade.entry_price + stop_loss:
                    active_trade.exit_price = active_trade.entry_price + stop_loss
                    active_trade.exit_reason = "sl"
                    active_trade.pnl = -stop_loss
                    active_trade.pnl_pct = -stop_loss / active_trade.entry_price * 100
                # 止盈
                elif bar_low <= active_trade.entry_price - take_profit:
                    active_trade.exit_price = active_trade.entry_price - take_profit
                    active_trade.exit_reason = "tp"
                    active_trade.pnl = take_profit
                    active_trade.pnl_pct = take_profit / active_trade.entry_price * 100
                # 超时
                elif i - active_trade.entry_time >= max_hold:
                    active_trade.exit_price = closes[i]
                    active_trade.exit_reason = "time"
                    active_trade.pnl = active_trade.entry_price - closes[i]
                    active_trade.pnl_pct = active_trade.pnl / active_trade.entry_price * 100
            
            if active_trade.exit_reason:
                active_trade.exit_time = i
                trades.append(active_trade)
                
                equity_curve.append(equity_curve[-1] + active_trade.pnl)
                peak = max(peak, equity_curve[-1])
                dd = (peak - equity_curve[-1]) / max(peak, 0.01) * 100
                max_dd = max(max_dd, dd)
                
                if active_trade.pnl < 0:
                    consec_losses += 1
                    max_consec = max(max_consec, consec_losses)
                else:
                    consec_losses = 0
                
                active_trade = None
        
        # === 处理挂单 ===
        if pending_order and not active_trade:
            if i >= pending_order["expire_bar"]:
                pending_order = None  # 过期
            else:
                # 检查是否成交
                if pending_order["direction"] == "LONG":
                    if lows[i] <= pending_order["price"]:
                        active_trade = Trade(
                            entry_time=i,
                            entry_price=pending_order["price"],
                            direction="LONG"
                        )
                        pending_order = None
                else:  # SHORT
                    if highs[i] >= pending_order["price"]:
                        active_trade = Trade(
                            entry_time=i,
                            entry_price=pending_order["price"],
                            direction="SHORT"
                        )
                        pending_order = None
        
        # === 有持仓就不下新单 ===
        if active_trade or pending_order:
            continue
        
        # === 信号检测 ===
        if ema_fast[i] is None or ema_slow[i] is None:
            continue
        if boll_upper[i] is None or srsi[i] is None:
            continue
        
        trend = "up" if ema_fast[i] > ema_slow[i] else "down"
        
        # 上涨趋势 + 触碰布林下轨 + StochRSI超卖 → 挂多单
        if trend == "up" and lows[i] <= boll_lower[i]:
            if srsi[i] <= stochrsi_lower:
                buy_price = boll_lower[i] - pending_offset
                pending_order = {
                    "direction": "LONG",
                    "price": buy_price,
                    "expire_bar": i + pending_valid,
                }
                continue
        
        # 下跌趋势 + 触碰布林上轨 + StochRSI超买 → 挂空单
        if (not trend_filter or trend == "down") and highs[i] >= boll_upper[i]:
            if srsi[i] >= stochrsi_upper:
                sell_price = boll_upper[i] + pending_offset
                pending_order = {
                    "direction": "SHORT",
                    "price": sell_price,
                    "expire_bar": i + pending_valid,
                }
                continue
    
    # === 统计结果 ===
    result = BacktestResult(trades=trades, params=locals())
    if not trades:
        return result
    
    result.total_trades = len(trades)
    result.winning_trades = sum(1 for t in trades if t.pnl > 0)
    result.win_rate = result.winning_trades / result.total_trades * 100
    result.total_pnl = sum(t.pnl for t in trades)
    result.avg_pnl_pct = sum(t.pnl_pct for t in trades) / len(trades)
    result.max_drawdown_pct = max_dd
    result.max_consecutive_losses = max_consec
    result.avg_hold_bars = sum(t.exit_time - t.entry_time for t in trades) / len(trades)
    
    # Sharpe (简化)
    pnls = [t.pnl for t in trades]
    if len(pnls) > 1:
        avg_p = sum(pnls) / len(pnls)
        std_p = math.sqrt(sum((p - avg_p) ** 2 for p in pnls) / (len(pnls) - 1))
        result.sharpe = avg_p / std_p * math.sqrt(252 * 24 * 60) if std_p > 0 else 0  # 年化
    
    return result


def print_result(r: BacktestResult, label=""):
    print(f"\n{'='*50}")
    print(f" {label}")
    print(f"{'='*50}")
    print(f"  总交易: {r.total_trades}")
    print(f"  胜率: {r.win_rate:.1f}%")
    print(f"  总PnL: ${r.total_pnl:+.2f}")
    print(f"  均PnL: {r.avg_pnl_pct:+.3f}%")
    print(f"  最大回撤: {r.max_drawdown_pct:.1f}%")
    print(f"  最大连亏: {r.max_consecutive_losses}")
    print(f"  平均持仓: {r.avg_hold_bars:.0f}分钟")
    
    # 出场原因统计
    exits = {}
    for t in r.trades:
        exits[t.exit_reason] = exits.get(t.exit_reason, 0) + 1
    print(f"  出场: ", end="")
    print(" | ".join(f"{k}={v}" for k, v in sorted(exits.items())))
    
    # 做多做空分开
    longs = [t for t in r.trades if t.direction == "LONG"]
    shorts = [t for t in r.trades if t.direction == "SHORT"]
    if longs:
        lw = sum(1 for t in longs if t.pnl > 0)
        print(f"  做多: {len(longs)}笔 胜率{lw/len(longs)*100:.0f}% PnL${sum(t.pnl for t in longs):+.2f}")
    if shorts:
        sw = sum(1 for t in shorts if t.pnl > 0)
        print(f"  做空: {len(shorts)}笔 胜率{sw/len(shorts)*100:.0f}% PnL${sum(t.pnl for t in shorts):+.2f}")


def optimize_params(candles, quick=True):
    """网格搜索最优参数"""
    print("\n🔍 开始参数优化...")
    
    if quick:
        param_grid = {
            "boll_period": [15, 20, 25, 30],
            "boll_std": [1.5, 2.0, 2.5, 3.0],
            "stochrsi_lower": [3, 5, 8, 10],
            "stochrsi_upper": [90, 92, 95, 97],
            "pending_offset": [0.01, 0.05, 0.1, 0.2, 0.3],
            "take_profit": [0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0],
            "stop_loss": [0.3, 0.5, 0.8, 1.0, 1.5],
            "max_hold": [30, 60, 120, 180],
            "pending_valid": [3, 5, 10, 15],
        }
    else:
        param_grid = {
            "boll_period": [10, 15, 20, 25, 30, 40],
            "boll_std": [1.0, 1.5, 2.0, 2.5, 3.0],
            "stochrsi_lower": [2, 3, 5, 8, 10, 15],
            "stochrsi_upper": [85, 90, 92, 95, 97, 98],
            "pending_offset": [0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5],
            "take_profit": [0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0],
            "stop_loss": [0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0],
            "max_hold": [15, 30, 60, 90, 120, 180, 240],
            "pending_valid": [1, 3, 5, 8, 10, 15, 20],
        }
    
    # 采样搜索（不穷举全部组合）
    import random
    keys = list(param_grid.keys())
    total_combos = 1
    for v in param_grid.values():
        total_combos *= len(v)
    
    max_tests = min(5000, total_combos)
    print(f"  参数空间: {total_combos} 组合, 采样 {max_tests}")
    
    best_score = -999
    best_result = None
    best_params = None
    
    for test_i in range(max_tests):
        params = {k: random.choice(v) for k, v in param_grid.items()}
        params["trend_filter"] = True
        
        r = backtest_xau(candles, **params)
        
        if r.total_trades < 10:  # 太少交易没意义
            continue
        
        # 综合评分：胜率*权重 + PnL*权重 - 回撤*权重
        score = (r.win_rate * 0.3 + 
                 min(r.total_pnl, 50) * 2 + 
                 r.total_trades * 0.1 - 
                 r.max_drawdown_pct * 0.5 +
                 r.sharpe * 0.5)
        
        if score > best_score:
            best_score = score
            best_result = r
            best_params = params.copy()
            if test_i % 500 == 0 or test_i == max_tests - 1:
                print(f"  [{test_i}/{max_tests}] 新最优: score={score:.1f} trades={r.total_trades} WR={r.win_rate:.0f}% PnL=${r.total_pnl:+.2f}")
    
    return best_result, best_params


if __name__ == "__main__":
    import sys
    
    # 加载数据
    data_file = DATA_DIR / "xauusdt_1m.json"
    candles = json.load(open(data_file))
    print(f"📊 加载 {len(candles)} 条1m K线")
    
    mode = sys.argv[1] if len(sys.argv) > 1 else "baseline"
    
    if mode == "baseline":
        # 基线参数（用户手动交易的经验值）
        result = backtest_xau(
            candles,
            boll_period=20, boll_std=2.0,
            stochrsi_lower=5, stochrsi_upper=95,
            pending_offset=0.1,
            take_profit=1.0, stop_loss=0.5,
            max_hold=120, pending_valid=10,
        )
        print_result(result, "基线参数（手动交易经验值）")
    
    elif mode == "optimize":
        result, params = optimize_params(candles, quick=False)
        if result:
            print_result(result, "最优参数")
            print(f"\n📋 最优参数:")
            for k, v in sorted(params.items()):
                print(f"  {k}: {v}")
            
            # 保存
            out = DATA_DIR / "best_xau_params.json"
            json.dump({"params": params, "score": {
                "trades": result.total_trades,
                "win_rate": result.win_rate,
                "total_pnl": result.total_pnl,
                "max_dd": result.max_drawdown_pct,
                "sharpe": result.sharpe,
            }}, open(out, "w"), indent=2)
            print(f"\n✅ 保存到 {out}")
    
    elif mode == "quick":
        result, params = optimize_params(candles, quick=True)
        if result:
            print_result(result, "快速优化最优")
            print(f"\n📋 参数:")
            for k, v in sorted(params.items()):
                print(f"  {k}: {v}")
