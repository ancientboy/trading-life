import { useCallback, useEffect, useState } from 'react';
import { fetchPublicArenaLive, type PublicArenaLive } from '../../lib/lifeEngagementApi';

export function TradingArenaPublicHook() {
  const [data, setData] = useState<PublicArenaLive | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    setBusy(true);
    setError('');
    try {
      const r = await fetchPublicArenaLive();
      if (!r.ok) {
        setError(r.error || '加载失败');
        return;
      }
      setData(r);
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 12000);
    return () => clearInterval(id);
  }, [load]);

  const cur = data?.current;
  const statusLabel = cur?.status === 'join'
    ? `报名中 ${cur.join_seconds_left}s`
    : cur?.status === 'running'
      ? `进行中 ${cur.seconds_left}s · ${cur.duration_label || ''}`
      : '等待下局';

  return (
    <div style={{
      marginTop: 14, padding: '12px 14px', borderRadius: 10,
      background: 'linear-gradient(135deg,#eef4ff,#fff8e8)',
      border: '2px solid #ffb74d',
      boxShadow: '0 2px 12px rgba(255,183,77,0.25)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#c65a00' }}>
          🏆 交易竞技 · 公开观赛
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
          background: cur?.status === 'running' ? '#ffecb3' : '#e3f2fd', color: '#5c4a32',
        }}>
          {busy && !cur ? '…' : statusLabel}
        </span>
      </div>
      <p style={{ fontSize: 11, color: '#7a6e62', margin: '0 0 10px', lineHeight: 1.45 }}>
        {data?.message || '猜涨跌 60s · 短线大赛极速/标准 · AI 每 30s 多轮操作 · 押冠亚季军'}
      </p>

      {error && <p style={{ color: '#e55', fontSize: 11 }}>{error}</p>}

      {cur && cur.entries.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#3a6bb5', marginBottom: 4 }}>
            当前选手 · 奖池 {cur.prize_pool} · 观众池 {cur.spectate_pool}
            {cur.leg_interval_sec ? ` · ${cur.leg_interval_sec}s/轮` : ''}
          </div>
          {cur.entries.slice(0, 5).map(e => (
            <div key={e.user_id} style={{
              fontSize: 10, padding: '3px 0', display: 'flex', justifyContent: 'space-between',
              color: '#5c4a32',
            }}>
              <span>
                {e.rank ? `${e.rank}. ` : ''}{e.agent_name || e.display_name}
                {e.is_npc ? ' 🤖' : ''} · {e.direction} {e.leverage}x
                {(e.legs_count ?? 0) > 0 ? ` · ${e.legs_count}轮` : ''}
              </span>
              <span style={{ color: (e.return_pct ?? 0) >= 0 ? '#2ea872' : '#c07070', fontWeight: 600 }}>
                {e.return_pct != null && e.return_pct !== 0
                  ? `${e.return_pct >= 0 ? '+' : ''}${e.return_pct}%`
                  : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {data?.win_rate_board && data.win_rate_board.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6a5a48', marginBottom: 4 }}>📈 竞技胜率榜</div>
          {data.win_rate_board.slice(0, 4).map(w => (
            <div key={w.user_id} style={{ fontSize: 10, color: '#8a7e72', padding: '2px 0' }}>
              {w.rank}. {w.display_name} · 胜率 {w.win_rate}% ({w.wins}/{w.entries})
            </div>
          ))}
        </div>
      )}

      {data?.highlights && data.highlights.length > 0 && (
        <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 8 }}>
          近期三甲：{data.highlights.slice(0, 3).map(h =>
            `${h.rank}.${h.display_name || h.agent_name} ${Number(h.return_pct) >= 0 ? '+' : ''}${h.return_pct}%`,
          ).join(' · ')}
        </div>
      )}

      <button className="ui-btn" style={{
        width: '100%', padding: '10px 0', fontSize: 13, fontWeight: 700,
        background: 'linear-gradient(135deg,#ffd54f,#ffb300)', borderColor: '#ff8f00',
      }} onClick={() => {
        sessionStorage.setItem('tl_post_login_tab', 'events');
      }}>
        注册参赛 · 押冠亚季军 · 领 5 万模拟盘
      </button>
    </div>
  );
}
