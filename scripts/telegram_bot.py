"""
小风交易系统 - Telegram Bot 交互接口

让主人通过 Telegram 对话控制交易系统：
/scan      - 扫描爆款山寨币
/analyze   - 分析指定币种 (如 /analyze BTCUSDT)
/status    - 查看风控状态
/signals   - 查看最近信号
/trade     - 查看交易池
/open      - 分析+风控+开仓 (自动执行信号)
/close X   - 手动平仓 (如 /close SOL)
/positions - 持仓看板
/history   - 交易记录
/help      - 帮助

设计为 Hermes Agent 的命令调度器，
由小风在 TG 对话中识别指令后调用。
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR, REDIS_URL, CORE_SYMBOLS

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
logger = logging.getLogger("TelegramBot")


# ============================================
# 命令处理器
# ============================================
class TradingBot:
    """交易系统 Telegram 命令调度器"""

    def __init__(self):
        self._ensure_modules()

    def _ensure_modules(self):
        """延迟导入，避免循环依赖"""
        self._hot_scanner = None
        self._analyst = None
        self._risk = None
        self._paper_engine = None

    @property
    def risk_agent(self):
        if self._risk is None:
            from risk_agent import RiskAgent
            self._risk = RiskAgent()
        return self._risk

    @property
    def paper_engine(self):
        if self._paper_engine is None:
            from paper_trade import PaperTradeEngine
            self._paper_engine = PaperTradeEngine()
        return self._paper_engine

    # ---- /scan 爆款扫描 ----
    async def cmd_scan(self) -> str:
        """扫描币安爆款山寨币"""
        import aiohttp
        from hot_scanner import scan_hot_coins, format_hot_report, scan_new_listings

        async with aiohttp.ClientSession() as session:
            hot = await scan_hot_coins(session)
            new = await scan_new_listings(session)

        report = format_hot_report(hot)
        if new:
            report += f"\n\n🆕 *新上线:* {', '.join(n['symbol'].replace('USDT','') for n in new)}"
        return report

    # ---- /analyze 分析币种 ----
    async def cmd_analyze(self, symbol: str = "") -> str:
        """对指定币种进行深度分析"""
        if not symbol:
            return "用法: /analyze BTCUSDT"

        symbol = symbol.upper()
        if not symbol.endswith("USDT"):
            symbol += "USDT"

        try:
            from analyst_agent import AnalystAgent
            agent = AnalystAgent()
            signals = await agent.analyze_watchlist([symbol], include_hot=False)

            if not signals:
                return f"❌ 无法分析 {symbol}"

            sig = signals[0]
            report = sig.to_telegram()

            # 加上详细分数
            d = sig.analysis_detail
            if d:
                report += f"\n\n📊 *分析细节:*"
                report += f"\n  综合分: {d.get('total_score', 0):+.1f}"
                report += f"\n  趋势: {d.get('trend_resonance', '?')}"
                report += f"\n  订单簿: {d.get('ob_imbalance', 0):+.3f}"
                report += f"\n  庄家: {d.get('whale_pressure', 0):+.3f}"
                scores = d.get("scores", {})
                if scores:
                    report += f"\n  量价5m: {scores.get('vp_5m', 0):+d}"
                    report += f"\n  量价1h: {scores.get('vp_1h', 0):+d}"
                    report += f"\n  量价4h: {scores.get('vp_4h', 0):+d}"

            # 风控审核
            review = self.risk_agent.review_signal(sig.to_dict())
            report += f"\n\n{self.risk_agent.to_telegram_review(review)}"

            return report

        except Exception as e:
            return f"❌ 分析失败: {e}"

    # ---- /status 风控状态 ----
    def cmd_status(self) -> str:
        """查看风控状态"""
        return self.risk_agent.status_report()

    # ---- /signals 最近信号 ----
    def cmd_signals(self) -> str:
        """查看最近的交易信号"""
        # 从 Redis 读取
        try:
            import redis
            rc = redis.from_url(REDIS_URL)
            entries = rc.xrevrange("stream:signals", count=5)
            if not entries:
                return "📭 暂无信号记录"

            lines = ["📋 *最近信号*\n"]
            for msg_id, data in entries:
                raw = {k.decode() if isinstance(k, bytes) else k: 
                       v.decode() if isinstance(v, bytes) else v 
                       for k, v in data.items()}
                sym = raw.get("symbol", "?")
                d = raw.get("direction", "?")
                c = raw.get("confidence", "?")
                ts = raw.get("timestamp", "?")
                lines.append(f"• {sym} {d} {c}% _{ts[:16]}_")

            return "\n".join(lines)
        except Exception as e:
            # 从文件读取
            import glob
            files = sorted(glob.glob(str(DATA_DIR / "signals-*.jsonl")))
            if not files:
                return "📭 暂无信号记录"

            lines = ["📋 *最近信号*\n"]
            with open(files[-1]) as f:
                all_lines = f.readlines()[-5:]
            for line in all_lines:
                try:
                    sig = json.loads(line)
                    lines.append(
                        f"• {sig.get('symbol','?')} {sig.get('direction','?')} "
                        f"{sig.get('confidence','?')}% "
                        f"_{sig.get('timestamp','')[:16]}_"
                    )
                except:
                    pass
            return "\n".join(lines)

    # ---- /trade 交易池 ----
    async def cmd_trade(self) -> str:
        """查看筛选器交易池 + 爆款"""
        import aiohttp

        lines = ["🎯 *交易池* ⏰ " + datetime.now().strftime("%H:%M") + "\n"]

        # 从筛选器状态
        screener_file = DATA_DIR / "screener-state.json"
        if screener_file.exists():
            try:
                state = json.loads(screener_file.read_text())
                lines.append(f"👁️ 观察: {state.get('watch_count',0)} | "
                           f"🔍 关注: {state.get('focus_count',0)} | "
                           f"🎯 交易: {state.get('trade_count',0)}\n")
                for c in state.get("trade_pool", [])[:10]:
                    emoji = "🟢" if c.get("change_24h", 0) > 0 else "🔴"
                    lines.append(
                        f"{emoji} *{c['symbol'].replace('USDT','')}* "
                        f"{c.get('change_24h',0):+.1f}% "
                        f"Vol:${c.get('volume_24h',0)/1e6:.0f}M "
                        f"分:{c.get('score_total',0):.0f}"
                    )
            except:
                pass
        else:
            lines.append("_筛选器未运行，加载实时爆款..._\n")

        # 加上实时爆款 TOP 5
        try:
            from hot_scanner import scan_hot_coins
            async with aiohttp.ClientSession() as session:
                hot = await scan_hot_coins(session)
            if hot:
                lines.append("\n🔥 *实时爆款 TOP5:*")
                for h in hot[:5]:
                    emoji = "🟢" if h.change_24h > 0 else "🔴"
                    lines.append(
                        f"{emoji} *{h.symbol.replace('USDT','')}* "
                        f"{h.change_24h:+.1f}% "
                        f"Vol:${h.volume_24h/1e6:.0f}M "
                        f"⭐{h.hot_score:.0f}"
                    )
        except:
            pass

        return "\n".join(lines)

    # ---- /open 自动开仓 ----
    async def cmd_open(self, symbol: str = "") -> str:
        """分析→风控→开仓一体化"""
        if symbol:
            symbol = symbol.upper()
            if not symbol.endswith("USDT"):
                symbol += "USDT"
            symbols = [symbol]
        else:
            symbols = None  # 全部核心+爆款

        try:
            from analyst_agent import AnalystAgent
            agent = AnalystAgent()
            signals = await agent.analyze_watchlist(symbols, include_hot=not symbol)

            if not signals:
                return "❌ 无可用信号"

            reports = []
            for sig in signals:
                sig_dict = sig.to_dict()
                review = self.risk_agent.review_signal(sig_dict)

                if review.get("approved"):
                    r = await self.paper_engine.execute_open(review, sig_dict)
                    reports.append(r)
                elif symbol:  # 只显示指定币的拒绝原因
                    reports.append(self.risk_agent.to_telegram_review(review))

            if not reports:
                return "📭 所有信号均未通过风控（方向不明/置信度不够），等待中..."
            return "\n\n".join(reports)

        except Exception as e:
            return f"❌ 开仓流程出错: {e}"

    # ---- /close 手动平仓 ----
    async def cmd_close(self, symbol: str) -> str:
        """手动平仓指定币种"""
        if not symbol:
            return "用法: /close SOL (指定要平仓的币种)"

        symbol = symbol.upper().replace("USDT", "") + "USDT"
        if symbol not in self.paper_engine.risk.positions:
            return f"❌ {symbol.replace('USDT','')} 没有持仓"

        price = await fetch_price_single(symbol)
        if not price:
            return f"❌ 无法获取 {symbol} 价格"

        result = self.paper_engine.execute_close(symbol, price, "手动平仓")
        return result or f"❌ 平仓失败"

    # ---- /positions 持仓看板 ----
    async def cmd_positions(self) -> str:
        """持仓看板"""
        # 先检查止损止盈
        await self.paper_engine.check_positions()
        return await self.paper_engine.dashboard()

    # ---- /history 交易记录 ----
    def cmd_history(self) -> str:
        """交易历史"""
        return self.paper_engine.trade_history(limit=10)

    # ---- /review 复盘报告 ----
    def cmd_review(self, report_type: str = "perf") -> str:
        """复盘报告"""
        from review import ReviewSystem
        rv = ReviewSystem()
        if report_type in ("daily", "日报"):
            return rv.daily_report()
        elif report_type in ("weekly", "周报"):
            return rv.weekly_report()
        elif report_type in ("detail", "明细"):
            return rv.trade_detail()
        else:
            return rv.performance()

    # ---- /help 帮助 ----
    def cmd_help(self) -> str:
        return (
            "🌬️ *小风交易系统* 命令列表\n\n"
            "/scan - 🔥 扫描币安爆款山寨币\n"
            "/analyze BTC - 📊 深度分析币种\n"
            "/status - 🛡️ 风控状态报告\n"
            "/signals - 📋 最近交易信号\n"
            "/trade - 🎯 交易池+爆款列表\n"
            "/open SOL - 📈 分析+开仓\n"
            "/close SOL - 📉 手动平仓\n"
            "/positions - 📊 持仓看板\n"
            "/history - 📋 交易记录\n"
            "/review - 📊 绩效复盘(日报/周报/明细)\n"
            "/help - 📖 帮助\n\n"
            "💡 也可以自然语言：\n"
            "「帮我开个 SOL 多单」\n"
            "「平掉 BTC 仓位」\n"
            "「现在有什么持仓」"
        )

    # ---- 命令路由 ----
    async def dispatch(self, text: str) -> str:
        """解析用户消息，路由到对应命令"""
        text = text.strip()
        lower = text.lower()

        # 直接命令
        if lower.startswith("/scan"):
            return await self.cmd_scan()
        elif lower.startswith("/analyze"):
            symbol = text[8:].strip()
            return await self.cmd_analyze(symbol)
        elif lower.startswith("/open"):
            symbol = text[5:].strip()
            return await self.cmd_open(symbol)
        elif lower.startswith("/close"):
            symbol = text[6:].strip()
            return await self.cmd_close(symbol)
        elif lower.startswith("/positions") or lower.startswith("/pos"):
            return await self.cmd_positions()
        elif lower.startswith("/history") or lower.startswith("/hist"):
            return self.cmd_history()
        elif lower.startswith("/review") or lower.startswith("/perf"):
            rtype = text.split()[-1] if len(text.split()) > 1 else "perf"
            return self.cmd_review(rtype)
        elif lower.startswith("/status"):
            return self.cmd_status()
        elif lower.startswith("/signals"):
            return self.cmd_signals()
        elif lower.startswith("/trade"):
            return await self.cmd_trade()
        elif lower.startswith("/help"):
            return self.cmd_help()

        # 自然语言识别
        if any(k in lower for k in ["爆款", "热点", "扫描", "山寨", "异动"]):
            return await self.cmd_scan()
        elif any(k in lower for k in ["开仓", "开多", "开空", "做多", "做空"]):
            symbol = self._extract_symbol(text)
            return await self.cmd_open(symbol)
        elif any(k in lower for k in ["平仓", "平掉", "关闭", "卖出"]):
            symbol = self._extract_symbol(text)
            if symbol:
                return await self.cmd_close(symbol)
            return "请告诉我要平仓哪个币，比如「平掉 SOL」"
        elif any(k in lower for k in ["持仓", "仓位", "持有"]):
            return await self.cmd_positions()
        elif any(k in lower for k in ["历史", "记录", "交易记录"]):
            return self.cmd_history()
        elif any(k in lower for k in ["复盘", "绩效", "胜率", "盈亏"]):
            return self.cmd_review("perf")
        elif any(k in lower for k in ["日报"]):
            return self.cmd_review("daily")
        elif any(k in lower for k in ["周报"]):
            return self.cmd_review("weekly")
        elif any(k in lower for k in ["分析", "行情", "看看", "怎么样"]):
            # 尝试提取币种
            symbol = self._extract_symbol(text)
            if symbol:
                return await self.cmd_analyze(symbol)
            return "请告诉我要分析哪个币，比如「分析 BTC」"
        elif any(k in lower for k in ["风控", "资金", "状态"]):
            return self.cmd_status()
        elif any(k in lower for k in ["信号", "最近"]):
            return self.cmd_signals()
        elif any(k in lower for k in ["交易池", "池子", "关注"]):
            return await self.cmd_trade()

        return None  # 不是交易命令，交给小风正常回复

    def _extract_symbol(self, text: str) -> str:
        """从自然语言中提取币种名"""
        import re
        # 匹配如 BTC, ETH, SOL, BTCUSDT 等
        patterns = [
            r'\b([A-Z]{2,10}USDT)\b',
            r'\b(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX|DOT|MATIC|LINK|UNI|AAVE|NEAR|OP|ARB|APE|FIL|ATOM|TRX)\b',
        ]
        for p in patterns:
            m = re.search(p, text.upper())
            if m:
                sym = m.group(1)
                if not sym.endswith("USDT"):
                    sym += "USDT"
                return sym
        return ""


async def fetch_price_single(symbol: str):
    """获取单个币种实时价格"""
    import aiohttp
    url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={symbol}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return float(data["price"])
    except:
        return None


# ============================================
# 测试
# ============================================
async def main():
    bot = TradingBot()
    
    # /help
    print("=== /help ===")
    print(bot.cmd_help())
    print()
    
    # /positions
    print("=== /positions ===")
    print(await bot.cmd_positions())
    print()
    
    # /history
    print("=== /history ===")
    print(bot.cmd_history())
    print()
    
    # /status
    print("=== /status ===")
    print(bot.cmd_status())
    print()
    
    # 自然语言
    print("=== NL: 持仓 ===")
    print(await bot.dispatch("看看持仓"))
    print()
    
    print("=== NL: 交易记录 ===")
    print(await bot.dispatch("看看历史交易"))


if __name__ == "__main__":
    asyncio.run(main())
