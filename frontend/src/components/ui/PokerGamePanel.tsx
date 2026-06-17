import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { PenguinAvatar } from './PenguinAvatar';
import { pokerSolo, pokerQuickJoin } from '../../lib/lifeEngagementApi';

const BUY_IN_TIERS = [
  { id: 'casual', buyIn: 30, label: '休闲局', desc: '底注 30 · 适合新手' },
  { id: 'standard', buyIn: 80, label: '标准局', desc: '底注 80 · 奖金更高' },
  { id: 'high', buyIn: 200, label: '高手局', desc: '底注 200 · 高风险高回报' },
] as const;

type PokerGamePanelProps = {
  showSitButton?: boolean;
  compact?: boolean;
};

export function PokerGamePanel({ showSitButton = true, compact = false }: PokerGamePanelProps) {
  const points = useGameStore(s => s.points);
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const canOperateAgent = useGameStore(s => s.canOperateAgent);
  const sendAgentToFacility = useGameStore(s => s.sendAgentToFacility);
  const addMessage = useGameStore(s => s.addMessage);
  const showPokerResult = useGameStore(s => s.showPokerResult);
  const openModal = useGameStore(s => s.openModal);

  const [tierId, setTierId] = useState<string>('casual');
  const [busy, setBusy] = useState<'sit' | 'solo' | 'quick' | null>(null);

  const tier = BUY_IN_TIERS.find(t => t.id === tierId) ?? BUY_IN_TIERS[0];
  const operableAgents = Object.values(agents).filter(a => canOperateAgent(a.agentId));
  const agent = (selectedAgentId && canOperateAgent(selectedAgentId) ? agents[selectedAgentId] : null)
    || operableAgents.sort((a, b) => b.stress - a.stress)[0];
  const canAfford = points >= tier.buyIn;
  const seatedAgent = operableAgents.find(a => a.activity === 'poker');
  const isSeated = !!seatedAgent;

  const revealResults = (
    results?: Array<{ name: string; score: number; rank: number; won: number; is_npc?: boolean }>,
    won?: number,
    pot?: number,
  ) => {
    if (!results?.length) return;
    showPokerResult({ results, won: won ?? 0, buyIn: tier.buyIn, pot });
  };

  const startSolo = async () => {
    if (!agent) return;
    setBusy('solo');
    const r = await pokerSolo(agent.agentId, tier.buyIn);
    if (!r.ok) addMessage(r.error || '开局失败');
    else {
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      revealResults(r.results, r.won, r.pot);
    }
    setBusy(null);
  };

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ fontSize: 11, color: '#8a7e72', marginBottom: 10, lineHeight: 1.55, padding: '8px 10px', background: '#fff8e8', borderRadius: 8 }}>
        <b>① 免费入座</b>：Agent 走到牌桌（或已入座）<br />
        <b>② 开始牌局</b>：荷官发牌并展示对局结果
      </div>

      <div style={{ fontSize: 11, color: '#d4af37', marginBottom: 8 }}>当前积分：{points}</div>

      {isSeated && seatedAgent && (
        <div style={{ marginBottom: 10, padding: 10, background: '#e8f8ef', borderRadius: 8, fontSize: 12, border: '1px solid #48d093' }}>
          <div style={{ fontWeight: 700, color: '#2ea872', marginBottom: 4 }}>✓ {seatedAgent.data.name} 已在牌桌</div>
          <div style={{ fontSize: 11, color: '#5a8a6a' }}>点击下方绿色按钮，荷官 Jack 将发牌</div>
        </div>
      )}

      {agent ? (
        <div style={{ marginBottom: 10, padding: 8, background: '#faf6ef', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <PenguinAvatar color={agent.data.color} headwear={agent.data.headwear} hatStyle={agent.data.hatStyle} size={28} />
          <div>
            <b>{agent.data.name}</b>
            <div style={{ fontSize: 10, color: '#8a7e72' }}>压力 {Math.round(agent.stress)}%</div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 10, padding: 8, background: '#fff8e8', borderRadius: 8, fontSize: 12, color: '#8a6e3a' }}>
          请先在「Agent 工坊」创建你自己的 Agent
        </div>
      )}

      {!compact && BUY_IN_TIERS.map(t => (
        <button key={t.id} className={`leisure-option ${tierId === t.id ? 'selected' : ''}`} onClick={() => setTierId(t.id)}>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontWeight: 600 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: '#8a7e72' }}>{t.desc}</div>
          </div>
          <span style={{ color: '#d4af37', fontWeight: 600, fontSize: 12 }}>买入 {t.buyIn}</span>
        </button>
      ))}

      {compact && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {BUY_IN_TIERS.map(t => (
            <button key={t.id} className={`ui-btn ${tierId === t.id ? 'active' : ''}`} style={{ flex: 1, fontSize: 10 }}
              onClick={() => setTierId(t.id)}>{t.buyIn}</button>
          ))}
        </div>
      )}

      {showSitButton && !isSeated && (
        <button className="ui-btn" style={{ width: '100%', marginTop: compact ? 0 : 8, marginBottom: 8, padding: '9px 0' }}
          disabled={!agent || busy !== null}
          onClick={async () => {
            if (!agent) return;
            setBusy('sit');
            const ok = await sendAgentToFacility('poker', { agentId: agent.agentId, skipCost: true });
            if (ok) addMessage(`${agent.data.name} 已入座 · 请点「开始牌局」`);
            setBusy(null);
          }}>
          {busy === 'sit' ? 'Agent 正在前往…' : '① 免费入座'}
        </button>
      )}

      <button className="ui-btn" style={{
        width: '100%', marginBottom: 8, padding: '12px 0',
        background: canAfford ? 'linear-gradient(135deg,#48d093,#2ea872)' : undefined,
        color: canAfford ? '#fff' : undefined,
        fontWeight: 700,
        fontSize: compact ? 12 : 14,
      }}
        disabled={!agent || busy !== null || !canAfford}
        onClick={() => void startSolo()}>
        {busy === 'solo' ? '🃏 荷官发牌中…' : !canAfford ? `积分不足（需 ${tier.buyIn}）` : `② 开始牌局 · 发牌（-${tier.buyIn} 积分）`}
      </button>

      <button className="ui-btn" style={{ width: '100%', marginBottom: 8 }}
        disabled={!agent || busy !== null}
        onClick={async () => {
          if (!agent) return;
          setBusy('quick');
          const r = await pokerQuickJoin(agent.agentId, tier.buyIn);
          if (!r.ok) {
            if (r.mode === 'no_room') addMessage('暂无公开房间 · 可直接点上方「开始牌局」');
            else addMessage(r.error || '匹配失败');
          } else {
            addMessage(r.message || '已入座（免费），等待其他玩家…');
          }
          setBusy(null);
        }}>
        {busy === 'quick' ? '匹配中…' : '快速入座（免费，匹配公开房）'}
      </button>

      {!compact && (
        <button className="ui-btn" style={{ width: '100%', fontSize: 11, opacity: 0.85 }}
          onClick={() => openModal('rank')}>
          多人房间 → 顶栏「排行」· 德州局
        </button>
      )}
    </div>
  );
}
