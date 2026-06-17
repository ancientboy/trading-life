#!/usr/bin/env python3
"""
Harness 分析工具集
LLM通过这些工具做深度分析和自助调优

工具列表:
1. analyze_regime      — 市场状态分析（牛/熊/震荡）
2. analyze_drawdown    — 最大回撤分析
3. analyze_failure     — 亏损归因分析
4. analyze_performance — 综合绩效分析
5. robust_sweep        — 稳健参数扫描（自动过拟合过滤）
6. auto_improve        — 一键自动优化（发现问题→验证→部署）
"""
import os, sys, json, time
import numpy as np
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(__file__))

TRADE_LOG = "/opt/trading-agent/data/trade-log.jsonl"
RISK_STATE = "/opt/trading-agent/scripts/data/risk_state.json"
BEST_PARAMS = "/opt/trading-agent/scripts/data/evolve/best_params.json"
EVOLVE_HISTORY = "/opt/trading-agent/scripts/data/evolve/evolve_history.jsonl"


def _load_trades() -> List[dict]:
    """加载交易记录"""
    trades = []
    try:
        with open(TRADE_LOG) as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try: trades.append(json.loads(line))
                except: pass
    except: pass
    return trades


def _load_positions() -> dict:
    """加载当前持仓"""
    try:
        with open(RISK_STATE) as f:
            return json.load(f)
    except:
        return {}


# ============================================================
# 工具1: 市场状态分析
# ============================================================
def analyze_regime(
    symbols: List[str] = None,
    lookback_days: int = 30,
) -> dict:
    """
    分析当前市场状态（牛市/熊市/震荡）
    
    指标：
    - BTC趋势（EMA20 vs EMA50）
    - 市场广度（涨跌比）
    - 波动率水平
    - 资金费率方向
    
    Returns:
        {regime, btc_trend, breadth, volatility_level, recommendation}
    """
    import aiohttp, asyncio
    
    async def _analyze():
        async with aiohttp.ClientSession() as session:
            # BTC K线
            url = f"https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit={lookback_days*6}"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                raw = await resp.json()
            
            closes = [float(k[4]) for k in raw]
            if len(closes) < 50:
                return {"error": "数据不足"}
            
            # EMA
            def ema(data, p):
                k = 2 / (p + 1)
                r = [sum(data[:p]) / p]
                for v in data[p:]: r.append(v * k + r[-1] * (1 - k))
                return r
            
            e20 = ema(closes, 20)[-1]
            e50 = ema(closes, 50)[-1]
            btc_price = closes[-1]
            btc_change_7d = (closes[-1] - closes[-42]) / closes[-42] * 100 if len(closes) > 42 else 0
            btc_change_24h = (closes[-1] - closes[-6]) / closes[-6] * 100 if len(closes) > 6 else 0
            
            # 波动率
            returns = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes))]
            vol = np.std(returns[-30:]) * np.sqrt(6 * 365) * 100  # 年化
            
            # 全市场涨跌
            url2 = "https://fapi.binance.com/fapi/v1/ticker/24hr"
            async with session.get(url2, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                tickers = await resp.json()
            
            usdt_pairs = [t for t in tickers if t.get("symbol", "").endswith("USDT")]
            up = sum(1 for t in usdt_pairs if float(t.get("priceChangePercent", 0)) > 0)
            down = len(usdt_pairs) - up
            breadth = up / max(len(usdt_pairs), 1) * 100
            
            # 资金费率
            url3 = "https://fapi.binance.com/fapi/v1/premiumIndex"
            async with session.get(url3, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                premium = await resp.json()
            
            funding_rates = [float(p.get("lastFundingRate", 0)) for p in premium if p.get("symbol", "").endswith("USDT")]
            avg_funding = np.mean(funding_rates) if funding_rates else 0
            positive_funding = sum(1 for f in funding_rates if f > 0) / max(len(funding_rates), 1) * 100
            
            # 判断regime
            if e20 > e50 and btc_change_7d > 5:
                regime = "bull"
                regime_cn = "牛市"
            elif e20 < e50 and btc_change_7d < -5:
                regime = "bear"
                regime_cn = "熊市"
            elif abs(btc_change_7d) < 3:
                regime = "chop"
                regime_cn = "震荡"
            elif e20 > e50:
                regime = "bull_weak"
                regime_cn = "弱牛"
            else:
                regime = "bear_weak"
                regime_cn = "弱熊"
            
            # 波动率水平
            if vol > 80:
                vol_level = "extreme"
            elif vol > 60:
                vol_level = "high"
            elif vol > 40:
                vol_level = "normal"
            else:
                vol_level = "low"
            
            # 建议
            recommendations = []
            if regime in ["bull", "bull_weak"]:
                recommendations.append("做多为主，减少做空")
                if btc_change_24h > 2:
                    recommendations.append("BTC 24h涨>2%，禁止做空")
            elif regime in ["bear", "bear_weak"]:
                recommendations.append("可适当做空，做多需谨慎")
                recommendations.append("降低仓位，增加止损")
            elif regime == "chop":
                recommendations.append("减少交易频率，等待方向")
                recommendations.append("用quick模式抓小波段")
            
            if vol_level in ["extreme", "high"]:
                recommendations.append("高波动，加宽止损")
            if avg_funding > 0.0005:
                recommendations.append("资金费率偏高，多头拥挤")
            elif avg_funding < -0.0005:
                recommendations.append("资金费率偏低，空头拥挤")
            
            return {
                "regime": regime,
                "regime_cn": regime_cn,
                "btc": {
                    "price": btc_price,
                    "change_24h": round(btc_change_24h, 2),
                    "change_7d": round(btc_change_7d, 2),
                    "ema20": round(e20, 2),
                    "ema50": round(e50, 2),
                    "trend": "UP" if e20 > e50 else "DOWN",
                },
                "breadth": {
                    "up": up, "down": down, "total": len(usdt_pairs),
                    "ratio": round(breadth, 1),
                },
                "volatility": {
                    "annualized_pct": round(vol, 1),
                    "level": vol_level,
                },
                "funding": {
                    "avg": round(avg_funding, 6),
                    "positive_pct": round(positive_funding, 1),
                },
                "recommendations": recommendations,
            }
    
    return asyncio.run(_analyze())


# ============================================================
# 工具2: 最大回撤分析
# ============================================================
def analyze_drawdown(
    days: int = 30,
) -> dict:
    """
    分析资金曲线和最大回撤
    
    Returns:
        {max_drawdown, max_drawdown_duration, current_drawdown, equity_curve, worst_trades}
    """
    trades = _load_trades()
    closes = [t for t in trades if t.get("action") == "CLOSE"]
    
    if not closes:
        return {"error": "无交易记录"}
    
    # 按时间排序
    closes.sort(key=lambda x: x.get("timestamp", ""))
    
    # 过滤指定天数
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    recent = [c for c in closes if c.get("timestamp", "") >= cutoff]
    
    if not recent:
        return {"error": f"近{days}天无交易"}
    
    # 构建资金曲线
    capital = 10000  # 起始
    peak = capital
    equity_curve = [{"timestamp": "start", "equity": capital, "drawdown": 0}]
    max_dd = 0
    max_dd_start = ""
    max_dd_end = ""
    dd_start_eq = peak
    current_dd = 0
    
    for c in recent:
        pnl = c.get("dollar_pnl", 0)
        capital += pnl
        if capital > peak:
            peak = capital
        dd = (peak - capital) / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd
            max_dd_start = equity_curve[-1]["timestamp"] if equity_curve else "start"
            max_dd_end = c.get("timestamp", "")
        current_dd = dd
        equity_curve.append({
            "timestamp": c.get("timestamp", ""),
            "equity": round(capital, 2),
            "drawdown": round(dd, 2),
            "pnl": pnl,
            "symbol": c.get("symbol", ""),
        })
    
    # 最大回撤持续时间
    dd_duration = 0
    in_dd = False
    dd_start_idx = 0
    for i, e in enumerate(equity_curve):
        if e["drawdown"] > 0 and not in_dd:
            in_dd = True
            dd_start_idx = i
        elif e["drawdown"] == 0 and in_dd:
            dd_duration = max(dd_duration, i - dd_start_idx)
            in_dd = False
    
    # 最差交易
    worst = sorted(recent, key=lambda x: x.get("dollar_pnl", 0))[:5]
    best = sorted(recent, key=lambda x: -x.get("dollar_pnl", 0))[:5]
    
    # 连亏分析
    streak = 0
    max_losing_streak = 0
    for c in recent:
        if c.get("dollar_pnl", 0) < 0:
            streak += 1
            max_losing_streak = max(max_losing_streak, streak)
        else:
            streak = 0
    
    return {
        "current_capital": round(capital, 2),
        "max_drawdown_pct": round(max_dd, 1),
        "max_drawdown_period": f"{max_dd_start} → {max_dd_end}",
        "current_drawdown_pct": round(current_dd, 1),
        "max_losing_streak": max_losing_streak,
        "total_trades": len(recent),
        "period_days": days,
        "worst_trades": [{"symbol": w.get("symbol"), "pnl": w.get("dollar_pnl"), "reason": w.get("reason", "")} for w in worst],
        "best_trades": [{"symbol": b.get("symbol"), "pnl": b.get("dollar_pnl")} for b in best],
        "equity_curve_summary": {
            "start": equity_curve[0]["equity"],
            "end": equity_curve[-1]["equity"],
            "peak": peak,
            "return_pct": round((capital - 10000) / 10000 * 100, 1),
        },
    }


# ============================================================
# 工具3: 亏损归因分析
# ============================================================
def analyze_failure(
    days: int = 30,
    top_n: int = 10,
) -> dict:
    """
    亏损归因：为什么亏？哪些币？哪种策略？什么时间段？
    
    Returns:
        {losing_coins, losing_strategies, losing_hours, common_patterns}
    """
    trades = _load_trades()
    closes = [t for t in trades if t.get("action") == "CLOSE"]
    
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    recent = [c for c in closes if c.get("timestamp", "") >= cutoff]
    
    if not recent:
        return {"error": f"近{days}天无交易"}
    
    losers = [c for c in recent if c.get("dollar_pnl", 0) < 0]
    winners = [c for c in recent if c.get("dollar_pnl", 0) >= 0]
    
    # 哪些币亏最多
    coin_pnl = defaultdict(float)
    coin_count = defaultdict(lambda: {"wins": 0, "losses": 0, "pnl": 0})
    for c in recent:
        sym = c.get("symbol", "unknown")
        pnl = c.get("dollar_pnl", 0)
        coin_pnl[sym] += pnl
        coin_count[sym]["pnl"] += pnl
        if pnl >= 0:
            coin_count[sym]["wins"] += 1
        else:
            coin_count[sym]["losses"] += 1
    
    worst_coins = sorted(coin_count.items(), key=lambda x: x[1]["pnl"])[:top_n]
    best_coins = sorted(coin_count.items(), key=lambda x: -x[1]["pnl"])[:top_n]
    
    # 亏损原因分布
    reasons = defaultdict(lambda: {"count": 0, "pnl": 0})
    for c in losers:
        reason = c.get("reason", "unknown")
        if "止损" in reason or "stop" in reason.lower():
            key = "stop_loss"
        elif "trailing" in reason.lower():
            key = "trailing_stop"
        elif "structure" in reason.lower() or "结构" in reason:
            key = "structure_exit"
        elif "timeout" in reason.lower() or "超时" in reason:
            key = "timeout"
        else:
            key = reason[:30]
        reasons[key]["count"] += 1
        reasons[key]["pnl"] += c.get("dollar_pnl", 0)
    
    # 时间段分析
    hour_pnl = defaultdict(lambda: {"count": 0, "pnl": 0})
    for c in recent:
        ts = c.get("timestamp", "")
        try:
            h = datetime.fromisoformat(ts).hour
            hour_pnl[h]["count"] += 1
            hour_pnl[h]["pnl"] += c.get("dollar_pnl", 0)
        except: pass
    
    worst_hours = sorted(hour_pnl.items(), key=lambda x: x[1]["pnl"])[:5]
    best_hours = sorted(hour_pnl.items(), key=lambda x: -x[1]["pnl"])[:5]
    
    # 方向分析
    long_pnl = sum(c.get("dollar_pnl", 0) for c in recent if c.get("direction") == "LONG")
    short_pnl = sum(c.get("dollar_pnl", 0) for c in recent if c.get("direction") == "SHORT")
    long_wins = sum(1 for c in recent if c.get("direction") == "LONG" and c.get("dollar_pnl", 0) >= 0)
    long_total = sum(1 for c in recent if c.get("direction") == "LONG")
    short_wins = sum(1 for c in recent if c.get("direction") == "SHORT" and c.get("dollar_pnl", 0) >= 0)
    short_total = sum(1 for c in recent if c.get("direction") == "SHORT")
    
    # 模式识别
    patterns = []
    
    # 连亏后的表现
    after_lose = []
    for i in range(1, len(recent)):
        if recent[i-1].get("dollar_pnl", 0) < 0:
            after_lose.append(recent[i].get("dollar_pnl", 0))
    if after_lose:
        avg_after_lose = np.mean(after_lose)
        if avg_after_lose < 0:
            patterns.append(f"连亏后继续亏损倾向（均亏${avg_after_lose:.0f}）→ 可能情绪化交易")
    
    # 大亏单分析
    big_losses = [c for c in losers if c.get("dollar_pnl", 0) < -200]
    if big_losses:
        avg_big = np.mean([c.get("dollar_pnl", 0) for c in big_losses])
        patterns.append(f"有{len(big_losses)}笔大亏（>${200}），均亏${avg_big:.0f} → 止损可能太宽")
    
    # 方向偏好
    if long_pnl > 0 and short_pnl < 0:
        patterns.append("做多盈利但做空亏损 → 考虑减少做空")
    elif short_pnl > 0 and long_pnl < 0:
        patterns.append("做空盈利但做多亏损 → 考虑减少做多")
    
    # 黑名单建议
    blacklist_suggestions = []
    for sym, stats in worst_coins:
        if stats["losses"] >= 2 and stats["wins"] == 0:
            blacklist_suggestions.append(sym)
    
    if blacklist_suggestions:
        patterns.append(f"建议黑名单: {', '.join(blacklist_suggestions)}（全亏无赢）")
    
    return {
        "summary": {
            "total": len(recent),
            "wins": len(winners),
            "losses": len(losers),
            "win_rate": round(len(winners) / len(recent) * 100, 1),
            "total_pnl": round(sum(c.get("dollar_pnl", 0) for c in recent), 2),
            "avg_win": round(np.mean([c.get("dollar_pnl", 0) for c in winners]), 2) if winners else 0,
            "avg_loss": round(np.mean([c.get("dollar_pnl", 0) for c in losers]), 2) if losers else 0,
        },
        "direction": {
            "long": {"pnl": round(long_pnl, 2), "wr": round(long_wins / max(long_total, 1) * 100, 1), "trades": long_total},
            "short": {"pnl": round(short_pnl, 2), "wr": round(short_wins / max(short_total, 1) * 100, 1), "trades": short_total},
        },
        "worst_coins": [{"symbol": s, **st} for s, st in worst_coins],
        "best_coins": [{"symbol": s, **st} for s, st in best_coins],
        "exit_reasons": dict(reasons),
        "worst_hours": [f"{h}:00 UTC (PnL ${d['pnl']:+.0f}, {d['count']}笔)" for h, d in worst_hours],
        "best_hours": [f"{h}:00 UTC (PnL ${d['pnl']:+.0f}, {d['count']}笔)" for h, d in best_hours],
        "patterns": patterns,
        "blacklist_suggestions": blacklist_suggestions,
    }


# ============================================================
# 工具4: 综合绩效分析
# ============================================================
def analyze_performance() -> dict:
    """
    综合绩效总览：资金、持仓、盈亏、策略表现
    
    Returns:
        {capital, positions, pnl, strategy_breakdown, screener_stats}
    """
    trades = _load_trades()
    state = _load_positions()
    
    closes = [t for t in trades if t.get("action") == "CLOSE"]
    
    # 基本统计
    total_pnl = sum(c.get("dollar_pnl", 0) for c in closes)
    wins = [c for c in closes if c.get("dollar_pnl", 0) >= 0]
    
    # 当前持仓
    positions = state.get("positions", {})
    pos_list = []
    for sym, p in positions.items():
        pos_list.append({
            "symbol": sym,
            "direction": p.get("direction", ""),
            "entry": p.get("entry_price", 0),
            "pnl_pct": p.get("unrealized_pnl_pct", 0),
            "reason": p.get("reason", ""),
        })
    
    # 近7天vs近30天
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()
    
    week_trades = [c for c in closes if c.get("timestamp", "") >= week_ago]
    month_trades = [c for c in closes if c.get("timestamp", "") >= month_ago]
    
    return {
        "capital": {
            "total": state.get("capital", 0),
            "available": state.get("available_capital", 0),
            "positions_count": len(positions),
            "max_positions": 30,
        },
        "all_time": {
            "total_trades": len(closes),
            "win_rate": round(len(wins) / max(len(closes), 1) * 100, 1),
            "total_pnl": round(total_pnl, 2),
        },
        "last_7d": {
            "trades": len(week_trades),
            "pnl": round(sum(c.get("dollar_pnl", 0) for c in week_trades), 2),
            "win_rate": round(sum(1 for c in week_trades if c.get("dollar_pnl", 0) >= 0) / max(len(week_trades), 1) * 100, 1),
        },
        "last_30d": {
            "trades": len(month_trades),
            "pnl": round(sum(c.get("dollar_pnl", 0) for c in month_trades), 2),
            "win_rate": round(sum(1 for c in month_trades if c.get("dollar_pnl", 0) >= 0) / max(len(month_trades), 1) * 100, 1),
        },
        "open_positions": pos_list,
    }


# ============================================================
# 工具5: 稳健参数扫描（自动过拟合过滤）
# ============================================================
def robust_sweep(
    strategy: str,
    days: int = 90,
    top_n: int = 12,
    max_degradation: float = 30.0,
    min_test_pnl: float = 5.0,
) -> dict:
    """
    稳健参数扫描：全扫 + Walk-Forward + 过拟合过滤
    只返回衰减<max_degradation%的参数
    
    流程：
    1. VBT全参数扫描
    2. 取Top 20参数
    3. 对每个做Walk-Forward
    4. 过滤过拟合的
    5. 返回最稳健的
    
    Returns:
        {robust_params, overfit_params, recommendation}
    """
    from vbt_backtest import fetch_klines_batch, vectorized_quick_backtest, vectorized_wave_backtest, generate_param_grid
    from harness import DataLoader
    
    symbols = DataLoader().get_top_symbols(top_n)
    data = fetch_klines_batch(symbols, "4h", days)
    
    fn = vectorized_quick_backtest if strategy == "momentum_quick" else vectorized_wave_backtest
    grid = generate_param_grid(strategy)
    
    print(f"🔬 稳健扫描: {strategy}")
    print(f"  参数: {len(grid)}种, 币种: {len(data)}个")
    
    # Step 1: 全扫找Top 20
    all_results = []
    for sym, df in data.items():
        results = fn(df, sym, grid)
        all_results.extend(results)
    
    all_results.sort(key=lambda x: -x.score)
    top_results = all_results[:20]
    
    # 去重参数
    seen_params = set()
    unique_top = []
    for r in top_results:
        key = tuple(sorted(r.params.items()))
        if key not in seen_params:
            seen_params.add(key)
            unique_top.append(r)
        if len(unique_top) >= 10:
            break
    
    print(f"  Top 10去重参数")
    
    # Step 2: Walk-Forward验证每个
    train_pct = 0.4
    robust = []
    overfit = []
    
    for r in unique_top:
        # 分割数据
        train_pnls = []
        test_pnls = []
        
        for sym, df in data.items():
            split = int(len(df) * train_pct)
            train_df = df.iloc[:split]
            test_df = df.iloc[split:]
            
            train_r = fn(train_df, sym, [r.params])
            test_r = fn(test_df, sym, [r.params])
            
            if train_r:
                train_pnls.extend([x.pnl_pct for x in train_r])
            if test_r:
                test_pnls.extend([x.pnl_pct for x in test_r])
        
        train_avg = np.mean(train_pnls) if train_pnls else 0
        test_avg = np.mean(test_pnls) if test_pnls else 0
        test_wr = sum(1 for p in test_pnls if p > 0) / max(len(test_pnls), 1) * 100
        
        degradation = (train_avg - test_avg) / max(train_avg, 0.1) * 100 if train_avg > 0 else 999
        
        result = {
            "params": r.params,
            "train_pnl": round(train_avg, 1),
            "test_pnl": round(test_avg, 1),
            "test_wr": round(test_wr, 1),
            "degradation": round(degradation, 1),
        }
        
        if degradation < max_degradation and test_avg >= min_test_pnl:
            robust.append(result)
        else:
            overfit.append(result)
    
    # Step 3: 排序推荐
    robust.sort(key=lambda x: -x["test_pnl"])
    overfit.sort(key=lambda x: x["degradation"])
    
    recommendation = ""
    if robust:
        best = robust[0]
        recommendation = f"推荐部署: test_pnl={best['test_pnl']:+.1f}%, WR={best['test_wr']:.1f}%, 衰减={best['degradation']:.1f}%"
    else:
        recommendation = "⚠️ 所有参数均过拟合，建议：1)加长回测天数 2)简化参数 3)降低策略复杂度"
    
    print(f"\n  稳健: {len(robust)}组, 过拟合: {len(overfit)}组")
    print(f"  {recommendation}")
    
    return {
        "strategy": strategy,
        "robust_params": robust,
        "overfit_params": overfit[:5],
        "recommendation": recommendation,
    }


# ============================================================
# 工具6: 一键自动优化
# ============================================================
def auto_improve(
    strategy: str = "all",
) -> dict:
    """
    一键自动优化：发现问题 → 验证 → 建议
    
    流程：
    1. 分析当前绩效
    2. 分析亏损归因
    3. 分析市场状态
    4. 稳健参数扫描
    5. 生成优化建议
    
    Returns:
        {diagnosis, recommendations, robust_params}
    """
    print("🤖 自动优化分析中...")
    
    # 1. 绩效
    perf = analyze_performance()
    
    # 2. 亏损分析
    failure = analyze_failure(days=30)
    
    # 3. 市场状态
    regime = analyze_regime()
    
    # 4. 建议
    recommendations = []
    
    # 基于绩效
    wr_7d = perf.get("last_7d", {}).get("win_rate", 0)
    pnl_7d = perf.get("last_7d", {}).get("pnl", 0)
    
    if wr_7d < 40:
        recommendations.append(f"⚠️ 近7天WR={wr_7d:.0f}%太低，考虑暂停交易或降低频率")
    if pnl_7d < -500:
        recommendations.append(f"⚠️ 近7天亏损${pnl_7d:.0f}，触发风控审视")
    
    # 基于亏损分析
    for pattern in failure.get("patterns", []):
        recommendations.append(f"📊 {pattern}")
    
    # 基于市场状态
    for rec in regime.get("recommendations", []):
        recommendations.append(f"🌐 {rec}")
    
    # 黑名单
    bl = failure.get("blacklist_suggestions", [])
    if bl:
        recommendations.append(f"🚫 建议加黑名单: {', '.join(bl)}")
    
    # 方向建议
    direction = failure.get("direction", {})
    long_pnl = direction.get("long", {}).get("pnl", 0)
    short_pnl = direction.get("short", {}).get("pnl", 0)
    if long_pnl > 0 and short_pnl < 0:
        recommendations.append("📈 做多赚钱做空亏，减少做空仓位")
    elif short_pnl > 0 and long_pnl < 0:
        recommendations.append("📉 做空赚钱做多亏，减少做多仓位")
    
    return {
        "regime": regime.get("regime_cn", "未知"),
        "performance": {
            "capital": perf.get("capital", {}).get("total", 0),
            "positions": perf.get("capital", {}).get("positions_count", 0),
            "pnl_7d": pnl_7d,
            "wr_7d": wr_7d,
            "pnl_30d": perf.get("last_30d", {}).get("pnl", 0),
            "wr_30d": perf.get("last_30d", {}).get("win_rate", 0),
        },
        "failure_summary": {
            "worst_coins": failure.get("worst_coins", [])[:3],
            "worst_hours": failure.get("worst_hours", [])[:3],
            "exit_reasons": failure.get("exit_reasons", {}),
        },
        "recommendations": recommendations,
    }


# ============================================================
# CLI入口
# ============================================================
TOOL_MAP = {
    "regime": lambda args: analyze_regime(),
    "drawdown": lambda args: analyze_drawdown(args.days),
    "failure": lambda args: analyze_failure(args.days, args.top_n),
    "performance": lambda args: analyze_performance(),
    "robust_sweep": lambda args: robust_sweep(args.strategy, args.days),
    "auto_improve": lambda args: auto_improve(args.strategy),
}

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Harness分析工具")
    parser.add_argument("tool", choices=list(TOOL_MAP.keys()))
    parser.add_argument("--strategy", default="momentum_quick")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--top-n", type=int, default=10)
    args = parser.parse_args()
    
    result = TOOL_MAP[args.tool](args)
    print(json.dumps(result, indent=2, default=str, ensure_ascii=False))
