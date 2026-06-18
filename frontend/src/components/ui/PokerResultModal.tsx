import { useState } from 'react';
import { useGameStore, type PokerHandResult } from '../../store/useGameStore';
import { PokerDealingCards } from './PokerDealingCards';

export function PokerResultModal({ data }: { data: PokerHandResult }) {
  const closeModal = useGameStore(s => s.closeModal);
  const [dealt, setDealt] = useState(false);

  const me = data.results.find(r => !r.is_npc);
  const won = data.won > 0;
  const net = data.net ?? (data.won - data.buyIn);

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
          {!dealt ? '荷官 Jack 发牌中…' : won ? '🎉 恭喜获胜！' : '本局未获胜'}
        </div>
        <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 4 }}>
          买入 {data.buyIn} · 奖池 {data.pot ?? '—'}（全员买入合计）
        </div>
      </div>

      <PokerDealingCards active={!dealt} onComplete={() => setDealt(true)} />

      {dealt && (
        <>
          {me && (
            <div style={{
              padding: 12, borderRadius: 8, marginBottom: 12, textAlign: 'center',
              background: won ? 'linear-gradient(135deg,#e8f8ef,#faf6ef)' : '#faf6ef',
              border: won ? '1px solid #48d093' : '1px solid #eee8dc',
            }}>
              <div style={{ fontWeight: 700 }}>{me.name}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                第 {me.rank} 名 · 牌力 {me.score}
              </div>
              {won ? (
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: '#2ea872' }}>
                  赢得奖池 +{data.won} 积分
                  <div style={{ fontSize: 12, marginTop: 2, color: '#48d093' }}>
                    净赚 +{net}（买入 -{data.buyIn}）
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 13, color: '#b07070' }}>
                  买入 -{data.buyIn} 积分 · 奖池由 {data.results[0]?.name} 赢得
                </div>
              )}
              {data.balance != null && (
                <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 6 }}>当前积分：{data.balance}</div>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>对局排名 · 第一名通吃奖池</div>
          {data.results.map(r => (
            <div key={r.name} style={{
              display: 'flex', justifyContent: 'space-between', padding: '6px 8px',
              background: r.rank === 1 ? '#fff8e8' : '#faf6ef', borderRadius: 6, marginBottom: 4, fontSize: 12,
            }}>
              <span>{r.rank}. {r.name}{r.is_npc ? ' 🤖' : ''}{r.rank === 1 ? ' 👑' : ''}</span>
              <span>
                {r.score} 牌力{r.won ? <span style={{ color: '#48d093', fontWeight: 700 }}> · +{r.won}</span> : ''}
              </span>
            </div>
          ))}
        </>
      )}

      <button className="ui-btn" style={{ width: '100%', marginTop: 14, padding: '10px 0' }}
        disabled={!dealt} onClick={closeModal}>
        {dealt ? '关闭' : '发牌中…'}
      </button>
    </div>
  );
}
