"""
Trading Agent Harness v2.0

按Agent+入场类型分开回测，融入Harness Engineering理念：
1. 沙盒环境 - 纯历史数据模拟，不碰真实API
2. Trajectory记录 - 每笔交易记录完整决策轨迹
3. 评估指标 - 多维度评分，不只看盈亏
4. 市场环境分类 - 区分牛市/熊市/震荡下的表现
5. 异常注入 - 模拟极端行情

用法:
  python3 harness.py --agent major --days 90
  python3 harness.py --agent altcoin --signal prelaunch --days 60
  python3 harness.py --agent all --days 90 --full-report
"""

import ccxt
import json
import argparse
import time
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field, asdict
from pathlib import Path
from enum import Enum

import sys
sys.path.insert(0, str(Path(__file__).parent))

from analyst_tech import (
    calc_stochrsi, check_stochrsi_entry, check_multi_timeframe_stochrsi,
    detect_breakout_setup, detect_volume_divergence,
    calc_atr, calc_ema, analyze_trend,
)
from prelaunch_detector import detect_prelaunch_signals

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger("Harness")


# ============================================
# 数据类型
# ============================================

class MarketRegime(Enum):
    BULL = "bull"
    BEAR = "bear"
    CHOP = "chop"
    CRASH = "crash"
    PUMP = "pump"


@dataclass
class TradeTrajectory:
    """完整交易轨迹 - Harness核心"""
    # 入场信息
    symbol: str
    agent_type: str          # major/altcoin/momentum
    signal_type: str         # trend_pullback_long/short/prelaunch_ambush/short_squeeze/...
    entry_time: str
    entry_price: float
    direction: str           # LONG/SHORT
    leverage: int
    
    # 决策轨迹 (Harness核心)
    decision_reason: str     # 为什么入场
    entry_score: float       # 入场评分
    indicators_snapshot: dict  # 入场时的指标快照
    
    # 市场环境
    market_regime: str       # bull/bear/chop/crash/pump
    btc_trend: str           # bullish/neutral/bearish
    
    # 出场信息
    exit_time: str = ""
    exit_price: float = 0.0
    exit_reason: str = ""    # stop_loss/structure_break/timeout/manual
    
    # 结果
    pnl_pct: float = 0.0
    pnl_dollar: float = 0.0
    bars_held: int = 0
    
    # Harness评估
    trajectory_score: float = 0.0  # 0-100 综合评分
    trajectory_notes: str = ""


# ============================================
# 数据加载
# ============================================

class DataLoader:
    def __init__(self):
        self.exchange = ccxt.binance({
            'enableRateLimit': True,
            'options': {'defaultType': 'future'},
        })
        self.cache_dir = Path(__file__).parent / 'data' / 'harness_cache'
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def fetch_klines(self, symbol: str, interval: str, days: int) -> List[dict]:
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=days)
        start_str = since.strftime('%Y%m%d')
        end_str = now.strftime('%Y%m%d')
        
        cache = self.cache_dir / f"{symbol}_{interval}_{start_str}_{end_str}.json"
        if cache.exists():
            return json.load(open(cache))
        
        logger.info(f"  拉取 {symbol} {interval} {days}天...")
        all_klines = []
        since_ms = int(since.timestamp() * 1000)
        
        while True:
            klines = self.exchange.fetch_ohlcv(symbol, interval, since=since_ms, limit=1500)
            if not klines:
                break
            for k in klines:
                all_klines.append({
                    'open_time': k[0],
                    'open': float(k[1]),
                    'high': float(k[2]),
                    'low': float(k[3]),
                    'close': float(k[4]),
                    'volume': float(k[5]),
                })
            since_ms = klines[-1][0] + 1
            if len(klines) < 1500:
                break
            time.sleep(0.5)
        
        json.dump(all_klines, open(cache, 'w'))
        return all_klines
    
    def get_top_symbols(self, top_n: int) -> List[str]:
        tickers = self.exchange.fetch_tickers()
        candidates = []
        for sym, t in tickers.items():
            if sym.endswith('/USDT:USDT'):
                vol = t.get('quoteVolume', 0) or 0
                if vol > 10_000_000:
                    candidates.append((sym.replace('/USDT:USDT', 'USDT'), vol))
        candidates.sort(key=lambda x: x[1], reverse=True)
        return [c[0] for c in candidates[:top_n]]


# ============================================
# 市场环境分类器
# ============================================

class MarketClassifier:
    """识别当前市场环境 (Regime Detection)"""
    
    @staticmethod
    def classify(klines_4h: List[dict]) -> MarketRegime:
        if len(klines_4h) < 30:
            return MarketRegime.CHOP
        
        closes = [k['close'] for k in klines_4h]
        volumes = [k['volume'] for k in klines_4h]
        
        # 最近30根 vs 前30根
        recent_closes = closes[-30:]
        earlier_closes = closes[-60:-30] if len(closes) >= 60 else closes[:30]
        
        if not earlier_closes:
            return MarketRegime.CHOP
        
        price_change = (recent_closes[-1] - earlier_closes[0]) / earlier_closes[0] * 100
        recent_vol = sum(volumes[-10:]) / 10
        avg_vol = sum(volumes[-30:]) / 30
        
        # EMA判断
        ema20 = calc_ema(closes, 20)
        ema50 = calc_ema(closes, 50) if len(closes) >= 50 else ema20
        
        # 暴涨/暴跌
        if price_change > 15:
            return MarketRegime.PUMP
        if price_change < -15:
            return MarketRegime.CRASH
        
        # 趋势
        if ema20 > ema50 and closes[-1] > ema20:
            return MarketRegime.BULL
        if ema20 < ema50 and closes[-1] < ema20:
            return MarketRegime.BEAR
        
        return MarketRegime.CHOP
    
    @staticmethod
    def get_btc_trend(klines_4h: List[dict]) -> str:
        if len(klines_4h) < 50:
            return "neutral"
        closes = [k['close'] for k in klines_4h]
        ema20 = calc_ema(closes, 20)
        ema50 = calc_ema(closes, 50)
        return "bullish" if ema20 > ema50 else "bearish"


# ============================================
# Agent信号检测器
# ============================================

class MajorSignalDetector:
    """主流币Agent信号"""
    
    def __init__(self):
        self.symbols = ["BTCUSDT", "ETHUSDT"]
    
    @staticmethod
    def _calc_rsi(closes, period=14):
        if len(closes) < period+1: return 50
        gains, losses = [], []
        for i in range(1, len(closes)):
            d = closes[i]-closes[i-1]
            gains.append(max(0,d)); losses.append(max(0,-d))
        if len(gains)<period: return 50
        ag=sum(gains[:period])/period; al=sum(losses[:period])/period
        for i in range(period,len(gains)):
            ag=(ag*(period-1)+gains[i])/period; al=(al*(period-1)+losses[i])/period
        if al==0: return 100
        return 100-100/(1+ag/al)
    
    @staticmethod
    def _calc_macd(closes, fast=12, slow=26, signal=9):
        def ema(data,p):
            if len(data)<p: return data[-1] if data else 0
            k=2/(p+1); e=sum(data[:p])/p
            for v in data[p:]: e=v*k+e*(1-k)
            return e
        fast_ema=[ema(closes[:i+1],fast) for i in range(slow-1,len(closes))]
        slow_ema=[ema(closes[:i+1],slow) for i in range(slow-1,len(closes))]
        macd_line=[f-s for f,s in zip(fast_ema,slow_ema)]
        if len(macd_line)<signal: return {'macd':0,'signal':0,'histogram':0}
        sig_line=ema(macd_line,signal)
        return {'macd':macd_line[-1],'signal':sig_line,'histogram':macd_line[-1]-sig_line}
    
    def _calc_stochrsi_simple(self, closes: list, period: int = 14, k_smooth: int = 3, d_smooth: int = 3) -> dict:
        """简化StochRSI - 与major_agent.py保持一致"""
        if len(closes) < period + k_smooth + d_smooth:
            return {"valid": False}
        
        gains, losses = [], []
        for i in range(1, len(closes)):
            diff = closes[i] - closes[i-1]
            gains.append(max(0, diff))
            losses.append(max(0, -diff))
        
        if len(gains) < period:
            return {"valid": False}
        
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        rsi_values = []
        if avg_loss == 0:
            rsi_values.append(100)
        else:
            rs = avg_gain / avg_loss
            rsi_values.append(100 - 100 / (1 + rs))
        
        for i in range(period, len(gains)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
            if avg_loss == 0:
                rsi_values.append(100)
            else:
                rs = avg_gain / avg_loss
                rsi_values.append(100 - 100 / (1 + rs))
        
        if len(rsi_values) < period:
            return {"valid": False}
        
        # Stochastic of RSI
        stoch_values = []
        for i in range(period - 1, len(rsi_values)):
            window = rsi_values[i - period + 1:i + 1]
            min_rsi = min(window)
            max_rsi = max(window)
            if max_rsi == min_rsi:
                stoch_values.append(50)
            else:
                stoch_values.append((rsi_values[i] - min_rsi) / (max_rsi - min_rsi) * 100)
        
        if len(stoch_values) < k_smooth + d_smooth:
            return {"valid": False}
        
        # K = SMA of stoch
        k_val = sum(stoch_values[-k_smooth:]) / k_smooth
        d_val = sum(stoch_values[-k_smooth-d_smooth:-k_smooth]) / d_smooth if len(stoch_values) >= k_smooth + d_smooth else k_val
        
        zone = "oversold" if k_val < 20 else "overbought" if k_val > 80 else "neutral"
        signal = "NEUTRAL"
        if k_val > d_val and zone == "oversold": signal = "GOLDEN_CROSS_OVERSOLD"
        elif k_val > d_val: signal = "GOLDEN_CROSS"
        elif k_val < d_val and zone == "overbought": signal = "DEAD_CROSS_OVERBOUGHT"
        elif k_val < d_val: signal = "DEAD_CROSS"
        
        return {"valid": True, "k": round(k_val, 2), "d": round(d_val, 2), 
                "zone": zone, "signal": signal}
    
    def detect(self, klines_4h: List[dict], symbol: str) -> List[dict]:
        signals = []
        closes = [k['close'] for k in klines_4h]
        
        if len(closes) < 50:
            return signals
        
        price = closes[-1]
        ema20 = calc_ema(closes, 20)
        ema50 = calc_ema(closes, 50)
        ema200 = calc_ema(closes, 200) if len(closes) >= 200 else ema50
        srsi = self._calc_stochrsi_simple(closes)
        
        # RSI
        rsi_val = self._calc_rsi(closes) if len(closes) >= 15 else 50
        # MACD
        macd_result = self._calc_macd(closes) if len(closes) >= 26 else {'macd':0,'signal':0,'histogram':0}
        
        # === 做多 ===
        bullish_trend = ema20 > ema50 and price > ema20
        if bullish_trend:
            distance = (price / ema20 - 1) * 100
            near_ema20 = -3 < distance < 2
            
            stochrsi_trigger = False
            if srsi.get("valid"):
                if srsi["signal"] in ["GOLDEN_CROSS_OVERSOLD", "GOLDEN_CROSS"]:
                    stochrsi_trigger = True
                elif srsi.get("zone") == "oversold" and srsi["k"] > srsi["d"]:
                    stochrsi_trigger = True
            
            rsi_ok = 30 < rsi_val < 55
            macd_ok = macd_result['histogram'] > 0 or macd_result['macd'] > macd_result['signal']
            
            score = 0
            if bullish_trend: score += 25
            if near_ema20: score += 20
            if stochrsi_trigger: score += 20
            if rsi_ok: score += 15
            if macd_ok: score += 10
            if price > ema200: score += 10
            
            if score >= 55:
                signals.append({
                    "type": "trend_pullback_long",
                    "direction": "LONG",
                    "score": score,
                    "reason": f"做多: dist={distance:+.1f}% StochRSI={srsi.get('zone','?')} RSI={rsi_val:.0f} MACD={macd_result['histogram']:.4f} score={score}",
                    "indicators": {
                        "ema20": round(ema20, 2), "ema50": round(ema50, 2),
                        "price": price, "rsi": round(rsi_val, 1),
                        "stochrsi_zone": srsi.get('zone', '?'),
                    },
                    "stop_loss_pct": 0.05,
                    "leverage": 20,
                })
        
        # === 做空 ===
        bearish_trend = ema20 < ema50 and price < ema20
        if bearish_trend:
            distance = (price / ema20 - 1) * 100
            near_ema20 = -2 < distance < 3
            
            stochrsi_trigger = False
            if srsi.get("valid"):
                k, d = srsi["k"], srsi["d"]
                zone = srsi["zone"]
                if zone == "overbought" and k < d:
                    stochrsi_trigger = True
                elif k > 75 and k < d:
                    stochrsi_trigger = True
            
            rsi_ok = 45 < rsi_val < 70
            macd_ok = macd_result['histogram'] < 0 or macd_result['macd'] < macd_result['signal']
            
            score = 0
            if bearish_trend: score += 25
            if near_ema20: score += 20
            if stochrsi_trigger: score += 20
            if rsi_ok: score += 15
            if macd_ok: score += 10
            if price < ema200: score += 10
            
            if score >= 55:
                signals.append({
                    "type": "trend_pullback_short",
                    "direction": "SHORT",
                    "score": score,
                    "reason": f"EMA20<EMA50 距EMA20={distance:+.1f}% StochRSI={srsi.get('zone','?')} 得分={score}",
                    "indicators": {
                        "ema20": round(ema20, 2), "ema50": round(ema50, 2),
                        "price": price,
                        "stochrsi_k": round(srsi.get('k', 0), 2),
                        "stochrsi_zone": srsi.get('zone', '?'),
                    },
                    "stop_loss": ema50 * 1.01,
                    "leverage": 15,
                })
        
        return signals


class AltcoinSignalDetector:
    """山寨币Agent信号 - 分3种类型"""
    
    def detect_prelaunch(self, klines_4h: List[dict], symbol: str) -> List[dict]:
        """Prelaunch埋伏信号"""
        signals = []
        pl = detect_prelaunch_signals(klines_4h, symbol)
        
        if pl['score'] >= 60:
            stoch = check_stochrsi_entry("LONG", calc_stochrsi(klines_4h))
            
            signals.append({
                "type": "prelaunch_ambush",
                "direction": "LONG",
                "score": pl['score'],
                "reason": f"prelaunch={pl['score']} phase={pl.get('phase','')} stochrsi={stoch.get('ok',False)} {pl.get('detail','')}",
                "indicators": {
                    "prelaunch_score": pl['score'],
                    "prelaunch_phase": pl.get('phase', ''),
                    "stochrsi_ok": stoch.get('ok', False),
                },
                "stop_loss_pct": 0.05,
                "leverage": 10,
            })
        
        return signals
    
    def detect_squeeze(self, klines_4h: List[dict], symbol: str) -> List[dict]:
        """逼空信号（简化版 - 用极端负费率+反弹模拟）"""
        # 回测中无法获取历史funding rate，用价格形态替代
        signals = []
        
        if len(klines_4h) < 20:
            return signals
        
        closes = [k['close'] for k in klines_4h]
        volumes = [k['volume'] for k in klines_4h]
        
        # 最近5根是否从低位大幅反弹
        recent_drop = (closes[-10] - min(closes[-10:])) / closes[-10] * 100
        recent_bounce = (closes[-1] - min(closes[-10:])) / min(closes[-10:]) * 100
        vol_surge = volumes[-1] > sum(volumes[-10:]) / 10 * 2
        
        if recent_drop > 8 and recent_bounce > 5 and vol_surge:
            score = 60 + min(recent_bounce, 20)
            signals.append({
                "type": "short_squeeze",
                "direction": "LONG",
                "score": min(score, 90),
                "reason": f"暴跌{recent_drop:.1f}%后反弹{recent_bounce:.1f}% 放量",
                "indicators": {
                    "drop_pct": round(recent_drop, 2),
                    "bounce_pct": round(recent_bounce, 2),
                    "vol_surge": vol_surge,
                },
                "stop_loss_pct": 0.035,
                "leverage": 20,
            })
        
        return signals
    
    def detect_breakout(self, klines_4h: List[dict], symbol: str) -> List[dict]:
        """突破信号"""
        signals = []
        
        if len(klines_4h) < 30:
            return signals
        
        # 简化版突破：价格突破20根K线高点+放量
        highs = [k['high'] for k in klines_4h[-21:-1]]
        volumes = [k['volume'] for k in klines_4h]
        current = klines_4h[-1]
        
        range_high = max(highs)
        avg_vol = sum(volumes[-20:]) / 20
        
        if current['close'] > range_high and current['volume'] > avg_vol * 1.2:
            breakout_pct = (current['close'] - range_high) / range_high * 100
            score = 60 + min(breakout_pct * 5, 25)
            
            signals.append({
                "type": "breakout",
                "direction": "LONG",
                "score": min(score, 90),
                "reason": f"突破{range_high:.2f} 放量{current['volume']/avg_vol:.1f}x 突破幅度{breakout_pct:.2f}%",
                "indicators": {
                    "range_high": round(range_high, 4),
                    "breakout_pct": round(breakout_pct, 2),
                    "vol_ratio": round(current['volume'] / avg_vol, 2),
                },
                "stop_loss_pct": 0.03,
                "leverage": 20,
            })
        
        return signals


class MomentumSignalDetector:
    """动量追涨信号 - 强势启动追踪"""

    SURGE_BARS = 5
    MIN_SURGE_PCT = 5.0
    TRAILING_STOP_PCT = 3.0

    def detect(self, klines_4h: List[dict], symbol: str) -> List[dict]:
        """检测强势启动信号 - 5根K线涨>5%+放量"""
        signals = []

        if len(klines_4h) < 20:
            return signals

        closes = [k['close'] for k in klines_4h]
        vols = [k['volume'] for k in klines_4h]
        price = closes[-1]

        lookback = self.SURGE_BARS
        if len(closes) <= lookback:
            return signals

        base = closes[-(lookback + 1)]
        surge_pct = (price / base - 1) * 100

        if surge_pct < self.MIN_SURGE_PCT:
            return signals

        # 量能确认
        vol_recent = sum(vols[-lookback:]) / lookback
        older_start = max(0, len(vols) - lookback - 10)
        older_end = len(vols) - lookback
        if older_end <= older_start:
            return signals
        vol_older = sum(vols[older_start:older_end]) / (older_end - older_start)
        if vol_older <= 0:
            return signals
        vol_ratio = vol_recent / vol_older

        score = min(60 + int(surge_pct * 2), 95)

        signals.append({
            "type": "surge_chase",
            "direction": "LONG",
            "score": score,
            "reason": f"追涨: {lookback}根涨{surge_pct:.1f}% 量比{vol_ratio:.1f}x",
            "indicators": {"surge_pct": round(surge_pct, 1), "vol_ratio": round(vol_ratio, 2)},
            "stop_loss_pct": 0.05,
            "leverage": 20,
        })

        return signals


# ============================================
# Harness引擎
# ============================================

class TradingHarness:
    """Agent Harness - 完整评估框架"""
    
    def __init__(self, initial_capital: float = 10000, risk_pct: float = 0.03):
        self.initial_capital = initial_capital
        self.risk_pct = risk_pct
        self.loader = DataLoader()
        self.classifier = MarketClassifier()
        
        self.trajectories: List[TradeTrajectory] = []
        self.regime_stats: Dict[str, dict] = {}
    
    @staticmethod
    def _calc_volatility(closes: list) -> float:
        if len(closes) < 2:
            return 0
        returns = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes)) if closes[i-1] > 0]
        if not returns:
            return 0
        import math
        avg = sum(returns) / len(returns)
        variance = sum((r - avg) ** 2 for r in returns) / len(returns)
        return math.sqrt(variance) * 100

    def _simulate_exit(self, entry_price: float, direction: str,
                        stop_loss: float, klines_after: List[dict],
                        max_bars: int = 60) -> dict:
        """模拟出场"""
        closes_so_far = []
        
        for i, k in enumerate(klines_after[:max_bars]):
            c = k['close']
            h = k['high']
            l = k['low']
            closes_so_far.append(c)
            
            # 止损
            if direction == "LONG" and l <= stop_loss:
                return {"exit_price": stop_loss, "bars_held": i+1,
                        "exit_reason": "stop_loss"}
            elif direction == "SHORT" and h >= stop_loss:
                return {"exit_price": stop_loss, "bars_held": i+1,
                        "exit_reason": "stop_loss"}
            
            # 结构破位止盈（至少5根后）
            if i >= 5 and len(closes_so_far) >= 20:
                ema20 = calc_ema(closes_so_far, 20)
                vol = k['volume']
                avg_vol = sum(x['volume'] for x in klines_after[max(0,i-20):i]) / min(20, i+1)
                
                if direction == "LONG" and c < ema20 and vol > avg_vol * 1.2:
                    return {"exit_price": c, "bars_held": i+1,
                            "exit_reason": "structure_break"}
                elif direction == "SHORT" and c > ema20 and vol > avg_vol * 1.2:
                    return {"exit_price": c, "bars_held": i+1,
                            "exit_reason": "structure_break"}
            
            # 超时
            if i == max_bars - 1:
                return {"exit_price": c, "bars_held": i+1, "exit_reason": "timeout"}
        
        return {"exit_price": entry_price, "bars_held": 0, "exit_reason": "no_data"}
    
    def _simulate_trailing_exit(self, entry_price: float, direction: str,
                                   initial_stop: float, klines_after: List[dict],
                                   max_bars: int = 30, trail_pct: float = 2.0) -> dict:
        """Trailing stop出场模拟 - 动量策略专用"""
        peak = entry_price
        stop = initial_stop

        for i, k in enumerate(klines_after[:max_bars]):
            c, h, l = k['close'], k['high'], k['low']

            if direction == "LONG":
                if h > peak:
                    peak = h
                    trail = peak * (1 - trail_pct / 100)
                    stop = max(stop, trail)
                if l <= stop:
                    return {"exit_price": stop, "bars_held": i+1,
                            "exit_reason": "trailing_stop"}
            elif direction == "SHORT":
                if l < peak:
                    peak = l
                    trail = peak * (1 + trail_pct / 100)
                    stop = min(stop, trail)
                if h >= stop:
                    return {"exit_price": stop, "bars_held": i+1,
                            "exit_reason": "trailing_stop"}

            if i == max_bars - 1:
                return {"exit_price": c, "bars_held": i+1, "exit_reason": "timeout"}

        return {"exit_price": entry_price, "bars_held": 0, "exit_reason": "no_data"}

    def _evaluate_trajectory(self, traj: TradeTrajectory) -> float:
        """Harness评估：给交易轨迹打分 0-100"""
        score = 50  # 基础分
        
        # 盈利加分
        if traj.pnl_pct > 0:
            score += min(traj.pnl_pct * 3, 30)
        else:
            score -= min(abs(traj.pnl_pct) * 2, 30)
        
        # 止损是好的风控（不是坏信号）
        if traj.exit_reason == "stop_loss" and traj.pnl_pct > -3:
            score += 5  # 小止损，风控好
        if traj.exit_reason == "structure_break" and traj.pnl_pct > 0:
            score += 10  # 结构止盈赚钱，策略好
        
        # 持仓时长评分
        if traj.bars_held < 3 and traj.pnl_pct < 0:
            score -= 10  # 快速止损可能是入场时机差
        if traj.bars_held > 20 and traj.pnl_pct > 0:
            score += 5  # 长期持仓盈利，趋势抓得好
        
        # 市场环境匹配
        if traj.market_regime == "bull" and traj.direction == "LONG" and traj.pnl_pct > 0:
            score += 5  # 顺趋势赚钱
        if traj.market_regime == "bear" and traj.direction == "LONG" and traj.pnl_pct < 0:
            score -= 5  # 熊市做多亏钱
        
        return max(0, min(100, round(score, 1)))
    
    def run_agent(self, agent_type: str, symbols: List[str], days: int,
                   signal_filter: str = None):
        """运行Agent级别回测"""
        logger.info(f"\n{'='*60}")
        logger.info(f"Harness: {agent_type} agent | {len(symbols)} symbols | {days} days")
        if signal_filter:
            logger.info(f"信号过滤: {signal_filter}")
        logger.info(f"{'='*60}")
        
        for symbol in symbols:
            klines_4h = self.loader.fetch_klines(symbol, '4h', days)
            if len(klines_4h) < 50:
                continue
            
            # BTC趋势
            btc_klines = self.loader.fetch_klines("BTCUSDT", '4h', days) if symbol != "BTCUSDT" else klines_4h
            btc_trend = self.classifier.get_btc_trend(btc_klines)
            
            # 选择检测器
            if agent_type == "major":
                detector = MajorSignalDetector()
            elif agent_type == "altcoin":
                detector = AltcoinSignalDetector()
            elif agent_type == "momentum":
                detector = MomentumSignalDetector()
            else:
                continue
            
            start_bar = 30
            last_entry_bar = -10  # 避免密集入场
            
            for i in range(start_bar, len(klines_4h) - 10):
                if i - last_entry_bar < 5:  # 至少间隔5根K线
                    continue
                
                window = klines_4h[max(0,i-50):i+1]
                regime = self.classifier.classify(window)
                timestamp = datetime.fromtimestamp(
                    int(klines_4h[i]['open_time']) / 1000, tz=timezone.utc
                )
                
                # 检测信号
                if agent_type == "major":
                    raw_signals = detector.detect(window, symbol)
                elif agent_type == "altcoin":
                    raw_signals = []
                    if not signal_filter or signal_filter == "prelaunch":
                        raw_signals += detector.detect_prelaunch(window, symbol)
                    if not signal_filter or signal_filter == "squeeze":
                        raw_signals += detector.detect_squeeze(window, symbol)
                    if not signal_filter or signal_filter == "breakout":
                        raw_signals += detector.detect_breakout(window, symbol)
                elif agent_type == "momentum":
                    raw_signals = detector.detect(window, symbol)
                else:
                    raw_signals = []
                
                for sig in raw_signals:
                    if sig['score'] < 50:
                        continue
                    
                    # === Pump/市场环境过滤 ===
                    sig_type = sig['type']
                    if regime == MarketRegime.PUMP and sig_type in {'prelaunch_ambush', 'breakout', 'newcoin_surge', 'newcoin_bottom', 'short_squeeze'}:
                        continue  # Pump环境禁止入场
                    if regime == MarketRegime.CRASH and sig_type in {'prelaunch_ambush', 'breakout'}:
                        continue  # Crash环境禁止做多入场
                    
                    # === 新币surge已禁用 ===
                    if sig_type == 'newcoin_surge':  # legacy, disabled
                        continue
                    
                    # === 波动率适配 ===
                    adapted_leverage = sig['leverage']
                    closes_for_vol = [k['close'] for k in window]
                    if len(closes_for_vol) >= 20:
                        vol = self._calc_volatility(closes_for_vol)
                        if vol > 5:
                            adapted_leverage = min(adapted_leverage, 10)
                        elif vol > 3:
                            adapted_leverage = min(adapted_leverage, 15)
                    sig['leverage'] = adapted_leverage
                    
                    price = klines_4h[i]['close']
                    direction = sig['direction']
                    
                    # 计算止损
                    if 'stop_loss' in sig:
                        stop_loss = sig['stop_loss']
                    else:
                        atr = calc_atr(window) if len(window) >= 14 else price * 0.02
                        stop_loss = price * (1 - sig.get('stop_loss_pct', 0.04)) if direction == "LONG" \
                                   else price * (1 + sig.get('stop_loss_pct', 0.04))
                    
                    # 模拟出场（动量用trailing stop，其他用固定止损）
                    remaining = klines_4h[i+1:]
                    if not remaining:
                        continue
                    
                    if agent_type == "momentum" and sig_type == "surge_chase":
                        result = self._simulate_trailing_exit(price, direction, stop_loss, remaining)
                    else:
                        result = self._simulate_exit(price, direction, stop_loss, remaining)
                    
                    # 计算盈亏
                    if direction == "LONG":
                        pnl_pct = (result['exit_price'] - price) / price * 100
                    else:
                        pnl_pct = (price - result['exit_price']) / price * 100
                    
                    position_value = self.initial_capital * self.risk_pct * sig['leverage']
                    pnl_dollar = position_value * pnl_pct / 100
                    
                    # 构建轨迹
                    traj = TradeTrajectory(
                        symbol=symbol,
                        agent_type=agent_type,
                        signal_type=sig['type'],
                        entry_time=timestamp.isoformat(),
                        entry_price=round(price, 6),
                        direction=direction,
                        leverage=sig['leverage'],
                        decision_reason=sig['reason'],
                        entry_score=sig['score'],
                        indicators_snapshot=sig['indicators'],
                        market_regime=regime.value,
                        btc_trend=btc_trend,
                        exit_time="",  # TODO: calculate from bars
                        exit_price=round(result['exit_price'], 6),
                        exit_reason=result['exit_reason'],
                        pnl_pct=round(pnl_pct, 2),
                        pnl_dollar=round(pnl_dollar, 2),
                        bars_held=result['bars_held'],
                    )
                    
                    # Harness评估
                    traj.trajectory_score = self._evaluate_trajectory(traj)
                    if traj.pnl_pct > 0:
                        traj.trajectory_notes = "✅ 盈利交易"
                    elif traj.exit_reason == "stop_loss" and traj.pnl_pct > -3:
                        traj.trajectory_notes = "⚠️ 小止损，风控OK"
                    elif traj.exit_reason == "stop_loss":
                        traj.trajectory_notes = "❌ 大止损，入场时机差"
                    else:
                        traj.trajectory_notes = "➖ 持平"
                    
                    self.trajectories.append(traj)
                    last_entry_bar = i
    
    def print_report(self):
        """打印Harness评估报告"""
        if not self.trajectories:
            print("\n❌ 无交易信号")
            return
        
        # 按Agent分组
        by_agent = {}
        for t in self.trajectories:
            if t.agent_type not in by_agent:
                by_agent[t.agent_type] = []
            by_agent[t.agent_type].append(t)
        
        print("\n" + "=" * 70)
        print("📊 Trading Agent Harness 评估报告")
        print("=" * 70)
        
        for agent, trades in by_agent.items():
            print(f"\n{'─'*50}")
            print(f"🤖 {agent.upper()} AGENT")
            print(f"{'─'*50}")
            
            total = len(trades)
            wins = [t for t in trades if t.pnl_dollar > 0]
            losses = [t for t in trades if t.pnl_dollar <= 0]
            total_pnl = sum(t.pnl_dollar for t in trades)
            avg_score = sum(t.trajectory_score for t in trades) / total
            
            print(f"  交易次数: {total} | 胜率: {len(wins)/total*100:.1f}%")
            print(f"  总盈亏: ${total_pnl:,.2f}")
            print(f"  Harness平均分: {avg_score:.1f}/100")
            
            # 按信号类型细分
            by_signal = {}
            for t in trades:
                if t.signal_type not in by_signal:
                    by_signal[t.signal_type] = []
                by_signal[t.signal_type].append(t)
            
            print(f"\n  --- 按信号类型 ---")
            for sig_type, sig_trades in sorted(by_signal.items()):
                st_total = len(sig_trades)
                st_wins = len([t for t in sig_trades if t.pnl_dollar > 0])
                st_pnl = sum(t.pnl_dollar for t in sig_trades)
                st_score = sum(t.trajectory_score for t in sig_trades) / st_total
                st_avg_hold = sum(t.bars_held for t in sig_trades) / st_total
                wr = st_wins / st_total * 100 if st_total > 0 else 0
                
                emoji = "🟢" if st_pnl > 0 else "🔴"
                print(f"  {emoji} {sig_type:25s}: {st_total:3d}笔 | 胜率{wr:5.1f}% | "
                      f"PnL ${st_pnl:>8,.2f} | 评分{st_score:.0f} | 平均持仓{st_avg_hold:.0f}根4h")
            
            # 按市场环境
            by_regime = {}
            for t in trades:
                if t.market_regime not in by_regime:
                    by_regime[t.market_regime] = []
                by_regime[t.market_regime].append(t)
            
            print(f"\n  --- 按市场环境 ---")
            for regime, r_trades in sorted(by_regime.items()):
                r_total = len(r_trades)
                r_wins = len([t for t in r_trades if t.pnl_dollar > 0])
                r_pnl = sum(t.pnl_dollar for t in r_trades)
                r_wr = r_wins / r_total * 100 if r_total > 0 else 0
                print(f"  {regime:8s}: {r_total:3d}笔 | 胜率{r_wr:5.1f}% | PnL ${r_pnl:>8,.2f}")
            
            # 按出场原因
            by_exit = {}
            for t in trades:
                if t.exit_reason not in by_exit:
                    by_exit[t.exit_reason] = {"count": 0, "pnl": 0}
                by_exit[t.exit_reason]["count"] += 1
                by_exit[t.exit_reason]["pnl"] += t.pnl_dollar
            
            print(f"\n  --- 按出场原因 ---")
            for ex, s in sorted(by_exit.items(), key=lambda x: x[1]['count'], reverse=True):
                print(f"  {ex:16s}: {s['count']:3d}笔 | PnL ${s['pnl']:>8,.2f}")
        
        # 总览
        all_total = len(self.trajectories)
        all_wins = len([t for t in self.trajectories if t.pnl_dollar > 0])
        all_pnl = sum(t.pnl_dollar for t in self.trajectories)
        all_score = sum(t.trajectory_score for t in self.trajectories) / all_total
        
        # 最大连续亏损
        max_consec_loss = 0
        current_loss = 0
        for t in self.trajectories:
            if t.pnl_dollar <= 0:
                current_loss += 1
                max_consec_loss = max(max_consec_loss, current_loss)
            else:
                current_loss = 0
        
        print(f"\n{'='*70}")
        print(f"📊 总览")
        print(f"{'='*70}")
        print(f"  总交易: {all_total} | 总胜率: {all_wins/all_total*100:.1f}%")
        print(f"  总盈亏: ${all_pnl:,.2f}")
        print(f"  Harness评分: {all_score:.1f}/100")
        print(f"  最大连续亏损: {max_consec_loss}笔")
        
        # 信号频率
        first_time = self.trajectories[0].entry_time[:10] if self.trajectories else "?"
        last_time = self.trajectories[-1].entry_time[:10] if self.trajectories else "?"
        print(f"  信号频率: {all_total}笔 / {first_time} ~ {last_time}")
        
        # 保存结果
        report_path = Path(__file__).parent / 'data' / f'harness_{datetime.now().strftime("%Y%m%d_%H%M")}.json'
        json.dump({
            "config": {
                "initial_capital": self.initial_capital,
                "risk_pct": self.risk_pct,
            },
            "summary": {
                "total_trades": all_total,
                "win_rate": all_wins/all_total*100,
                "total_pnl": all_pnl,
                "harness_score": all_score,
                "max_consecutive_losses": max_consec_loss,
            },
            "trajectories": [asdict(t) for t in self.trajectories],
        }, open(report_path, 'w'), indent=2, default=str)
        
        print(f"\n详细轨迹已保存: {report_path}")


# ============================================
# 主入口
# ============================================

def main():
    parser = argparse.ArgumentParser(description='Trading Agent Harness v2.0')
    parser.add_argument('--agent', type=str, default='all',
                        choices=['major', 'altcoin', 'newcoin', 'all'])
    parser.add_argument('--signal', type=str, default=None,
                        help='过滤信号类型: prelaunch/squeeze/breakout')
    parser.add_argument('--symbols', type=str, nargs='+', help='指定币种')
    parser.add_argument('--top', type=int, default=15, help='Top N币种')
    parser.add_argument('--days', type=int, default=90)
    parser.add_argument('--capital', type=float, default=10000)
    parser.add_argument('--risk', type=float, default=0.03)
    parser.add_argument('--full-report', action='store_true', help='完整报告含轨迹详情')
    
    args = parser.parse_args()
    
    harness = TradingHarness(initial_capital=args.capital, risk_pct=args.risk)
    
    # 确定回测币种
    if args.symbols:
        symbols = args.symbols
    elif args.agent == 'major':
        symbols = ["BTCUSDT", "ETHUSDT"]
    else:
        symbols = harness.loader.get_top_symbols(args.top)
    
    if args.agent in ('major', 'all'):
        major_syms = ["BTCUSDT", "ETHUSDT"]
        harness.run_agent('major', major_syms, args.days)
    
    if args.agent in ('altcoin', 'all'):
        alt_syms = [s for s in symbols if s not in ["BTCUSDT", "ETHUSDT"]]
        harness.run_agent('altcoin', alt_syms[:20], args.days, args.signal)
    
    if args.agent in ('momentum', 'all'):
        # 新币用更多币种
        harness.run_agent('momentum', alt_syms[:15], args.days)
    
    harness.print_report()
    
    # 如果要完整轨迹详情
    if args.full_report and harness.trajectories:
        print(f"\n--- 完整轨迹 (前20笔) ---")
        for i, t in enumerate(harness.trajectories[:20]):
            emoji = "🟢" if t.pnl_dollar > 0 else "🔴"
            print(f"  {emoji} #{i+1:3d} {t.symbol:12s} {t.direction:5s} {t.signal_type:25s} | "
                  f"得分{t.entry_score:.0f}→Harness{t.trajectory_score:.0f} | "
                  f"PnL{t.pnl_pct:+.1f}%(${t.pnl_dollar:+.0f}) | "
                  f"{t.market_regime:5s} | {t.exit_reason} | {t.decision_reason[:50]}")


if __name__ == '__main__':
    main()
