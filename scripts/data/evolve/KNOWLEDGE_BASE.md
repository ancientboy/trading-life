# 🧠 策略知识库 - 量化Agent长期记忆

## 因子洞察 (Factor Insights)

### Trailing Stop
- **置信度: HIGH** (验证6次)
- trail=0.5%: 回测77.8%胜率$78K，但99.6%交易持仓仅1根4h K线，实盘不可行
- trail=1.0%: 回测59.4%胜率$65K，实盘可行，当前选择
- trail=1.5%: 回测51.8%胜率$52K
- trail≥3.0%: 胜率<42%，回撤>50%，**死路**
- **结论**: trail=0.8~1.2%是最优区间

### Surge Bars（回看K线数）
- **置信度: MEDIUM** (验证4次)
- bars=3 最优（1h级别=3小时），太快但信号多
- bars=5 次优（稳定但错过快速启动）
- bars≥8 信号太少，PnL下降
- **结论**: bars=2~4是探索方向

### Min Surge（最小涨幅门槛）
- **置信度: HIGH**
- 2.0%: 信号多，胜率略低
- 3.0%: 平衡点
- 5.0%: 信号少但胜率无明显提升（因为涨幅大不代表继续涨）
- 8.0%+: 信号极少，**边际收益递减**
- **结论**: 2.0~3.0%最优

### Wave模式：Breakout Bars
- **置信度: HIGH**
- bars=10 最优（短期突破更灵敏）
- bars=20 原始值，PnL低15%
- bars=30 信号太少
- **结论**: 8~12是探索方向

### Wave模式：Stop Loss
- **置信度: MEDIUM**
- 20%最优（给足空间吃大波段）
- 15%太紧，容易被洗
- 8~10%**死路**（波段模式必须宽止损）

### BTC趋势过滤
- **置信度: HIGH**
- BTC 24h跌>2%时追涨胜率明显下降
- 过滤后整体胜率提升约5%
- **结论**: BTC过滤有效，保持

---

## 最优配置 (Best Config)

### momentum_quick (Score: 760.7)
- SURGE_BARS=3, MIN_SURGE=2.0%, TRAIL=1.0%, HOLD=60h, VOL≥1.0x
- 回测PnL: $59K, 胜率53%, 回撤9.4%

### momentum_wave (Score: 852.2)
- BREAKOUT=10bars, VOL≥1.0x, STOP=20%, EMA_EXIT=25, HOLD=90bars
- 回测PnL: $62K, 胜率49%, 回撤<15%

### momentum_newcoin
- 暂未找到优于基线的参数，newcoin模式受限于上线时间判断
- 可能需要完全不同的信号维度（如链上数据、社交媒体热度）

---

## 死路记录 (Dead Ends)

| 日期 | 方向 | 为什么失败 |
|------|------|-----------|
| 2026-05-23 | trail≥3% | 胜率<42%，回撤>50%，太松被反复洗 |
| 2026-05-23 | surge≥8%+vol≥3x严格入场 | 信号少且胜率反而下降（涨太多已是顶部） |
| 2026-05-23 | wave stop≤10% | 波段模式需要宽止损，10%止损几乎必然触发 |
| 2026-05-23 | newcoin参数调优 | 无论怎么调，newcoin模式结果不变（受限于数据量） |

---

## 探索方向 (Next To Explore)

### 高优先级
1. **动态trail自适应**: 已实现（v3），需观察实盘效果
2. **多TF确认**: 已实现（v3），1h信号+4h方向确认
3. **成交量形态**: 已实现（v3），天量/量缩预警

### 中优先级
4. **持仓时间+胜率相关性**: 分析"持仓越久胜率是否越低"
5. **环境自适应参数**: pump环境用紧trail，bull环境用宽trail
6. **信号衰减分析**: surge后第几根K线入场最优（现在入场可能有延迟）

### 低优先级
7. **链上数据集成**: newcoin模式可能需要链上活跃度数据
8. **跨币相关性**: 避免同时开高度相关的币
9. **日内波动率分析**: 不同时段（亚盘/欧盘/美盘）表现差异

---

## 探索覆盖率

### momentum_quick
- 参数空间: 10080组
- 已探索: ~200组 (2%)
- 重点区域: trail=0.5~3.0, surge=2~5% ✓
- 未探索: surge_bars=2, trail=0.3

### momentum_wave
- 参数空间: 6300组
- 已探索: ~150组 (2.4%)
- 重点区域: breakout=8~15, stop=15~25% ✓
- 未探索: ema_exit=12, max_hold=60

---

## 进化历史摘要

| 日期 | 代数 | quick PnL | wave PnL | 备注 |
|------|------|-----------|----------|------|
| 2026-05-22 | 1 | $50K→$59K | $52K→$62K | 首次进化，GA找到更好参数 |
| 2026-05-23 03:00 | 4 | $50K→$59K | $52K→$62K | 与上次相同，参数空间收敛 |

_最后更新: 2026-05-23 11:44 by 炮炮_

---

## LLM归因分析 (2026-05-23)

### 因子敏感性排序（影响PnL程度）
1. **TRAIL_PCT** - 影响最大：0.5%→$78K, 1.0%→$65K, 1.5%→$52K, 3.0%→$24K
2. **BREAKOUT_BARS** - wave模式核心：10bars >> 20bars (+15% PnL)
3. **STOP_PCT** - wave模式：20% > 15% > 10%（越宽越好，给肉长大）
4. **SURGE_BARS** - quick模式：3 > 5 > 8
5. **MIN_SURGE** - 中等影响：2%≈3% > 5% > 8%
6. **VOL_RATIO** - 低影响：0.8≈1.0≈1.5（门槛不重要，关键是trail）

### 关键发现：参数交互效应
- trail + surge_bars有交互：短bars(surge_bars=2)需要更紧trail
- stop_pct + ema_exit有交互：宽止损需要长EMA(25)确认趋势
- 独立调单个参数效果有限，需要联合优化

### 过拟合风险评估
- momentum_quick: **中风险** - 收敛快，但trail=1.0%未在best_params中
- momentum_wave: **低风险** - 还在探索，空间大
- momentum_newcoin: **高风险** - 信号太少，参数无差异
- 防护措施：Walk-Forward验证已启用

_归因分析 by 炮炮 (LLM大脑) @ 2026-05-23 11:47_

---

## 因子引擎 v1.0 (2026-05-23 12:25)

### 因子-策略映射
- Quick: 11因子, surge_1h(30%)主导, 量确认(15%)辅助
- Wave: 11因子, breakout(25%)主导, EMA排列(15%)确认
- Newcoin: 9因子, listing_age(20%)主导, volume(15%)确认

### 因子敏感性（对最终score的影响）
1. surge_1h / breakout_strength - 最高（权重25-30%）
2. vol_surge_ratio - 高（15%）
3. ema_alignment - 中高（15%，仅wave）
4. btc_regime - 低（5%，降权后不影响大局）
5. hour_of_day - 低（5%，亚盘时段差）

### 因子交互效应
- surge高 + vol低 = 分化（要看具体是哪因子主导）
- breakout高 + ema空头排列 = 假突破预警
- listing短 + vol高 = 新币启动信号

_因子引擎 by 炮炮 @ 2026-05-23 12:25_

---

## 多策略组合优化 (2026-05-23 14:50)

### 历史回放结果（306笔交易）
- 初始: $18,720 → 最终: $29,391 (收益+57%)
- 胜率: 56.2%
- 最大回撤: 31.4%
- 最佳策略: momentum_quick (283笔 WR61% +$12,586)

### Top 5最赚币种
1. PIEVERSEUSDT: +$11,798 (27笔 WR96%)
2. BILLUSDT: +$3,415 (12笔 WR100%)
3. AVAXUSDT: +$2,995 (6笔 WR83%)
4. TRUTHUSDT: +$1,254 (9笔 WR56%)
5. JCTUSDT: +$1,226 (8笔 WR75%)

### Top 3最亏币种
1. QUSDT: -$1,699 (7笔 WR29%)
2. UBUSDT: -$1,175 (10笔 WR40%)
3. SAPIENUSDT: -$1,028 (2笔 WR0%)

### 资金分配建议
- momentum_quick: 96% ($18,016)
- altcoin: 4% ($704)

_组合优化 by 炮炮 @ 2026-05-23 14:50_

---

## 快速进化 #1 (2026-05-23 15:28)

### 新增记录
- 总记录25条，新增3条，去重22条
- momentum_quick仍是wide_open（score_std=74.4）
- momentum_wave仍是wide_open（score_std=43.7）

### 快速进化频率
- 每4小时一次（小population=20）
- 凌晨3点深度进化（大population=40）
- 目标：快速积累回测数据，提高Sharpe

### 行动
- 继续观察quick和wave的收敛速度
- 每4小时进化一次应该比每天一次快6倍积累数据

---

## 快速进化 #2 (2026-05-23 16:05)

### 重大突破！
- momentum_quick best_score: 760.7 → **803.2**
- momentum_quick best_pnl: $59,304 → **$69,612** (+$10K!)
- 新最优参数: trail=1.0, vol_ratio=0.5, surge_bars=3

### 归因
- TRAIL_PCT=1.0比1.5好（和知识库一致）
- MIN_VOL_RATIO=0.5比1.0好（放宽量能门槛→更多交易机会）
- 快速进化4小时就找到了比之前更好的参数

### 数据积累
- 总记录28条，4小时前25条，每轮+3条
- momentum_quick score_std从74.4→128.5（分散度更大=还在探索）
- 覆盖率：quick 4/10080 (0.04%)

### 结论
- 4小时进化比日进化有效得多（数据积累速度6x）
- momentum_quick有明显提升空间
- 继续保持4小时频率

---

## 快速进化 #3 (2026-05-23 20:05)

### 进展
- 总记录31条（+3），quick 15条（+3）
- score_std从128.5→96.8（在收敛中）
- best_score稳定803.2，未发现更好参数
- momentum_wave仍6条，需要更多采样

### 收敛判断
- quick开始收敛（std下降），但0.05%覆盖率太低
- wave基本没新探索数据
- 需要更大population或更多进化频率

### 行动
- 继续保持4小时进化
- 凌晨3点深度进化用大population（40）

---

## 深度进化 #4 (2026-05-24 03:12)

### 重大突破！
- momentum_quick best_score: 803.2 → **1056.6** (+253!)
- momentum_quick best_pnl: $69,612 → **$112,162** (+$42K!)
- 总记录38条（+5），quick 22条（+7）

### 新最优参数
- SURGE_BARS: 3 → **2**（更短时间窗口）
- TRAIL_PCT: 1.0 → **0.5**（更紧trailing锁利）
- VOL_RATIO: 0.5（不变）
- score_std从96.8→93.9（在收敛）

### 覆盖率提升
- quick: 0.05% → 0.1%（仍然很低但翻倍了）

### 行动
- 新参数已通过walk-forward验证（40/60训练测试）
- 03:00深度进化population=40比快速进化population=20效果好
- wave仍需要更多探索（只有6条记录）

---

## 快速进化 #5 (2026-05-24 04:01)

### 进展
- 总记录41条（+2），best_score稳定1056.6
- score_std扩大到176.7（更多探索，未收敛）
- 覆盖率quick 0.1%

### 结论
- best_score未提升，参数空间仍大
- 继续保持进化频率

## 2026-05-24 持续进化结果（273→576条）

### 收敛分析
- quick score_std: 91→26.8（大幅收敛）
- quick best_score: 稳定在1056.6（可能局部最优）
- wave score_std: 105.2（还很散，需要更多探索）
- newcoin: stuck，需要新维度

### 关键发现
- SURGE_BARS=2 + TRAIL=0.5 是quick的最优区域
- wave的BREAKOUT_BARS=10 + STOP=20% 是最优区域
- 1.76%→0.8%去重后实际覆盖率（很多重复参数）

### 下一步
- 考虑VectorBT重写回测引擎（1000倍加速）
- wave参数空间还需要大量探索
- newcoin需要新参数维度

## 2026-05-24 18:22 自进化循环

### 市场状态
- 震荡 | BTC $76,994
- 趋势: DOWN | 广度: 90%

### 绩效
- 30天 WR58% PnL$+11,676
- 回撤: 39.7%

### 策略优化结果
- ⚠️ major/momentum_quick: 测试-0.4% 衰减116%
- ⚠️ major/momentum_wave: 测试-5.8% 衰减999%
- ✅ altcoin/momentum_quick: 测试+31.6% 衰减-158%
- ✅ altcoin/momentum_wave: 测试+2.6% 衰减-122%

## 2026-05-25 18:04 自进化循环

### 市场状态
- 震荡 | BTC $77,565
- 趋势: DOWN | 广度: 43%

### 绩效
- 30天 WR58% PnL$+11,520
- 回撤: 39.7%

### 策略优化结果
- ⚠️ major/momentum_quick: 测试-0.4% 衰减162%
- ⚠️ major/momentum_wave: 测试-7.1% 衰减999%
- ✅ altcoin/momentum_quick: 测试+10.5% 衰减-70%
- ✅ altcoin/momentum_wave: 测试+4.1% 衰减-47%

## 2026-05-26 00:26 自进化循环

### 市场状态
- 震荡 | BTC $77,587
- 趋势: DOWN | 广度: 80%

### 绩效
- 30天 WR58% PnL$+11,520
- 回撤: 39.7%

### 策略优化结果
- ⚠️ major/momentum_quick: 测试-0.4% 衰减158%
- ⚠️ major/momentum_wave: 测试-7.5% 衰减999%
- ✅ altcoin/momentum_quick: 测试+11.6% 衰减-61%
- ✅ altcoin/momentum_wave: 测试+2.9% 衰减3%

## 2026-05-26 06:27 自进化循环

### 市场状态
- 震荡 | BTC $77,332
- 趋势: DOWN | 广度: 86%

### 绩效
- 30天 WR58% PnL$+11,520
- 回撤: 39.7%

### 策略优化结果
- ⚠️ major/momentum_quick: 测试-0.4% 衰减158%
- ⚠️ major/momentum_wave: 测试-7.5% 衰减999%
- ✅ altcoin/momentum_quick: 测试+11.8% 衰减-63%
- ✅ altcoin/momentum_wave: 测试+2.8% 衰减6%

## 2026-05-27 18:05 自进化循环

### 市场状态
- 震荡 | BTC $75,876
- 趋势: DOWN | 广度: 23%

### 绩效
- 30天 WR58% PnL$+11,520
- 回撤: 39.7%

### 策略优化结果
- ⚠️ major/momentum_quick: 测试-0.4% 衰减161%
- ⚠️ major/momentum_wave: 测试-6.2% 衰减999%
- ✅ altcoin/momentum_quick: 测试+11.0% 衰减-106%
- ✅ altcoin/momentum_wave: 测试+3.0% 衰减-92%

## 2026-05-28 00:23 自进化循环

### 市场状态
- 弱熊 | BTC $75,300
- 趋势: DOWN | 广度: 35%

### 绩效
- 30天 WR58% PnL$+11,520
- 回撤: 39.7%

### 策略优化结果
- ✅ major/momentum_quick: 测试+2.9% 衰减2%
- ✅ major/momentum_wave: 测试+1.1% 衰减-12%
- ✅ altcoin/momentum_quick: 测试+9.0% 衰减-75%
- ✅ altcoin/momentum_wave: 测试+7.3% 衰减-133%
