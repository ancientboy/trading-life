import type { ArenaEntry } from '../../lib/lifeEngagementApi';

export function LogicDrawer({ entry, onClose }: { entry: ArenaEntry; onClose?: () => void }) {
  const legs = entry.all_legs?.length ? entry.all_legs : entry.recent_legs;
  return (
    <div style={{
      marginTop: 10, padding: 12, borderRadius: 10,
      background: '#f0f4ff', border: '1px solid #b8cce8', fontSize: 11,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: '#3a6bb5' }}>📋 {entry.agent_name} · 交易逻辑</span>
        {onClose && (
          <button type="button" className="ui-btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={onClose}>收起</button>
        )}
      </div>
      <div style={{ lineHeight: 1.55, color: '#5a4a3a', marginBottom: 8 }}>
        <div><b>策略</b> · {entry.signal_summary || `${entry.strategy_preset} · ${entry.direction} ${entry.leverage}x`}</div>
        <div><b>累计</b> · {(entry.return_pct ?? 0) >= 0 ? '+' : ''}{entry.return_pct ?? 0}%
          {(entry.legs_count ?? 0) > 0 ? ` · ${entry.legs_count} 轮操作` : ''}</div>
      </div>
      {legs && legs.length > 0 ? (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: '#6b5e4e' }}>操作时间线</div>
          {legs.slice().reverse().map(l => (
            <div key={`${l.leg}-${l.created_at}`} style={{
              display: 'flex', justifyContent: 'space-between', padding: '4px 0',
              borderBottom: '1px dashed #d8e0f0',
            }}>
              <span>第 {(l.leg ?? 0) + 1} 轮 · {l.direction}</span>
              <span style={{
                fontWeight: 600,
                color: (l.return_pct ?? 0) >= 0 ? '#2ea872' : '#c07070',
              }}>
                {(l.return_pct ?? 0) >= 0 ? '+' : ''}{l.return_pct}%
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#9a8b7a' }}>开赛后每 30s 展示各轮操作</div>
      )}
    </div>
  );
}
