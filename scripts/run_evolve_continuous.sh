#!/bin/bash
cd /opt/trading-agent/scripts
LOG=data/evolve/continuous.log
MAX_ITERATIONS=${1:-30}
ITER=0
TOTAL_BEFORE=$(wc -l < data/evolve/evolve_history.jsonl)
NO_NEW_COUNT=0

echo "=== $(date) 持续进化开始 (目标${MAX_ITERATIONS}轮, 低内存模式) ===" >> $LOG
echo "  初始记录: ${TOTAL_BEFORE}条" >> $LOG

while [ $ITER -lt $MAX_ITERATIONS ]; do
    ITER=$((ITER + 1))
    echo "" >> $LOG
    echo "--- 迭代 ${ITER}/${MAX_ITERATIONS} $(date +%H:%M:%S) ---" >> $LOG
    
    python3 auto_evolve.py \
      --agent momentum \
      --days 60 \
      --generations 2 \
      --population 10 \
      >> $LOG 2>&1
    
    TOTAL_AFTER=$(wc -l < data/evolve/evolve_history.jsonl)
    NEW=$((TOTAL_AFTER - TOTAL_BEFORE))
    TOTAL_BEFORE=$TOTAL_AFTER
    
    echo "  新增: ${NEW}条 | 总计: ${TOTAL_AFTER}条" >> $LOG
    
    if [ "$NEW" -eq 0 ]; then
        NO_NEW_COUNT=$((NO_NEW_COUNT + 1))
        if [ "$NO_NEW_COUNT" -ge 3 ]; then
            echo "  连续3轮无新参数，提前停止" >> $LOG
            break
        fi
    else
        NO_NEW_COUNT=0
    fi
    
    sleep 3
done

python3 evolve_analyzer.py >> $LOG 2>&1

TRIGGER=data/evolve/analysis_trigger.json
if [ -f "$TRIGGER" ]; then
    python3 -c "
import json
trigger = json.load(open('data/evolve/analysis_trigger.json'))
task = {'type': 'continuous_evolution_done', 'trigger': trigger, 'iterations': $ITER}
json.dump(task, open('data/evolve/llm_task.json', 'w'), indent=2)
" >> $LOG 2>&1
fi

echo "=== $(date) 持续进化完成 (${ITER}轮, ${TOTAL_AFTER}条记录) ===" >> $LOG
