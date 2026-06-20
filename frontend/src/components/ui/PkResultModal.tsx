import { useEffect, useState } from 'react';
import { useGameStore, type PkResultData } from '../../store/useGameStore';

export function PkResultModal({ data }: { data: PkResultData }) {
  const closeModal = useGameStore(s => s.closeModal);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setStep(1), 500);
    return () => clearTimeout(t);
  }, []);

  const won = data.won;

  return (
    <div style={{ color: '#3d3530', textAlign: 'center' }}>
      <div style={{
        padding: 20, borderRadius: 12, marginBottom: 16,
        background: won ? 'linear-gradient(135deg,#e3f2fd,#fff8e0)' : 'linear-gradient(135deg,#ffebee,#faf6ef)',
        border: won ? '2px solid #42a5f5' : '2px solid #ef9a9a',
        transform: step >= 1 ? 'scale(1)' : 'scale(0.9)',
        transition: 'all 0.4s ease',
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>{won ? '⚔️' : '💥'}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: won ? '#1565c0' : '#c62828' }}>
          {won ? 'PK 胜利！' : 'PK 惜败'}
        </div>
        <div style={{ fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>
          vs <b>{data.opponent_name}</b>
          <div style={{ marginTop: 8 }}>
            你押 <b>{data.my_direction === 'up' ? '📈 涨' : '📉 跌'}</b>
            · BTC {data.winner_side === 'up' ? '收涨' : data.winner_side === 'down' ? '收跌' : '平'}
          </div>
          {won && data.won_amount > 0 && (
            <div style={{ fontSize: 24, fontWeight: 800, color: '#2ea872', marginTop: 10 }}>
              +{data.won_amount} 积分
            </div>
          )}
          {!won && (
            <div style={{ fontSize: 14, color: '#9a8b7a', marginTop: 8 }}>-{data.stake} 积分</div>
          )}
          {data.streak && data.streak >= 2 && (
            <div style={{ marginTop: 10, padding: '6px 12px', borderRadius: 99, background: '#ffe082', fontSize: 12, fontWeight: 700 }}>
              🔥 {data.streak} 连胜！
            </div>
          )}
        </div>
      </div>
      <button className="ui-btn" style={{ width: '100%' }} onClick={closeModal}>下一场</button>
    </div>
  );
}
