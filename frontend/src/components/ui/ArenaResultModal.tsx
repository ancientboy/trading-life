import { useEffect, useRef, useState } from 'react';
import { useGameStore, type ArenaResultData } from '../../store/useGameStore';
import {
  appBaseUrl, buildArenaShareText, downloadArenaShareCard,
  shareOrCopy, shareResultMessage,
} from '../../lib/shareUtils';

const RANK_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function ArenaResultModal({ data }: { data: ArenaResultData }) {
  const closeModal = useGameStore(s => s.closeModal);
  const addMessage = useGameStore(s => s.addMessage);
  const [step, setStep] = useState(0);
  const [sharing, setSharing] = useState(false);
  const autoShared = useRef(false);

  const my = data.my_entry;
  const podium = (data.entries || []).filter(e => e.rank && e.rank <= 3).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const specWin = (data.my_spectator_bets || []).some(b => (b.payout ?? 0) > 0);
  const highlight = my && my.rank && my.rank <= 3;

  useEffect(() => {
    const timers = [0, 600, 1200, 1800].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!highlight || !data.first_podium || autoShared.current) return;
    autoShared.current = true;
    (async () => {
      try {
        const text = buildArenaShareText(data);
        const r = await shareOrCopy({ title: '交易人生 · 短线大赛', text, url: appBaseUrl() });
        addMessage(`🏆 竞技领奖 · ${shareResultMessage(r)}`);
        await downloadArenaShareCard(data, appBaseUrl());
        addMessage('竞技分享卡已保存');
      } catch {
        addMessage('自动分享未完成，可手动保存');
      }
    })();
  }, [data, highlight, addMessage]);

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{
        textAlign: 'center', padding: 16, borderRadius: 12, marginBottom: 14,
        background: 'linear-gradient(135deg,#fff8e0,#eef4ff)',
        border: '2px solid #ffb74d',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#c65a00' }}>
          🏆 短线大赛结算 · {data.duration_label || ''}
        </div>
        {data.first_podium && highlight && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: '#8a6e00' }}>
            🎁 首次登上领奖台！
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>领奖台</div>
      {podium.map(e => (
        <div key={e.user_id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 10px', marginBottom: 6, borderRadius: 8,
          background: step >= (e.rank ?? 0) ? (e.rank === 1 ? '#fff8e8' : '#faf6ef') : '#f0f0f0',
          opacity: step >= (e.rank ?? 0) ? 1 : 0.35,
          transition: 'all 0.4s ease',
          border: e.user_id === my?.user_id ? '2px solid #ffb74d' : '1px solid #ebe4d8',
        }}>
          <span>
            {RANK_MEDAL[e.rank ?? 0] || `${e.rank}.`} {e.agent_name}
            {(e.legs_count ?? 0) > 0 ? ` · ${e.legs_count}轮` : ''}
          </span>
          <span style={{ fontWeight: 700, color: (e.return_pct ?? 0) >= 0 ? '#2ea872' : '#c07070' }}>
            {(e.return_pct ?? 0) >= 0 ? '+' : ''}{e.return_pct}%
            {e.prize ? ` · +${e.prize}` : ''}
          </span>
        </div>
      ))}

      {my && (
        <div style={{ marginTop: 12, padding: 10, background: '#eef4ff', borderRadius: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>你的 Agent · {my.agent_name}</div>
          <div>{my.signal_summary || `${my.direction} · ${my.leverage}x`}</div>
          {my.all_legs && my.all_legs.length > 0 && step >= 3 && (
            <div style={{ marginTop: 8, fontSize: 10, color: '#6b5e4e', lineHeight: 1.5 }}>
              操作回放：
              {my.all_legs.slice().reverse().map(l => (
                <div key={l.leg}>
                  第{l.leg + 1}轮 {l.direction} {(l.return_pct ?? 0) >= 0 ? '+' : ''}{l.return_pct}%
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {specWin && (
        <div style={{ marginTop: 10, padding: 8, background: '#fff8e8', borderRadius: 6, fontSize: 11, textAlign: 'center' }}>
          🎉 观众押注命中！
          {(data.my_spectator_bets || []).filter(b => (b.payout ?? 0) > 0).map(b => (
            <div key={b.pick_rank}>押 {b.pick_rank === 1 ? '冠军' : b.pick_rank === 2 ? '亚军' : '季军'} +{b.payout}</div>
          ))}
        </div>
      )}

      {step >= 4 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="ui-btn" style={{ flex: 1 }} disabled={sharing}
            onClick={async () => {
              setSharing(true);
              try {
                await downloadArenaShareCard(data, appBaseUrl());
                addMessage('竞技分享卡已保存');
              } finally { setSharing(false); }
            }}>
            分享战报
          </button>
          <button className="ui-btn" style={{ flex: 1 }} onClick={closeModal}>下一场</button>
        </div>
      )}
    </div>
  );
}
