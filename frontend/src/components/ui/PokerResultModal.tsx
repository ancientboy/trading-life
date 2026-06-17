import { useEffect, useState } from 'react';
import { useGameStore, type PokerHandResult } from '../../store/useGameStore';
import { SPRITE } from '../icons/spritePaths';

const CARD_FACES = ['🂡', '🂱', '🃁', '🃑', '🂮', '🃎', '🂭', '🃍'];

export function PokerResultModal({ data }: { data: PokerHandResult }) {
  const closeModal = useGameStore(s => s.closeModal);
  const [dealt, setDealt] = useState(0);

  useEffect(() => {
    if (dealt >= 5) return;
    const t = setTimeout(() => setDealt(d => d + 1), 280);
    return () => clearTimeout(t);
  }, [dealt]);

  const me = data.results.find(r => !r.is_npc);
  const won = data.won > 0;

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <img src={SPRITE.cards} alt="" style={{ width: 48, height: 48, opacity: 0.9 }} />
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>
          {dealt < 5 ? '荷官 Jack 发牌中…' : won ? '🎉 恭喜获胜！' : '本局结束'}
        </div>
        <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 4 }}>
          买入 {data.buyIn} · 奖池 {data.pot ?? '—'}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16, minHeight: 44 }}>
        {CARD_FACES.slice(0, 5).map((c, i) => (
          <div key={i} style={{
            width: 36, height: 48, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: i < dealt ? '#fff' : '#d4c8b8',
            border: '1px solid #c4b8a8',
            fontSize: 22,
            boxShadow: i < dealt ? '0 2px 6px rgba(0,0,0,0.12)' : 'none',
            transform: i < dealt ? 'translateY(0)' : 'translateY(4px)',
            transition: 'all 0.2s ease',
            opacity: i < dealt ? 1 : 0.5,
          }}>
            {i < dealt ? c : '🂠'}
          </div>
        ))}
      </div>

      {dealt >= 5 && (
        <>
          {me && (
            <div style={{
              padding: 10, borderRadius: 8, marginBottom: 12, textAlign: 'center',
              background: won ? 'linear-gradient(135deg,#e8f8ef,#faf6ef)' : '#faf6ef',
            }}>
              <div style={{ fontWeight: 700 }}>{me.name}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                第 {me.rank} 名 · 得分 {me.score}
                {data.won > 0 && <span style={{ color: '#48d093', fontWeight: 700 }}> · +{data.won} 积分</span>}
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>对局排名</div>
          {data.results.map(r => (
            <div key={r.name} style={{
              display: 'flex', justifyContent: 'space-between', padding: '6px 8px',
              background: r.rank === 1 ? '#fff8e8' : '#faf6ef', borderRadius: 6, marginBottom: 4, fontSize: 12,
            }}>
              <span>{r.rank}. {r.name}{r.is_npc ? ' 🤖' : ''}</span>
              <span>{r.score} 分{r.won ? ` · +${r.won}` : ''}</span>
            </div>
          ))}
        </>
      )}

      <button className="ui-btn" style={{ width: '100%', marginTop: 14, padding: '10px 0' }}
        disabled={dealt < 5} onClick={closeModal}>
        {dealt < 5 ? '发牌中…' : '关闭'}
      </button>
    </div>
  );
}
