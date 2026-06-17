#!/usr/bin/env python3
"""
交易系统健康检查 + 自愈脚本
v19更新: SL用实际结构支撑位(不硬编码距离)，无固定TP
检测项：
1. SL >= entry (做多止损在入场价上方 - 异常)
2. 仓位名义值 < $100 (微量仓位)
3. 持仓超时 > 72h
4. 资金使用率 > 60%
5. 连续亏损过多
"""

import json
import sys
import os
import time
from datetime import datetime, timezone

RISK_STATE = "/opt/trading-agent/data/risk_state.json"
TRADE_LOG = "/opt/trading-agent/data/trade-log.jsonl"
MIN_NOTIONAL = 100   # $100
MAX_MARGIN_PCT = 0.60 # 60%

def load_state():
    with open(RISK_STATE) as f:
        return json.load(f)

def save_state(data):
    with open(RISK_STATE, 'w') as f:
        json.dump(data, f, indent=2)

def health_check(auto_fix=False):
    """执行健康检查，返回 (报告文本, 修复数)"""
    data = load_state()
    positions = data.get('positions', {})
    capital = data.get('capital', 0)
    
    issues = []
    fixes = 0
    
    # 计算总保证金
    total_margin = 0
    for sym, pos in positions.items():
        entry = pos.get('entry_price', 0)
        qty = pos.get('quantity', 0)
        lev = pos.get('leverage', 20)
        margin = (entry * qty / lev) if lev > 0 else 0
        total_margin += margin
    
    margin_pct = total_margin / capital * 100 if capital > 0 else 0
    
    # 全局检查
    if margin_pct > MAX_MARGIN_PCT * 100:
        issues.append(f"🔴 资金使用率{margin_pct:.1f}% > 60%上限")
    
    consecutive = data.get('consecutive_losses', 0)
    if consecutive >= 5:
        issues.append(f"🔴 连续亏损{consecutive}次，建议暂停")
    
    # 逐仓检查
    for sym, pos in positions.items():
        entry = pos.get('entry_price', 0)
        qty = pos.get('quantity', 0)
        sl = pos.get('stop_loss', 0)
        lev = pos.get('leverage', 20)
        tps = pos.get('take_profits', [])
        direction = pos.get('direction', 'LONG')
        opened_at = pos.get('opened_at', '')
        
        notional = entry * qty
        margin = notional / lev if lev > 0 else 0
        
        # 检查1: SL >= entry (v19: SL可以>entry是盈利保护状态，但如果SL<=0就是异常)
        if sl <= 0:
            issues.append(f"🚨 {sym}: SL未设置(sl=0)")
        # 注意：v19跟踪止损后SL可以>entry（盈利保护），这是正常的，不再报错
        
        # 检查2: 微量仓位
        if notional < MIN_NOTIONAL:
            issues.append(f"⚠️ {sym}: 名义值${notional:.2f}<${MIN_NOTIONAL}")
            # 微量仓位不自动平仓，只告警
        
        # 检查3: 亏损持仓超时（盈利仓位不设超时，让趋势跑完）
        if opened_at:
            try:
                # 计算当前盈亏比例（使用SL作为近似，无实时价格）
                if sl > 0 and entry > 0:
                    if direction == 'LONG':
                        pnl_pct = ((sl - entry) / entry) * 100  # 到SL的潜在亏损
                    else:
                        pnl_pct = ((entry - sl) / entry) * 100
                else:
                    pnl_pct = 0
                
                if isinstance(opened_at, (int, float)):
                    hours = (time.time() - opened_at) / 3600
                else:
                    opened_time = datetime.fromisoformat(str(opened_at).replace('Z', '+00:00'))
                    hours = (datetime.now(timezone.utc) - opened_time).total_seconds() / 3600
                
                if hours > 168:  # 7天
                    issues.append(f"⏰ {sym}: 持仓{hours:.0f}h>168h超时")
            except Exception as e:
                issues.append(f"⚠️ {sym}: 无法解析持仓时间({opened_at}): {e}")
    
    if auto_fix and fixes > 0:
        save_state(data)
    
    # 生成报告
    report_lines = [
        f"📊 交易系统健康报告",
        f"资金: ${capital:,.2f} | 持仓: {len(positions)} | 使用率: {margin_pct:.1f}%",
        f"连续亏损: {consecutive}",
        "",
    ]
    
    if not issues:
        report_lines.append("✅ 所有检查通过，无异常")
    else:
        report_lines.append(f"发现{len(issues)}个问题:")
        for issue in issues:
            report_lines.append(issue)
    
    if fixes > 0:
        report_lines.append(f"\n🔧 已自动修复{fixes}个问题")
    
    report_lines.append(f"\n检查时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    
    return "\n".join(report_lines), fixes

if __name__ == '__main__':
    auto_fix = '--fix' in sys.argv
    report, fixes = health_check(auto_fix=auto_fix)
    print(report)
    if fixes > 0:
        print(f"\n[自愈] 共修复{fixes}个异常")
