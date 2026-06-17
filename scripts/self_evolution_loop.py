#!/usr/bin/env python3
"""
Self-Evolution Loop — 自进化主循环
整合所有harness工具，形成闭环：
  发现策略 → 回测验证 → Walk-Forward过滤 → 部署 → 实盘验证 → 反馈 → 再优化

针对三种币类型：
  - 主流币 (major): BTC/ETH/SOL/BNB — 稳定趋势策略
  - 山寨币 (altcoin): Top50-200 — 动量突破策略
  - 新币 (newcoin): 上线<60天 — prelaunch策略

每轮循环：
  1. 分析市场状态 → 确定当前应该偏多/偏空/观望
  2. 分析历史表现 → 找出亏损原因、黑名单
  3. 策略参数优化 → VBT全扫 + Walk-Forward
  4. 选币参数优化 → 筛选条件回测
  5. 部署稳健参数 → 只部署衰减<30%的
  6. 反馈记录 → 写入知识库

设计为可被cron调用或被LLM大脑调用
"""
import os, sys, json, time, traceback
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

sys.path.insert(0, os.path.dirname(__file__))

LOG_DIR = os.path.join(os.path.dirname(__file__), "data/evolve")
EVOLVE_HISTORY = os.path.join(LOG_DIR, "evolve_history.jsonl")
BEST_PARAMS_FILE = os.path.join(LOG_DIR, "best_params.json")
KNOWLEDGE_FILE = os.path.join(LOG_DIR, "KNOWLEDGE_BASE.md")
OPTIMIZATION_LOG = os.path.join(LOG_DIR, "optimization_log.jsonl")


class SelfEvolutionLoop:
    """自进化主循环"""
    
    # 三类币的策略配置
    AGENT_CONFIG = {
        "major": {
            "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
            "strategies": ["momentum_quick", "momentum_wave"],
            "description": "主流币 — 趋势跟随",
        },
        "altcoin": {
            "symbols": None,  # 动态从screener获取
            "strategies": ["momentum_quick", "momentum_wave"],
            "description": "山寨币 — 动量突破",
        },
        "newcoin": {
            "symbols": None,  # 动态筛选上线<60天
            "strategies": ["momentum_newcoin"],
            "description": "新币 — prelaunch",
        },
    }
    
    def __init__(self):
        self.log_messages = []
        self.best_params = self._load_best_params()
        self.optimization_count = 0
        
    def _load_best_params(self) -> dict:
        try:
            with open(BEST_PARAMS_FILE) as f:
                return json.load(f)
        except:
            return {}
    
    def _save_best_params(self):
        with open(BEST_PARAMS_FILE, 'w') as f:
            json.dump(self.best_params, f, indent=2)
    
    def log(self, msg: str, level: str = "INFO"):
        ts = time.strftime('%H:%M:%S')
        entry = f"[{ts}] [{level}] {msg}"
        self.log_messages.append(entry)
        print(entry)
    
    def _append_history(self, record: dict):
        """记录优化历史"""
        with open(OPTIMIZATION_LOG, 'a') as f:
            f.write(json.dumps(record, default=str) + '\n')
    
    # ============================================================
    # Phase 1: 市场状态分析
    # ============================================================
    def phase_analyze_market(self) -> dict:
        """分析市场状态"""
        self.log("📊 Phase 1: 市场状态分析")
        
        from harness_analyzer import analyze_regime
        regime = analyze_regime()
        
        self.log(f"  市场状态: {regime.get('regime_cn', '?')} ({regime.get('regime', '?')})")
        btc = regime.get('btc', {})
        self.log(f"  BTC: ${btc.get('price', 0):,.0f} 24h:{btc.get('change_24h', 0):+.1f}%")
        self.log(f"  趋势: {btc.get('trend', '?')} 广度:{regime.get('breadth', {}).get('ratio', 0):.0f}%")
        
        return regime
    
    # ============================================================
    # Phase 2: 历史表现分析
    # ============================================================
    def phase_analyze_performance(self) -> dict:
        """分析历史表现和亏损"""
        self.log("📉 Phase 2: 历史表现分析")
        
        from harness_analyzer import analyze_failure, analyze_drawdown
        
        failure = analyze_failure(days=30)
        drawdown = analyze_drawdown(days=30)
        
        summary = failure.get("summary", {})
        self.log(f"  30天: {summary.get('total', 0)}笔 WR{summary.get('win_rate', 0):.0f}% PnL${summary.get('total_pnl', 0):+,.0f}")
        
        # 方向分析
        direction = failure.get("direction", {})
        for d, stats in direction.items():
            if stats.get("trades", 0) > 0:
                self.log(f"  {d}: {stats['trades']}笔 WR{stats['wr']:.0f}% PnL${stats['pnl']:+,.0f}")
        
        # 黑名单建议
        blacklist = failure.get("blacklist_suggestions", [])
        if blacklist:
            self.log(f"  🚫 建议黑名单: {', '.join(blacklist)}")
        
        # 模式识别
        for pattern in failure.get("patterns", []):
            self.log(f"  📊 {pattern}")
        
        return {"failure": failure, "drawdown": drawdown, "blacklist": blacklist}
    
    # ============================================================
    # Phase 3: 策略参数优化（分币类型）
    # ============================================================
    def phase_optimize_strategies(self, regime: dict) -> dict:
        """对每类币做策略优化"""
        self.log("🔬 Phase 3: 策略参数优化")
        
        results = {}
        
        for agent_type, config in self.AGENT_CONFIG.items():
            self.log(f"\n  === {config['description']} ({agent_type}) ===")
            
            agent_results = {}
            for strategy in config["strategies"]:
                self.log(f"  策略: {strategy}")
                
                try:
                    # VBT全扫
                    from vbt_backtest import full_sweep
                    symbols = config["symbols"] or self._get_dynamic_symbols(agent_type)
                    if not symbols:
                        self.log(f"    ⚠️ 无币种，跳过")
                        continue
                    
                    sweep_result = full_sweep(strategy, days=60, top_n=min(len(symbols), 12))
                    
                    if not sweep_result or not sweep_result.get("best_overall"):
                        self.log(f"    ⚠️ 无结果")
                        continue
                    
                    best = sweep_result["best_overall"]
                    self.log(f"    全扫最优: Score={best['score']:.0f} PnL={best['pnl_pct']:+.1f}% WR={best['win_rate']:.1f}%")
                    
                    # Walk-Forward验证
                    train_avg, test_avg, test_wr, degradation = self._walk_forward_check(
                        strategy, best["params"], symbols
                    )
                    
                    is_robust = degradation < 30 and test_avg > 0
                    status = "✅ 稳健" if is_robust else f"⚠️ 过拟合(衰减{degradation:.0f}%)"
                    self.log(f"    WF验证: 训练{train_avg:+.1f}%→测试{test_avg:+.1f}% WR{test_wr:.0f}% {status}")
                    
                    agent_results[strategy] = {
                        "best_params": best["params"],
                        "sweep_score": best["score"],
                        "sweep_pnl": best["pnl_pct"],
                        "train_pnl": train_avg,
                        "test_pnl": test_avg,
                        "test_wr": test_wr,
                        "degradation": degradation,
                        "robust": is_robust,
                    }
                    
                    # 只部署稳健参数
                    if is_robust and best["score"] > self._current_score(strategy):
                        self.best_params[strategy] = {
                            **best["params"],
                            "_metadata": {
                                "source": "self_evolution",
                                "test_pnl": test_avg,
                                "degradation": degradation,
                                "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
                                "regime": regime.get("regime"),
                            }
                        }
                        self._save_best_params()
                        self.log(f"    🚀 已部署! (优于当前参数)")
                    
                except Exception as e:
                    self.log(f"    ❌ 错误: {e}")
                    traceback.print_exc()
            
            results[agent_type] = agent_results
        
        return results
    
    def _get_dynamic_symbols(self, agent_type: str) -> List[str]:
        """动态获取币种列表"""
        try:
            from harness import DataLoader
            loader = DataLoader()
            
            if agent_type == "altcoin":
                return loader.get_top_symbols(30)
            elif agent_type == "newcoin":
                # 获取新币（上线<60天）
                symbols = loader.get_all_symbols()
                # 简化：返回所有活跃币（newcoin检测在momentum_agent里做）
                return loader.get_top_symbols(20)
            else:
                return self.AGENT_CONFIG[agent_type]["symbols"]
        except:
            return []
    
    def _walk_forward_check(self, strategy: str, params: dict, 
                            symbols: List[str], days: int = 90) -> tuple:
        """Walk-Forward快速验证"""
        from vbt_backtest import fetch_klines_batch, vectorized_quick_backtest, vectorized_wave_backtest
        
        data = fetch_klines_batch(symbols[:8], "4h", days)  # 限制8币省内存
        
        fn = vectorized_quick_backtest if strategy == "momentum_quick" else vectorized_wave_backtest
        
        train_pnls = []
        test_pnls = []
        
        for sym, df in data.items():
            split = int(len(df) * 0.4)
            train_df = df.iloc[:split]
            test_df = df.iloc[split:]
            
            train_r = fn(train_df, sym, [params])
            test_r = fn(test_df, sym, [params])
            
            for r in train_r: train_pnls.append(r.pnl_pct)
            for r in test_r: test_pnls.append(r.pnl_pct)
        
        train_avg = np.mean(train_pnls) if train_pnls else 0
        test_avg = np.mean(test_pnls) if test_pnls else 0
        test_wr = sum(1 for p in test_pnls if p > 0) / max(len(test_pnls), 1) * 100
        degradation = (train_avg - test_avg) / max(train_avg, 0.1) * 100 if train_avg > 0 else 999
        
        return train_avg, test_avg, test_wr, degradation
    
    def _current_score(self, strategy: str) -> float:
        """当前参数的score"""
        current = self.best_params.get(strategy, {})
        if "_metadata" in current:
            return current.get("_metadata", {}).get("sweep_score", 0)
        return 0
    
    # ============================================================
    # Phase 4: 选币优化
    # ============================================================
    def phase_optimize_screener(self) -> dict:
        """优化选币权重"""
        self.log("🔍 Phase 4: 选币权重进化")
        
        try:
            from evolvable_screener import evolve_screener_weights
            import asyncio
            
            # 先验证当前权重
            weights_file = os.path.join(LOG_DIR, "screener_weights.json")
            try:
                old_weights = json.load(open(weights_file))
                self.log(f"  当前权重: Score={old_weights.get('score',0):.1f} Avg={old_weights.get('avg_return',0):+.1f}%")
            except: pass
            
            # 进化5代
            best = asyncio.run(evolve_screener_weights(days=60, top_n=40, generations=5))
            
            self.log(f"  ✅ 选币权重进化完成")
            
            return {"evolved": True, "weights": best}
        except Exception as e:
            self.log(f"  ❌ 选币优化失败: {e}")
            return {}
    
    # ============================================================
    # Phase 5: 知识库更新
    # ============================================================
    def phase_update_knowledge(self, regime: dict, perf: dict, strategy_results: dict):
        """更新知识库"""
        self.log("📚 Phase 5: 更新知识库")
        
        entry = f"""
## {time.strftime('%Y-%m-%d %H:%M')} 自进化循环

### 市场状态
- {regime.get('regime_cn', '?')} | BTC ${regime.get('btc', {}).get('price', 0):,.0f}
- 趋势: {regime.get('btc', {}).get('trend', '?')} | 广度: {regime.get('breadth', {}).get('ratio', 0):.0f}%

### 绩效
- 30天 WR{perf.get('failure', {}).get('summary', {}).get('win_rate', 0):.0f}% PnL${perf.get('failure', {}).get('summary', {}).get('total_pnl', 0):+,.0f}
- 回撤: {perf.get('drawdown', {}).get('max_drawdown_pct', 0):.1f}%

### 策略优化结果
"""
        for agent_type, results in strategy_results.items():
            for strategy, data in results.items():
                robust = "✅" if data.get("robust") else "⚠️"
                entry += f"- {robust} {agent_type}/{strategy}: 测试{data.get('test_pnl', 0):+.1f}% 衰减{data.get('degradation', 0):.0f}%\n"
        
        with open(KNOWLEDGE_FILE, 'a') as f:
            f.write(entry)
        
        self.log("  知识库已更新")
    
    # ============================================================
    # 主循环
    # ============================================================
    def run_once(self) -> dict:
        """执行一轮完整的自进化循环"""
        start = time.time()
        self.log(f"\n{'='*60}")
        self.log(f"🧬 自进化循环开始")
        self.log(f"{'='*60}")
        
        try:
            # Phase 1: 市场分析
            regime = self.phase_analyze_market()
            
            # Phase 2: 绩效分析
            perf = self.phase_analyze_performance()
            
            # Phase 3: 策略优化
            strategy_results = self.phase_optimize_strategies(regime)
            
            # Phase 4: 选币优化
            screener_result = self.phase_optimize_screener()
            
            # Phase 5: 知识库
            self.phase_update_knowledge(regime, perf, strategy_results)
            
            elapsed = time.time() - start
            self.log(f"\n✅ 自进化循环完成 ({elapsed:.0f}s)")
            
            # 汇总
            summary = {
                "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
                "elapsed_seconds": round(elapsed, 1),
                "regime": regime.get("regime"),
                "performance": {
                    "wr": perf.get("failure", {}).get("summary", {}).get("win_rate", 0),
                    "pnl": perf.get("failure", {}).get("summary", {}).get("total_pnl", 0),
                },
                "strategy_results": strategy_results,
                "deployed": [s for s, p in self.best_params.items() 
                            if "_metadata" in p and p["_metadata"].get("source") == "self_evolution"],
                "log": self.log_messages[-20:],
            }
            
            self._append_history(summary)
            return summary
            
        except Exception as e:
            self.log(f"❌ 循环失败: {e}")
            traceback.print_exc()
            return {"error": str(e)}


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="自进化主循环")
    parser.add_argument("--once", action="store_true", help="执行一轮")
    parser.add_argument("--continuous", action="store_true", help="持续循环")
    parser.add_argument("--interval", type=int, default=3600, help="循环间隔(秒)")
    args = parser.parse_args()
    
    loop = SelfEvolutionLoop()
    
    if args.once:
        result = loop.run_once()
        print(json.dumps(result, indent=2, default=str, ensure_ascii=False))
    elif args.continuous:
        print(f"🔄 持续进化模式，间隔{args.interval}秒")
        while True:
            try:
                result = loop.run_once()
                # 通知（如果配置了）
                report_file = "/opt/trading-agent/data/pending_wechat_report.json"
                deployed = result.get("deployed", [])
                if deployed:
                    msg = f"🧬 自进化部署更新:\n"
                    for s in deployed:
                        p = loop.best_params.get(s, {})
                        meta = p.get("_metadata", {})
                        msg += f"  {s}: 测试{meta.get('test_pnl', 0):+.1f}% 衰减{meta.get('degradation', 0):.0f}%\n"
                    json.dump({
                        "pushed": False,
                        "message": msg,
                        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
                    }, open(report_file, 'w'), indent=2)
                
                time.sleep(args.interval)
            except KeyboardInterrupt:
                print("停止")
                break
            except Exception as e:
                print(f"循环错误: {e}")
                time.sleep(60)
    else:
        parser.print_help()
