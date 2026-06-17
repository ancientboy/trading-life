# LLM 分析日志

## 2026-05-23 11:47 - 首次LLM大脑分析

### 输入
- 进化记录22条，去重后14条新记录
- 收敛状态：quick=converged, wave=wide_open, newcoin=stuck, risk=converged
- 覆盖率：quick 0.0%, wave 0.0%, newcoin 0.2%, risk 1.6%

### 分析

**momentum_quick 收敛原因：**
- 最佳参数trail=1.5%，但知识库显示trail=1.0%更好（$65K vs $52K）
- 问题：当前best_params.json里存的是trail=1.5（旧参数），不是1.0（v3代码值）
- 进化引擎没搜到1.0因为grid search采样太稀疏
- 行动：扩展trail范围到0.5~3.0（已在v3完成），下次应能搜到

**momentum_wave 空间大原因：**
- wave参数对结果影响巨大（$38K~$62K波动）
- breakout_bars=10 vs 20 差距15% PnL
- 还有很多未探索区域
- 行动：增加population到40

**momentum_newcoin 打转原因：**
- newcoin模式信号太少（620笔都是同一个结果）
- 回测数据中7天内新币样本不够
- 纯参数调优已到天花板
- 行动：需要新信号维度（链上数据/SNS热度），暂标记为低优先级

**risk 收敛原因：**
- 参数空间只有64组，已充分探索
- max_positions=6, risk=3%, circuit_break=8 是合理值
- 行动：保持

### 决策
1. ✅ 保持trail扩展（v3已完成）
2. ✅ population 30→40
3. ⏸️ newcoin暂时不再调参，专注quick和wave
4. 📝 更新知识库

### 下次进化建议
- 重点搜 momentum_wave（空间最大）
- momentum_quick 加入trail=0.8测试
- newcoin 考虑换成"小币突破"模式（不限上线时间）
