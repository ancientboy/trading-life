# 方案B：两阶段重构计划 (v14)

## 目标
把18层过滤砍到 **4层**，消除方向冲突、参数打架、置信度层层削减。

## 新架构（2阶段 + 2层过滤）

```
阶段1: direction_rules.py → 方向一锤定音（BB+RSI+EMA）
         ↓ SKIP → 结束
         ↓ LONG/SHORT → 继续
阶段2: SMC提供价位（入场区/止损/止盈）+ AI确认时机
         ↓ AI判断SKIP → 结束
         ↓ AI确认入场 → 继续
过滤1: risk_agent.py → 风控审核（仓位/止损/盈亏比/冷却）
         ↓ 拒绝 → 结束
         ↓ 通过 → 继续
过滤2: paper_trade.py → 开仓执行
```

## 要改的文件（4个）

### 1. `auto_runner.py` — 大幅简化 run_analysis_cycle
**删除的过滤层（~200行）：**
- ❌ 4h趋势结构硬否决 (L170-191)
- ❌ SMC方向对比+日志 (L197-204)  
- ❌ 技术面冲突检查 (L206-215)
- ❌ 选币方向冲突检查 (L216-225)
- ❌ LONG门槛(≥75%) (L229-236)
- ❌ StochRSI+EMA双确认过滤器 (L257-295)
- ❌ LONG高位追涨拒绝 (L301-309)
- ❌ 置信度拒绝冷却 (L241-248, L386-394)
- ❌ 盈亏比拒绝冷却 (L375-384)
- ❌ OB连续跳过冷却 (简化，只保留基本冷却)
- ❌ 回调入场等待队列 (_pending_pullbacks) — 暂时移除，后续可选加回

**保留的：**
- ✅ 已持仓/冷却预筛（L523-555）— 避免浪费API
- ✅ 风控审核 (risk_agent.review_signal)
- ✅ AI决策流程核心

**简化后的 run_analysis_cycle 流程：**
```
for each candidate:
    1. 规则引擎 judge_direction() → 方向+置信度
       - SKIP → 跳过
       - LONG/SHORT → 继续
    2. SMC生成入场区/止损/止盈（纯价位，不参与方向）
    3. AI确认时机（方向已定，只回答入场/等待）
    4. 构造信号 → 风控审核 → 开仓
```

### 2. `ai_trader.py` — 简化AI角色
**删除：**
- ❌ `ai_analyze_trend()` 函数（死代码，从未被调用）
- ❌ `TREND_SYSTEM_PROMPT`（不再需要AI判断趋势）
- ❌ `ai_batch_analyze()` 函数（不再使用）

**保留/修改：**
- ✅ `_build_timing_prompt()` — 简化，去掉StochRSI/EMA等冗余提示
- ✅ `ai_analyze()` — 简化：
  - 阶段1直接用 `judge_direction()` 结果（已有）
  - 阶段2 AI确认时机（已有）
  - 删除 `TREND_SYSTEM_PROMPT` 相关代码

### 3. `risk_agent.py` — 简化风控
**删除：**
- ❌ 舆情风控检查 (L350-367)
- ❌ 舆情矛盾减仓 (L486-493)
- ❌ 极端情绪减仓 (L496-501)
- ❌ 趋势冲突保护 (L378-381)
- ❌ SMC+HMA对齐加分 (L448-457) — 杠杆不应依赖这些

**保留：**
- ✅ 止损冷却/黑名单机制
- ✅ 置信度检查
- ✅ 盈亏比检查（RR<1.0拒绝，<1.5警告）
- ✅ 仓位/总仓位上限
- ✅ 动态杠杆计算
- ✅ 连续亏损减仓

### 4. `ai_briefing.py` — 清理简报
**删除：**
- ❌ `_calc_stochrsi_simple()` 函数（名字误导，实际返回RSI不是StochRSI）
- ❌ 简报中的StochRSI段落（用 `direction_rules.py` 的指标替代）

**新增：**
- ✅ 注入 `direction_rules.py` 的指标结果到简报（BB %B, RSI, EMA排列）
  让AI看到规则引擎用的数据，更好地判断时机

## 不改的文件
- `direction_rules.py` — 保持不变，方向一锤定音
- `smc_signal.py` — 保持不变，只提供价位
- `hma_trend.py` — 保持不变，信号注入简报
- `analyst_tech.py` — 保持不变，工具函数库
- `analyst_agent.py` — 保持不变，数据采集
- `paper_trade.py` — 大部分保持不变，只去掉重复的仓位计算

## 实施顺序
1. 备份所有要改的文件
2. 先改 `ai_trader.py`（最小改动，删死代码）
3. 再改 `risk_agent.py`（删舆情风控）
4. 再改 `ai_briefing.py`（清理简报）
5. 最后改 `auto_runner.py`（最大改动，简化调度逻辑）
6. 测试运行1轮，确认信号生成正常

## 风险控制
- 每步改动前备份原文件
- 改完后先 `--once` 单次测试
- 确认无误后再正式运行
