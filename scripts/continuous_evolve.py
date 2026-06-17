#!/usr/bin/env python3
"""
持续进化 v2 - 优先使用VectorBT全参数扫描
"""
import json, time, sys, os, gc
sys.path.insert(0, os.path.dirname(__file__))

MAX_ITER = int(sys.argv[1]) if len(sys.argv) > 1 else 30
LOG = os.path.join(os.path.dirname(__file__), 'data/evolve/continuous.log')

def log(msg):
    ts = time.strftime('%H:%M:%S')
    with open(LOG, 'a') as f: f.write(f"{ts} {msg}\n")
    print(f"{ts} {msg}")

def count_records():
    p = os.path.join(os.path.dirname(__file__), 'data/evolve/evolve_history.jsonl')
    with open(p) as f: return sum(1 for l in f if l.strip())

def append_record(record: dict):
    p = os.path.join(os.path.dirname(__file__), 'data/evolve/evolve_history.jsonl')
    with open(p, 'a') as f:
        f.write(json.dumps(record, default=str) + '\n')

log(f"\n=== 持续进化v2开始 ({MAX_ITER}轮, VectorBT) ===")
before = count_records()
log(f"  初始: {before}条")

no_new = 0

for i in range(MAX_ITER):
    log(f"\n--- #{i+1}/{MAX_ITER} ---")
    try:
        # 先尝试VBT全扫（更快更全）
        for stg in ["momentum_quick", "momentum_wave"]:
            try:
                from vbt_backtest import full_sweep
                t0 = time.time()
                result = full_sweep(stg, days=60, top_n=12)
                elapsed = time.time() - t0
                
                if result and result.get('best_overall'):
                    best = result['best_overall']
                    log(f"  {stg} VBT全扫: Score={best['score']:.0f} PnL={best['pnl_pct']:+.1f}% ({elapsed:.0f}s)")
                    
                    # 记录
                    append_record({
                        'type': 'vbt_sweep',
                        'strategy': stg,
                        'result': best,
                        'coverage': '100%',
                        'elapsed': elapsed,
                        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
                    })
                else:
                    log(f"  {stg} VBT: 无结果")
            except Exception as e:
                log(f"  {stg} VBT err: {e}")
            
            gc.collect()
        
        # 补充GA进化（探索VBT之外的变异）
        from auto_evolve import EvolutionEngine
        engine = EvolutionEngine(dry_run=False)
        for stg in ["momentum_quick", "momentum_wave"]:
            try:
                r = engine.auto_optimize(stg, days=60, max_combos=15)
                if r:
                    log(f"  {stg} GA补充: Score={r.score:.0f} ${r.pnl:+,.0f}")
            except Exception as e:
                log(f"  {stg} GA err: {e}")
        del engine
        gc.collect()
        
    except Exception as e:
        log(f"  fatal: {e}")
        gc.collect()
        time.sleep(5)
        continue

    after = count_records()
    new = after - before; before = after
    log(f"  +{new} = {after}")
    if new == 0:
        no_new += 1
        if no_new >= 3: log("  converged!"); break
    else: no_new = 0
    time.sleep(2)

log(f"\n=== 完成 ({i+1}轮, {after}条) ===")
