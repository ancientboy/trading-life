"""
XAU布林带挂单Agent
- 500x杠杆
- 1分钟K线判断信号，实时监控
- 布林带挂单策略：顺势+超卖超买+挂单
- 支持固定止盈和移动止盈
"""
import asyncio, aiohttp, json, math, time, logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR.parent / "data"
LOG_DIR = BASE_DIR.parent / "logs"

logger = logging.getLogger("XAUBollAgent")

@dataclass
class XAUConfig:
    """可进化参数"""
    # 布林带
    boll_period: int = 30
    boll_std: float = 1.5        # 回测最优
    
    # StochRSI阈值
    srsi_lower: float = 8.0      # 回测最优
    srsi_upper: float = 97.0     # 回测最优
    
    # 挂单
    pending_offset: float = 0.1  # 回测最优
    pending_valid: int = 20      # 回测最优
    
    # 止盈止损（固定，每单独立）
    take_profit: float = 10.0    # 固定止盈($)
    stop_loss: float = 10.0      # 固定止损($)
    
    # 持仓
    max_hold: int = 240          # 最长持仓(分钟)
    max_positions: int = 30      # 回测最优
    
    # 手数
    lot_size: float = 0.01       # 每笔手数(盎司)
    leverage: int = 500
    
    # 多挂单
    orders_per_signal: int = 15  # 每信号挂单数
    order_spacing: float = 0.2   # 挂单间距($)
    max_pending: int = 30        # 最大挂单数
    
    # 趋势（多周期）
    ema_fast: int = 20
    ema_slow: int = 50
    trend_timeframes: tuple = ("1m", "5m")  # 周期共振：15s信号 + 1m/5m趋势过滤
    
    # 时间过滤
    trade_hours: tuple = (0, 24)  # 允许交易时段(UTC)


class XAUBollAgent:
    """XAU布林带挂单Agent"""
    
    def __init__(self, capital: float = 10000.0, config: Optional[XAUConfig] = None):
        self.capital = capital
        self.initial_capital = capital
        self.config = config or XAUConfig()
        
        # 状态
        self.positions: Dict[str, dict] = {}  # pending + active
        self.pending_orders: List[dict] = []
        self.active_positions: List[dict] = []
        self.trades_history: List[dict] = []
        self.candle_buffer: List[dict] = []  # K线缓存
        
        # 统计
        self.total_trades = 0
        self.total_wins = 0
        self.total_pnl = 0.0
        self.consecutive_losses = 0
        self.is_circuit_break = False
        
        # 加载状态
        self._load_state()
        
    def _state_file(self):
        return DATA_DIR / "agent_xau_state.json"
    
    def _load_state(self):
        f = self._state_file()
        if f.exists():
            try:
                d = json.load(open(f))
                self.capital = d.get("capital", self.initial_capital)
                self.total_trades = d.get("total_trades", 0)
                self.total_wins = d.get("total_wins", 0)
                self.total_pnl = d.get("total_pnl", 0)
                self.consecutive_losses = d.get("consecutive_losses", 0)
                self.is_circuit_break = d.get("is_circuit_break", False)
                self.active_positions = d.get("active_positions", [])
                self.pending_orders = d.get("pending_orders", [])
                self.trades_history = d.get("trades_history", [])
                logger.info(f"🏦 XAU Agent启动 | 资金${self.capital:,.0f} | 持仓{len(self.active_positions)} | 挂单{len(self.pending_orders)}")
            except Exception as e:
                logger.warning(f"加载状态失败: {e}")
    
    def _save_state(self):
        f = self._state_file()
        d = {
            "capital": self.capital,
            "initial_capital": self.initial_capital,
            "total_trades": self.total_trades,
            "total_wins": self.total_wins,
            "total_pnl": self.total_pnl,
            "consecutive_losses": self.consecutive_losses,
            "is_circuit_break": self.is_circuit_break,
            "active_positions": self.active_positions,
            "pending_orders": self.pending_orders,
            "trades_history": self.trades_history[-200:],  # 只保留最近200笔
            "config": {
                "boll_period": self.config.boll_period,
                "boll_std": self.config.boll_std,
                "srsi_lower": self.config.srsi_lower,
                "srsi_upper": self.config.srsi_upper,
                "pending_offset": self.config.pending_offset,
                "pending_valid": self.config.pending_valid,
                "take_profit": self.config.take_profit,
                "stop_loss": self.config.stop_loss,
                "max_hold": self.config.max_hold,
                "max_positions": self.config.max_positions,
                "lot_size": self.config.lot_size,
                "leverage": self.config.leverage,
            },
            "updated": datetime.now(timezone(timedelta(hours=8))).isoformat(),
        }
        f.write_text(json.dumps(d, indent=2, ensure_ascii=False))
    
    # ============================================================
    # 指标计算
    # ============================================================
    
    @staticmethod
    def calc_ema(values: List[float], period: int) -> List[Optional[float]]:
        if len(values) < period:
            return [None] * len(values)
        ema = [None] * (period - 1)
        ema.append(sum(values[:period]) / period)
        k = 2.0 / (period + 1)
        for i in range(period, len(values)):
            ema.append(values[i] * k + ema[-1] * (1 - k))
        return ema
    
    @staticmethod
    def calc_boll(values: List[float], period: int, std_mult: float):
        n = len(values)
        upper = [None] * n
        lower = [None] * n
        mid = [None] * n
        for i in range(period - 1, n):
            w = values[i - period + 1:i + 1]
            m = sum(w) / period
            s = math.sqrt(sum((x - m) ** 2 for x in w) / period)
            mid[i] = m
            upper[i] = m + std_mult * s
            lower[i] = m - std_mult * s
        return mid, upper, lower
    
    @staticmethod
    def calc_stochrsi(closes: List[float], rsi_period=14, stoch_period=14, k_smooth=3):
        n = len(closes)
        deltas = [closes[i] - closes[i - 1] for i in range(1, n)]
        gains = [max(d, 0) for d in deltas]
        losses = [abs(min(d, 0)) for d in deltas]
        
        rsi = [None] * n
        if n < rsi_period + 1:
            return [None] * n
        
        ag = sum(gains[:rsi_period]) / rsi_period
        al = sum(losses[:rsi_period]) / rsi_period
        rsi[rsi_period] = 100 if al == 0 else 100 - 100 / (1 + ag / al)
        for i in range(rsi_period, len(gains)):
            ag = (ag * (rsi_period - 1) + gains[i]) / rsi_period
            al = (al * (rsi_period - 1) + losses[i]) / rsi_period
            rsi[i + 1] = 100 if al == 0 else 100 - 100 / (1 + ag / al)
        
        stoch = [None] * n
        for i in range(stoch_period, n):
            w = [v for v in rsi[i - stoch_period + 1:i + 1] if v is not None]
            if len(w) < stoch_period:
                continue
            mn, mx = min(w), max(w)
            stoch[i] = (rsi[i] - mn) / (mx - mn) * 100 if mx != mn else 50
        
        if k_smooth > 1:
            smoothed = [None] * n
            for i in range(n):
                if stoch[i] is None:
                    continue
                vals = [stoch[j] for j in range(max(0, i - k_smooth + 1), i + 1) if stoch[j] is not None]
                if len(vals) >= k_smooth:
                    smoothed[i] = sum(vals) / len(vals)
            return smoothed
        return stoch
    
    # ============================================================
    # 数据获取
    # ============================================================
    
    async def fetch_klines(self, session, limit=200):
        """获取15秒K线（通过aggTrades聚合）"""
        return await self.fetch_15s_klines(session, limit)
    
    async def fetch_15s_klines(self, session, limit=200):
        """通过aggTrades聚合生成15秒K线"""
        interval_ms = 15_000  # 15秒
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - limit * interval_ms
        
        # 分段拉取：每段1000条trades，拼够200根K线
        all_trades = []
        fetch_start = start_ms
        for _ in range(3):  # 最多3轮
            url = "https://fapi.binance.com/fapi/v1/aggTrades"
            params = {
                "symbol": "XAUUSDT",
                "startTime": fetch_start,
                "endTime": now_ms,
                "limit": 1000,
            }
            try:
                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    trades = await resp.json()
                    if not isinstance(trades, list) or len(trades) == 0:
                        break
            except Exception as e:
                logger.warning(f"获取aggTrades失败: {e}")
                break
            
            all_trades.extend(trades)
            # 如果拿到<1000条，说明已到头
            if len(trades) < 1000:
                break
            # 下一轮从最后一条之后开始
            fetch_start = int(trades[-1]["T"]) + 1
            
            # 已拉到足够trades，提前退出
            if len(all_trades) >= 2000:
                break
        
        # 聚合成15秒K线
        candles = {}
        for t in trades:
            ts = int(t["T"])  # aggTrade timestamp
            bucket = ts - (ts % interval_ms)  # 对齐到15秒
            price = float(t["p"])
            qty = float(t["q"])
            
            if bucket not in candles:
                candles[bucket] = {
                    "t": bucket, "o": price, "h": price,
                    "l": price, "c": price, "v": qty
                }
            else:
                c = candles[bucket]
                c["h"] = max(c["h"], price)
                c["l"] = min(c["l"], price)
                c["c"] = price
                c["v"] += qty
        
        # 排序并返回最近的limit根
        sorted_candles = sorted(candles.values(), key=lambda x: x["t"])
        return sorted_candles[-limit:]
    
    async def fetch_price(self, session):
        """获取当前价格"""
        url = "https://fapi.binance.com/fapi/v1/ticker/price?symbol=XAUUSDT"
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                d = await resp.json()
                return float(d["price"])
        except:
            return 0
    
    # ============================================================
    # 核心交易逻辑
    # ============================================================
    
    async def check_positions(self, session):
        """检查持仓和挂单"""
        price = await self.fetch_price(session)
        if price <= 0:
            return
        
        now_min = int(time.time() / 60)
        closed = []
        
        for pos in self.active_positions[:]:
            entry = pos["entry_price"]
            direction = pos["direction"]
            entry_time = pos["entry_min"]
            highest = pos.get("highest", entry)
            lowest = pos.get("lowest", entry)
            
            # 更新最高/最低
            if price > highest:
                pos["highest"] = price
                highest = price
            if price < lowest:
                pos["lowest"] = price
                lowest = price
            
            pnl = 0
            exit_reason = ""
            
            if direction == "LONG":
                raw = price - entry
                if raw >= self.config.take_profit:
                    pnl = self.config.take_profit
                    exit_reason = "tp"
                elif raw <= -self.config.stop_loss:
                    pnl = -self.config.stop_loss
                    exit_reason = "sl"
                elif now_min - entry_time >= self.config.max_hold:
                    pnl = raw
                    exit_reason = "time"
            else:  # SHORT
                raw = entry - price
                if raw >= self.config.take_profit:
                    pnl = self.config.take_profit
                    exit_reason = "tp"
                elif raw <= -self.config.stop_loss:
                    pnl = -self.config.stop_loss
                    exit_reason = "sl"
                elif now_min - entry_time >= self.config.max_hold:
                    pnl = raw
                    exit_reason = "time"
            
            if exit_reason:
                # 计算实际盈亏（考虑手数和杠杆）
                dollar_pnl = pnl * self.config.lot_size  # 杠杆只影响保证金，不影响盈亏
                self.capital += dollar_pnl
                self.total_pnl += dollar_pnl
                self.total_trades += 1
                
                if dollar_pnl > 0:
                    self.total_wins += 1
                    self.consecutive_losses = 0
                else:
                    self.consecutive_losses += 1
                
                pos["exit_price"] = price
                pos["exit_reason"] = exit_reason
                pos["pnl"] = dollar_pnl
                pos["pnl_pct"] = pnl
                self.trades_history.append(pos)
                self.active_positions.remove(pos)
                closed.append(pos)
                
                emoji = "🟢" if dollar_pnl > 0 else "🔴"
                logger.info(f"{emoji} XAU平仓: {direction} entry={entry:.2f} exit={price:.2f} "
                           f"pnl=${dollar_pnl:+.2f} ({pnl:+.2f}$) reason={exit_reason}")
        
        # 检查挂单
        for order in self.pending_orders[:]:
            if now_min >= order["expire_min"]:
                self.pending_orders.remove(order)
                continue
            
            if order["direction"] == "LONG" and price <= order["price"]:
                # 成交
                order["entry_price"] = order["price"]
                order["entry_min"] = now_min
                order["highest"] = order["price"]
                order["lowest"] = order["price"]
                self.active_positions.append(order)
                self.pending_orders.remove(order)
                logger.info(f"✅ XAU挂单成交: LONG @${order['price']:.2f}")
            
            elif order["direction"] == "SHORT" and price >= order["price"]:
                order["entry_price"] = order["price"]
                order["entry_min"] = now_min
                order["highest"] = order["price"]
                order["lowest"] = order["price"]
                self.active_positions.append(order)
                self.pending_orders.remove(order)
                logger.info(f"✅ XAU挂单成交: SHORT @${order['price']:.2f}")
        
        if closed:
            self._save_state()
    
    async def scan_signal(self, session):
        """扫描信号"""
        # 熔断
        if self.is_circuit_break or self.consecutive_losses >= 8:
            return
        
        # 仓位上限
        total_open = len(self.active_positions) + len(self.pending_orders)
        if total_open >= self.config.max_positions:
            return
        
        # 获取1m K线（用于信号判断）
        klines = await self.fetch_klines(session, 200)
        if len(klines) < 100:
            return
        
        closes = [k["c"] for k in klines]
        highs = [k["h"] for k in klines]
        lows = [k["l"] for k in klines]
        
        # 计算1m指标（入场信号）
        ema_f = self.calc_ema(closes, self.config.ema_fast)
        ema_s = self.calc_ema(closes, self.config.ema_slow)
        _, boll_up, boll_lo = self.calc_boll(closes, self.config.boll_period, self.config.boll_std)
        srsi = self.calc_stochrsi(closes)
        
        i = len(closes) - 1  # 最新K线
        
        if ema_f[i] is None or ema_s[i] is None or boll_lo[i] is None or srsi[i] is None:
            return
        
        current_price = closes[i]
        
        # 多周期趋势过滤：15m和1h的EMA必须同方向
        trend_up = ema_f[i] > ema_s[i]  # 1m趋势
        trend_down = ema_f[i] < ema_s[i]
        
        for tf in self.config.trend_timeframes:
            try:
                url = f"https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT&interval={tf}&limit=100"
                async with session.get(url) as resp:
                    tf_data = await resp.json()
                if len(tf_data) < 60:
                    continue
                tf_closes = [float(k[4]) for k in tf_data]
                tf_ema_f = self.calc_ema(tf_closes, self.config.ema_fast)
                tf_ema_s = self.calc_ema(tf_closes, self.config.ema_slow)
                ti = len(tf_closes) - 1
                if tf_ema_f[ti] is None or tf_ema_s[ti] is None:
                    continue
                tf_up = tf_ema_f[ti] > tf_ema_s[ti]
                # 大周期趋势优先：如果大周期是UP，不允许做空
                if tf_up:
                    trend_down = False
                else:
                    trend_up = False
            except Exception:
                continue
        
        now_min = int(time.time() / 60)
        
        # 计算布林中轨
        boll_mid = self.calc_boll(closes, self.config.boll_period, self.config.boll_std)[0]
        if boll_mid[i] is None:
            return
        mid = boll_mid[i]

        # 上涨趋势 + 价格在中轨下方 + 超卖 → 挂多单（多级）
        if trend_up and current_price < mid and srsi[i] <= self.config.srsi_lower:
            # 从当前价格往下方挂单
            base_price = current_price - self.config.pending_offset
            placed = 0
            for k in range(self.config.orders_per_signal):
                p2 = round(base_price - k * self.config.order_spacing, 2)
                if p2 <= 0:
                    break
                # 检查重复
                dup = False
                for o in self.pending_orders:
                    if o["direction"] == "LONG" and abs(o["price"] - p2) < 0.3:
                        dup = True; break
                if dup:
                    continue
                if len(self.pending_orders) >= self.config.max_pending:
                    break
                
                order = {
                    "direction": "LONG",
                    "price": p2,
                    "expire_min": now_min + self.config.pending_valid,
                    "signal_price": current_price,
                    "boll_mid": mid,
                    "boll_lower": boll_lo[i],
                    "srsi": srsi[i],
                    "reason": f"趋势↑+中轨下方+SRSI{srsi[i]:.0f}",
                }
                self.pending_orders.append(order)
                placed += 1
            
            if placed > 0:
                logger.info(f"📌 XAU挂多单×{placed}: @{base_price:.2f}~ (当前${current_price:.2f} 中轨${mid:.2f} SRSI={srsi[i]:.0f})")
        
        # 下跌趋势 + 价格在中轨上方 + 超买 → 挂空单（多级）
        elif trend_down and current_price > mid and srsi[i] >= self.config.srsi_upper:
            # 从当前价格往上方挂单
            base_price = current_price + self.config.pending_offset
            placed = 0
            for k in range(self.config.orders_per_signal):
                p2 = round(base_price + k * self.config.order_spacing, 2)
                # 检查重复
                dup = False
                for o in self.pending_orders:
                    if o["direction"] == "SHORT" and abs(o["price"] - p2) < 0.3:
                        dup = True; break
                if dup:
                    continue
                if len(self.pending_orders) >= self.config.max_pending:
                    break
                
                order = {
                    "direction": "SHORT",
                    "price": p2,
                    "expire_min": now_min + self.config.pending_valid,
                    "signal_price": current_price,
                    "boll_mid": mid,
                    "boll_upper": boll_up[i],
                    "srsi": srsi[i],
                    "reason": f"趋势↓+中轨上方+SRSI{srsi[i]:.0f}",
                }
                self.pending_orders.append(order)
                placed += 1
            
            if placed > 0:
                logger.info(f"📌 XAU挂空单×{placed}: @{base_price:.2f}~ (当前${current_price:.2f} 中轨${mid:.2f} SRSI={srsi[i]:.0f})")
        
        self._save_state()
    
    async def run_cycle(self, session):
        """运行一个周期"""
        # 周末休市跳过（周六13:00 ~ 周一07:00 北京时间）
        now = datetime.now(timezone(timedelta(hours=8)))
        wd = now.weekday()  # 0=Mon ... 5=Sat 6=Sun
        h = now.hour
        is_weekend = (
            (wd == 5 and h >= 13) or  # 周六13:00起
            (wd == 6) or               # 周日全天
            (wd == 0 and h < 7)         # 周一07:00前
        )
        if is_weekend:
            return  # 周末休市，只检查持仓不扫描信号
        
        await self.check_positions(session)
        await self.scan_signal(session)
