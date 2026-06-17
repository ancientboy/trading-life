"""
回测引擎 v1.0

用历史K线数据验证现有策略效果。
不改动现有系统代码，独立运行。

用法：
  python3 backtest.py --symbol BTCUSDT --days 90 --strategy altcoin
  python3 backtest.py --symbol ETHUSDT --days 180 --strategy major
  python3 backtest.py --top 20 --days 60 --strategy altcoin
"""

import ccxt
import json
import argparse
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional
from pathlib import Path

# 添加路径以复用现有分析模块
import sys
sys.path.insert(0, str(Path(__file__).parent))

from analyst_tech import (
    calc_stochrsi, check_stochrsi_entry, check_multi_timeframe_stochrsi,
    detect_breakout_setup, detect_volume_divergence, detect_trend_exhaustion,
    calc_atr, calc_ema, detect_candle_pattern, check_ema_alignment,
    analyze_trend, find_entry_point,
)
from prelaunch_detector import detect_prelaunch_signals

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger("Backtest")

# ============================================
# 数据获取
# ============================================

class DataLoader:
    """从Binance拉取历史K线"""
    
    def __init__(self):
        self.exchange = ccxt.binance({
            'enableRateLimit': True,
            'options': {'defaultType': 'future'},
        })
        self.cache_dir = Path(__file__).parent / 'data' / 'backtest_cache'
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def _cache_path(self, symbol: str, interval: str, start: str, end: str) -> Path:
        return self.cache_dir / f"{symbol}_{interval}_{start}_{end}.json"
    
    def fetch_klines(self, symbol: str, interval: str, days: int) -> List[dict]:
        """拉取历史K线，带缓存"""
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=days)
        start_str = since.strftime('%Y%m%d')
        end_str = now.strftime('%Y%m%d')
        
        cache = self._cache_path(symbol, interval, start_str, end_str)
        if cache.exists():
            logger.info(f"  缓存命中: {cache.name}")
            return json.load(open(cache))
        
        logger.info(f"  拉取 {symbol} {interval} 最近{days}天...")
        all_klines = []
        
        since_ms = int(since.timestamp() * 1000)
        limit = 1500
        
        while True:
            klines = self.exchange.fetch_ohlcv(
                symbol, interval, since=since_ms, limit=limit
            )
            if not klines:
                break
            
            for k in klines:
                all_klines.append({
                    'open_time': k[0],
                    'open': str(k[1]),
                    'high': str(k[2]),
                    'low': str(k[3]),
                    'close': str(k[4]),
                    'volume': str(k[5]),
                })
            
            since_ms = klines[-1][0] + 1
            
            if len(klines) < limit:
                break
            
            time.sleep(0.5)
        
        # 缓存
        json.dump(all_klines, open(cache, 'w'))
        logger.info(f"  缓存到: {cache.name} ({len(all_klines)}条)")
        return all_klines


# ============================================
# 信号检测器（复用现有逻辑）
# ============================================

class SignalDetector:
    """在回测中检测信号，复用现有策略逻辑"""
    
    def __init__(self, strategy: str = "altcoin"):
        self.strategy = strategy
    
    def detect_prelaunch(self, klines_4h: List[dict], symbol: str) -> dict:
        """检测启动前信号"""
        return detect_prelaunch_signals(
            klines_4h=klines_4h,
            symbol=symbol,
            oi_change=0,  # 回测中无链上数据
            funding_rate=0,
            long_short_ratio=0,
        )
    
    def detect_breakout(self, klines_15m: List[dict], klines_1h: List[dict] = None) -> dict:
        """检测突破信号"""
        return detect_breakout_setup(klines_15m, klines_1h)
    
    def check_stochrsi(self, direction: str, klines: List[dict]) -> dict:
        """检查StochRSI入场条件"""
        return check_stochrsi_entry(direction, calc_stochrsi(klines))
    
    def check_multi_stochrsi(self, direction: str, klines_dict: dict) -> dict:
        """多周期StochRSI确认"""
        return check_multi_timeframe_stochrsi(direction, klines_dict)
    
    def detect_divergence(self, klines: List[dict], direction: str) -> dict:
        """检测量价背离"""
        return detect_volume_divergence(klines, direction)
    
    def get_trend(self, klines_by_interval: dict) -> dict:
        """获取趋势判断"""
        return analyze_trend(klines_by_interval)


# ============================================
# 回测引擎
# ============================================

class BacktestEngine:
    """回测引擎"""
    
    def __init__(self, strategy: str = "altcoin", leverage: int = 10,
                 risk_pct: float = 0.03, initial_capital: float = 10000):
        self.strategy = strategy
        self.leverage = leverage
        self.risk_pct = risk_pct
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.detector = SignalDetector(strategy)
        self.loader = DataLoader()
        
        # 交易记录
        self.trades = []
        self.positions = {}  # symbol -> {entry, direction, size, stop_loss}
        
        # 统计
        self.stats = {
            "total_signals": 0,
            "entries": 0,
            "wins": 0,
            "losses": 0,
            "total_pnl": 0,
            "max_drawdown": 0,
            "peak_capital": initial_capital,
        }
    
    @staticmethod
    def _ensure_numeric(klines: List[dict]) -> List[dict]:
        """确保K线数据中的价格/成交量是float类型"""
        result = []
        for k in klines:
            nk = dict(k)
            for field in ('open', 'high', 'low', 'close', 'volume'):
                if field in nk and isinstance(nk[field], str):
                    nk[field] = float(nk[field])
            result.append(nk)
        return result
    
    def _get_klines_window(self, klines: List[dict], end_idx: int, count: int) -> List[dict]:
        """获取K线窗口"""
        start = max(0, end_idx - count)
        return self._ensure_numeric(klines[start:end_idx])
    
    def _simulate_sl_tp(self, entry_price: float, direction: str, 
                         klines_after: List[dict], atr: float,
                         max_bars: int = 60) -> dict:
        """
        模拟止盈止损
        使用结构破位止盈 + ATR止损
        
        Returns: {exit_price, pnl_pct, bars_held, exit_reason}
        """
        # 止损：1.5x ATR
        if direction == "LONG":
            stop_loss = entry_price - 1.5 * atr
        else:
            stop_loss = entry_price + 1.5 * atr
        
        # 追踪EMA20作为止盈参考
        closes_so_far = []
        
        for i, k in enumerate(klines_after[:max_bars]):
            c = float(k['close'])
            h = float(k['high'])
            l = float(k['low'])
            closes_so_far.append(c)
            
            # 检查止损
            if direction == "LONG" and l <= stop_loss:
                return {
                    "exit_price": stop_loss,
                    "pnl_pct": (stop_loss - entry_price) / entry_price * 100,
                    "bars_held": i + 1,
                    "exit_reason": "stop_loss"
                }
            elif direction == "SHORT" and h >= stop_loss:
                return {
                    "exit_price": stop_loss,
                    "pnl_pct": (entry_price - stop_loss) / entry_price * 100,
                    "bars_held": i + 1,
                    "exit_reason": "stop_loss"
                }
            
            # 结构破位止盈：至少持有5根K线后检查
            if i >= 5 and len(closes_so_far) >= 20:
                ema20 = calc_ema(closes_so_far, 20)
                
                if direction == "LONG":
                    # 放量破EMA20 → 止盈
                    vol = float(k.get('volume', 0))
                    avg_vol = sum(float(x.get('volume', 0)) for x in klines_after[max(0,i-20):i]) / min(20, i+1)
                    if c < ema20 and vol > avg_vol * 1.2:
                        return {
                            "exit_price": c,
                            "pnl_pct": (c - entry_price) / entry_price * 100,
                            "bars_held": i + 1,
                            "exit_reason": "structure_break"
                        }
                elif direction == "SHORT":
                    vol = float(k.get('volume', 0))
                    avg_vol = sum(float(x.get('volume', 0)) for x in klines_after[max(0,i-20):i]) / min(20, i+1)
                    if c > ema20 and vol > avg_vol * 1.2:
                        return {
                            "exit_price": c,
                            "pnl_pct": (entry_price - c) / entry_price * 100,
                            "bars_held": i + 1,
                            "exit_reason": "structure_break"
                        }
            
            # 超时强制平仓
            if i == max_bars - 1:
                pnl = (c - entry_price) / entry_price * 100 if direction == "LONG" \
                      else (entry_price - c) / entry_price * 100
                return {
                    "exit_price": c,
                    "pnl_pct": pnl,
                    "bars_held": i + 1,
                    "exit_reason": "timeout"
                }
        
        return {"exit_price": entry_price, "pnl_pct": 0, "bars_held": 0, "exit_reason": "no_data"}
    
    def run_single(self, symbol: str, days: int):
        """对单个币种回测"""
        logger.info(f"\n{'='*60}")
        logger.info(f"回测 {symbol} | 策略={self.strategy} | 最近{days}天")
        logger.info(f"{'='*60}")
        
        # 拉取4h K线（主信号）
        klines_4h = self.loader.fetch_klines(symbol, '4h', days)
        # 拉取15m K线（入场时机）
        klines_15m = self._ensure_numeric(self.loader.fetch_klines(symbol, '15m', min(days, 30)))
        
        if len(klines_4h) < 50:
            logger.warning(f"K线数据不足: {len(klines_4h)}条")
            return
        
        # 从第30根开始（前面用于指标计算）
        start_bar = 30
        signals_found = []
        
        for i in range(start_bar, len(klines_4h)):
            window_4h = self._get_klines_window(klines_4h, i, 50)
            current_price = float(window_4h[-1]['close'])
            timestamp = datetime.fromtimestamp(
                int(window_4h[-1]['open_time']) / 1000, tz=timezone.utc
            )
            
            # ===== 信号检测 =====
            
            # 1. Prelaunch信号（山寨币策略）
            if self.strategy in ("altcoin", "newcoin"):
                pl = self.detector.detect_prelaunch(window_4h, symbol)
                
                if pl['score'] >= 60:
                    self.stats["total_signals"] += 1
                    
                    # 检查StochRSI确认
                    stoch = self.detector.check_stochrsi("LONG", window_4h)
                    multi_stoch = self.detector.check_multi_stochrsi("LONG", {"4h": window_4h})
                    
                    signal = {
                        "timestamp": timestamp.isoformat(),
                        "price": current_price,
                        "type": "prelaunch",
                        "score": pl['score'],
                        "phase": pl.get('phase', ''),
                        "stochrsi_ok": stoch.get('ok', False),
                        "multi_stochrsi_ok": multi_stoch.get('ok', False),
                        "detail": pl.get('detail', ''),
                    }
                    signals_found.append(signal)
            
            # 2. 突破信号
            # 找对应15m窗口
            bar_time_ms = int(window_4h[-1]['open_time'])
            klines_15m_before = [k for k in klines_15m 
                                 if int(k['open_time']) < bar_time_ms + 14400000]  # 4h
            klines_15m_window = self._ensure_numeric(
                klines_15m_before[-96:] if len(klines_15m_before) >= 96 else klines_15m_before
            )
            
            if len(klines_15m_window) >= 30:
                breakout = self.detector.detect_breakout(klines_15m_window)
                if breakout.get('detected'):
                    self.stats["total_signals"] += 1
                    
                    direction = breakout.get('direction', 'LONG')
                    signal = {
                        "timestamp": timestamp.isoformat(),
                        "price": current_price,
                        "type": "breakout",
                        "score": 50 + breakout.get('strength', 0) * 10,
                        "direction": direction,
                        "detail": breakout.get('type', ''),
                    }
                    signals_found.append(signal)
            
            # ===== 模拟交易 =====
            # 只模拟评分>=阈值的信号
            for sig in signals_found[-1:]:  # 只处理最新的信号
                if sig['score'] < 50:
                    continue
                
                direction = sig.get('direction', 'LONG')
                
                # 计算ATR
                atr = calc_atr(window_4h)
                if atr <= 0 or current_price <= 0:
                    continue
                
                # 模拟后续走势
                remaining_klines = klines_4h[i+1:]
                if not remaining_klines:
                    continue
                
                result = self._simulate_sl_tp(
                    current_price, direction, remaining_klines, atr
                )
                
                # 固定仓位大小（不复利），每笔用初始资金的risk_pct
                position_value = self.initial_capital * self.risk_pct * self.leverage
                pnl_dollar = position_value * result['pnl_pct'] / 100
                
                trade = {
                    "symbol": symbol,
                    "entry_time": sig['timestamp'],
                    "entry_price": current_price,
                    "direction": direction,
                    "signal_type": sig['type'],
                    "signal_score": sig['score'],
                    "leverage": self.leverage,
                    "exit_price": result['exit_price'],
                    "exit_reason": result['exit_reason'],
                    "pnl_pct": round(result['pnl_pct'], 2),
                    "pnl_dollar": round(pnl_dollar, 2),
                    "bars_held": result['bars_held'],
                    "capital_after": round(self.capital + pnl_dollar, 2),
                }
                self.trades.append(trade)
                self.capital += pnl_dollar
                
                if pnl_dollar > 0:
                    self.stats["wins"] += 1
                else:
                    self.stats["losses"] += 1
                self.stats["entries"] += 1
                self.stats["total_pnl"] += pnl_dollar
                
                # 更新最大回撤
                if self.capital > self.stats["peak_capital"]:
                    self.stats["peak_capital"] = self.capital
                dd = (self.stats["peak_capital"] - self.capital) / self.stats["peak_capital"] * 100
                if dd > self.stats["max_drawdown"]:
                    self.stats["max_drawdown"] = round(dd, 2)
                
                # 避免重复入场，跳过这个窗口
                break
        
        return signals_found
    
    def run_top(self, top_n: int, days: int):
        """回测成交额前N的币种"""
        logger.info(f"获取成交额Top{top_n}币种...")
        
        exchange = ccxt.binance({
            'enableRateLimit': True,
            'options': {'defaultType': 'future'},
        })
        
        tickers = exchange.fetch_tickers()
        candidates = []
        for sym, t in tickers.items():
            if sym.endswith('/USDT:USDT'):
                vol = t.get('quoteVolume', 0) or 0
                if vol > 10_000_000:
                    candidates.append((sym.replace('/USDT:USDT', 'USDT'), vol))
        
        candidates.sort(key=lambda x: x[1], reverse=True)
        selected = [c[0] for c in candidates[:top_n]]
        
        logger.info(f"回测币种: {selected}")
        
        for sym in selected:
            try:
                self.run_single(sym, days)
            except Exception as e:
                logger.error(f"{sym} 回测失败: {e}")
        
        self.print_report()
    
    def print_report(self):
        """打印回测报告"""
        total = self.stats["entries"]
        if total == 0:
            print("\n❌ 无交易信号触发")
            return
        
        win_rate = self.stats["wins"] / total * 100
        avg_pnl = self.stats["total_pnl"] / total
        avg_win = sum(t['pnl_dollar'] for t in self.trades if t['pnl_dollar'] > 0) / max(1, self.stats["wins"])
        avg_loss = sum(t['pnl_dollar'] for t in self.trades if t['pnl_dollar'] <= 0) / max(1, self.stats["losses"])
        
        # 按信号类型分组统计
        by_type = {}
        for t in self.trades:
            tp = t['signal_type']
            if tp not in by_type:
                by_type[tp] = {"count": 0, "wins": 0, "pnl": 0}
            by_type[tp]["count"] += 1
            if t['pnl_dollar'] > 0:
                by_type[tp]["wins"] += 1
            by_type[tp]["pnl"] += t['pnl_dollar']
        
        # 按出场原因分组
        by_exit = {}
        for t in self.trades:
            ex = t['exit_reason']
            if ex not in by_exit:
                by_exit[ex] = {"count": 0, "pnl": 0}
            by_exit[ex]["count"] += 1
            by_exit[ex]["pnl"] += t['pnl_dollar']
        
        print("\n" + "=" * 60)
        print("📊 回测报告")
        print("=" * 60)
        print(f"策略: {self.strategy} | 杠杆: {self.leverage}x | 风险: {self.risk_pct*100}%")
        print(f"初始资金: ${self.initial_capital:,.0f}")
        print(f"最终资金: ${self.capital:,.2f}")
        print(f"总盈亏: ${self.stats['total_pnl']:,.2f} ({self.stats['total_pnl']/self.initial_capital*100:.1f}%)")
        print(f"最大回撤: {self.stats['max_drawdown']:.1f}%")
        print()
        print(f"信号总数: {self.stats['total_signals']}")
        print(f"入场次数: {total}")
        print(f"胜率: {win_rate:.1f}% ({self.stats['wins']}胜 / {self.stats['losses']}负)")
        print(f"平均盈利: ${avg_win:,.2f} | 平均亏损: ${avg_loss:,.2f}")
        print(f"盈亏比: {abs(avg_win/avg_loss):.2f}" if avg_loss != 0 else "盈亏比: N/A")
        
        print(f"\n--- 按信号类型 ---")
        for tp, s in sorted(by_type.items(), key=lambda x: x[1]['pnl'], reverse=True):
            wr = s['wins'] / s['count'] * 100 if s['count'] > 0 else 0
            print(f"  {tp:20s}: {s['count']:3d}笔 | 胜率{wr:5.1f}% | PnL ${s['pnl']:,.2f}")
        
        print(f"\n--- 按出场原因 ---")
        for ex, s in sorted(by_exit.items(), key=lambda x: x[1]['count'], reverse=True):
            print(f"  {ex:20s}: {s['count']:3d}笔 | PnL ${s['pnl']:,.2f}")
        
        # 输出最差和最好的交易
        if self.trades:
            best = max(self.trades, key=lambda t: t['pnl_dollar'])
            worst = min(self.trades, key=lambda t: t['pnl_dollar'])
            print(f"\n最佳: {best['symbol']} {best['direction']} +${best['pnl_dollar']:,.2f} ({best['pnl_pct']:+.1f}%) [{best['signal_type']}]")
            print(f"最差: {worst['symbol']} {worst['direction']} ${worst['pnl_dollar']:,.2f} ({worst['pnl_pct']:+.1f}%) [{worst['signal_type']}]")
        
        # 保存详细结果
        report_path = Path(__file__).parent / 'data' / f'backtest_{datetime.now().strftime("%Y%m%d_%H%M")}.json'
        json.dump({
            "config": {
                "strategy": self.strategy,
                "leverage": self.leverage,
                "risk_pct": self.risk_pct,
                "initial_capital": self.initial_capital,
            },
            "stats": self.stats,
            "trades": self.trades,
        }, open(report_path, 'w'), indent=2, default=str)
        
        print(f"\n详细结果已保存: {report_path}")


# ============================================
# 主入口
# ============================================

def main():
    parser = argparse.ArgumentParser(description='交易策略回测引擎')
    parser.add_argument('--symbol', type=str, help='单个币种回测，如 BTCUSDT')
    parser.add_argument('--top', type=int, help='回测成交额前N的币种')
    parser.add_argument('--days', type=int, default=90, help='回测天数 (默认90)')
    parser.add_argument('--strategy', type=str, default='altcoin', 
                        choices=['altcoin', 'major', 'newcoin'], help='策略类型')
    parser.add_argument('--leverage', type=int, default=10, help='杠杆 (默认10)')
    parser.add_argument('--risk', type=float, default=0.03, help='单笔风险比例 (默认0.03)')
    parser.add_argument('--capital', type=float, default=10000, help='初始资金 (默认10000)')
    
    args = parser.parse_args()
    
    engine = BacktestEngine(
        strategy=args.strategy,
        leverage=args.leverage,
        risk_pct=args.risk,
        initial_capital=args.capital,
    )
    
    if args.symbol:
        engine.run_single(args.symbol, args.days)
        engine.print_report()
    elif args.top:
        engine.run_top(args.top, args.days)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
