#!/bin/bash
cd /opt/trading-agent/scripts
echo "=== $(date) 自进化循环开始 ===" >> data/evolve/self_evolution.log
python3 self_evolution_loop.py --once >> data/evolve/self_evolution.log 2>&1
echo "=== $(date) 自进化循环完成 ===" >> data/evolve/self_evolution.log
