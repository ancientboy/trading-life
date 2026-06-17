#!/usr/bin/env python3
"""
周度反思脚本 - 由cron每周触发

运行三层优化闭环：
1. 加载最近7天反馈
2. 分析并生成优化建议
3. 输出报告
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / 'agents'))
from agents.enhancer import (
    FeedbackClassifier, FeedbackReflectionAgent, 
    HierarchicalOptimizer, MarketRegimeDetector
)

def run_weekly_reflection():
    print("=" * 60)
    print(f"📊 周度反思报告")
    print(f"   {datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)
    
    # 1. 反馈摘要
    summary = FeedbackClassifier.get_summary(days=7)
    if summary['total'] == 0:
        print("\n❌ 最近7天无交易反馈数据")
        return
    
    print(f"\n📈 总体表现:")
    print(f"   交易笔数: {summary['total']}")
    print(f"   胜率: {summary['win_rate']:.1f}%")
    print(f"   总盈亏: ${summary['total_pnl']:,.2f}")
    
    print(f"\n📊 按信号类型:")
    for etype, stats in summary.get('by_entry_type', {}).items():
        wr = stats['wins'] / stats['count'] * 100 if stats['count'] > 0 else 0
        emoji = "🟢" if stats['pnl'] > 0 else "🔴"
        print(f"   {emoji} {etype}: {stats['count']}笔 | 胜率{wr:.0f}% | PnL ${stats['pnl']:+,.0f}")
    
    print(f"\n📊 按严重程度:")
    for sev, count in summary.get('by_severity', {}).items():
        emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(sev, "⚪")
        print(f"   {emoji} {sev}: {count}笔")
    
    print(f"\n📊 按市场环境:")
    for regime, count in summary.get('by_regime', {}).items():
        print(f"   {regime}: {count}笔")
    
    # 2. 运行优化
    print(f"\n{'='*60}")
    print(f"🔧 优化分析")
    print(f"{'='*60}")
    
    report = HierarchicalOptimizer.get_optimization_report()
    print(report)
    
    # 3. 运行优化闭环
    result = HierarchicalOptimizer.run(auto_apply_level1=False)
    
    print(f"\n📋 优化结果:")
    print(f"   总建议: {result.get('total_suggestions', 0)}")
    for level, count in result.get('by_level', {}).items():
        emoji = {"parameter": "🔧", "function": "⚡", "strategy": "🔥"}.get(level, "❓")
        print(f"   {emoji} {level}: {count}条")
    
    if result.get('pending'):
        print(f"\n⏳ 待确认建议 ({len(result['pending'])}条):")
        for i, s in enumerate(result['pending'][:10], 1):
            level_emoji = {"parameter": "🔧", "function": "⚡", "strategy": "🔥"}.get(s['level'], "❓")
            print(f"   {i}. {level_emoji} [{s['level']}] {s['entry_type']}")
            print(f"      {s['reason']}")
            print(f"      建议: {s['suggested_value']}")
    
    # 4. 推送报告
    report_file = Path(__file__).parent / 'data' / 'weekly_reflection.json'
    json.dump({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "optimization": result,
    }, open(report_file, 'w'), ensure_ascii=False, indent=2, default=str)
    
    print(f"\n✅ 报告已保存: {report_file}")


if __name__ == "__main__":
    run_weekly_reflection()
