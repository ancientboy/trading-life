#!/usr/bin/env python3
"""
进化后分析触发器
进化完成后生成分析报告，写入trigger文件等待LLM大脑（炮炮）处理
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

EVOLVE_DIR = Path(__file__).parent / "data" / "evolve"
HISTORY_FILE = EVOLVE_DIR / "evolve_history.jsonl"
BEST_PARAMS = EVOLVE_DIR / "best_params.json"
KNOWLEDGE_BASE = EVOLVE_DIR / "KNOWLEDGE_BASE.md"
ANALYSIS_TRIGGER = EVOLVE_DIR / "analysis_trigger.json"
PARAM_FINGERPRINTS = EVOLVE_DIR / "param_fingerprints.json"


def md5_params(params: dict) -> str:
    """参数指纹去重"""
    import hashlib
    s = json.dumps(params, sort_keys=True)
    return hashlib.md5(s.encode()).hexdigest()


def load_history() -> list:
    if not HISTORY_FILE.exists():
        return []
    records = []
    for line in HISTORY_FILE.read_text().strip().split('\n'):
        if line.strip():
            records.append(json.loads(line))
    return records


def load_fingerprints() -> set:
    if not PARAM_FINGERPRINTS.exists():
        return set()
    return set(json.loads(PARAM_FINGERPRINTS.read_text()))


def save_fingerprints(fps: set):
    PARAM_FINGERPRINTS.write_text(json.dumps(list(fps)))


def deduplicate(records: list, fingerprints: set) -> tuple:
    """去重：返回新记录数和跳过数"""
    new_count = 0
    skip_count = 0
    new_records = []
    for r in records:
        params = r.get('result', {}).get('params') or r.get('best', {}).get('params')
        if params:
            fp = md5_params(params)
            if fp in fingerprints:
                skip_count += 1
                continue
            fingerprints.add(fp)
            new_count += 1
            new_records.append(r)
    return new_count, skip_count, new_records


def analyze_convergence(records: list) -> dict:
    """分析收敛情况：参数是否在局部打转"""
    strategy_results = defaultdict(list)
    for r in records:
        s = r.get('strategy', '?')
        result = r.get('result') or r.get('best', {})
        strategy_results[s].append({
            'score': result.get('score', 0),
            'pnl': result.get('pnl', 0),
            'win_rate': result.get('win_rate', 0),
            'trades': result.get('trades', 0),
            'params': result.get('params', {}),
            'type': r.get('type', '?'),
        })

    analysis = {}
    for strategy, results in strategy_results.items():
        if len(results) < 3:
            analysis[strategy] = {'status': 'insufficient_data', 'count': len(results)}
            continue

        scores = [r['score'] for r in results]
        pnls = [r['pnl'] for r in results]

        # 收敛度：最近3次的score标准差
        recent = scores[-3:]
        avg = sum(recent) / len(recent)
        variance = sum((s - avg) ** 2 for s in recent) / len(recent)
        std = variance ** 0.5

        if std < 5:
            status = 'converged'  # 已收敛
        elif std < 20:
            status = 'exploring'  # 还在探索
        else:
            status = 'wide_open'  # 空间很大

        best = max(results, key=lambda x: x['score'])
        worst = min(results, key=lambda x: x['score'])

        # 局部打转检测：最近5次score变化<10
        if len(scores) >= 5:
            last5 = scores[-5:]
            if max(last5) - min(last5) < 10:
                status = 'stuck'  # 局部打转

        analysis[strategy] = {
            'status': status,
            'count': len(results),
            'score_std': round(std, 1),
            'best_score': best['score'],
            'best_pnl': best['pnl'],
            'worst_pnl': worst['pnl'],
            'best_params': best['params'],
            'improvement_potential': 'high' if status in ('wide_open', 'exploring') else 'low',
        }

    return analysis


def generate_trigger():
    """生成分析触发文件"""
    records = load_history()
    if not records:
        print("无进化历史，跳过分析")
        return

    # 去重
    fingerprints = load_fingerprints()
    new_count, skip_count, new_records = deduplicate(records, fingerprints)
    save_fingerprints(fingerprints)

    # 收敛分析
    convergence = analyze_convergence(records)

    # 最近一次进化的结果
    latest = records[-1] if records else {}
    latest_ts = latest.get('timestamp', '?')[:19]

    # 计算总覆盖率
    total_space = {
        'momentum_quick': 10080,
        'momentum_wave': 6300,
        'momentum_newcoin': 960,
        'risk': 64,
    }
    coverage = {}
    for strategy, total in total_space.items():
        explored = len(set(
            md5_params(r.get('result', {}).get('params', {}))
            for r in records
            if r.get('strategy') == strategy and r.get('result', {}).get('params')
        ))
        coverage[strategy] = f'{explored}/{total} ({explored/total*100:.1f}%)'

    # 生成trigger
    trigger = {
        "type": "post_evolution_analysis",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latest_evolve": latest_ts,
        "total_records": len(records),
        "new_records": new_count,
        "duplicates_skipped": skip_count,
        "convergence": convergence,
        "coverage": coverage,
        "action_required": any(
            v.get('status') in ('stuck', 'converged')
            for v in convergence.values()
        ),
        "recommendations": [],
    }

    # 自动生成推荐
    for strategy, info in convergence.items():
        if info.get('status') == 'stuck':
            trigger['recommendations'].append(
                f"{strategy} 局部打转，建议：扩大参数空间或加入新维度"
            )
        elif info.get('status') == 'converged':
            trigger['recommendations'].append(
                f"{strategy} 已收敛，建议：增加训练数据天数或换不同市场周期"
            )
        elif info.get('status') == 'wide_open':
            trigger['recommendations'].append(
                f"{strategy} 空间大，建议：增加进化代数和population"
            )

    ANALYSIS_TRIGGER.write_text(json.dumps(trigger, indent=2, ensure_ascii=False))
    print(f"✅ 分析触发器已生成: {ANALYSIS_TRIGGER}")
    print(f"  总记录: {len(records)} | 新增: {new_count} | 去重: {skip_count}")
    for s, info in convergence.items():
        print(f"  {s}: {info.get('status', '?')} (score_std={info.get('score_std', '?')})")
    if trigger['recommendations']:
        print("  推荐:")
        for rec in trigger['recommendations']:
            print(f"    → {rec}")


if __name__ == "__main__":
    generate_trigger()
