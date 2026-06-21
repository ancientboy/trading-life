import { useEffect, useRef, useState } from 'react';
import { useGameStore, type GuessResultData } from '../../store/useGameStore';
import { placeLeverageBet } from '../../lib/lifeEngagementApi';
import {
  appBaseUrl, buildGuessShareText, renderGuessShareCard,
  shareOrCopy, shareResultMessage,
} from '../../lib/shareUtils';
import { SharePosterPreview } from './SharePosterPreview';

export function GuessResultModal({ data }: { data: GuessResultData }) {
  const closeModal = useGameStore(s => s.closeModal);
  const addMessage = useGameStore(s => s.addMessage);
  const triggerTradingReaction = useGameStore(s => s.triggerTradingReaction);
  const flyToZone = useGameStore(s => s.flyToZone);
  const [phase, setPhase] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [posterBlob, setPosterBlob] = useState<Blob | null>(null);
  const [levBusy, setLevBusy] = useState(false);
  const autoShared = useRef(false);

  const won = data.won && (data.payout ?? 0) > 0;
  const pl = data.pending_leverage;
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
      } catch {
        addMessage('自动分享未完成，可手动点下方按钮');
      }
    })();
  }, [data, won, addMessage]);

  const doLeverage = async (direction: 'up' | 'down', leverage: number) => {
    if (!pl) return;
    setLevBusy(true);
    try {
      const r = await placeLeverageBet(direction, leverage, pl.source_round_id || '');
      if (!r.ok) {
        addMessage(r.error || '杠杆押注失败');
        return;
      }
      addMessage(r.message || `杠杆 ${leverage}x 已押`);
      triggerTradingReaction('leverage', leverage);
      flyToZone('arena');
      closeModal();
    } finally {
      setLevBusy(false);
    }
  };

  return (
    <>
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

      {phase >= 2 && won && pl && (
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 10,
          background: '#fff8e8', border: '1px solid #ffb74d', textAlign: 'left',
        }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>🎰 翻倍出击 · 用 {pl.profit} 利润博下一根 K 线</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {[2, 5, 10].map(lev => (
              <button key={`u${lev}`} type="button" className="ui-btn" style={{ flex: 1, fontSize: 10 }}
                disabled={levBusy} onClick={() => void doLeverage('up', lev)}>
                {lev}x 涨
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[2, 5, 10].map(lev => (
              <button key={`d${lev}`} type="button" className="ui-btn" style={{ flex: 1, fontSize: 10, background: '#ffefef' }}
                disabled={levBusy} onClick={() => void doLeverage('down', lev)}>
                {lev}x 跌
              </button>
            ))}
          </div>
          <p style={{ fontSize: 9, color: '#9a8b7a', marginTop: 6, marginBottom: 0 }}>120 秒内有效 · 赢则利润×杠杆</p>
        </div>
      )}

      {phase >= 2 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {won && (
            <button className="ui-btn" style={{ flex: 1 }} disabled={sharing}
              onClick={async () => {
                setSharing(true);
                try {
                  const blob = await renderGuessShareCard(data, appBaseUrl());
                  setPosterBlob(blob);
                } catch {
                  addMessage('生成分享卡失败');
                } finally { setSharing(false); }
              }}>
              保存分享卡
            </button>
          )}
          <button className="ui-btn" style={{ flex: 1 }} onClick={closeModal}>继续</button>
        </div>
      )}
    </div>
    <SharePosterPreview
      blob={posterBlob}
      filename={`trading-life-guess-${Date.now()}.png`}
      onClose={() => setPosterBlob(null)}
      onSaved={() => addMessage('分享卡已保存')}
    />
    </>
  );
}
