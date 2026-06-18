import { useGameStore } from '../../store/useGameStore';

export function DailyTasksPanel({ compact = false }: { compact?: boolean }) {
  const points = useGameStore(s => s.points);
  const dailyTasks = useGameStore(s => s.dailyTasks);
  const dailyTaskDefs = useGameStore(s => s.dailyTaskDefs);
  const claimDailyTask = useGameStore(s => s.claimDailyTask);
  const claimDailyAllowance = useGameStore(s => s.claimDailyAllowance);
  const dailyAllowanceClaimed = useGameStore(s => s.dailyAllowanceClaimed);
  const dailyAllowanceAmount = useGameStore(s => s.dailyAllowanceAmount);
  const dailyDate = useGameStore(s => s.dailyDate);

  const totalReward = dailyTaskDefs.reduce((sum, d) => sum + d.reward, 0);
  const claimedCount = dailyTaskDefs.filter(d => dailyTasks[d.id]?.claimed).length;
  const doneUnclaimed = dailyTaskDefs.filter(d => {
    const t = dailyTasks[d.id];
    return t && t.progress >= d.target && !t.claimed;
  }).length;

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{
        marginBottom: compact ? 10 : 14, padding: compact ? 8 : 12,
        background: 'linear-gradient(135deg, #faf6ef 0%, #f5efe4 100%)',
        borderRadius: 10, border: '1px solid #e8e0d4',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: compact ? 13 : 15 }}>📋 每日任务</div>
            <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 2 }}>
              {dailyDate || '今日'} · 已领 {claimedCount}/{dailyTaskDefs.length}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#9a8b7a' }}>可领奖励</div>
            <div style={{ fontWeight: 700, color: '#d4af37', fontSize: compact ? 13 : 15 }}>
              {doneUnclaimed > 0 ? `${doneUnclaimed} 项` : `${totalReward} 积分`}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#d4af37', marginTop: 6 }}>当前积分：{points}</div>
        {!dailyAllowanceClaimed && (
          <button className="ui-btn" style={{ width: '100%', marginTop: 8, fontSize: 12, padding: '8px 0' }}
            onClick={() => void claimDailyAllowance()}>
            🎁 领取每日积分 +{dailyAllowanceAmount}
          </button>
        )}
        {dailyAllowanceClaimed && (
          <div style={{ fontSize: 11, color: '#48d093', marginTop: 8 }}>✓ 今日每日积分已领取</div>
        )}
      </div>

      {dailyTaskDefs.map(def => {
        const t = dailyTasks[def.id] ?? { progress: 0, claimed: false };
        const progress = Math.min(t.progress, def.target);
        const pct = def.target > 0 ? Math.round((progress / def.target) * 100) : 0;
        const done = progress >= def.target;
        const icon = (def as { icon?: string }).icon ?? '✦';

        return (
          <div key={def.id} className="leisure-option" style={{
            cursor: 'default', marginBottom: 6,
            opacity: t.claimed ? 0.65 : 1,
            background: done && !t.claimed ? '#f0faf3' : undefined,
          }}>
            <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: compact ? 12 : 13 }}>{def.label}</div>
              <div style={{
                height: 4, background: '#e8e0d4', borderRadius: 2, marginTop: 5, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: t.claimed ? '#48d093' : done ? '#d4af37' : '#c8b8a0',
                  borderRadius: 2, transition: 'width 0.3s',
                }} />
              </div>
              <div style={{ fontSize: 10, color: '#8a7e72', marginTop: 3 }}>
                {progress} / {def.target} · 奖励 <span style={{ color: '#d4af37' }}>{def.reward}</span> 积分
              </div>
            </div>
            {t.claimed ? (
              <span style={{ color: '#48d093', fontSize: 11, whiteSpace: 'nowrap' }}>✓ 已领</span>
            ) : (
              <button
                className="ui-btn"
                disabled={!done}
                onClick={() => claimDailyTask(def.id)}
                style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
              >
                {done ? '领取' : `${pct}%`}
              </button>
            )}
          </div>
        );
      })}

      {!compact && (
        <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 10, lineHeight: 1.5 }}>
          挂机、派遣、完成休闲活动可推进任务；每日 0 点（北京时间）重置<br />
          挂机积分仅在页面打开时累计，每日上限 120 分钟
        </p>
      )}
    </div>
  );
}
