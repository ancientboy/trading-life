"""
小风交易系统 - 分析师 Agent (Part 3: 主控制器)

整合技术分析 + 情报信号，生成交易信号
"""
import asyncio
import aiohttp
import json
import logging
import time
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR, REDIS_URL, CORE_SYMBOLS
from analyst_data import collect_all_analysis, KLINE_INTERVALS
from analyst_tech import (
    analyze_volume_price, analyze_orderbook,
    analyze_whale_behavior, analyze_trend, find_entry_point,
    calc_stochrsi, check_stochrsi_entry, calc_dynamic_stop,
    check_multi_timeframe_stochrsi, detect_volume_divergence,
    analyze_taker_ratio, detect_breakout_setup, detect_pullback_entry
)
from analyst_smc import analyze_smc
from sentiment_data import collect_sentiment
from funding_trend import analyze_funding_trend, get_funding_direction_signal, analyze_funding_for_screening

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
logger = logging.getLogger("AnalystAgent")

import redis as _redis
try:
    redis_client = _redis.from_url(REDIS_URL)
    USE_REDIS = True
except:
    USE_REDIS = False


# ============================================
# 信号生成
# ============================================
class TradeSignal:
    """交易信号"""
    def __init__(self, symbol: str):
        self.signal_id = f"SIG-{datetime.now().strftime('%Y%m%d')}-{int(time.time())%10000:04d}"
        self.symbol = symbol
        self.timestamp = datetime.now(timezone.utc).isoformat()
        self.direction = "NEUTRAL"
        self.confidence = 0
        self.entry_zone = [0, 0]
        self.stop_loss = 0
        self.targets = [0, 0, 0]
        self.risk_reward = 0
        self.position_pct = 0
        self.time_horizon = "intraday"
        self.reasoning = []
        self.counter_arguments = []
        self.supporting_evidence = []
        self.analysis_detail = {}

    def to_dict(self):
        d = {
            "signal_id": self.signal_id,
            "symbol": self.symbol,
            "timestamp": self.timestamp,
            "direction": self.direction,
            "confidence": self.confidence,
            "entry_zone": self.entry_zone,
            "stop_loss": self.stop_loss,
            "targets": self.targets,
            "risk_reward": self.risk_reward,
            "position_pct": self.position_pct,
            "time_horizon": self.time_horizon,
            "reasoning": self.reasoning[:10],
            "counter_arguments": self.counter_arguments[:5],
            "supporting_evidence": self.supporting_evidence[:10],
            "analysis_detail": self.analysis_detail,
        }
        return d

    def to_telegram(self):
        emoji = {"LONG": "🟢做多", "SHORT": "🔴做空", "NEUTRAL": "⚪观望"}.get(self.direction, "⚪")
        lines = [
            f"📊 *交易信号* {emoji}",
            f"#{self.symbol.replace('USDT','')} | {self.signal_id}",
            f"⏰ {datetime.now().strftime('%H:%M')}",
            "",
            f"📈 方向: *{self.direction}*",
            f"🎯 置信度: *{self.confidence}%*",
            f"📍 入场: {self.entry_zone[0]:,.2f} ~ {self.entry_zone[1]:,.2f}",
            f"🛑 止损: {self.stop_loss:,.2f}",
            f"🎯 目标: {', '.join(f'{t:,.2f}' for t in self.targets)}",
            f"⚖️ 盈亏比: 1:{self.risk_reward:.1f}",
            f"📦 仓位: {self.position_pct}%",
            "",
            "📝 *理由:*",
        ]
        for r in self.reasoning[:5]:
            lines.append(f"  • {r}")
        if self.counter_arguments:
            lines.append("")
            lines.append("⚠️ *风险:*")
            for c in self.counter_arguments[:3]:
                lines.append(f"  • {c}")
        return "\n".join(lines)


# ============================================
# 分析师主逻辑
# ============================================
class AnalystAgent:
    def __init__(self):
        self.signals: List[TradeSignal] = []

    # ============================================
    # 两阶段架构 v3: 舆情选币 → 技术入场
    # ============================================
    # 
    # 第一阶段：选币+方向（舆情驱动）
    #   - HotScanner: 24h涨幅/跌幅异常 → 纳入候选
    #   - 资金费率极端(>0.2%或<-0.2%) → 方向信号
    #   - OI急变 → 方向确认
    #   - 新闻催化剂 → 辅助方向
    #   → 输出: 候选币列表 + 建议方向 + 选币理由
    #
    # 第二阶段：入场时机（技术面驱动）
    #   - 只分析被选中的币
    #   - 趋势判断: 是否与舆情方向一致
    #   - 量价分析: 是否有突破/放量信号
    #   - StochRSI: 是否在合理区间(超卖做多/超买做空)
    #   - 订单簿: 是否有支撑/阻力
    #   → 输出: 入场价/止损/目标/置信度
    # ============================================
    def _get_dynamic_weights(self, symbol: str, sentiment: dict) -> dict:
        """保留接口兼容，但不再使用混合权重"""
        return {"vp_5m": 0.05, "vp_1h": 0.10, "vp_4h": 0.15,
                "orderbook": 0.15, "whale": 0.10, "trend": 0.25,
                "sentiment": 0.20}
    
    def _check_vp_resonance(self, vp_scores: dict, suggested_dir: str = None) -> dict:
        """
        多周期量价共振检测
        
        检测5m/15m/1h/4h的量价方向是否一致：
        - full: 全部同向（最强信号）
        - strong: 3个同向
        - partial: 2个同向
        - none: 无共振或矛盾
        
        返回: {resonance: str, score: float, details: str, aligned_periods: int}
        """
        if suggested_dir is None:
            return {"resonance": "none", "score": 0, "details": "无建议方向", "aligned_periods": 0}
        
        key_periods = ["5m", "15m", "1h", "4h"]
        is_long = suggested_dir == "LONG"
        
        aligned = 0
        contradictory = 0
        details = []
        
        for p in key_periods:
            s = vp_scores.get(p, 0)
            if (is_long and s > 5) or (not is_long and s < -5):
                aligned += 1
                details.append(f"{p}✓")
            elif (is_long and s < -10) or (not is_long and s > 10):
                contradictory += 1
                details.append(f"{p}✗")
            else:
                details.append(f"{p}~")
        
        # 共振等级
        if aligned >= 4:
            resonance = "full"
            score = 30.0
        elif aligned >= 3 and contradictory == 0:
            resonance = "strong"
            score = 20.0
        elif aligned >= 2 and contradictory == 0:
            resonance = "partial"
            score = 10.0
        elif contradictory >= 2:
            resonance = "conflict"
            score = -15.0
        else:
            resonance = "none"
            score = 0.0
        
        # 入场周期15m单独判断（最关键）
        vp_15m = vp_scores.get("15m", 0)
        if (is_long and vp_15m < -10) or (not is_long and vp_15m > 10):
            score -= 20  # 入场周期严重矛盾，大扣分
            details.append("⚠️15m逆势")
        
        detail_str = f"共振={resonance} [{','.join(details)}] 一致{aligned}个/矛盾{contradictory}个"
        
        return {"resonance": resonance, "score": score, "details": detail_str, "aligned_periods": aligned}

    # ============================================
    # 第一阶段：选币+方向（舆情驱动）
    # ============================================
    async def screen_coins(self, session: aiohttp.ClientSession) -> list:
        """
        v16 纯做多选币系统 — 基于成交量寻找即将启动的做多机会
        
        核心理念：不追涨（不看24h涨幅），通过量能异动提前发现启动信号
        
        选币信号来源（全部基于前瞻指标）：
        1. 成交量暴增 — 量能突然放大（主力进场信号）
        2. 量价蓄力 — 成交量放大但价格还没大涨（吸筹阶段）
        3. 资金费率极端 — 空头拥挤看多
        4. 资金费率趋势 — 多头趋势确认
        5. OI急变 — 持仓量异常变化
        6. 新上市合约 — 天然高波动机会
        
        所有币种统一对待，无核心币种特殊逻辑。
        
        返回: [{symbol, suggested_dir, reasons[], screen_score}]
        """
        candidates = {}  # symbol → {direction, reasons, score}
        
        # ============================================
        # 1. 成交量暴增扫描（核心信号）— 从所有期货交易对中找放量币
        # ============================================
        try:
            async with session.get(
                "https://fapi.binance.com/fapi/v1/ticker/24hr",
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                tickers = await resp.json()
            
            usdt_pairs = [t for t in tickers if t["symbol"].endswith("USDT")]
            
            # 获取资金费率（后面也用）
            async with session.get(
                "https://fapi.binance.com/fapi/v1/premiumIndex",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                premiums = await resp.json()
            funding_map = {p["symbol"]: float(p.get("lastFundingRate", 0)) for p in premiums}
            
            for t in usdt_pairs:
                symbol = t["symbol"]
                volume_24h = float(t.get("quoteVolume", 0))
                change_24h = float(t.get("priceChangePercent", 0))
                price = float(t.get("lastPrice", 0))
                trades_count = int(t.get("count", 0))
                
                # 基础过滤：成交额太低的跳过
                if volume_24h < 5_000_000:
                    continue
                
                if symbol not in candidates:
                    candidates[symbol] = {"direction": None, "reasons": [], "score": 0}
                
                # ---- ① 成交额绝对值（流动性基础分，非决定性）----
                if volume_24h >= 1_000_000_000:
                    candidates[symbol]["score"] += 3
                elif volume_24h >= 500_000_000:
                    candidates[symbol]["score"] += 2
                
                # ---- ② 交易笔数（成交活跃度）----
                if trades_count >= 500000:
                    candidates[symbol]["score"] += 3
                    candidates[symbol]["reasons"].append(f"成交活跃({trades_count/1000:.0f}K笔)")
                
                # ---- ③ 量价蓄力信号（核心！）----
                # 成交量放大 但 价格还没大涨 = 主力在吸筹
                # 成交量放大 + 价格微跌/横盘 = 更强的吸筹信号
                if volume_24h >= 50_000_000:  # $50M+ 成交额才有意义
                    funding = funding_map.get(symbol, 0)
                    
                    # 放量但价格只微涨（+1%~+8%）→ 吸筹特征
                    if -2 < change_24h <= 8:
                        # 价格越平静，量能越大，吸筹信号越强
                        calm_score = max(0, 8 - abs(change_24h))  # 价格波动越小分越高
                        vol_score = min(10, volume_24h / 100_000_000 * 2)  # 成交额越大分越高
                        
                        if calm_score + vol_score >= 6:
                            candidates[symbol]["direction"] = "LONG"
                            candidates[symbol]["score"] += int(calm_score + vol_score)
                            candidates[symbol]["reasons"].append(
                                f"量能蓄力(Vol=${volume_24h/1e6:.0f}M 价格{change_24h:+.1f}%)"
                            )
                    
                    # 放量+微跌 → 恐慌抛售后主力接盘
                    elif -10 < change_24h <= -2:
                        candidates[symbol]["direction"] = "LONG"
                        candidates[symbol]["score"] += 8
                        candidates[symbol]["reasons"].append(
                            f"放量回调接盘(Vol=${volume_24h/1e6:.0f}M 跌{change_24h:.1f}%)"
                        )
                
                # ---- ④ 资金费率信号 ----
                fr = funding_map.get(symbol, 0)
                # 空头拥挤(费率为负) → 做多信号（空头平仓推高价格）
                if fr < -0.001:
                    candidates[symbol]["direction"] = "LONG"
                    candidates[symbol]["score"] += 8
                    candidates[symbol]["reasons"].append(f"空头拥挤(费率{fr*100:.3f}%)→看多")
                # 费率正但不极端 → 多头情绪温和，趋势可能延续
                elif 0 < fr < 0.001:
                    candidates[symbol]["score"] += 3
                    candidates[symbol]["reasons"].append(f"费率微正{fr*100:.3f}%→情绪偏多")
                    
        except Exception as e:
            logger.warning(f"量能选币失败: {e}")
        
        # ============================================
        # 2. 资金费率极端 — 从Redis读更精确的数据
        # ============================================
        try:
            import redis as _r
            rc = _r.from_url(REDIS_URL)
            funding_data = rc.xrevrange("stream:binance:funding", count=200)
            seen = set()
            for eid, raw in funding_data:
                sym = raw.get(b"symbol", raw.get("symbol", b""))
                if isinstance(sym, bytes): sym = sym.decode()
                if sym in seen:
                    continue
                seen.add(sym)
                
                rate = raw.get(b"rate", raw.get("rate", "0"))
                if isinstance(rate, bytes): rate = rate.decode()
                try:
                    rate_f = float(rate)
                except:
                    continue
                
                if sym not in candidates:
                    candidates[sym] = {"direction": None, "reasons": [], "score": 0}
                
                # 空头极度拥挤 → 强做多（空头平仓=买入压力）
                if rate_f <= -0.003:
                    candidates[sym]["direction"] = "LONG"
                    candidates[sym]["score"] += 20
                    candidates[sym]["reasons"].append(f"空头极度拥挤(费率{rate_f*100:.3f}%)→强做多")
                elif rate_f <= -0.002:
                    candidates[sym]["direction"] = "LONG"
                    candidates[sym]["score"] += 12
                    candidates[sym]["reasons"].append(f"空头拥挤(费率{rate_f*100:.3f}%)→看多")
                elif rate_f <= -0.001:
                    candidates[sym]["direction"] = "LONG"
                    candidates[sym]["score"] += 8
                    candidates[sym]["reasons"].append(f"费率偏空{rate_f*100:.3f}%→偏多")
        except Exception as e:
            logger.warning(f"费率选币失败: {e}")
        
        # ============================================
        # 3. OI急变 — 只关注有利于做多的信号
        # ============================================
        try:
            from sentiment_data import get_open_interest_sentiment
            oi_data = get_open_interest_sentiment()
            for d in oi_data.get("oi_details", []):
                sym = d["symbol"]
                oi_change = d.get("oi_change_3h", 0)
                sig = d.get("signal", "")
                if sym not in candidates:
                    candidates[sym] = {"direction": None, "reasons": [], "score": 0}
                # OI大增+价格上涨 → 多头建仓=看多
                if sig == "OI_EXTREME_OVERHEAT" and oi_change > 0:
                    candidates[sym]["direction"] = "LONG"
                    candidates[sym]["score"] += 8
                    candidates[sym]["reasons"].append(f"OI大增({oi_change:+.1f}%)→多头建仓")
                # OI大减 → 空头平仓=看多
                elif sig == "OI_MASS_UNWIND" and oi_change < 0:
                    candidates[sym]["direction"] = "LONG"
                    candidates[sym]["score"] += 8
                    candidates[sym]["reasons"].append(f"OI大减({oi_change:+.1f}%)→空头平仓")
        except Exception as e:
            logger.debug(f"OI选币跳过: {e}")
        
        # ============================================
        # 4. 资金费率趋势 — 只看有利于做多的方向
        # ============================================
        try:
            funding_trends = analyze_funding_for_screening()
            btc_trend = funding_trends.get("BTCUSDT")
            btc_rate_dir = "neutral"
            if btc_trend:
                btc_rate_dir = btc_trend.get("direction", "neutral")
            
            for sym, info in candidates.items():
                if sym == "BTCUSDT":
                    continue
                
                ft = funding_trends.get(sym)
                if not ft:
                    continue
                
                ft_dir = ft.get("direction", "neutral")
                ft_strength = ft.get("strength", 0)
                btc_div = ft.get("btc_divergence", "neutral")
                ind_signal = ft.get("independent_signal", "")
                
                # 只关注偏多方向
                if ft_dir in ["bullish", "slightly_bullish"] and ft_strength >= 3:
                    if info["direction"] is None:
                        info["direction"] = "LONG"
                    info["score"] += min(8, ft_strength)
                    info["reasons"].append(f"费率偏多({ft.get('label', '')[:30]})")
                
                # BTC联动 — 只在BTC也偏多时加强
                if btc_rate_dir in ["bullish", "slightly_bullish"]:
                    if info["direction"] == "LONG" or info["direction"] is None:
                        info["score"] += 3
                        if info["direction"] is None:
                            info["direction"] = "LONG"
                        info["reasons"].append("BTC费率偏多→联动看多")
                
                # 独立行情（与BTC背离）
                if "divergence" in btc_div and ind_signal and "看多" in ind_signal:
                    info["score"] += 5
                    info["reasons"].append(ind_signal[:50])
        except Exception as e:
            logger.debug(f"费率趋势选币跳过: {e}")
        
        # ============================================
        # 5. 新上市合约 — 天然高波动机会
        # ============================================
        try:
            from hot_scanner import scan_new_listings
            new_listings = await scan_new_listings(session)
            for n in new_listings:
                sym = n["symbol"]
                days = n.get("days_since_listing", 99)
                if sym not in candidates:
                    candidates[sym] = {"direction": None, "reasons": [], "score": 0}
                candidates[sym]["direction"] = "LONG"
                candidates[sym]["score"] += 10
                candidates[sym]["reasons"].append(f"🆕新上市{days:.0f}天→高波动机会")
        except Exception as e:
            logger.debug(f"新上市扫描跳过: {e}")
        
        # ============================================
        # 6. 筛选：统一标准，所有币一视同仁
        # ============================================
        results = []
        for sym, info in candidates.items():
            # 必须有LONG方向 + 分数≥5
            if info["direction"] != "LONG" or info["score"] < 5:
                continue
            
            results.append({
                "symbol": sym,
                "suggested_dir": "LONG",
                "screen_reasons": info["reasons"],
                "screen_score": info["score"],
            })
        
        # 按选币分数排序（高分优先分析）
        results.sort(key=lambda x: x["screen_score"], reverse=True)
        
        logger.info(f"🔍 v16选币结果: {len(results)}个做多候选 (全部统一筛选)")
        for c in results[:10]:
            logger.info(f"  📌 {c['symbol']:12s} 分数={c['screen_score']:2d} "
                        f"| {'; '.join(c['screen_reasons'][:2])}")
        
        return results
    # ============================================
    # 第二阶段：入场时机（技术面驱动）
    # ============================================
    async def analyze_entry(self, session: aiohttp.ClientSession, 
                            symbol: str, suggested_dir: str = None,
                            screen_reasons: list = None) -> Optional[TradeSignal]:
        """
        纯技术面分析入场时机
        
        如果 suggested_dir 由选币阶段提供，则：
        - 技术面只需要确认"可以入场"(不需要自己判断方向)
        - 门槛降低：技术面只要不反对即可入场
        
        如果没有 suggested_dir（核心币种），则：
        - 技术面需要自己判断方向
        - 门槛正常
        """
        logger.info(f"📊 技术分析 {symbol} (建议方向={suggested_dir or '待定'})...")
        
        # 1. 采集数据
        try:
            data = await asyncio.wait_for(collect_all_analysis(session, symbol), timeout=15)
        except Exception as e:
            logger.error(f"数据采集失败 {symbol}: {e}")
            return None

        price = data.get("funding", {}).get("mark_price", 0)
        if price == 0:
            price = data["klines"].get("1m", [{}])[-1].get("close", 0) if data["klines"].get("1m") else 0
        if price == 0:
            return None

        signal = TradeSignal(symbol)

        # 2. 多周期量价分析（入场周期为主，多周期共振为辅）
        vp_scores = {}
        vp_signals = {}
        for interval in ["5m", "15m", "1h", "4h", "1d"]:
            klines = data["klines"].get(interval, [])
            if klines:
                vp = analyze_volume_price(klines)
                vp_scores[interval] = vp["score"]
                vp_signals[interval] = vp["signals"]
        
        # 2a. 多周期量价共振检测
        vp_resonance = self._check_vp_resonance(vp_scores, suggested_dir)
        
        # 3. 订单簿分析
        ob = analyze_orderbook(data["depth"], price)

        # 4. 庄家行为
        whale = analyze_whale_behavior(data["trades"], data["klines"].get("1m", []))

        # 5. 趋势判断
        trend = analyze_trend(data["klines"])

        # 5a. SMC 智能资金概念分析 (BOS/CHoCH + OB + FVG + Premium/Discount)
        smc_klines = {}
        for interval in ["15m", "1h", "4h"]:
            if interval in data["klines"] and len(data["klines"][interval]) >= 10:
                smc_klines[interval] = data["klines"][interval]
        smc = analyze_smc(smc_klines) if smc_klines else {"bias": "neutral", "score": 0, "signals": [], "key_levels": {"supports": [], "resistances": [], "order_blocks": [], "fvg_unfilled": []}}

        # 6. 综合技术面评分（入场周期15m为核心，5m看即时动能，SMC占15%）
        tech_score = (
            vp_scores.get("5m", 0) * 0.10 +    # 即时动能
            vp_scores.get("15m", 0) * 0.20 +   # ⭐ 入场周期（最关键）
            vp_scores.get("1h", 0) * 0.10 +    # 中周期趋势
            vp_scores.get("4h", 0) * 0.05 +    # 大周期方向
            ob["score"] * 0.10 +
            whale["score"] * 0.10 +
            trend["score"] * 0.20 +            # 趋势权重微调(从0.30→0.20)
            vp_resonance["score"] * 0.05 +     # 多周期量价共振加分
            smc["score"] * 0.10                # 🧠 SMC 智能资金概念 (BOS/CHoCH+OB+FVG)
        )
        
        # 7. 方向判断逻辑（两阶段）
        if suggested_dir:
            # === 选币阶段已给出方向 ===
            # 技术面只需确认"不反对"
            # 检查趋势是否严重矛盾
            trend_resonance = trend.get("trend", "mixed")
            strong_contradiction = False
            
            if suggested_dir == "LONG" and trend_resonance == "strong_bearish":
                strong_contradiction = True
            elif suggested_dir == "SHORT" and trend_resonance == "strong_bullish":
                strong_contradiction = True
            
            if strong_contradiction:
                # 趋势严重矛盾 → 降级处理（方向不变但置信度大降）
                signal.direction = suggested_dir
                signal.confidence = 35  # 低置信度会被风控拦住
                signal.reasoning.append(f"⚠️ 趋势({trend_resonance})与建议方向矛盾")
            else:
                # 趋势不矛盾或一致 → 入场！
                signal.direction = suggested_dir
                
                # 置信度基于技术面支持程度
                base_conf = 60  # 被选中的币基础置信度60%
                tech_support = 0
                
                # 趋势一致加分
                if suggested_dir == "LONG" and "bullish" in trend_resonance:
                    tech_support += 15
                elif suggested_dir == "SHORT" and "bearish" in trend_resonance:
                    tech_support += 15
                
                # 量价支持加分（入场周期15m为核心，5m看即时确认）
                vp_15m = vp_scores.get("15m", 0)
                vp_5m = vp_scores.get("5m", 0)
                vp_1h = vp_scores.get("1h", 0)
                
                is_long = suggested_dir == "LONG"
                # 入场周期量价方向一致（最关键）
                if (is_long and vp_15m > 5) or (not is_long and vp_15m < -5):
                    tech_support += 10
                # 即时动能也一致（双重确认）
                if (is_long and vp_5m > 3) or (not is_long and vp_5m < -3):
                    tech_support += 5
                # 1h大势方向一致
                if (is_long and vp_1h > 5) or (not is_long and vp_1h < -5):
                    tech_support += 5
                # 多周期量价共振额外加分
                if vp_resonance["resonance"] in ["strong", "full"]:
                    tech_support += 5
                
                # 订单簿支持
                if (suggested_dir == "LONG" and ob["imbalance"] > 0.1) or \
                   (suggested_dir == "SHORT" and ob["imbalance"] < -0.1):
                    tech_support += 5
                
                signal.confidence = min(95, base_conf + tech_support)
                
                if tech_support >= 15:
                    signal.reasoning.append(f"✅ 技术面强力支持{tech_support}分")
                elif tech_support >= 5:
                    signal.reasoning.append(f"✅ 技术面基本支持{tech_support}分")
                else:
                    signal.reasoning.append(f"⚠️ 技术面中性(无反对)")
        else:
            # === 没有建议方向（核心币种）===
            # 技术面自己判断方向，用传统逻辑
            if tech_score > 8:
                signal.direction = "LONG"
            elif tech_score < -8:
                signal.direction = "SHORT"
            else:
                signal.direction = "NEUTRAL"
            
            if signal.direction != "NEUTRAL":
                signal.confidence = min(95, int(abs(tech_score) * 2 + 50))
            else:
                signal.confidence = max(0, 50 - int(abs(tech_score)))

        # 7a. SMC 信号注入 reasoning (BOS/CHoCH/OB/FVG)
        if smc["signals"]:
            # 取最有影响力的3条SMC信号
            top_smc = smc["signals"][:3]
            for s in top_smc:
                signal.reasoning.append(f"🧠 SMC: {s}")
        if smc["bias"] != "neutral" and smc["score"] != 0:
            # SMC方向与信号方向一致时加分
            smc_aligned = (signal.direction == "LONG" and smc["bias"] == "bullish") or \
                          (signal.direction == "SHORT" and smc["bias"] == "bearish")
            if smc_aligned:
                signal.confidence = min(95, signal.confidence + 5)
                signal.reasoning.append(f"🧠 SMC共振 {smc['bias']} (score={smc['score']})")
            elif signal.direction != "NEUTRAL":
                # SMC与信号矛盾时微降
                signal.confidence = max(20, signal.confidence - 3)
                signal.reasoning.append(f"⚠️ SMC矛盾 {smc['bias']} vs {signal.direction}")

        # 8. StochRSI 过滤
        klines_15m = data["klines"].get("15m", [])
        klines_1h = data["klines"].get("1h", [])
        stochrsi_15m = calc_stochrsi(klines_15m) if len(klines_15m) > 30 else {"valid": False}
        stochrsi_1h = calc_stochrsi(klines_1h) if len(klines_1h) > 30 else {"valid": False}

        if signal.direction != "NEUTRAL":
            stochrsi_check = check_stochrsi_entry(signal.direction, stochrsi_15m)
            if not stochrsi_check["allowed"]:
                signal.reasoning.append(f"⛔ {stochrsi_check['reason']}")
                # 选币阶段来的信号：不直接否决，而是大幅降权
                if suggested_dir:
                    signal.confidence = max(30, signal.confidence - 20)
                    signal.reasoning.append("📉 StochRSI不理想但选币信号强，降低仓位")
                else:
                    signal.direction = "NEUTRAL"
                    signal.confidence = 0
            else:
                signal.reasoning.append(f"✅ {stochrsi_check['reason']}")
                if signal.direction == "LONG" and stochrsi_15m.get("k_value", 50) < 30:
                    signal.confidence = min(95, signal.confidence + 10)
                elif signal.direction == "SHORT" and stochrsi_15m.get("k_value", 50) > 70:
                    signal.confidence = min(95, signal.confidence + 10)

        # 8a. 多周期 StochRSI 共振 (高灵敏度因子)
        multi_srsi = {"resonance_level": "none", "score": 0, "details": ""}
        if signal.direction != "NEUTRAL":
            multi_srsi = check_multi_timeframe_stochrsi(signal.direction, data["klines"])
            if multi_srsi["score"] > 0:
                signal.confidence = min(95, signal.confidence + multi_srsi["score"] // 3)
                signal.reasoning.append(multi_srsi["details"])
                # 强共振时大幅提高置信度
                if multi_srsi["resonance_level"] == "strong":
                    signal.confidence = min(95, signal.confidence + 10)
            elif multi_srsi["score"] < 0:
                signal.confidence = max(20, signal.confidence - abs(multi_srsi["score"]) // 3)

        # 8b. 量价背离检测 (高灵敏度因子)
        vol_div = {"divergence": False, "score": 0, "details": ""}
        if signal.direction != "NEUTRAL":
            # 用1h K线做量价背离
            klines_1h_data = data["klines"].get("1h", [])
            vol_div = detect_volume_divergence(klines_1h_data, signal.direction)
            if vol_div["score"] != 0:
                signal.confidence = min(95, signal.confidence + vol_div["score"] // 4)
                signal.reasoning.append(vol_div["details"])

        # 8c. 大单比率 (Taker Buy/Sell)
        taker = {"ratio": 1.0, "score": 0, "signal": "neutral", "details": ""}
        if signal.direction != "NEUTRAL":
            taker = analyze_taker_ratio(data.get("trades", []))
            if taker["score"] != 0:
                # 主力方向与交易方向一致加分，矛盾减分
                if signal.direction == "LONG" and taker["score"] > 0:
                    signal.confidence = min(95, signal.confidence + abs(taker["score"]) // 3)
                elif signal.direction == "SHORT" and taker["score"] < 0:
                    signal.confidence = min(95, signal.confidence + abs(taker["score"]) // 3)
                elif signal.direction == "LONG" and taker["score"] < 0:
                    signal.confidence = max(20, signal.confidence - abs(taker["score"]) // 4)
                elif signal.direction == "SHORT" and taker["score"] > 0:
                    signal.confidence = max(20, signal.confidence - abs(taker["score"]) // 4)
                signal.reasoning.append(taker["details"])

        # 8d. 早期启动检测 (Breakout Setup) — 高权重因子
        breakout = {"detected": False, "type": "none", "score": 0, "details": "", "breakout_level": 0}
        if signal.direction != "NEUTRAL":
            breakout = detect_breakout_setup(
                data["klines"].get("15m", []),
                data["klines"].get("1h", []),
                signal.direction
            )
            if breakout["score"] != 0:
                signal.confidence = min(95, signal.confidence + breakout["score"])
                if breakout["detected"]:
                    signal.reasoning.append(f"🚀 早期启动: {breakout['details']}")

        # 8e. 趋势回调入场 (Pullback Entry) — 高权重因子
        # 只在没检测到突破时才检查回调（突破和回调是互斥场景）
        pullback = {"detected": False, "type": "none", "score": 0, "details": "", "pullback_level": 0}
        if signal.direction != "NEUTRAL" and not breakout["detected"]:
            pullback = detect_pullback_entry(
                data["klines"].get("15m", []),
                data["klines"].get("1h", []),
                data["klines"].get("4h", []),
                signal.direction
            )
            if pullback["score"] != 0:
                signal.confidence = min(95, signal.confidence + pullback["score"])
                if pullback["detected"]:
                    signal.reasoning.append(f"🔄 回调入场: {pullback['details']}")

        # 9. 入场点 + 动态止损
        analysis_combined = {
            "price": price,
            "orderbook": ob,
            "trend": trend,
            "volume_price_1h": {"score": vp_scores.get("1h", 0)},
            "whale": whale,
            # SMC 关键价位 (OB/支撑阻力)
            "smc_supports": smc["key_levels"].get("supports", []),
            "smc_resistances": smc["key_levels"].get("resistances", []),
            "smc_obs": smc["key_levels"].get("order_blocks", []),
        }
        entry = find_entry_point(analysis_combined)
        signal.entry_zone = entry["entry_zone"]
        signal.targets = entry["targets"]
        signal.risk_reward = entry["risk_reward"]

        # 动态ATR止损
        if signal.direction != "NEUTRAL" and klines_15m:
            dyn_stop = calc_dynamic_stop(price, signal.direction, klines_15m,
                                         atr_multiplier=1.5, min_sl_pct=0.03)
            signal.stop_loss = dyn_stop["stop_loss"]
            signal.reasoning.append(
                f"🛑 ATR止损 {dyn_stop['sl_pct']:.1f}%")
            entry_price = (signal.entry_zone[0] + signal.entry_zone[1]) / 2
            if entry_price > 0:
                sl_dist = abs(entry_price - signal.stop_loss)
                tp_dist = abs(signal.targets[0] - entry_price) if signal.targets[0] > 0 else 0
                if sl_dist > 0 and tp_dist > 0:
                    signal.risk_reward = round(tp_dist / sl_dist, 2)
        else:
            signal.stop_loss = entry["stop_loss"]

        # 10. 仓位（基于置信度）
        if signal.confidence >= 80:
            signal.position_pct = 10
        elif signal.confidence >= 70:
            signal.position_pct = 7
        elif signal.confidence >= 60:
            signal.position_pct = 5
        elif signal.confidence >= 50:
            signal.position_pct = 3
        else:
            signal.position_pct = 0

        # 时间窗口
        if signal.confidence >= 70:
            signal.time_horizon = "scalp"
        elif signal.confidence >= 50:
            signal.time_horizon = "intraday"
        else:
            signal.time_horizon = "swing"

        # 11. 理由
        if screen_reasons:
            signal.reasoning = ["🔍 选币: " + r for r in screen_reasons[:3]] + signal.reasoning
        
        for interval, sigs in vp_signals.items():
            for s in sigs:
                if signal.direction == "LONG" and any(k in s for k in ["阳线", "买入", "支撑"]):
                    signal.reasoning.append(f"[{interval}] {s}")
                elif signal.direction == "SHORT" and any(k in s for k in ["阴线", "卖出", "压力"]):
                    signal.reasoning.append(f"[{interval}] {s}")
        
        # 量价共振判断写入reasoning
        if vp_resonance["resonance"] in ["full", "strong"]:
            signal.reasoning.append(f"📈 量价{vp_resonance['resonance']}共振: {vp_resonance['details']}")
        elif vp_resonance["resonance"] == "conflict":
            signal.reasoning.append(f"⚠️ 量价矛盾: {vp_resonance['details']}")
        
        if ob["imbalance"] > 0.15 and signal.direction == "LONG":
            signal.reasoning.append(f"📊 买盘厚{ob['bid_depth']:.1f}x")
        elif ob["imbalance"] < -0.15 and signal.direction == "SHORT":
            signal.reasoning.append(f"📊 卖盘厚{ob['ask_depth']:.1f}x")

        # 12. 分析详情
        signal.analysis_detail = {
            "total_score": round(tech_score, 1),
            "trend_resonance": trend.get("trend", "mixed"),
            "vp_scores": {k: round(v, 1) for k, v in vp_scores.items()},
            "vp_resonance": vp_resonance,
            "orderbook_imbalance": round(ob["imbalance"], 2),
            "whale_score": whale["score"],
            "stochrsi_15m": stochrsi_15m if isinstance(stochrsi_15m, dict) else {},
            "multi_srsi": multi_srsi,
            "volume_divergence": vol_div,
            "taker_ratio": taker,
            "breakout": breakout,
            "pullback": pullback,
            "suggested_dir": suggested_dir,
            "screen_score": 0,
            "price": price,
            "sentiment": {},
        }

        return signal

    def push_signals(self, signals: List[TradeSignal]):
        """推送信号到 Redis"""
        if not USE_REDIS:
            self._save_signals(signals)
            return
        for sig in signals:
            payload = {k: json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else str(v)
                       for k, v in sig.to_dict().items()}
            redis_client.xadd("stream:signals", payload, maxlen=200)

    def _save_signals(self, signals: List[TradeSignal]):
        date_str = datetime.now().strftime("%Y-%m-%d")
        filepath = DATA_DIR / f"signals-{date_str}.jsonl"
        for sig in signals:
            with open(filepath, "a") as f:
                f.write(json.dumps(sig.to_dict(), ensure_ascii=False) + "\n")


async def main(symbols: List[str] = None):
    """分析师主入口"""
    logger.info("📊 小风交易系统 - 分析师 Agent 启动")
    agent = AnalystAgent()
    signals = await agent.analyze_watchlist(symbols)
    agent.push_signals(signals)
    return signals


if __name__ == "__main__":
    asyncio.run(main())
