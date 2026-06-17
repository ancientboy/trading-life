"""
亏损交易自动分析器
- 从trade-log.jsonl读取所有亏损交易
- 分析亏损模式：币种、时段、市场环境、止损方式
- 输出分析报告和改进行动
"""
import json
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

DATA_DIR = Path("/opt/trading-agent/data")

def analyze_losses(days: int = 30, top_n: int = 10):
    """分析亏损交易"""
    trades = []
    with open(DATA_DIR / "trade-log.jsonl") as f:
        for line in f:
            try: trades.append(json.loads(line.strip()))
            except: pass

    # 过滤时间范围
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    recent = []
    for t in trades:
        ts = t.get("timestamp", "")
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if dt >= cutoff:
                    recent.append(t)
            except:
                recent.append(t)

    closes = [t for t in recent if t.get("action") == "CLOSE"]
    losses = [t for t in closes if t.get("dollar_pnl", 0) < 0]
    wins = [t for t in closes if t.get("dollar_pnl", 0) > 0]

    if not losses:
        print("No losses found")
        return

    report = []
    report.append(f"Loss Analysis Report ({days}d)")
    report.append("=" * 50)
    report.append(f"Total closes: {len(closes)} | Wins: {len(wins)} | Losses: {len(losses)}")
    total_loss = sum(t.get("dollar_pnl", 0) for t in losses)
    total_win = sum(t.get("dollar_pnl", 0) for t in wins)
    report.append(f"Total win: ${total_win:+,.0f} | Total loss: ${total_loss:+,.0f}")
    if total_loss != 0:
        report.append(f"Win/Loss ratio: {abs(total_win/total_loss):.2f}")
    report.append("")

    # 1. Top loss coins
    coin_pnl = defaultdict(float)
    coin_count = defaultdict(int)
    for t in losses:
        sym = t.get("symbol", "?")
        coin_pnl[sym] += t.get("dollar_pnl", 0)
        coin_count[sym] += 1

    report.append(f"Top {top_n} worst coins:")
    sorted_coins = sorted(coin_pnl.items(), key=lambda x: x[1])
    for sym, pnl in sorted_coins[:top_n]:
        cnt = coin_count[sym]
        avg = pnl / cnt
        report.append(f"  {sym}: {cnt}x ${pnl:+,.0f} (avg ${avg:+,.0f})")
    report.append("")

    # 2. Stop type analysis
    stop_types = defaultdict(lambda: {"count": 0, "pnl": 0})
    for t in losses:
        reason = t.get("reason", "") or "unknown"
        if "trailing" in reason.lower() or "trail" in reason.lower() or "跟踪" in reason:
            stype = "trailing stop"
        elif "struct" in reason.lower() or "结构" in reason:
            stype = "structure stop"
        elif "EMA" in reason or "ema" in reason.lower():
            stype = "EMA break"
        elif "ATR" in reason:
            stype = "ATR stop"
        elif "timeout" in reason.lower() or "超时" in reason:
            stype = "timeout"
        elif "circuit" in reason.lower() or "熔断" in reason:
            stype = "circuit breaker"
        elif reason and reason != "unknown":
            stype = reason[:40]
        else:
            stype = "unknown"
        stop_types[stype]["count"] += 1
        stop_types[stype]["pnl"] += t.get("dollar_pnl", 0)

    report.append("Stop type breakdown:")
    for stype, data in sorted(stop_types.items(), key=lambda x: x[1]["pnl"]):
        report.append(f"  {stype}: {data['count']}x ${data['pnl']:+,.0f}")
    report.append("")

    # 3. Hour analysis
    hour_losses = defaultdict(float)
    for t in losses:
        ts = t.get("timestamp", "")
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                hour_losses[dt.hour] += t.get("dollar_pnl", 0)
            except:
                pass

    if hour_losses:
        report.append("Worst hours (UTC):")
        worst_hours = sorted(hour_losses.items(), key=lambda x: x[1])[:5]
        for h, pnl in worst_hours:
            report.append(f"  {h:02d}:00 -> ${pnl:+,.0f}")
        report.append("")

    # 4. Direction analysis
    dir_losses = defaultdict(lambda: {"count": 0, "pnl": 0})
    for t in losses:
        d = t.get("direction", "LONG")
        dir_losses[d]["count"] += 1
        dir_losses[d]["pnl"] += t.get("dollar_pnl", 0)

    report.append("Direction breakdown:")
    for d, data in dir_losses.items():
        report.append(f"  {d}: {data['count']}x ${data['pnl']:+,.0f}")
    report.append("")

    # 5. Suggestions
    report.append("Action items:")
    worst_coins = [sym for sym, _ in sorted_coins[:3]]
    if worst_coins:
        report.append(f"  1. Blacklist/reduce weight: {', '.join(worst_coins)}")

    struct_count = sum(1 for t in losses if "struct" in t.get("reason", "").lower() or "结构" in t.get("reason", ""))
    if struct_count > 5:
        report.append(f"  2. Too many structure stops ({struct_count}), consider ATR adjustment")

    avg_loss = total_loss / len(losses) if losses else 0
    if abs(avg_loss) > 200:
        report.append(f"  3. Avg loss ${avg_loss:+,.0f} too large, consider tighter stops or lower leverage")

    text = "\n".join(report)
    print(text)

    with open(DATA_DIR / "loss_analysis.txt", "w") as f:
        f.write(text)

    return text


if __name__ == "__main__":
    analyze_losses(days=30)
