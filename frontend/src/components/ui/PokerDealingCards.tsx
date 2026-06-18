import { useEffect, useState } from 'react';

const CARD_FACES = ['🂡', '🂱', '🃁', '🃑', '🂮'];

export function PokerDealingCards({ active = true, onComplete }: { active?: boolean; onComplete?: () => void }) {
  const [dealt, setDealt] = useState(0);

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

  return (
    <div style={{ textAlign: 'center', marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#3d3530' }}>
        {dealt < 5 ? '🃏 荷官 Jack 发牌中…' : '🃏 开牌！'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, minHeight: 52 }}>
        {CARD_FACES.map((c, i) => (
          <div key={i} style={{
            width: 38, height: 50, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: i < dealt ? '#fff' : '#d4c8b8',
            border: '1px solid #c4b8a8',
            fontSize: 22,
            boxShadow: i < dealt ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
            transform: i < dealt ? 'translateY(-4px) rotate(-2deg)' : 'translateY(2px)',
            transition: 'all 0.22s ease',
            opacity: i < dealt ? 1 : 0.55,
          }}>
            {i < dealt ? c : '🂠'}
          </div>
        ))}
      </div>
    </div>
  );
}
