import { useEffect, useState } from 'react';
import { PokerCardRow } from './PokerCard';

export function PokerDealingCards({
  active = true,
  onComplete,
  communityCards = [],
}: {
  active?: boolean;
  onComplete?: () => void;
  communityCards?: string[];
}) {
  const [dealt, setDealt] = useState(0);
  const cards = communityCards.length === 5
    ? communityCards
    : ['', '', '', '', ''];

  useEffect(() => {
    if (!active) {
      setDealt(0);
      return;
    }
    if (dealt >= 5) {
      onComplete?.();
      return;
    }
    const t = setTimeout(() => setDealt(d => d + 1), 260);
    return () => clearTimeout(t);
  }, [dealt, active, onComplete]);

  const visible = cards.slice(0, dealt);

  return (
    <div style={{ textAlign: 'center', marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#3d3530' }}>
        {dealt < 5 ? '🃏 荷官 Jack 发公共牌…' : '🃏 公共牌'}
      </div>
      <div style={{ minHeight: 56, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {dealt === 0 ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {cards.map((_, i) => (
              <div key={i} style={{
                width: 38, height: 52, borderRadius: 6,
                background: 'linear-gradient(135deg,#8b6914,#6b4f10)',
                border: '1px solid #5a4010',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                color: '#f5efe6', boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
              }}>🂠</div>
            ))}
          </div>
        ) : (
          <PokerCardRow cards={visible} />
        )}
      </div>
      {communityCards.length === 5 && dealt >= 5 && (
        <div style={{ fontSize: 10, color: '#9a8b7a', marginTop: 6 }}>翻牌 · 转牌 · 河牌</div>
      )}
    </div>
  );
}
