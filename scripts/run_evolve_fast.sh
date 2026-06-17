#!/bin/bash
# 快速进化（每4小时）- 小population，快速迭代
cd /opt/trading-agent/scripts

LOG=/opt/trading-agent/scripts/data/evolve/cron.log
echo "=== $(date) 快速进化开始 ===" >> $LOG

# 只进化quick和wave（最活跃的两个策略）
# 小population: grid=30, GA=2代×20个体, factor=10, screener=10
python3 auto_evolve.py \
  --agent momentum \
  --days 60 \
  --generations 2 \
  --population 20 \
  >> $LOG 2>&1

# 分析器
python3 evolve_analyzer.py >> $LOG 2>&1

# 生成LLM任务（如果需要）
TRIGGER=/opt/trading-agent/scripts/data/evolve/analysis_trigger.json
if [ -f "$TRIGGER" ]; then
    NEEDS_ACTION=$(python3 -c "import json; print(json.load(open('$TRIGGER')).get('action_required', False))" 2>/dev/null)
    if [ "$NEEDS_ACTION" = "True" ]; then
        python3 -c "
import json
trigger = json.load(open('$TRIGGER'))
task = {'type': 'evolution_analysis', 'trigger': trigger}
json.dump(task, open('/opt/trading-agent/scripts/data/evolve/llm_task.json', 'w'), indent=2)
" 2>/dev/null
    fi
fi

# 选币回测（用当前参数验证）
python3 -c "
import asyncio
from screener_backtest import ScreenerBacktest
bt = ScreenerBacktest()
asyncio.run(bt.run_comparison(days=30))
" >> /opt/trading-agent/logs/screener_bt.log 2>&1

echo "=== $(date) 快速进化完成 ===" >> $LOG
