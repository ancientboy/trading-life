#!/usr/bin/env python3
"""重置模拟交易数据"""
import json

# 读取当前状态
with open('/opt/trading-agent/data/risk_state.json', 'r') as f:
    data = json.load(f)

print(f"重置前: capital=${data['capital']:.2f}, positions={len(data.get('positions', {}))}, trades={len(data.get('trade_history', []))}")

# 重置
data['capital'] = 10000.0
data['daily_pnl'] = 0.0
data['weekly_start_capital'] = 10000.0
data['last_review_capital'] = 10000.0
data['consecutive_losses'] = 0
data['need_review'] = False
data['positions'] = {}
data['trade_history'] = []
data['cooldown'] = {}
if 'ob_cooldown' in data:
    data['ob_cooldown'] = {}

with open('/opt/trading-agent/data/risk_state.json', 'w') as f:
    json.dump(data, f, indent=2)

print("✅ 重置完成: capital=$10000, 持仓已清空, 交易历史已清空")
