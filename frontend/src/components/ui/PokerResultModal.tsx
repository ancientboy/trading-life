import { useState } from 'react';
import { useGameStore, type PokerHandResult, type PokerPlayerResult } from '../../store/useGameStore';
import { PokerDealingCards } from './PokerDealingCards';
import { PokerCardRow } from './PokerCard';

function formatHandLabel(r: PokerPlayerResult): string {
  if (r.hand_combo && r.hand_name) return `${r.hand_name} · ${r.hand_combo}`;
  if (r.hand_combo) return r.hand_combo;
  if (r.hand_name) return r.hand_name;
  return `牌力 ${r.score}`;
}

export function PokerResultModal({ data }: { data: PokerHandResult }) {
  const closeModal = useGameStore(s => s.closeModal);
  const [dealt, setDealt] = useState(false);

  const me = data.results.find(r => !r.is_npc);
  const won = data.won > 0;
  const net = data.net ?? (data.won - data.buyIn);
  const community = data.community_cards ?? [];

  return (
    <div style={{ color: '#3d3530', maxHeight: '70vh', overflowY: 'auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
          {!dealt ? '荷官 Jack 发牌中…' : won ? '🎉 恭喜获胜！' : '本局未获胜'}
        </div>
        <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 4 }}>
          买入 {data.buyIn} · 奖池 {data.pot ?? '—'}（全员买入合计）
        </div>
      </div>

      <PokerDealingCards
        active={!dealt}
        communityCards={community}
        onComplete={() => setDealt(true)}
      />

      {dealt && (
        <>
          {me && (
            <div style={{
              padding: 12, borderRadius: 8, marginBottom: 12, textAlign: 'center',
              background: won ? 'linear-gradient(135deg,#e8f8ef,#faf6ef)' : '#faf6ef',
              border: won ? '1px solid #48d093' : '1px solid #eee8dc',
            }}>
              <div style={{ fontWeight: 700 }}>{me.name}</div>
              {me.hole_cards && me.hole_cards.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, color: '#8a7e72', marginBottom: 4 }}>你的手牌</div>
                  <PokerCardRow cards={me.hole_cards} />
                </div>
              )}
              <div style={{ fontSize: 13, marginTop: 8, fontWeight: 600, color: '#5c4a32' }}>
                第 {me.rank} 名 · {formatHandLabel(me)}
              </div>
              {me.best_cards && me.best_cards.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, color: '#8a7e72', marginBottom: 4 }}>最佳五张</div>
                  <PokerCardRow cards={me.best_cards} small />
                </div>
              )}
              {won ? (
                <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: '#2ea872' }}>
                  赢得奖池 +{data.won} 积分
                  <div style={{ fontSize: 12, marginTop: 2, color: '#48d093' }}>
                    净赚 +{net}（买入 -{data.buyIn}）
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 13, color: '#b07070' }}>
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
              padding: '8px 10px', background: r.rank === 1 ? '#fff8e8' : '#faf6ef',
              borderRadius: 8, marginBottom: 6, fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: r.hole_cards?.length ? 6 : 0 }}>
                <span style={{ fontWeight: r.rank === 1 ? 700 : 500 }}>
                  {r.rank}. {r.name}{r.is_npc ? ' 🤖' : ''}{r.rank === 1 ? ' 👑' : ''}
                </span>
                <span style={{ color: '#5c4a32', fontWeight: 600 }}>
                  {formatHandLabel(r)}
                  {r.won ? <span style={{ color: '#48d093', marginLeft: 6 }}>+{r.won}</span> : ''}
                </span>
              </div>
              {r.hole_cards && r.hole_cards.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#9a8b7a', minWidth: 36 }}>手牌</span>
                  <PokerCardRow cards={r.hole_cards} small />
                </div>
              )}
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
