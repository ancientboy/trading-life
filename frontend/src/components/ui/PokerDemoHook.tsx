import { useState } from 'react';
import { fetchPublicPokerDemo, type PokerDemoResult } from '../../lib/lifeEngagementApi';
import { PokerCardRow } from './PokerCard';

export function PokerDemoHook() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<PokerDemoResult | null>(null);
  const [error, setError] = useState('');

  const play = async () => {
    setError('');
    setBusy(true);
    setData(null);
    try {
      const r = await fetchPublicPokerDemo();
      if (!r.ok || !r.results?.length) {
        setError(r.error || '试玩失败，请稍后重试');
        return;
      }
      setData(r);
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  };

  const winner = data?.results.find(r => r.rank === 1);

  return (
    <div style={{
      marginTop: 16, padding: '12px 14px', borderRadius: 10,
      background: 'linear-gradient(135deg,#f0faf4,#faf6ef)',
      border: '1px solid #c8e6c9',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#2e7d4f', marginBottom: 6 }}>
        🃏 未登录试玩 · 30 秒看 AI 对决
      </div>
      <p style={{ fontSize: 11, color: '#7a6e62', margin: '0 0 10px', lineHeight: 1.45 }}>
        点一下看 1 手牌 · 注册后可亲自上桌，首局必得高价值分享卡
      </p>

      {!data && (
        <button className="ui-btn" style={{ width: '100%', padding: '9px 0', fontSize: 13 }}
          disabled={busy} onClick={() => void play()}>
          {busy ? '发牌中…' : '▶ 一键看 AI 开牌'}
        </button>
      )}

      {error && <p style={{ color: '#e55', fontSize: 11, marginTop: 8 }}>{error}</p>}

      {data && winner && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, color: '#5c4a32', fontWeight: 600, marginBottom: 6 }}>
            👑 {winner.name} · {winner.hand_name || winner.hand_combo} · +{winner.won} 积分
          </div>
          {data.community_cards && data.community_cards.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 4 }}>公共牌</div>
              <PokerCardRow cards={data.community_cards} small />
            </div>
          )}
          {data.results.slice(0, 3).map(r => (
            <div key={r.name} style={{
              fontSize: 10, color: '#8a7e72', padding: '3px 0',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{r.rank}. {r.name}{r.rank === 1 ? ' 👑' : ''}</span>
              <span>{r.hand_name || r.hand_combo}</span>
            </div>
          ))}
          <button className="ui-btn" style={{ width: '100%', marginTop: 10, fontSize: 11, padding: '6px 0' }}
            onClick={() => { setData(null); void play(); }}>
            再看一手
          </button>
        </div>
      )}
    </div>
  );
}
