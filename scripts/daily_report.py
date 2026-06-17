#!/usr/bin/env python3
"""
定时报告生成器 + 直接微信推送
每天8:00和20:00由cron触发
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR

def get_price(sym):
    try:
        url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sym}"
        return float(json.loads(urllib.request.urlopen(url, timeout=5).read())['price'])
    except:
        return 0

def generate_report():
    now = datetime.now(timezone(timedelta(hours=8)))
    
    total_capital = 0
    total_initial = 0
    total_positions = 0
    total_unrealized_pnl = 0
    sections = []
    
    for at, name in [('major', '主流币'), ('altcoin', '山寨币'), ('newcoin', '新币'), ('xau', '黄金500x')]:
        f = DATA_DIR / f"agent_{at}_state.json"
        if not f.exists():
            sections.append(f"【{name}Agent】未启动")
            continue
        
        d = json.load(open(f))
        capital = d['capital']
        initial = 10000.0  # 每个Agent固定初始$10,000
        total_capital += capital
        total_initial += initial
        wr = d['total_trades']/max(d['total_wins']+d['total_losses'],1)*100 if d['total_trades']>0 else 0
        
        pos_lines = []
        positions = d.get('positions', {})
        total_positions += len(positions)
        unrealized = 0
        
        for sym, p in positions.items():
            price = get_price(sym)
            entry = p['entry_price']
            direction = p.get('direction', 'LONG')
            if price > 0:
                raw_change = (price / entry - 1) * 100
                if direction == 'SHORT':
                    pnl_pct = -raw_change * p['leverage']
                    pnl_amount = -p['quantity'] * entry * (price / entry - 1)
                else:
                    pnl_pct = raw_change * p['leverage']
                    pnl_amount = p['quantity'] * entry * (price / entry - 1)
                unrealized += pnl_amount
                emoji = "🟢" if pnl_pct > 0 else "🔴"
                # 格式化入场价/现价
                if entry >= 100:
                    price_str = f"{entry:,.1f}→{price:,.1f}"
                elif entry >= 1:
                    price_str = f"{entry:.2f}→{price:.2f}"
                else:
                    price_str = f"{entry:.4f}→{price:.4f}"
                pos_lines.append(f"{emoji} {sym} {direction[0]} {p['leverage']}x {price_str} {pnl_pct:+.1f}%(${pnl_amount:+,.0f})")
            else:
                pos_lines.append(f"❓ {sym} {p['leverage']}x")
        
        total_unrealized_pnl += unrealized
        effective_capital = capital + unrealized
        net_pnl = effective_capital - initial
        net_emoji = "📈" if net_pnl >= 0 else "📉"
        
        pos_text = "\n".join(pos_lines) if pos_lines else "空仓"
        sections.append(
            f"【{name}Agent】余额${effective_capital:,.0f} {net_emoji}{net_pnl:+,.0f}\n"
            f"初始${initial:,.0f} 浮动${unrealized:+,.0f}\n"
            f"{pos_text}"
        )
    
    # 追踪
    tracker_file = DATA_DIR / "agent_tracker.json"
    tracker_text = ""
    if tracker_file.exists():
        td = json.load(open(tracker_file))
        sigs = td.get('signals', [])
        checked = [s for s in sigs if any(s.get('checks', {}).get(p) for p in ['4h','8h','24h'])]
        hits = sum(1 for s in checked if any(s.get('checks', {}).get(p, {}).get('hit') for p in ['4h','8h','24h']))
        wr = hits/len(checked)*100 if checked else 0
        tracker_text = f"\n信号: {len(sigs)}条 命中{hits}({wr:.0f}%)"
    
    total_effective = total_capital + total_unrealized_pnl
    total_net = total_effective - total_initial
    total_emoji = "📈" if total_net >= 0 else "📉"
    
    report = f"📊 交易报告 ({now.strftime('%m-%d %H:%M')})\n\n"
    report += "\n\n".join(sections)
    report += tracker_text
    report += f"\n\n{'='*20}"
    report += f"\n总余额: ${total_effective:,.0f} {total_emoji}{total_net:+,.0f}"
    report += f"\n总初始: ${total_initial:,.0f} | 浮动: ${total_unrealized_pnl:+,.0f} | 持仓: {total_positions}个"
    
    # === 反馈摘要（来自Enhancer） ===
    try:
        sys.path.insert(0, str(Path(__file__).parent / 'agents'))
        from agents.enhancer import FeedbackClassifier, HierarchicalOptimizer
        
        fb_summary = FeedbackClassifier.get_summary(days=1)
        if fb_summary['total'] > 0:
            report += f"\n\n📝 今日反馈: {fb_summary['total']}笔"
            report += f" 胜率{fb_summary['win_rate']:.0f}% PnL${fb_summary['total_pnl']:+,.0f}"
            
            by_sev = fb_summary.get('by_severity', {})
            high_count = by_sev.get('high', 0) + by_sev.get('critical', 0)
            if high_count > 0:
                report += f" ⚠️{high_count}笔高危"
    except Exception as e:
        pass
    
    # === v3系统状态 ===
    try:
        sys_info_lines = []
        
        # 选币方向
        dir_file = Path('/opt/trading-agent/scripts/data/coin_directions.json')
        if dir_file.exists():
            dirs = json.load(open(dir_file))
            longs = [s for s, d in dirs.items() if d.get('direction') == 'LONG']
            shorts = [s for s, d in dirs.items() if d.get('direction') == 'SHORT']
            sys_info_lines.append(f"🧭 选币: {len(longs)}做多 {len(shorts)}做空")
            if shorts:
                sys_info_lines.append(f"   做空: {', '.join(s.replace('USDT','') for s in shorts[:5])}")
        
        # 持仓vs选币方向一致性
        for at in ['major', 'altcoin', 'newcoin', 'xau']:
            f = DATA_DIR / f"agent_{at}_state.json"
            if f.exists():
                d = json.load(open(f))
                for sym, p in d.get('positions', {}).items():
                    pos_dir = p.get('direction', 'LONG')
                    rec_dir = dirs.get(sym, {}).get('direction', '') if dir_file.exists() else ''
                    if rec_dir and rec_dir != pos_dir:
                        sys_info_lines.append(f"⚠️ {sym} 持仓{pos_dir} 但推荐{rec_dir}")
        
        # 进化状态
        evolve_file = Path('/opt/trading-agent/scripts/data/evolve/best_params.json')
        if evolve_file.exists():
            bp = json.load(open(evolve_file))
            q_meta = bp.get('momentum_quick', {}).get('_metadata', {})
            if q_meta.get('source') == 'self_evolution':
                sys_info_lines.append(f"🧬 参数: 自进化(衰减{q_meta.get('degradation',0):.0f}%)")
        
        if sys_info_lines:
            report += "\n\n" + "\n".join(sys_info_lines)
    except:
        pass
    
    return report


def push_to_wechat(msg):
    """通过pending文件推送 - 由OpenClaw agent在heartbeat中读取并推送"""
    pending_file = DATA_DIR / "pending_wechat_report.json"
    try:
        payload = {
            "message": msg,
            "timestamp": datetime.now(timezone(timedelta(hours=8))).isoformat(),
            "channel": "openclaw-weixin",
            "to": "o9cq801kLBuLl3lPs3gk_40jqkww@im.wechat",
            "pushed": False,
        }
        import json as _json
        Path(pending_file).write_text(_json.dumps(payload, ensure_ascii=False, indent=2))
        return True
    except Exception as e:
        print(f"写入pending失败: {e}")
        return False


if __name__ == "__main__":
    report = generate_report()
    print(report)
    print()
    
    success = push_to_wechat(report)
    if success:
        print("✅ 微信推送成功")
    else:
        print("⚠️ 微信推送失败，已写入队列")
