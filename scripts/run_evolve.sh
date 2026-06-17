#!/bin/bash
# 每日自动进化 + 分析脚本
cd /opt/trading-agent/scripts

echo "=== $(date) 开始自动进化 ===" >> /opt/trading-agent/scripts/data/evolve/cron.log

# Step 1: 运行进化
python3 auto_evolve.py \
  --agent all \
  --days 90 \
  --generations 3 \
  --population 40 \
  >> /opt/trading-agent/scripts/data/evolve/cron.log 2>&1

# Step 2: 运行分析器（去重+收敛分析+生成trigger）
python3 evolve_analyzer.py \
  >> /opt/trading-agent/scripts/data/evolve/cron.log 2>&1

# Step 3: 生成LLM分析任务文件
TRIGGER=/opt/trading-agent/scripts/data/evolve/analysis_trigger.json
if [ -f "$TRIGGER" ]; then
    NEEDS_ACTION=$(python3 -c "import json; print(json.load(open('$TRIGGER')).get('action_required', False))")
    if [ "$NEEDS_ACTION" = "True" ]; then
        echo "$(date): ⚠️ 需要LLM分析，写入任务" >> /opt/trading-agent/scripts/data/evolve/cron.log
        
        # 写入LLM任务文件，供heartbeat读取
        python3 -c "
import json
trigger = json.load(open('$TRIGGER'))
task = {
    'type': 'evolution_analysis',
    'message': '🧠 进化分析任务：请读取 data/evolve/analysis_trigger.json 和 KNOWLEDGE_BASE.md，分析收敛情况并更新知识库',
    'trigger': trigger,
    'instructions': [
        '读取 analysis_trigger.json 中的收敛分析',
        '读取 KNOWLEDGE_BASE.md 中的已有知识',
        '根据收敛状态提出新的搜索方向',
        '更新 KNOWLEDGE_BASE.md（因子洞察/死路记录/探索方向）',
        '如果参数空间需要调整，修改 auto_evolve.py 中的 PARAM_SPACES',
        '如果发现重要的因子洞察，写入知识库',
    ]
}
json.dump(task, open('/opt/trading-agent/scripts/data/evolve/llm_task.json', 'w'), ensure_ascii=False, indent=2)
print('LLM task written')
"
    fi
fi

echo "=== $(date) 进化+分析完成 ===" >> /opt/trading-agent/scripts/data/evolve/cron.log
