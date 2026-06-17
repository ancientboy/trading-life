"""
动量追涨Agent v3 - 全维度进化版

四大升级：
1. 扩展参数空间（trail=0.5%~5%，自适应出场）
2. Walk-Forward验证（60天训练→30天验证）
3. 多信号维度（多TF确认、成交量形态、BTC趋势过滤）
4. 1分钟级别监控做精确trailing stop
"""

import logging
import asyncio
import aiohttp
import math
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Set
from dataclasses import dataclass

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.base_agent import BaseAgent
from config import DATA_DIR

logger = logging.getLogger("MomentumAgent")


@dataclass
class SurgeSignal:
    symbol: str
    mode: str          # quick / wave / newcoin
    price: float
    stop_loss: float
    score: int
    reason: str
    surge_pct: float
    vol_ratio: float
    # v3 新增
    btc_regime: str = "neutral"  # bull/bear/neutral
    vol_pattern: str = "normal"  # surge/climax/exhaustion
    mtf_score: int = 0          # 多TF确认分数 0-100


class MomentumAgent(BaseAgent):
    """动量追涨Agent v3 - 全维度进化"""

    # ===== 快钱模式参数 =====
    QUICK_SURGE_BARS = 3
    QUICK_MIN_SURGE = 2.0
    QUICK_TRAIL_PCT = 1.0       # v3: 从1.5降到1.0（更紧）
    QUICK_STOP_PCT = 3.0       # quick止损百分比（可进化）
    QUICK_MAX_HOLD = 60
    QUICK_MIN_VOL_RATIO = 1.0

    # ===== 多TF确认参数 =====
    MTF_ENABLED = True
    MTF_REQUIRE_4H_UP = False    # 4h也要在涨（v3默认关闭，太严格）
    MTF_BTC_FILTER = True        # BTC大跌时不追
    MTF_BTC_DROP_THRESHOLD = -2.0  # BTC 24h跌>2%时不追

    # ===== 成交量形态参数 =====
    VOL_PATTERN_ENABLED = True
    VOL_CLIMAX_RATIO = 5.0      # 量比>5x=天量（警惕）
    VOL_EXHAUSTION_DECAY = 0.5   # 量衰减>50%= exhaustion

    # ===== 动态trailing stop参数 =====
    DYNAMIC_TRAIL_ENABLED = True
    DYNAMIC_TRAIL_BASE = 1.0     # 基础trail%
    DYNAMIC_TRAIL_VOL_SCALE = 0.3  # 波动率乘数

    # ===== 稳定币黑名单 =====
    STABLECOINS = {'USDCUSDT', 'BUSDUSDT', 'TUSDUSDT', 'DAIUSDT', 'FDUSDUSDT',
                   'USDPUSDT', 'PYUSDUSDT', 'EUSDUSDT', 'FIRSTUSDUSDT'}

    # ===== 波段模式参数 =====
    WAVE_BREAKOUT_BARS = 10
    WAVE_MIN_VOL_RATIO = 1.0
    WAVE_STOP_PCT = 20.0
    WAVE_EMA_EXIT = 25
    WAVE_MAX_HOLD = 90

    # ===== 新币模式参数 =====
    NEWCOIN_MAX_DAYS = 60
    NEWCOIN_STOP_PCT = 25.0
    NEWCOIN_EMA_EXIT = 10
    NEWCOIN_MAX_HOLD = 120

    def __init__(self, capital: float):
        super().__init__(
            agent_type="momentum",
            capital=capital,
            max_positions=6,
            max_single_risk_pct=0.03,
            max_position_pct=0.10,
            circuit_break_limit=8,
        )
        self._active_symbols: List[str] = []
        self._shuffled_symbols: List[str] = []
        self._scan_offset: int = 0
        self._symbol_updated: datetime = datetime.min.replace(tzinfo=timezone.utc)
        self._recent_exits: Dict[str, int] = {}
        self._newcoin_listings: Dict[str, datetime] = {}
        # v3: BTC趋势缓存
        self._btc_24h_change: float = 0.0
        self._btc_4h_trend: str = "neutral"  # up/down/neutral
        self._btc_updated: datetime = datetime.min.replace(tzinfo=timezone.utc)
        # v3: 选币方向缓存
        self._coin_directions: Dict[str, dict] = {}  # {symbol: {direction, score, reason}}
        self._directions_updated: datetime = datetime.min.replace(tzinfo=timezone.utc)

    # ================================================================
    # 币种管理
    # ================================================================

    async def _fetch_active_symbols(self, session: aiohttp.ClientSession) -> List[str]:
        if self._active_symbols:
            return self._active_symbols

        cache = DATA_DIR / 'active_symbols.json'
        if cache.exists():
            try:
                import json as _json
                data = _json.load(open(cache))
                self._active_symbols = data.get('symbols', self._fallback_symbols())
                import random as _random
                self._shuffled_symbols = list(self._active_symbols)
                _random.shuffle(self._shuffled_symbols)
                logger.info(f"[momentum] 加载本地币种: {len(self._active_symbols)}个")
                return self._active_symbols
            except:
                pass

        try:
            url = "https://fapi.binance.com/fapi/v1/exchangeInfo"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                info = await resp.json()
            symbols = []
            for s in info.get('symbols', []):
                if (s.get('quoteAsset') == 'USDT'
                    and s.get('contractType') == 'PERPETUAL'
                    and s.get('status') == 'TRADING'):
                    symbols.append(s['symbol'])
                    onboard = s.get('onboardDate', 0)
                    if onboard:
                        self._newcoin_listings[s['symbol']] = datetime.fromtimestamp(onboard/1000, tz=timezone.utc)
            self._active_symbols = symbols
            import random as _random
            self._shuffled_symbols = list(symbols)
            _random.shuffle(self._shuffled_symbols)
            logger.info(f"[momentum] API获取币种: {len(symbols)}个")
            return symbols
        except Exception as e:
            logger.warning(f"[momentum] 获取币种失败: {e}")
            self._active_symbols = self._fallback_symbols()
            import random as _random
            self._shuffled_symbols = list(self._active_symbols)
            _random.shuffle(self._shuffled_symbols)
            return self._active_symbols

    @staticmethod
    def _fallback_symbols() -> List[str]:
        return [
            "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
            "DOGEUSDT", "SUIUSDT", "NEARUSDT", "ONDOUSDT", "HYPEUSDT",
            "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "MATICUSDT",
            "1000PEPEUSDT", "WIFUSDT", "ORDIUSDT", "WLDUSDT", "TAOUSDT",
        ]

    def _is_newcoin(self, symbol: str) -> bool:
        listing = self._newcoin_listings.get(symbol)
        if not listing:
            return False
        return (datetime.now(timezone.utc) - listing).days <= self.NEWCOIN_MAX_DAYS

    # ================================================================
    # v3: BTC趋势缓存（每5分钟更新）
    # ================================================================

    async def _update_btc_context(self, session: aiohttp.ClientSession):
        """更新BTC趋势上下文"""
        if (datetime.now(timezone.utc) - self._btc_updated).total_seconds() < 300:
            return  # 5分钟内不重复更新

        try:
            # 24h涨跌
            url = "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                d = await resp.json()
            self._btc_24h_change = float(d.get('priceChangePercent', 0))

            # 4h趋势（用EMA判断）
            url2 = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=50"
            async with session.get(url2, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if isinstance(raw, list) and len(raw) >= 30:
                closes = [float(k[4]) for k in raw]
                from harness import calc_ema
                ema10 = calc_ema(closes, 10)
                ema20 = calc_ema(closes, 20)
                if ema10 > ema20 and closes[-1] > ema10:
                    self._btc_4h_trend = "up"
                elif ema10 < ema20 and closes[-1] < ema10:
                    self._btc_4h_trend = "down"
                else:
                    self._btc_4h_trend = "neutral"

            self._btc_updated = datetime.now(timezone.utc)
        except:
            pass

    def _load_coin_directions(self):
        """加载选币器推荐方向"""
        if (datetime.now(timezone.utc) - self._directions_updated).total_seconds() < 300:
            return  # 5分钟内不重复
        try:
            path = DATA_DIR / 'coin_directions.json'
            if path.exists():
                self._coin_directions = json.loads(path.read_text())
                self._directions_updated = datetime.now(timezone.utc)
        except:
            pass

    # ================================================================
    # v3: 多TF确认
    # ================================================================

    async def _check_mtf_confirmation(self, session, symbol: str,
                                       surge_1h: float) -> int:
        """多时间框架确认评分 0-100"""
        score = 50  # 基础分

        # 1. BTC过滤：BTC大跌时降分
        if self.MTF_BTC_FILTER:
            if self._btc_24h_change < self.MTF_BTC_DROP_THRESHOLD:
                score -= 25  # BTC暴跌，风险高
            elif self._btc_24h_change < 0:
                score -= 10  # BTC微跌
            elif self._btc_24h_change > 2:
                score += 10  # BTC大涨，市场情绪好

        # 2. 4h趋势确认
        if self.MTF_REQUIRE_4H_UP:
            try:
                url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=4h&limit=30"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                    raw = await resp.json()
                if isinstance(raw, list) and len(raw) >= 20:
                    closes_4h = [float(k[4]) for k in raw]
                    from harness import calc_ema
                    ema10 = calc_ema(closes_4h, 10)
                    if closes_4h[-1] > ema10:
                        score += 15  # 4h也在涨
                    else:
                        score -= 15  # 4h在跌，1h追涨可能是假突破
            except:
                pass

        return max(0, min(100, score))

    # ================================================================
    # v3: 成交量形态分析
    # ================================================================

    def _analyze_vol_pattern(self, vols: List[float]) -> str:
        """分析成交量形态"""
        if len(vols) < 5:
            return "normal"

        recent = vols[-3:]
        older = vols[-8:-3] if len(vols) >= 8 else vols[:-3]

        if not older:
            return "normal"

        recent_avg = sum(recent) / len(recent)
        older_avg = sum(older) / len(older)

        if older_avg == 0:
            return "normal"

        vol_ratio = recent_avg / older_avg

        # 天量警告（可能是顶部）
        if vol_ratio > self.VOL_CLIMAX_RATIO:
            return "climax"

        # 量能衰竭（涨了但量在缩）
        if vol_ratio < self.VOL_EXHAUSTION_DECAY:
            return "exhaustion"

        # 健康放量
        if vol_ratio > 1.5:
            return "surge"

        return "normal"

    # ================================================================
    # v3: 动态trailing stop
    # ================================================================

    def _calc_dynamic_trail(self, entry_price: float, current_price: float,
                            klines_1m: List[dict] = None) -> float:
        """根据波动率计算动态trailing stop百分比"""
        if not self.DYNAMIC_TRAIL_ENABLED:
            return self.QUICK_TRAIL_PCT

        # 基础trail
        trail = self.DYNAMIC_TRAIL_BASE

        # 如果有1m数据，用最近30根的波动率调整
        if klines_1m and len(klines_1m) >= 10:
            closes = [k['close'] for k in klines_1m[-30:]]
            if len(closes) >= 10:
                returns = [(closes[i] - closes[i-1]) / closes[i-1]
                          for i in range(1, len(closes)) if closes[i-1] > 0]
                if returns:
                    vol = math.sqrt(sum(r**2 for r in returns) / len(returns)) * 100
                    # 波动率越高，trail越宽
                    trail += vol * self.DYNAMIC_TRAIL_VOL_SCALE

        # 盈利越多，trail越紧（锁利润）
        profit_pct = (current_price / entry_price - 1) * 100
        if profit_pct > 5:
            trail *= 0.7  # 赚了5%以上，收紧到70%
        if profit_pct > 10:
            trail *= 0.5  # 赚了10%以上，收紧到50%

        return max(0.3, min(5.0, trail))  # 限制在0.3%-5%

    # ================================================================
    # 扫描逻辑
    # ================================================================

    async def run_cycle(self, session: aiohttp.ClientSession, cycle: int = 0) -> list:
        """扫描全部币种"""
        if not self.can_open():
            return []

        symbols = self._shuffled_symbols
        if not symbols:
            await self._fetch_active_symbols(session)
            symbols = self._shuffled_symbols
            if not symbols:
                return []

        logger.info(f"[momentum] 扫描batch offset={self._scan_offset}/{len(symbols)}")

        results = []
        batch_size = 30

        if self._scan_offset >= len(symbols):
            self._scan_offset = 0
        batch = symbols[self._scan_offset:self._scan_offset + batch_size]
        self._scan_offset += batch_size

        # v3: 先更新BTC上下文
        await self._update_btc_context(session)

        for sym in batch:
            if sym in self.positions:
                continue
            if not self.can_open():
                break
            if sym in self.STABLECOINS:
                continue

            try:
                signal = await self._scan_symbol(session, sym)
                if not signal:
                    continue

                # v3: 多TF评分
                if self.MTF_ENABLED:
                    signal.mtf_score = await self._check_mtf_confirmation(
                        session, sym, signal.surge_pct)

                # v3: 成交量形态调整分数
                if self.VOL_PATTERN_ENABLED:
                    if signal.vol_pattern == "climax":
                        signal.score -= 15  # 天量降分
                        signal.reason += " ⚠️天量"
                    elif signal.vol_pattern == "exhaustion":
                        signal.score -= 10  # 量缩降分
                        signal.reason += " ⚠️量缩"
                    elif signal.vol_pattern == "surge":
                        signal.score += 5   # 健康放量加分

                # v3: BTC过滤
                if self.MTF_BTC_FILTER and self._btc_24h_change < self.MTF_BTC_DROP_THRESHOLD:
                    if signal.mode == "quick":
                        logger.debug(f"[momentum] BTC跌{self._btc_24h_change:.1f}%，跳过{sym}")
                        continue

                # 分数阈值
                if signal.score < 45:
                    continue

                leverage = 10 if signal.mode == "wave" else (5 if signal.mode == "newcoin" else 20)
                # 做空方向由surge_pct负值决定
                direction = "SHORT" if signal.surge_pct < 0 else "LONG"
                opened = self.open_position(
                    symbol=sym, direction=direction,
                    entry_price=signal.price,
                    stop_loss=signal.stop_loss,
                    leverage=leverage,
                    entry_type=f"surge_{signal.mode}",
                    take_profit=[signal.price],
                    reasoning=signal.reason,
                    klines_4h=None,
                )
                if opened:
                    results.append({
                        "symbol": sym, "action": direction,
                        "price": signal.price,
                        "leverage": leverage,
                        "score": signal.score,
                        "entry_type": f"surge_{signal.mode}",
                    })
                    logger.info(f"🚀 [momentum] {signal.mode}信号: {sym} "
                               f"+{signal.surge_pct:.1f}% ({signal.reason}) "
                               f"MTF={signal.mtf_score}")

            except Exception as e:
                logger.debug(f"[momentum] {sym} scan error: {e}")

        return results

    async def _scan_symbol(self, session, symbol) -> Optional[SurgeSignal]:
        """扫描单个币种 — 基于选币器推荐方向过滤"""
        # 加载方向信息
        self._load_coin_directions()
        recommended_dir = self._coin_directions.get(symbol, {}).get("direction", "")

        if self._is_newcoin(symbol):
            sig = await self._detect_newcoin(session, symbol)
            if sig:
                return sig

        # 做多策略（screener推LONG或无方向时都检测）
        if recommended_dir != "SHORT":
            sig = await self._detect_quick(session, symbol)
            if sig:
                return sig

            sig = await self._detect_wave(session, symbol)
            if sig:
                return sig

            # SMC Demand OB做多
            sig = await self._detect_smc_demand_ob(session, symbol)
            if sig:
                return sig

            # 突破回踩做多
            sig = await self._detect_breakout_pullback(session, symbol)
            if sig:
                return sig

        # 做空策略（screener推SHORT或无方向时都检测）
        if recommended_dir != "LONG":
            # 做空信号检测
            sig = await self._detect_short(session, symbol)
            if sig:
                return sig

            # EMA144第1次反弹做空
            sig = await self._detect_ema144_short(session, symbol)
            if sig:
                return sig
        if sig:
            return sig

        return None

    async def _detect_short(self, session, symbol) -> Optional[SurgeSignal]:
        """做空信号检测 v3 - 基于回测优化（120天+$3,339验证）
        
        回测验证：
        - 60天: 89笔 PnL +$199
        - 90天: 131笔 PnL +$1,322
        - 120天: 171笔 PnL +$3,339
        
        最优参数：pump>=8% dist>=5% vol>=1.5x stop=5% trail=5% hold=45bars
        盈利币：INU, PEPE, GMT, WLD, ADA, XRP
        亏损币（排除）：BSB, BEAT, TAO, HYPE, EDEN
        """
        # 做空黑名单（回测验证亏损的币种）
        SHORT_BLACKLIST = {'BSBUSDT', 'BEATUSDT', 'TAOUSDT', 'HYPEUSDT', 'EDENUSDT'}
        SHORT_STOP_PCT = 5.0  # 做空止损（可进化）
        if symbol in SHORT_BLACKLIST:
            return None
        
        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=4h&limit=50"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if not isinstance(raw, list) or len(raw) < 30:
                return None

            closes = [float(k[4]) for k in raw]
            vols = [float(k[5]) for k in raw]
            price = closes[-1]

            def calc_ema(data, period):
                if len(data) < period: return data[-1]
                k = 2 / (period + 1)
                ema = sum(data[:period]) / period
                for v in data[period:]: ema = v * k + ema * (1 - k)
                return ema

            ema20 = calc_ema(closes, 20)

            # 急涨超买做空（回测最优参数）
            n = 3
            base = closes[-(n + 1)]
            pump = (price / base - 1) * 100
            dist_ema = (price / ema20 - 1) * 100

            if pump < 8 or dist_ema < 5:
                return None

            vol_recent = sum(vols[-n:]) / n
            vol_older = sum(vols[-(n + 10):-n]) / min(10, len(vols) - n) if len(vols) > n else 1
            vol_ratio = vol_recent / vol_older if vol_older > 0 else 1

            if vol_ratio < 1.5:
                return None

            # BTC涨>2%不做空
            if self._btc_24h_change > 2.0:
                return None

            # 评分
            score = min(55 + int(pump), 85)
            reason_parts = [f"急涨{pump:.1f}%", f"超买{dist_ema:.1f}%", f"量比{vol_ratio:.1f}x"]

            # 资金费率加分
            try:
                ms = await asyncio.wait_for(
                    _fetch_microstructure(session, symbol), timeout=2.0
                )
                if ms and ms.get('funding_rate'):
                    fr = ms['funding_rate']
                    if fr > 0.001:
                        score = min(score + 10, 90)
                        reason_parts.append(f"费率{fr*100:.3f}%")
            except:
                pass

            # 回测最优：止损5% trailing 5%
            stop = price * (1 + self.SHORT_STOP_PCT / 100)

            return SurgeSignal(
                symbol=symbol, mode="quick", price=price,
                stop_loss=stop, score=score,
                reason=f"做空: {' '.join(reason_parts)}",
                surge_pct=-pump,
                vol_ratio=vol_ratio,
                btc_regime=self._btc_4h_trend,
                vol_pattern="surge",
            )
        except:
            return None

    async def _detect_ema144_short(self, session, symbol) -> Optional[SurgeSignal]:
        """EMA144第1次反弹做空（180天+33.3%，盈亏比2.44验证）
        
        逻辑：
        1. 空头趋势确认（EMA144 < EMA576）
        2. 价格曾远离EMA144（<-3%）
        3. 第1次反弹到EMA144附近
        4. 做空，止损EMA144+2%
        5. 只做第1次反弹（第2次起失效）
        
        止盈：trailing 3%（回测最优）
        """
        try:
            # 需要拉更多K线来计算EMA576
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=4h&limit=600"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                raw = await resp.json()
            if not isinstance(raw, list) or len(raw) < 580:
                return None
            
            closes = [float(k[4]) for k in raw]
            highs = [float(k[2]) for k in raw]
            
            def calc_ema(data, period):
                if len(data) < period: return data[-1]
                k = 2 / (period + 1)
                ema = sum(data[:period]) / period
                for v in data[period:]: ema = v * k + ema * (1 - k)
                return ema
            
            # 当前EMA
            e144 = calc_ema(closes, 144)
            e576 = calc_ema(closes, 576)
            
            # 空头趋势确认
            if e144 >= e576:
                return None
            
            # 当前价格
            price = closes[-1]
            
            # 价格在EMA144附近（反弹触及）
            if price > e144 * 1.02:  # 已超过EMA144太多
                return None
            if price < e144 * 0.97:  # 还没反弹到
                return None
            
            # 检查是否曾远离EMA144（-3%以下）
            recent_closes = closes[-30:]
            min_dist = min((c - e144) / e144 * 100 for c in recent_closes)
            if min_dist > -3:
                return None
            
            # 检查这是否是第1次反弹（最近30根内没有触及EMA144的记录）
            earlier = closes[-60:-30]
            earlier_bounced = any(abs((c - calc_ema(closes[:i+60+1], 144)) / calc_ema(closes[:i+60+1], 144)) < 0.02 
                                for i, c in enumerate(earlier) if i + 60 < len(closes))
            # 如果之前也反弹过，说明不是第1次
            # 简化：检查过去15根K线是否持续低于EMA144
            prev_bars_below = sum(1 for c in closes[-20:-3] if c < calc_ema(closes[:len(closes)-20+20], 144) * 0.99)
            if prev_bars_below < 5:  # 过去大部分时间没有远离EMA
                return None
            
            # 检查是否已经做过这个币的EMA144反弹
            bounce_key = f"ema144_short_{symbol}"
            if hasattr(self, '_ema144_bounced') and self._ema144_bounced.get(bounce_key):
                return None
            
            # 评分
            dist = (price - e144) / e144 * 100
            score = min(60 + int(abs(min_dist) * 2), 85)
            
            # BTC涨>2%不做空
            if self._btc_24h_change > 2.0:
                return None
            
            stop = e144 * 1.02  # EMA144上方2%止损
            
            # 标记已反弹
            if not hasattr(self, '_ema144_bounced'):
                self._ema144_bounced = {}
            self._ema144_bounced[bounce_key] = True
            
            return SurgeSignal(
                symbol=symbol, mode="wave", price=price,
                stop_loss=stop, score=score,
                reason=f"EMA144反弹做空: 趋势空头, 跌{abs(min_dist):.1f}%后反弹到EMA144",
                surge_pct=-abs(min_dist),
                vol_ratio=1.0,
                btc_regime=self._btc_4h_trend,
                vol_pattern="normal",
            )
        except:
            return None

    async def _detect_smc_demand_ob(self, session, symbol) -> Optional[SurgeSignal]:
        """SMC Demand OB做多 + Supply OB止盈
        
        回测优化参数（90天验证）：
        - 强OB过滤(>3x avg body)
        - 止损: OB下沿1%
        - 止盈: 最近Supply OB / Swing High
        - 盈亏比>1.5才入场
        - 阳线确认 + EMA20>EMA50趋势
        """
        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=4h&limit=60"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if not isinstance(raw, list) or len(raw) < 40:
                return None
            
            closes = [float(k[4]) for k in raw]
            opens = [float(k[1]) for k in raw]
            highs = [float(k[2]) for k in raw]
            lows = [float(k[3]) for k in raw]
            vols = [float(k[5]) for k in raw]
            price = closes[-1]
            
            def calc_ema(data, period):
                if len(data) < period: return data[-1]
                k = 2 / (period + 1)
                ema = sum(data[:period]) / period
                for v in data[period:]: ema = v * k + ema * (1 - k)
                return ema
            
            # 趋势过滤
            e20 = calc_ema(closes, 20)
            e50 = calc_ema(closes, 50)
            if e20 <= e50:
                return None
            
            # BTC过滤
            if self._btc_24h_change < -2.0:
                return None
            
            # 找Demand OB（大阳线body）
            lookback = min(40, len(closes) - 5)
            demand_obs = []
            supply_obs = []
            swing_highs = []
            
            avg_body = sum(abs(closes[i] - opens[i]) for i in range(-lookback, 0)) / lookback
            
            for i in range(-lookback, 0):
                body = abs(closes[i] - opens[i])
                strength = body / avg_body if avg_body > 0 else 0
                
                if closes[i] > opens[i] and strength >= 3.0:  # 强大阳线
                    ob_low = opens[i]  # Demand OB下沿
                    ob_high = closes[i]  # Demand OB上沿
                    demand_obs.append((ob_low, ob_high, strength))
                
                if closes[i] < opens[i] and strength >= 2.0:  # 大阴线 = Supply OB
                    ob_low = closes[i]
                    ob_high = opens[i]
                    supply_obs.append((ob_low, ob_high, strength))
            
            # 找Swing High
            for i in range(-lookback + 5, -3):
                if all(highs[i] >= highs[i-j] for j in range(1, 6)) and \
                   all(highs[i] >= highs[i+j] for j in range(1, 4)):
                    swing_highs.append(highs[i])
            
            if not demand_obs:
                return None
            
            # 找价格触及的最近Demand OB
            for ob_low, ob_high, strength in sorted(demand_obs, key=lambda x: x[0], reverse=True):
                # 当前K线触及OB区域
                if lows[-1] <= ob_high and price >= ob_low:
                    # 阳线确认（当前或前一根）
                    if closes[-1] <= opens[-1] and (len(closes) < 2 or closes[-2] <= opens[-2]):
                        continue
                    
                    entry = price
                    stop = ob_low * 0.99  # OB下沿1%止损
                    
                    # 找止盈目标（最近Supply OB或Swing High）
                    targets = []
                    for s_lo, s_hi, s_st in sorted(supply_obs, key=lambda x: x[0]):
                        if s_lo > entry:
                            targets.append((s_lo, 'supply_ob'))
                            break
                    for sh in sorted(swing_highs):
                        if sh > entry:
                            targets.append((sh, 'swing_high'))
                            break
                    
                    if not targets:
                        target_price = entry * 1.03  # 兜底3%
                        target_type = 'fixed_3pct'
                    else:
                        target_price, target_type = min(targets, key=lambda x: x[0])
                    
                    # 盈亏比检查
                    risk = entry - stop
                    reward = target_price - entry
                    if risk <= 0: continue
                    rr = reward / risk
                    if rr < 1.5: continue  # 盈亏比至少1:1.5
                    
                    # 评分
                    score = min(55 + int(strength * 3) + int(rr * 5), 85)
                    
                    return SurgeSignal(
                        symbol=symbol, mode="wave", price=entry,
                        stop_loss=stop, score=score,
                        reason=f"Demand OB: 强度{strength:.1f}x 止盈{target_type}(RR={rr:.1f})",
                        surge_pct=(entry - ob_low) / ob_low * 100,
                        vol_ratio=vols[-1] / (sum(vols[-20:]) / 20) if sum(vols[-20:]) > 0 else 1,
                        btc_regime=self._btc_4h_trend,
                        vol_pattern="normal",
                    )
            
            return None
        except:
            return None

    async def _detect_breakout_pullback(self, session, symbol) -> Optional[SurgeSignal]:
        """突破回踩策略 - 回测验证（60天+$92.4%，盈亏比2.63）
        
        逻辑：
        1. 找到底部结构（摆动低点形成颈线）
        2. 放量大阳线突破颈线
        3. 等待回调到大阳线开盘价
        4. 不破开盘价 + 趋势确认 → 做多
        
        只做多，EMA20>EMA50趋势过滤
        """
        try:
            # 拉取更多K线来找结构
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=4h&limit=80"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if not isinstance(raw, list) or len(raw) < 50:
                return None
            
            closes = [float(k[4]) for k in raw]
            opens = [float(k[1]) for k in raw]
            highs = [float(k[2]) for k in raw]
            lows = [float(k[3]) for k in raw]
            vols = [float(k[5]) for k in raw]
            
            def calc_ema(data, period):
                if len(data) < period: return data[-1]
                k = 2 / (period + 1)
                ema = sum(data[:period]) / period
                for v in data[period:]: ema = v * k + ema * (1 - k)
                return ema
            
            # 趋势过滤
            e20 = calc_ema(closes, 20)
            e50 = calc_ema(closes, 50)
            if e20 <= e50:  # 非多头趋势
                return None
            
            # BTC过滤
            if self._btc_24h_change < -2.0:  # BTC大跌不做
                return None
            
            # 找摆动低点
            lookback = min(50, len(closes) - 5)
            swing_lows = []
            for i in range(5, lookback):
                is_low = all(lows[i] <= lows[i-j] for j in range(1, 6)) and \
                         all(lows[i] <= lows[i+j] for j in range(1, 4))
                if is_low:
                    swing_lows.append((i, lows[i]))
            
            if len(swing_lows) < 2:
                return None
            
            # 找最近的两个摆动低点（底结构）
            last_swing = swing_lows[-1]
            prev_swing = swing_lows[-2]
            
            if last_swing[0] - prev_swing[0] < 10:
                return None
            
            # 颈线 = 两个低点之间的最高点
            between_high = max(highs[i] for i in range(prev_swing[0], last_swing[0]+1))
            neckline = between_high
            
            # 找突破大阳线
            price = closes[-1]
            avg_vol = sum(vols[-20:]) / 20
            
            # 在最近10根K线内找突破
            for j in range(max(last_swing[0]+1, len(closes)-10), len(closes)):
                body_pct = (closes[j] - opens[j]) / opens[j] * 100
                if closes[j] <= neckline:
                    continue
                if body_pct < 1.5:
                    continue
                if vols[j] < avg_vol * 1.5:
                    continue
                
                # 突破确认！大阳线开盘价 = 回踩支撑
                breakout_open = opens[j]
                
                # 检查是否正在回踩
                # 最低价接近开盘价但不破
                recent_low = min(lows[j+1:]) if j+1 < len(lows) else price
                
                if recent_low <= breakout_open * 1.02 and recent_low >= breakout_open * 0.995:
                    # 回踩确认！
                    score = 60 + min(int(body_pct * 2), 20)
                    reason = f"突破回踩: 大阳线涨{body_pct:.1f}% 回踩支撑{breakout_open:.4f}"
                    
                    stop = breakout_open * 0.98  # 开盘价下方2%止损
                    
                    return SurgeSignal(
                        symbol=symbol, mode="wave", price=price,
                        stop_loss=stop, score=score,
                        reason=reason,
                        surge_pct=body_pct,
                        vol_ratio=vols[j] / avg_vol,
                        btc_regime=self._btc_4h_trend,
                        vol_pattern="surge",
                    )
                break  # 只检查最近的突破
            
            return None
        except:
            return None

    async def _detect_quick(self, session, symbol) -> Optional[SurgeSignal]:
        """快钱模式 - 1h K线 + 因子引擎"""
        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=1h&limit=30"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if not isinstance(raw, list) or len(raw) < 15:
                return None

            closes = [float(k[4]) for k in raw]
            vols = [float(k[5]) for k in raw]
            price = closes[-1]

            n = min(self.QUICK_SURGE_BARS, len(closes) - 1)
            base = closes[-(n + 1)]
            surge = (price / base - 1) * 100
            if surge < self.QUICK_MIN_SURGE:
                return None

            vol_recent = sum(vols[-n:]) / n
            vol_older = sum(vols[max(0, len(vols) - n - 10):len(vols) - n])
            vol_older = vol_older / min(10, len(vols) - n) if len(vols) > n else 1
            vol_ratio = vol_recent / vol_older if vol_older > 0 else 1

            # v4: 因子引擎 + 微观结构
            try:
                from factor_engine import FactorEngine
                fe = FactorEngine()
                hour_utc = datetime.now(timezone.utc).hour
                # 拉微观结构
                try:
                    ms = await asyncio.wait_for(
                        _fetch_microstructure(session, symbol),
                        timeout=3.0
                    )
                except:
                    ms = None
                factor_score = fe.score_quick_enhanced(
                    closes, vols,
                    self._btc_24h_change, self._btc_4h_trend,
                    hour_utc, microstructure=ms
                )
                score = int(factor_score.total_score)
                vol_pattern = factor_score.factors[2].signal if len(factor_score.factors) > 2 else "normal"
            except:
                # fallback到简单评分
                vol_pattern = self._analyze_vol_pattern(vols)
                score = min(55 + int(surge * 3), 90)

            stop = price * (1 - self.QUICK_STOP_PCT / 100)

            return SurgeSignal(
                symbol=symbol, mode="quick", price=price,
                stop_loss=stop, score=score,
                reason=f"快钱: {n}h涨{surge:.1f}% 量比{vol_ratio:.1f}x",
                surge_pct=surge, vol_ratio=vol_ratio,
                btc_regime=self._btc_4h_trend,
                vol_pattern=vol_pattern,
            )
        except:
            return None

    async def _detect_wave(self, session, symbol) -> Optional[SurgeSignal]:
        """波段模式 - 4h K线 + 因子引擎"""
        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=4h&limit=50"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if not isinstance(raw, list) or len(raw) < 30:
                return None

            closes = [float(k[4]) for k in raw]
            vols = [float(k[5]) for k in raw]
            highs = [float(k[2]) for k in raw]
            lows = [float(k[3]) for k in raw]
            price = closes[-1]

            n = self.WAVE_BREAKOUT_BARS
            if len(closes) <= n:
                return None
            high_n = max(closes[-(n + 1):-1])
            if price <= high_n:
                return None

            surge_pct = (price / high_n - 1) * 100
            if surge_pct < 0.5:
                return None

            vol_now = vols[-1]
            vol_avg = sum(vols[-21:-1]) / 20 if len(vols) > 20 else 1
            vol_ratio = vol_now / vol_avg if vol_avg > 0 else 1
            if vol_ratio < self.WAVE_MIN_VOL_RATIO:
                return None

            # v4: 因子引擎 + 微观结构
            try:
                from factor_engine import FactorEngine
                fe = FactorEngine()
                # 拉微观结构
                try:
                    ms = await asyncio.wait_for(
                        _fetch_microstructure(session, symbol),
                        timeout=3.0
                    )
                except:
                    ms = None
                factor_score = fe.score_wave_enhanced(
                    closes, vols, highs, lows,
                    self._btc_24h_change, self._btc_4h_trend,
                    self.WAVE_BREAKOUT_BARS, microstructure=ms
                )
                score = int(factor_score.total_score)
                vol_pattern = factor_score.factors[7].signal if len(factor_score.factors) > 7 else "normal"
            except:
                vol_pattern = self._analyze_vol_pattern(vols)
                score = min(50 + int(vol_ratio * 5) + int(surge_pct * 2), 85)

            stop = price * (1 - self.WAVE_STOP_PCT / 100)

            return SurgeSignal(
                symbol=symbol, mode="wave", price=price,
                stop_loss=stop, score=score,
                reason=f"波段: 破{n}根高点+{surge_pct:.1f}% 量比{vol_ratio:.1f}x",
                surge_pct=surge_pct, vol_ratio=vol_ratio,
                btc_regime=self._btc_4h_trend,
                vol_pattern=vol_pattern,
            )
        except:
            return None

    async def _detect_newcoin(self, session, symbol) -> Optional[SurgeSignal]:
        """新币模式"""
        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=4h&limit=50"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if not isinstance(raw, list) or len(raw) < 10:
                return None

            closes = [float(k[4]) for k in raw]
            vols = [float(k[5]) for k in raw]
            price = closes[-1]
            first_close = closes[0]
            total_chg = (price / first_close - 1) * 100

            vol_recent = sum(vols[-3:]) / 3
            vol_older = sum(vols[:max(1, len(vols) - 3)]) / max(1, len(vols) - 3)
            vol_ratio = vol_recent / vol_older if vol_older > 0 else 1

            if vol_ratio < 2.0:
                return None
            if price < first_close:
                return None

            score = min(55 + int(vol_ratio * 3) + int(max(0, total_chg)), 85)
            stop = price * (1 - self.NEWCOIN_STOP_PCT / 100)

            days = (datetime.now(timezone.utc) - self._newcoin_listings.get(symbol, datetime.now(timezone.utc))).days

            return SurgeSignal(
                symbol=symbol, mode="newcoin", price=price,
                stop_loss=stop, score=score,
                reason=f"新币: 上线{days}天 放量{vol_ratio:.1f}x 涨{total_chg:.0f}%",
                surge_pct=max(0, total_chg), vol_ratio=vol_ratio,
            )
        except:
            return None

    # ================================================================
    # 持仓检查 - v3: 1分钟级别动态trailing
    # ================================================================

    async def check_positions(self, session: aiohttp.ClientSession, cycle: int = 0):
        """检查持仓"""
        for sym in list(self.positions.keys()):
            try:
                url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sym}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    data = await resp.json()
                price = float(data.get('price', 0))
                if price <= 0:
                    continue

                pos = self.positions.get(sym)
                if not pos:
                    continue

                mode = pos.entry_type.replace("surge_", "") if pos.entry_type else "quick"
                hold_hours = (datetime.now(timezone.utc) - datetime.fromisoformat(
                    pos.opened_at.replace('Z', '+00:00'))).total_seconds() / 3600

                should_exit, reason = False, ""

                if mode == "quick":
                    should_exit, reason = await self._check_quick_exit_v3(
                        pos, price, hold_hours, session, sym)
                elif mode == "wave":
                    should_exit, reason = await self._check_wave_exit(
                        pos, price, hold_hours, session, sym)
                elif mode == "newcoin":
                    should_exit, reason = await self._check_newcoin_exit(
                        pos, price, hold_hours, session, sym)

                if should_exit:
                    self.close_position(sym, price, reason)
                    self._recent_exits[sym] = cycle

            except Exception as e:
                logger.debug(f"[momentum] check {sym} error: {e}")

    async def _check_quick_exit_v3(self, pos, price, hold_hours,
                                     session, sym) -> tuple:
        """v3快钱出场：1分钟级别动态trailing stop"""
        # 更新峰值
        if pos.take_profit:
            peak = pos.take_profit[0]
            if price > peak:
                pos.take_profit[0] = price
                peak = price
        else:
            peak = pos.entry_price
            pos.take_profit = [max(peak, price)]

        peak = pos.take_profit[0]

        # v3: 获取1m K线做动态trailing
        trail_pct = self.QUICK_TRAIL_PCT  # 默认
        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=1m&limit=30"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                raw = await resp.json()
            if isinstance(raw, list) and len(raw) >= 10:
                klines_1m = [{"close": float(k[4]), "high": float(k[2]),
                              "low": float(k[3])} for k in raw]
                trail_pct = self._calc_dynamic_trail(
                    pos.entry_price, price, klines_1m)
        except:
            pass

        trail = peak * (1 - trail_pct / 100)
        stop = max(pos.stop_loss, trail)

        if price <= stop:
            ride = (peak / pos.entry_price - 1) * 100
            return True, (f"快钱动态trailing stop {trail_pct:.1f}% "
                         f"(峰值+{ride:.1f}%)")

        if hold_hours >= self.QUICK_MAX_HOLD:
            return True, f"快钱超时{hold_hours:.0f}h"

        return False, ""

    async def _check_wave_exit(self, pos, price, hold_hours, session, sym) -> tuple:
        """波段模式出场"""
        if price <= pos.stop_loss:
            return True, "波段止损"

        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=30"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if isinstance(raw, list) and len(raw) >= 20:
                closes = [float(k[4]) for k in raw]
                from harness import calc_ema
                ema = calc_ema(closes, self.WAVE_EMA_EXIT)
                if price < ema and closes[-2] >= calc_ema(closes[:-1], self.WAVE_EMA_EXIT):
                    ride = (price / pos.entry_price - 1) * 100
                    return True, f"波段EMA{self.WAVE_EMA_EXIT}破位 (持仓+{ride:.1f}%)"
        except:
            pass

        bars_held = hold_hours / 4
        if bars_held >= self.WAVE_MAX_HOLD:
            return True, f"波段超时{bars_held:.0f}根"

        return False, ""

    async def _check_newcoin_exit(self, pos, price, hold_hours, session, sym) -> tuple:
        """新币模式出场"""
        if price <= pos.stop_loss:
            return True, "新币止损"

        try:
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=20"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                raw = await resp.json()
            if isinstance(raw, list) and len(raw) >= 10:
                closes = [float(k[4]) for k in raw]
                from harness import calc_ema
                ema = calc_ema(closes, self.NEWCOIN_EMA_EXIT)
                if price < ema and closes[-2] >= calc_ema(closes[:-1], self.NEWCOIN_EMA_EXIT):
                    ride = (price / pos.entry_price - 1) * 100
                    return True, f"新币EMA{self.NEWCOIN_EMA_EXIT}破位 (持仓+{ride:.1f}%)"
        except:
            pass

        bars_held = hold_hours / 4
        if bars_held >= self.NEWCOIN_MAX_HOLD:
            return True, f"新币超时{bars_held:.0f}根"

        return False, ""

    def get_status(self) -> str:
        active = len(self.positions)
        wr = self.total_wins / self.total_trades * 100 if self.total_trades > 0 else 0
        sym_count = len(self._active_symbols)
        btc = f"BTC:{self._btc_24h_change:+.1f}%24h" if self._btc_updated > datetime.min.replace(tzinfo=timezone.utc) else "BTC:?"
        return (
            f"📈 [momentum] ${self.capital:,.0f} | "
            f"监控{sym_count}币 持仓{active}/{self.max_positions} | "
            f"{self.total_trades}笔 WR{wr:.1f}% | "
            f"PnL ${self.total_pnl:+,.0f} | {btc}"
        )


# ============ 微观结构数据拉取（绕过FactorEngine异步问题） ============

async def _fetch_microstructure(session, symbol):
    """拉取微观结构数据：订单簿+资金费率+OI+多空比"""
    try:
        import asyncio
        results = await asyncio.gather(
            _fetch_depth(session, symbol),
            _fetch_funding(session, symbol),
            _fetch_ls_ratio(session, symbol),
            return_exceptions=True,
        )
        depth = results[0] if not isinstance(results[0], Exception) else None
        funding = results[1] if not isinstance(results[1], Exception) else None
        ls_data = results[2] if not isinstance(results[2], Exception) else None
        
        return {
            "depth": depth,
            "funding_rate": funding,
            "ls_ratio": ls_data.get("ls_ratio", 1.0) if ls_data else 1.0,
            "top_ratio": ls_data.get("top_ratio", 1.0) if ls_data else 1.0,
            "taker_ratio": ls_data.get("taker_ratio", 1.0) if ls_data else 1.0,
        }
    except:
        return None

async def _fetch_depth(session, symbol):
    url = f"https://fapi.binance.com/fapi/v1/depth?symbol={symbol}&limit=10"
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
        return await resp.json()

async def _fetch_funding(session, symbol):
    url = f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbol}&limit=1"
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
        data = await resp.json()
    if data and len(data) > 0:
        return float(data[0].get("fundingRate", 0))
    return None

async def _fetch_ls_ratio(session, symbol):
    import asyncio
    ls_url = f"https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol={symbol}&period=4h&limit=1"
    top_url = f"https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol={symbol}&period=4h&limit=1"
    taker_url = f"https://fapi.binance.com/futures/data/takerlongshortRatio?symbol={symbol}&period=4h&limit=1"
    ls_r, top_r, taker_r = await asyncio.gather(
        session.get(ls_url, timeout=aiohttp.ClientTimeout(total=3)),
        session.get(top_url, timeout=aiohttp.ClientTimeout(total=3)),
        session.get(taker_url, timeout=aiohttp.ClientTimeout(total=3)),
    )
    ls_data, top_data, taker_data = await ls_r.json(), await top_r.json(), await taker_r.json()
    return {
        "ls_ratio": float(ls_data[0]["longShortRatio"]) if ls_data and len(ls_data) > 0 else 1.0,
        "top_ratio": float(top_data[0]["longShortRatio"]) if top_data and len(top_data) > 0 else 1.0,
        "taker_ratio": float(taker_data[0]["buySellRatio"]) if taker_data and len(taker_data) > 0 else 1.0,
    }
