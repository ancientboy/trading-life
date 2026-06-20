import { useEffect, useRef, useState } from 'react';
import { useGameStore, type GuessResultData } from '../../store/useGameStore';
import {
  appBaseUrl, buildGuessShareText, downloadGuessShareCard,
  shareOrCopy, shareResultMessage,
} from '../../lib/shareUtils';

export function GuessResultModal({ data }: { data: GuessResultData }) {
  const closeModal = useGameStore(s => s.closeModal);
  const addMessage = useGameStore(s => s.addMessage);
  const [phase, setPhase] = useState(0);
  const [sharing, setSharing] = useState(false);
  const autoShared = useRef(false);

  const won = data.won && (data.payout ?? 0) > 0;
  const chg = data.start_price
    ? ((data.end_price - data.start_price) / data.start_price) * 100
    : 0;

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 400);
    const t2 = setTimeout(() => setPhase(2), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (!won || !data.first_win || autoShared.current) return;
    autoShared.current = true;
    (async () => {
      try {
        const text = buildGuessShareText(data);
        const r = await shareOrCopy({ title: '交易人生 · 猜涨跌首胜', text, url: appBaseUrl() });
        addMessage(`🎁 猜涨跌首胜 · ${shareResultMessage(r)}`);
        await downloadGuessShareCard(data, appBaseUrl());
        addMessage('猜涨跌首胜分享卡已保存');
      } catch {
        addMessage('自动分享未完成，可手动点下方按钮');
      }
    })();
  }, [data, won, addMessage]);

  return (
    <div style={{ color: '#3d3530', textAlign: 'center' }}>
      <div style={{
        padding: 20, borderRadius: 12, marginBottom: 16,
        background: won
          ? 'linear-gradient(135deg,#e8f5e9,#fff8e0)'
          : 'linear-gradient(135deg,#ffebee,#faf6ef)',
        border: won ? '2px solid #66bb6a' : '2px solid #ef9a9a',
        transform: phase >= 1 ? 'scale(1)' : 'scale(0.92)',
        opacity: phase >= 1 ? 1 : 0.3,
        transition: 'all 0.45s ease',
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>{won ? '🎯' : '📉'}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: won ? '#2e7d32' : '#c62828' }}>
          {won ? '押对了！' : '本局未中'}
        </div>
        {data.first_win && won && (
          <div style={{
            marginTop: 10, padding: '6px 12px', borderRadius: 99, display: 'inline-block',
            background: '#ffd54f', fontSize: 12, fontWeight: 700, color: '#5c4a00',
          }}>
            🎁 猜涨跌首胜大礼包
          </div>
        )}
        <div style={{ fontSize: 13, marginTop: 14, lineHeight: 1.6 }}>
          BTC ${Math.round(data.start_price).toLocaleString()}
          {' → '}
          ${Math.round(data.end_price).toLocaleString()}
          <span style={{ color: chg >= 0 ? '#2ea872' : '#c07070', marginLeft: 8, fontWeight: 700 }}>
            {chg >= 0 ? '+' : ''}{chg.toFixed(3)}%
          </span>
        </div>
        <div style={{ fontSize: 14, marginTop: 10 }}>
          你押 <b>{data.direction === 'up' ? '📈 涨' : '📉 跌'}</b>
          {won && (
            <div style={{ fontSize: 24, fontWeight: 800, color: '#2ea872', marginTop: 8 }}>
              +{data.payout} 积分
            </div>
          )}
        </div>
      </div>

      {phase >= 2 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {won && (
            <button className="ui-btn" style={{ flex: 1 }} disabled={sharing}
              onClick={async () => {
                setSharing(true);
                try {
                  await downloadGuessShareCard(data, appBaseUrl());
                  addMessage('分享卡已保存');
                } finally { setSharing(false); }
              }}>
              保存分享卡
            </button>
          )}
          <button className="ui-btn" style={{ flex: 1 }} onClick={closeModal}>继续</button>
        </div>
      )}
    </div>
  );
}
