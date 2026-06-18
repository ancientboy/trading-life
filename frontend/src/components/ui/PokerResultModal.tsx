import { useState, type CSSProperties } from 'react';
import { useGameStore, type PokerHandResult, type PokerPlayerResult } from '../../store/useGameStore';
import { PokerDealingCards } from './PokerDealingCards';
import { PokerCardRow } from './PokerCard';

function formatHandLabel(r: PokerPlayerResult): string {
  if (r.hand_name) return r.hand_name;
  if (r.hand_combo) return r.hand_combo;
  return `牌力 ${r.score}`;
}

function PlayerHandBlock({
  player,
  highlight = false,
  layout = 'horizontal',
}: {
  player: PokerPlayerResult;
  highlight?: boolean;
  layout?: 'horizontal' | 'vertical';
}) {
  const bestCards = player.best_cards?.length ? player.best_cards : undefined;
  const boxStyle: CSSProperties = {
    padding: highlight ? '8px 10px' : '6px 8px',
    borderRadius: 8,
    background: highlight ? 'linear-gradient(135deg,#fff8e8,#faf6ef)' : '#f5f0e8',
    border: highlight ? '1px solid rgba(212,175,55,0.55)' : '1px solid #ebe4d8',
    flex: 1,
    minWidth: 0,
  };

  if (layout === 'horizontal') {
    return (
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, marginTop: 8 }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 4 }}>手牌</div>
          {player.hole_cards && player.hole_cards.length > 0 ? (
            <PokerCardRow cards={player.hole_cards} small />
          ) : (
            <span style={{ fontSize: 10, color: '#c8baa8' }}>—</span>
          )}
        </div>
        {bestCards && (
          <div style={boxStyle}>
            <div style={{
              fontSize: 10, color: '#8a7e72', marginBottom: 6,
              fontWeight: highlight ? 700 : 500,
            }}>
              最佳五张 · {formatHandLabel(player)}
              {player.hand_combo ? ` · ${player.hand_combo}` : ''}
            </div>
            <PokerCardRow cards={bestCards} small />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, textAlign: highlight ? 'center' : 'left' }}>
      {player.hole_cards && player.hole_cards.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, justifyContent: highlight ? 'center' : 'flex-start' }}>
          <span style={{ fontSize: 10, color: '#9a8b7a', minWidth: 52 }}>手牌</span>
          <PokerCardRow cards={player.hole_cards} small />
        </div>
      )}
      {bestCards && (
        <div style={boxStyle}>
          <div style={{
            fontSize: 10, color: '#8a7e72', marginBottom: 6,
            fontWeight: highlight ? 700 : 500,
            textAlign: highlight ? 'center' : 'left',
          }}>
            最佳五张 · {formatHandLabel(player)}
            {player.hand_combo ? ` · ${player.hand_combo}` : ''}
          </div>
          <PokerCardRow cards={bestCards} small={!highlight} />
        </div>
      )}
    </div>
  );
}

export function PokerResultModal({ data }: { data: PokerHandResult }) {
  const closeModal = useGameStore(s => s.closeModal);
  const [dealt, setDealt] = useState(false);

  const me = data.results.find(r => !r.is_npc);
  const won = data.won > 0;
  const net = data.net ?? (data.won - data.buyIn);
  const community = data.community_cards ?? [];
  const winners = data.results.filter(r => r.won > 0);
  const isTie = data.tie ?? winners.length > 1;
  const winnerNames = winners.map(r => r.name).join('、');

  return (
    <div style={{ color: '#3d3530', maxHeight: '70vh', overflowY: 'auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
          {!dealt ? '荷官 Jack 发牌中…' : won
            ? (isTie ? '🤝 平局！平分奖池' : '🎉 恭喜获胜！')
            : '本局未获胜'}
        </div>
        <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 4 }}>
          买入 {data.buyIn} · 奖池 {data.pot ?? '—'}（{isTie ? '平局平分' : '胜者通吃'}）
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
              <div style={{ fontSize: 13, marginTop: 6, fontWeight: 600, color: '#5c4a32' }}>
                第 {me.rank} 名
              </div>
              <PlayerHandBlock player={me} highlight={won} layout="horizontal" />
              {won ? (
                <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: '#2ea872' }}>
                  {isTie ? `平分奖池 +${data.won} 积分` : `赢得奖池 +${data.won} 积分`}
                  <div style={{ fontSize: 12, marginTop: 2, color: '#48d093' }}>
                    净赚 +{net}（买入 -{data.buyIn}）
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 13, color: '#b07070' }}>
                  买入 -{data.buyIn} 积分 · 奖池由 {isTie ? `${winnerNames} 平分` : data.results.find(r => r.rank === 1)?.name ?? '—'} 赢得
                </div>
              )}
              {data.balance != null && (
                <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 6 }}>当前积分：{data.balance}</div>
              )}
            </div>
          )}

          {dealt && community.length === 5 && (
            <div style={{
              padding: '10px 12px', marginBottom: 12, background: '#f5f0e8',
              borderRadius: 8, border: '1px solid #e8dcc8', textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: '#8a7e72', marginBottom: 6 }}>公共牌（5 张）</div>
              <PokerCardRow cards={community} />
              <div style={{ fontSize: 10, color: '#9a8b7a', marginTop: 8, lineHeight: 1.5 }}>
                从 2 张手牌 + 5 张公共牌中选出最大 5 张组合 · 牌型大小：同花顺 &gt; 四条 &gt; 葫芦 &gt; 同花 &gt; 顺子 &gt; 三条 &gt; 两对 &gt; 一对 &gt; 高牌
              </div>
            </div>
          )}

          {(() => {
            const top = data.results.find(r => r.rank === 1);
            if (!top?.best_cards?.length) return null;
            return (
              <div style={{
                padding: '10px 12px', marginBottom: 12, background: '#fff8e8',
                borderRadius: 8, border: '1px solid rgba(212,175,55,0.45)', textAlign: 'center',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#5c4a32', marginBottom: 8 }}>
                  {isTie ? '🤝 最大牌型（平局）' : '👑 本局最大牌型'} · {top.name}
                </div>
                <PokerCardRow cards={top.best_cards} />
                <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 8 }}>
                  {formatHandLabel(top)}{top.hand_combo ? ` · ${top.hand_combo}` : ''}
                </div>
              </div>
            );
          })()}

          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
            对局排名 · {isTie ? '平局平分奖池' : '胜者通吃奖池'}
          </div>
          {data.results.map(r => (
            <div key={r.name} style={{
              padding: '8px 10px', background: r.won > 0 ? '#fff8e8' : '#faf6ef',
              borderRadius: 8, marginBottom: 6, fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: r.won > 0 ? 700 : 500 }}>
                  {r.rank}. {r.name}{r.is_npc ? ' 🤖' : ''}{r.won > 0 ? (isTie ? ' 🤝' : ' 👑') : ''}
                </span>
                {r.won ? (
                  <span style={{ color: '#48d093', fontWeight: 700 }}>+{r.won}</span>
                ) : (
                  <span style={{ fontSize: 10, color: '#9a8b7a' }}>{formatHandLabel(r)}</span>
                )}
              </div>
              <PlayerHandBlock player={r} highlight={r.rank === 1} layout="horizontal" />
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
