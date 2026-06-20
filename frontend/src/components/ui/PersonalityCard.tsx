import type { TradingModesState } from '../../lib/lifeEngagementApi';

const TIER_COLOR: Record<string, string> = {
  bronze: '#cd7f32', silver: '#9e9e9e', gold: '#ffd700', none: '#9a8b7a',
};

export function PersonalityCard({ personality }: { personality?: TradingModesState['personality'] }) {
  if (!personality) return null;
  const tier = personality.tier || 'none';
  const dims = personality.dimensions || {};
  return (
    <div style={{
      padding: 10, marginBottom: 10, borderRadius: 10,
      background: 'linear-gradient(135deg,#f0f4ff,#faf6ef)',
      border: `1px solid ${TIER_COLOR[tier] || '#ccc'}`,
      fontSize: 11,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 800, color: '#3a6bb5' }}>📖 交易人格图鉴</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
          background: TIER_COLOR[tier], color: tier === 'gold' ? '#5c4a00' : '#fff',
        }}>
          {tier === 'none' ? '未解锁' : tier.toUpperCase()}
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{personality.title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10, color: '#6b5e4e' }}>
        {Object.entries(dims).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{k === 'risk' ? '风险偏好' : k === 'duel' ? '对抗性' : k === 'faction_loyalty' ? '阵营' : k === 'arena' ? '竞技' : k === 'guess' ? '猜涨跌' : '韧性'}</span>
            <span style={{ fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
