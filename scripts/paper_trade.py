"""
小风交易系统 - Phase 3 模拟盘引擎 (纸上交易)

职责：
1. 监听风控审批通过的信号 → 模拟开仓
2. 实时跟踪持仓价格 → 止损/止盈自动触发
3. 持仓状态看板 → Telegram 展示
4. 交易日志记录 → 复盘用

运行方式：
  python paper_trade.py          # 前台运行
  python paper_trade.py --once   # 单次检查（cron用）
"""
import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR, REDIS_URL, CORE_SYMBOLS

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
logger = logging.getLogger("PaperTrade")

# K线获取缓存（避免每60秒重复请求）
_kline_cache = {}
import time as _time


# ============================================
# 实时价格获取
# ============================================
async def fetch_prices(symbols: List[str]) -> Dict[str, float]:
    """批量获取当前价格"""
    import aiohttp
    prices = {}
    if not symbols:
        return prices

    url = "https://fapi.binance.com/fapi/v1/ticker/price"
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price_map = {d["symbol"]: float(d["price"]) for d in data}
                    for sym in symbols:
                        if sym in price_map:
                            prices[sym] = price_map[sym]
        except Exception as e:
            logger.warning(f"获取价格失败: {e}")
    return prices


async def fetch_price(symbol: str) -> Optional[float]:
    """获取单个币种价格"""
    p = await fetch_prices([symbol])
    return p.get(symbol)


async def fetch_klines_for_trend(symbol: str, interval: str = "15m", limit: int = 50) -> list:
    """获取K线数据用于趋势判断（带30秒缓存）"""
    cache_key = f"{symbol}_{interval}"
    now = _time.time()
    if cache_key in _kline_cache:
        cached_time, cached_data = _kline_cache[cache_key]
        if now - cached_time < 30:  # 30秒缓存
            return cached_data
    
    import aiohttp
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval={interval}&limit={limit}"
    klines = []
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status == 200:
                    raw = await resp.json()
                    for k in raw:
                        klines.append({
                            "open": float(k[1]), "high": float(k[2]),
                            "low": float(k[3]), "close": float(k[4]),
                            "volume": float(k[5]),
                        })
        except Exception as e:
            logger.debug(f"K线获取失败 {symbol}: {e}")
    
    _kline_cache[cache_key] = (now, klines)
    return klines


# ============================================
# 模拟盘引擎
# ============================================
class PaperTradeEngine:
    """纸上交易引擎"""

    def __init__(self):
        from risk_agent import RiskAgent
        self.risk = RiskAgent()
        self.trade_log_file = DATA_DIR / "trade-log.jsonl"
        logger.info(f"🏦 模拟盘启动 | 资金: ${self.risk.capital:,.0f} | 持仓: {len(self.risk.positions)}笔")

    # ---- 开仓 ----
    async def execute_open(self, review: dict, signal: dict) -> str:
        """执行模拟开仓"""
        if not review.get("approved"):
            return f"❌ 信号被风控拒绝: {review.get('reason', '未知')}"

        sym = review["symbol"]
        if sym in self.risk.positions:
            return f"⚠️ {sym} 已有持仓，跳过"

        # 获取实时价格作为入场价
        live_price = await fetch_price(sym)
        if not live_price:
            return f"❌ 无法获取 {sym} 实时价格"

        # 用实时价调整入场价
        entry = live_price
        orig_entry = review.get("entry_price", entry)
        review["entry_price"] = entry

        # 调整止损（基于实时价）
        sl = review.get("stop_loss", 0)
        direction = review["direction"]
        if sl == 0:
            sl = entry * (0.97 if direction == "LONG" else 1.03)  # 默认3%
        else:
            # 按比例调整止损到实时价附近
            if orig_entry > 0:
                price_diff_pct = (entry - orig_entry) / orig_entry
                sl = sl * (1 + price_diff_pct)
        
        # ★ 止损安全校验：调整后止损距不超过5%（币价），否则强制收紧
        sl_dist_pct = abs(sl - entry) / entry * 100 if entry > 0 else 0
        if sl_dist_pct > 5.0:
            logger.warning(f"⚠️ {sym} 止损距{sl_dist_pct:.1f}%过宽，强制收紧到3%")
            sl = entry * (0.97 if direction == "LONG" else 1.03)
            sl_dist_pct = 3.0
        
        review["stop_loss"] = sl

        # 按比例调整止盈目标到实时价附近
        targets = signal.get("targets", [])
        if orig_entry > 0 and targets:
            price_ratio = entry / orig_entry
            adjusted_targets = [round(t * price_ratio, 8) for t in targets]
            signal["targets"] = adjusted_targets

        # 调整仓位大小 — 严格保证金5%上限（与risk_agent一致）
        risk_dist = abs(entry - sl)
        if risk_dist > 0:
            max_margin = self.risk.capital * 0.05  # 单笔最大保证金5%
            leverage = review.get("leverage", 1)
            margin_based_size = max_margin * leverage / entry  # 保证金上限反算
            max_risk = self.risk.capital * 0.05  # 单笔最大风险5%
            risk_based_size = max_risk / risk_dist  # 风险反算
            position_size = min(risk_based_size, margin_based_size)  # 取较小值
            
            # ★ v19修复: 最小名义值检查 — notional < $100则无意义
            notional = position_size * entry
            if notional < 100:
                logger.warning(f"⚠️ {sym} 计算仓位名义值=${notional:.2f} < $100最低线，跳过开仓")
                return f"⚠️ {sym} 仓位太小(名义${notional:.2f})，跳过"
            
            review["position_size"] = round(position_size, 4)
        else:
            return f"❌ {sym} 无法计算仓位(止损距离为0)"

        # 开仓
        self.risk.open_position(review, signal)

        # 记录日志
        self._log_trade("OPEN", review, signal, entry)

        # 计算名义持仓
        qty = review['position_size']
        notional = entry * qty

        report = (
            f"📈 *模拟开仓成功*\n"
            f"#{sym.replace('USDT','')} | {direction} | {review.get('leverage', 1)}x\n"
            f"📍 入场: ${entry:,.4f}\n"
            f"📦 {qty:,.2f}个 = ${notional:,.0f}\n"
            f"🛑 止损: ${sl:,.4f}\n"
            f"🎯 目标: {', '.join(f'${t:,.4f}' for t in signal.get('targets', [])[:3])}\n"
            f"⚖️ 盈亏比: {review.get('risk_reward', 0):.1f}\n"
            f"⚠️ 风险等级: {review.get('risk_level', '?')}\n"
        )
        if review.get("warnings"):
            report += f"⚠️ {', '.join(review['warnings'])}\n"

        logger.info(f"📈 模拟开仓 {sym} {direction} @${entry:,.2f}")
        return report

    # ---- 平仓 ----
    def execute_close(self, symbol: str, exit_price: float, reason: str = "") -> Optional[str]:
        """执行模拟平仓"""
        if symbol not in self.risk.positions:
            return None

        pos = self.risk.positions[symbol]
        record = self.risk.close_position(symbol, exit_price, reason)
        if not record:
            return None

        # 记录日志
        self._log_trade("CLOSE", None, None, exit_price, pos, record)

        emoji = "✅" if record.pnl_pct >= 0 else "❌"
        # 真实盈亏 = 名义持仓 × 价格涨跌
        notional = pos.entry_price * pos.quantity
        price_change_pct = (exit_price - pos.entry_price) / pos.entry_price * 100
        if pos.direction == "SHORT":
            price_change_pct = -price_change_pct
        dollar_pnl = notional * price_change_pct / 100

        report = (
            f"{emoji} *模拟平仓*\n"
            f"#{symbol.replace('USDT','')} | {pos.direction} | {pos.leverage}x\n"
            f"📍 ${pos.entry_price:,.4f} → ${exit_price:,.4f} ({price_change_pct:+.2f}%)\n"
            f"📦 {pos.quantity:,.2f}个 × ${notional:,.0f}\n"
            f"💵 盈亏: ${dollar_pnl:+,.2f}\n"
            f"💰 资金: ${self.risk.capital:,.0f}\n"
            f"📝 原因: {reason or '手动平仓'}\n"
        )
        logger.info(f"📊 模拟平仓 {symbol} 涨跌{price_change_pct:+.2f}% 盈亏${dollar_pnl:+,.2f} 原因={reason}")
        return report

    # ---- 止损止盈监控 ----
    async def check_positions(self) -> List[str]:
        """
        v17 结构止盈系统 — 波浪目标位 + 结构破坏确认
        
        核心思路（以波浪理论为基础）：
        1. 开仓时计算三浪目标位（Fib扩展1.618/2.618）
        2. 到目标位分批止盈（TP1=1.618平50%, TP2=2.618平25%）
        3. 剩余仓位用结构破坏来平（1h出现Lower High = 三浪结束）
        4. 止损 = 区间最低点（不变）
        
        不依赖AI，纯规则引擎。
        """
        if not self.risk.positions:
            return []

        symbols = list(self.risk.positions.keys())
        prices = await fetch_prices(symbols)
        results = []

        for sym, pos in list(self.risk.positions.items()):
            price = prices.get(sym)
            if not price:
                continue

            closed = False

            # ====== 基础数据 ======
            pnl_pct = (price - pos.entry_price) / pos.entry_price * 100  # 只做多
            pos.unrealized_pnl_pct = pnl_pct

            # 更新历史最高浮盈
            if pnl_pct > pos.max_profit_pct:
                pos.max_profit_pct = pnl_pct

            # 最小持仓时间（3分钟内不平仓）
            MIN_HOLD_SECONDS = 180
            if pos.opened_at:
                try:
                    opened = datetime.fromisoformat(pos.opened_at)
                    held = (datetime.now(timezone.utc) - opened).total_seconds()
                    if held < MIN_HOLD_SECONDS:
                        continue
                except:
                    pass

            # ====== v19: 跟踪止损（Trailing Stop Loss）======
            # 核心理念：波浪不是用来设止盈的，是用来判断趋势和拿住单子的
            # SL = 实际结构支撑位(Swing Low)，不硬编码百分比
            # 随着价格上涨，SL跟着最新的Swing Low上移 → 让利润奔跑
            # 三浪走完（1h下降结构确认）→ 全平
            
            # --- 跟踪止损更新：每次check都重新计算Swing Low ---
            if not closed and pos.stop_loss > 0:
                try:
                    from direction_rules import detect_swing_points
                    # 用1h K线计算最新Swing Low（比15m更稳定，不易被噪音甩下车）
                    klines_1h_trend = await fetch_klines_for_trend(sym, "1h", 50)
                    if klines_1h_trend and len(klines_1h_trend) >= 20:
                        closes_sl = [float(k.get('close', 0)) for k in klines_1h_trend]
                        lows_sl = [float(k.get('low', 0)) for k in klines_1h_trend]
                        struct_sl = detect_swing_points(closes_sl, closes_sl, lows_sl, left=3, right=3)
                        new_sl = struct_sl.get('last_swing_low', 0)
                        
                        if new_sl > 0:
                            # Swing Low必须高于当前SL才能上移（只上移不下移）
                            if new_sl > pos.stop_loss:
                                old_sl = pos.stop_loss
                                pos.stop_loss = new_sl
                                sl_move = (new_sl - old_sl) / pos.entry_price * 100
                                logger.info(f"📈 {sym} 跟踪止损上移: ${old_sl:.4f}→${new_sl:.4f} (+{sl_move:.1f}%)")
                except Exception as e:
                    logger.debug(f"跟踪止损计算失败 {sym}: {e}")

            # --- SL保护：如果SL在入场价上方（异常情况），不允许低于入场价 ---
            if not closed and pos.stop_loss > 0:
                if pos.stop_loss >= pos.entry_price:
                    # SL已经上移到入场价以上（盈利保护状态），这是正常的
                    # 只需要确保它确实是一个有效支撑
                    pass
                # 如果初始SL还没设（旧数据兼容），用1h Swing Low
                if pos.stop_loss <= 0:
                    try:
                        from direction_rules import detect_swing_points
                        klines_15m = await fetch_klines_for_trend(sym, "15m", 50)
                        if klines_15m and len(klines_15m) >= 20:
                            closes_15m = [float(k.get('close', 0)) for k in klines_15m]
                            lows_15m = [float(k.get('low', 0)) for k in klines_15m]
                            struct = detect_swing_points(closes_15m, closes_15m, lows_15m, left=3, right=3)
                            sl_candidate = struct.get('last_swing_low', 0)
                            if sl_candidate > 0 and sl_candidate < pos.entry_price:
                                pos.stop_loss = sl_candidate
                    except:
                        pass

            # --- 止损触发 ---
            if not closed and pos.stop_loss > 0 and price <= pos.stop_loss:
                # 判断是亏损止损还是盈利回撤止损
                if pos.stop_loss >= pos.entry_price:
                    reason = f"🔒 盈利保护止损 @{pos.stop_loss:,.6f} (浮盈{pnl_pct:+.1f}%)"
                else:
                    reason = f"🛑 结构止损 @{pos.stop_loss:,.6f} (浮盈{pnl_pct:+.1f}%)"
                r = self.execute_close(sym, pos.stop_loss, reason)
                if r: results.append(r)
                closed = True
                logger.info(f"🛑 {sym} 止损触发: 价格${price:.6f} <= SL${pos.stop_loss:.6f}")

            # ====== v20: 两级结构止盈（级别匹配入场级别）======
            # 核心思路：入场看4h底部突破 → 止盈也要看4h顶部结构
            # 第一级：1h出顶部结构 → 先出50%锁利润，SL移到保本
            # 第二级：4h出顶部结构 → 全平剩余仓位（大趋势真正反转）
            # 如果入场级别是1h（没有4h突破），则1h出顶就直接全平
            if not closed and pnl_pct > 2.0:
                try:
                    from wave_pattern import detect_top_pattern

                    # --- 第一级：1h顶部结构 → 部分平仓 ---
                    if not pos.tp_level1_done:
                        klines_1h_exit = await fetch_klines_for_trend(sym, "1h", 80)
                        if klines_1h_exit and len(klines_1h_exit) >= 30:
                            top_1h = detect_top_pattern(klines_1h_exit)
                            if top_1h:
                                tp_name = {"double_top": "双顶", "head_shoulders_top": "头肩顶", "multiple_top": "多重顶"}.get(top_1h.pattern_type, top_1h.pattern_type)

                                # 如果入场级别是1h（或未知），1h出顶直接全平
                                if pos.entry_wave_level != "4h":
                                    r = self.execute_close(sym, price,
                                        f"🎯 1h{tp_name}破颈线${top_1h.neckline:.4f} 全平 (浮盈{pnl_pct:+.1f}%)")
                                    if r: results.append(r)
                                    closed = True
                                    logger.info(f"🎯 {sym} 1h级止盈(入场1h): {tp_name}, 浮盈{pnl_pct:+.1f}%")
                                else:
                                    # 入场是4h级别 → 只出50%锁利润，剩余等4h信号
                                    result = self.risk.close_partial_position(sym, price, 0.5,
                                        f"🎯 1h{tp_name}破颈线 → 先出50%锁利润 (浮盈{pnl_pct:+.1f}%)")
                                    if result:
                                        pos.tp_level1_done = True
                                        # close_partial_position已自动将SL移到保本价
                                        logger.info(f"🎯 {sym} 第一级止盈: 1h{tp_name}, 出50%, 剩余等4h信号, SL已移保本")
                                        results.append(
                                            f"✂️ *部分平仓(50%)*\n"
                                            f"#{sym.replace('USDT','')} | 1h{tp_name}\n"
                                            f"📍 浮盈{pnl_pct:+.1f}%\n"
                                            f"📝 剩余仓位等4h顶部结构信号\n"
                                            f"🛡️ SL已移至保本价"
                                        )

                    # --- 第二级：4h顶部结构 → 全平剩余 ---
                    if not closed and pos.entry_wave_level == "4h" and pos.tp_level1_done:
                        klines_4h_exit = await fetch_klines_for_trend(sym, "4h", 120)
                        if klines_4h_exit and len(klines_4h_exit) >= 30:
                            top_4h = detect_top_pattern(klines_4h_exit)
                            if top_4h:
                                tp_name = {"double_top": "双顶", "head_shoulders_top": "头肩顶", "multiple_top": "多重顶"}.get(top_4h.pattern_type, top_4h.pattern_type)
                                r = self.execute_close(sym, price,
                                    f"🎯 4h{tp_name}破颈线${top_4h.neckline:.4f} → 全平剩余 (浮盈{pnl_pct:+.1f}%)")
                                if r: results.append(r)
                                closed = True
                                logger.info(f"🎯 {sym} 第二级止盈: 4h{tp_name}, 全平剩余, 浮盈{pnl_pct:+.1f}%")

                except Exception as e:
                    logger.debug(f"结构止盈检测失败 {sym}: {e}")

            # ====== v20: 超时保护（不跟盈利趋势作对）======
            # 盈利中：不设超时！4h趋势走三浪可能几周，让跟踪止损+结构止盈管理
            # 亏损中：超过168小时(7天)还在亏 → 趋势判断可能错了，强制离场
            if not closed and pnl_pct < 0 and sym in self.risk.positions:
                pos2 = self.risk.positions[sym]
                if pos2.opened_at:
                    try:
                        opened = datetime.fromisoformat(pos2.opened_at)
                        held = (datetime.now(timezone.utc) - opened).total_seconds()
                        if held > 168 * 3600:  # 7天
                            r = self.execute_close(sym, price,
                                f"⏰ 亏损持仓超7天强制平仓 (浮亏{pnl_pct:+.1f}%)")
                            if r: results.append(r)
                    except:
                        pass

        # 保存状态
        self.risk._save_state()
        return results


    # ---- 持仓看板 ----
    async def dashboard(self) -> str:
        """生成持仓看板"""
        if not self.risk.positions:
            return "📭 当前无持仓"

        symbols = list(self.risk.positions.keys())
        prices = await fetch_prices(symbols)

        lines = [
            f"📊 *持仓看板* ⏰ {datetime.now().strftime('%H:%M')}\n"
            f"💰 资金: ${self.risk.capital:,.0f} | "
            f"持仓: {len(self.risk.positions)}笔\n"
        ]

        total_unrealized = 0
        for sym, pos in self.risk.positions.items():
            price = prices.get(sym, pos.entry_price)
            if pos.direction == "LONG":
                pnl_pct = (price - pos.entry_price) / pos.entry_price * 100
                pnl_usd = (price - pos.entry_price) * pos.quantity
            else:
                pnl_pct = (pos.entry_price - price) / pos.entry_price * 100
                pnl_usd = (pos.entry_price - price) * pos.quantity

            total_unrealized += pnl_usd
            emoji = "🟢" if pnl_pct >= 0 else "🔴"

            # 分批止盈状态
            tp_status = ""
            if pos.tp1_closed or pos.tp2_closed:
                parts = []
                if pos.tp1_closed:
                    parts.append("T1✅")
                if getattr(pos, 'tp2_closed', False):
                    parts.append("T2✅")
                tp_status = f"  ✂️ {', '.join(parts)}\n"

            lines.append(
                f"{emoji} *{sym.replace('USDT','')}* {pos.direction} {pos.leverage}x\n"
                f"  📍 {pos.entry_price:,.4f} → {price:,.4f}\n"
                f"  📦 {pos.quantity:,.2f} | 名义: ${pos.entry_price*pos.quantity:,.0f}\n"
                f"  📊 {pnl_pct:+.2f}% (${pnl_usd:+,.0f})\n"
                f"  🛑 SL: {pos.stop_loss:,.4f}"
                + (f"\n{tp_status}" if tp_status else "")
            )

        # 总览
        exp = self.risk.get_exposure()
        wr = exp.get('win_rate', 0)
        lines.append(
            f"\n📊 总仓位: {exp['total_pct']}% | "
            f"多: {exp['long_pct']}% 空: {exp['short_pct']}%\n"
            f"💵 未实现盈亏: ${total_unrealized:+,.0f}\n"
            f"📈 日收益: {exp['daily_pnl_pct']:+.2f}% (${exp.get('daily_pnl_usd', 0):+,.0f})"
            f" | 周收益: {exp.get('weekly_change_pct', 0):+.2f}%\n"
            f"💰 资金: ${self.risk.capital:,.0f}"
            f" (日初${exp.get('today_start_capital', 0):,.0f}"
            f" 周初${exp.get('week_start_capital', 0):,.0f})\n"
            f"📊 累计: {exp.get('total_trades', 0)}笔"
            f" 胜{exp.get('total_wins', 0)} 负{exp.get('total_losses', 0)}"
            f" 胜率{wr:.0f}%"
        )

        return "\n".join(lines)

    # ---- 交易日志 ----
    def _log_trade(self, action: str, review=None, signal=None, price: float = 0,
                   position=None, record=None):
        """记录交易日志"""
        entry = {
            "action": action,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "price": price,
        }
        if review:
            entry["symbol"] = review.get("symbol", "")
            entry["direction"] = review.get("direction", "")
            entry["position_size"] = review.get("position_size", 0)
            entry["leverage"] = review.get("leverage", 1)
            entry["stop_loss"] = review.get("stop_loss", 0)
            entry["risk_level"] = review.get("risk_level", "")
        if position:
            entry["symbol"] = position.symbol
            entry["direction"] = position.direction
            entry["entry_price"] = position.entry_price
            entry["quantity"] = position.quantity
            entry["leverage"] = position.leverage
        if record:
            entry["exit_price"] = record.exit_price
            entry["pnl_pct"] = record.pnl_pct
            entry["quantity"] = record.quantity
            entry["reason"] = record.reason if hasattr(record, 'reason') else ""
            # 计算美元盈亏和资金回报
            if position:
                dollar_pnl = (record.exit_price - position.entry_price) * record.quantity
                if position.direction == "SHORT":
                    dollar_pnl = -dollar_pnl
                entry["dollar_pnl"] = round(dollar_pnl, 2)
                margin = position.entry_price * record.quantity / position.leverage
                entry["margin"] = round(margin, 2)
                notional = position.entry_price * record.quantity
                entry["notional"] = round(notional, 2)
                # 资金回报率 = 美元盈亏 / 当前资金
                capital_before = self.risk.capital - dollar_pnl  # 平仓前资金
                if capital_before > 0:
                    entry["capital_return_pct"] = round(dollar_pnl / capital_before * 100, 2)

        with open(self.trade_log_file, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # ---- 交易历史 ----
    def trade_history(self, limit: int = 10) -> str:
        """交易历史报告"""
        if not self.trade_log_file.exists():
            return "📭 暂无交易记录"

        lines = [f"📋 *交易记录* (最近{limit}笔)\n"]
        count = 0
        with open(self.trade_log_file) as f:
            all_lines = f.readlines()

        for line in reversed(all_lines[-limit * 3:]):
            if count >= limit:
                break
            try:
                t = json.loads(line)
                if t.get("action") != "CLOSE":
                    continue
                emoji = "✅" if t.get("pnl_pct", 0) >= 0 else "❌"
                dollar = t.get("dollar_pnl", 0)
                dollar_str = f" ${dollar:+,.0f}" if dollar else ""
                qty = t.get("quantity", 0)
                qty_str = f" {qty:,.0f}个" if qty else ""
                lines.append(
                    f"{emoji} {t.get('symbol','').replace('USDT','')} "
                    f"{t.get('direction','')} "
                    f"{t.get('pnl_pct',0):+.2f}%{dollar_str}{qty_str} "
                    f"_{t.get('timestamp','')[:16]}_"
                )
                count += 1
            except:
                pass

        if count == 0:
            return "📭 暂无已平仓记录"

        # 统计
        wins = sum(1 for l in all_lines[-50:] if '"pnl_pct"' in l and json.loads(l).get("pnl_pct", 0) >= 0 and json.loads(l).get("action") == "CLOSE")
        total = sum(1 for l in all_lines[-50:] if '"action": "CLOSE"' in l)

        if total > 0:
            lines.append(f"\n📊 近{total}笔: 胜率 {wins/total*100:.0f}% ({wins}胜/{total-wins}负)")

        return "\n".join(lines)

    # ---- 全量分析 + 开仓流程 ----
    async def run_signal_pipeline(self) -> List[str]:
        """运行完整的 分析→风控→开仓 流程"""
        results = []
        try:
            from analyst_agent import AnalystAgent
            agent = AnalystAgent()
            signals = await agent.analyze_watchlist(include_hot=True)

            for sig in signals:
                sig_dict = sig.to_dict()
                review = self.risk.review_signal(sig_dict)

                if review.get("approved"):
                    r = await self.execute_open(review, sig_dict)
                    results.append(r)
                # 不记录被拒绝的信号（太多了）

        except Exception as e:
            results.append(f"❌ 信号流程出错: {e}")
            logger.error(f"信号流程出错: {e}", exc_info=True)

        return results


# ============================================
# 主循环
# ============================================
async def main_loop(interval: int = 60, once: bool = False):
    """主循环：监控止损止盈 + 定时扫描信号"""
    engine = PaperTradeEngine()

    cycle = 0
    while True:
        cycle += 1
        try:
            # 1. 检查持仓止损止盈
            closes = await engine.check_positions()
            for c in closes:
                logger.info(c[:200])

            # 2. 每15分钟运行一次信号扫描
            if cycle % 15 == 1:
                logger.info("🔄 运行信号扫描...")
                results = await engine.run_signal_pipeline()
                for r in results:
                    logger.info(r[:200])

            # 3. 输出看板
            if cycle % 10 == 1:
                dash = await engine.dashboard()
                logger.info(f"📊 看板:\n{dash}")

        except Exception as e:
            logger.error(f"主循环错误: {e}", exc_info=True)

        if once:
            break
        await asyncio.sleep(interval)


# ============================================
# 入口
# ============================================
async def test():
    """快速测试"""
    engine = PaperTradeEngine()

    # 1. 看板（无持仓）
    print(await engine.dashboard())
    print()

    # 2. 运行信号管道
    print("=== 信号管道测试 ===")
    results = await engine.run_signal_pipeline()
    for r in results:
        print(r)
    if not results:
        print("（当前无信号通过风控，正常）")

    # 3. 检查持仓
    closes = await engine.check_positions()
    for c in closes:
        print(c)

    # 4. 看板
    print("\n=== 看板 ===")
    print(await engine.dashboard())

    # 5. 历史记录
    print("\n=== 历史 ===")
    print(engine.trade_history())


if __name__ == "__main__":
    if "--test" in sys.argv:
        asyncio.run(test())
    elif "--once" in sys.argv:
        asyncio.run(main_loop(once=True))
    else:
        asyncio.run(main_loop())

