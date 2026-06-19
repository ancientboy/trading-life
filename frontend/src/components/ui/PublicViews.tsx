import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import type { AdvancedPokerGame } from '../../lib/lifeEngagementApi';
import {
  fetchPublicRoomPreview, fetchPublicSeasonInfo, fetchPublicSeasonLeaderboard,
  fetchPublicSpectateState, fetchReferralInfo,
} from '../../lib/lifeEngagementApi';
import { buildInviteLink, buildJoinLink, buildLeaderboardLink, shareOrCopy } from '../../lib/shareUtils';
import { isLoggedIn } from '../../lib/lifeAuth';
import { PokerCard } from './PokerCard';

const PHASE_LABEL: Record<string, string> = {
  preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌',
  between_hands: '局间', complete: '结束', waiting: '等待',
};

type PublicShellProps = { loggedIn: boolean; children: React.ReactNode; title: string };

function PublicShell({ loggedIn, children, title }: PublicShellProps) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f0e8', padding: '16px 12px 32px' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>🐧</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#3d3530', margin: '6px 0 2px' }}>{title}</h1>
          <p style={{ fontSize: 12, color: '#8a7e72' }}>交易人生 · Trading Life</p>
        </div>
        {children}
        {!loggedIn && (
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <a href="/trading/life/" className="ui-btn" style={{ display: 'inline-block', padding: '10px 24px', textDecoration: 'none' }}>
              登录 / 注册参与
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function PublicSpectateView({ roomId, loggedIn }: { roomId: string; loggedIn?: boolean }) {
  const authed = loggedIn ?? isLoggedIn();
  const [game, setGame] = useState<AdvancedPokerGame | null>(null);
  const [status, setStatus] = useState('playing');
  const [buyIn, setBuyIn] = useState(0);
  const [error, setError] = useState('');
  const sinceRef = useRef(0);

  const poll = useCallback(async () => {
    const r = await fetchPublicSpectateState(roomId, sinceRef.current);
    if (!r.ok) {
      setError(r.error || '加载失败');
      return;
    }
    setError('');
    if (r.buy_in) setBuyIn(r.buy_in);
    if (r.game) {
      setGame(r.game);
      if (r.game.events?.length) {
        sinceRef.current = Math.max(...r.game.events.map(e => e.seq ?? 0)) + 1;
      }
    }
    if (r.status) setStatus(r.status);
  }, [roomId]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 1800);
    return () => clearInterval(t);
  }, [poll]);

  const share = () => {
    const url = `${window.location.origin}/trading/life/?view=spectate&room=${encodeURIComponent(roomId)}`;
    void shareOrCopy({ title: '交易人生观赛', text: '🃏 进阶德州锦标赛直播中', url });
  };

  return (
    <PublicShell loggedIn={authed} title="公开观赛 · 进阶德州">
      <div style={{ background: '#fff', borderRadius: 12, padding: 14, border: '1px solid #e0d4c4' }}>
        {error && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        {game ? (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2ea872', marginBottom: 8 }}>
              第 {game.hand_number} 手 · {PHASE_LABEL[game.phase] || game.phase}
              {buyIn > 0 && <span style={{ color: '#8a7e72', fontWeight: 400 }}> · 买入 {buyIn}</span>}
            </div>
            <div style={{
              padding: 12, background: 'linear-gradient(160deg,#1a4d32,#0f3320)', borderRadius: 10,
              color: '#e8f5e9', textAlign: 'center', marginBottom: 10,
            }}>
              <div style={{ fontSize: 11, marginBottom: 6 }}>底池 <b style={{ color: '#ffd54f' }}>{game.pot}</b></div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                {game.community.length === 0
                  ? <span style={{ opacity: 0.5, fontSize: 11 }}>尚未发公共牌</span>
                  : game.community.map(c => <PokerCard key={c} card={c} />)}
              </div>
              {game.actor_name && status === 'playing' && (
                <div style={{ fontSize: 10, marginTop: 8, color: '#a5d6a7' }}>行动中：{game.actor_name}</div>
              )}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>选手</div>
            {game.players.filter(p => !p.eliminated).slice(0, 7).map(p => (
              <div key={p.seat_id} style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 0',
                borderBottom: '1px dashed #eee8dc', fontSize: 11,
              }}>
                <span>{p.name}</span>
                <span style={{ color: '#2ea872', fontWeight: 700 }}>{p.stack}</span>
              </div>
            ))}
            {status === 'tournament_complete' && (
              <div style={{ marginTop: 10, padding: 8, background: '#eef4ff', borderRadius: 8, fontSize: 12 }}>
                🏆 锦标赛已结束
              </div>
            )}
          </>
        ) : !error && (
          <div style={{ textAlign: 'center', padding: 24, color: '#8a7e72', fontSize: 13 }}>加载观赛桌…</div>
        )}
        <button type="button" className="ui-btn" style={{ width: '100%', marginTop: 12 }} onClick={share}>
          分享观赛链接
        </button>
      </div>
    </PublicShell>
  );
}

export function PublicLeaderboardView({ loggedIn }: { loggedIn?: boolean }) {
  const authed = loggedIn ?? isLoggedIn();
  const [metric, setMetric] = useState('points');
  const [entries, setEntries] = useState<Array<{ rank: number; name: string; points_earned?: number; social_score?: number; pvp_wins?: number; pnl_score?: number }>>([]);
  const [seasonName, setSeasonName] = useState('');

  useEffect(() => {
    fetchPublicSeasonInfo().then(r => {
      if (r.ok && r.season) setSeasonName(r.season.name || '当前赛季');
    });
    fetchPublicSeasonLeaderboard(metric).then(r => {
      if (r.ok) setEntries(r.entries);
    });
  }, [metric]);

  const metricLabel: Record<string, string> = { points: '积分', social: '社交', pvp: 'PvP', pnl: 'PnL' };

  const share = () => {
    void shareOrCopy({
      title: '交易人生赛季榜',
      text: `🏆 ${seasonName || '赛季'}排行榜 · ${metricLabel[metric]}`,
      url: buildLeaderboardLink(),
    });
  };

  return (
    <PublicShell loggedIn={authed} title="赛季排行榜">
      <div style={{ background: '#fff', borderRadius: 12, padding: 14, border: '1px solid #e0d4c4' }}>
        {seasonName && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{seasonName}</div>}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {['points', 'social', 'pvp', 'pnl'].map(m => (
            <button key={m} type="button" className={`ui-btn ${metric === m ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => setMetric(m)}>
              {metricLabel[m]}
            </button>
          ))}
        </div>
        {entries.map(e => (
          <div key={e.rank} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px dashed #eee8dc', fontSize: 12 }}>
            <span style={{ width: 28, color: e.rank <= 3 ? '#d4af37' : '#999', fontWeight: 700 }}>{e.rank}</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{e.name}</span>
            <span style={{ color: '#2ea872', fontWeight: 700 }}>
              {Math.round(e.points_earned ?? e.social_score ?? e.pvp_wins ?? e.pnl_score ?? 0)}
            </span>
          </div>
        ))}
        <button type="button" className="ui-btn" style={{ width: '100%', marginTop: 12 }} onClick={share}>
          分享排行榜
        </button>
      </div>
    </PublicShell>
  );
}

export function PublicJoinLanding({ roomCode }: { roomCode: string }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof fetchPublicRoomPreview>> | null>(null);

  useEffect(() => {
    fetchPublicRoomPreview(roomCode).then(setPreview);
  }, [roomCode]);

  const link = buildJoinLink(roomCode);

  return (
    <PublicShell loggedIn={false} title="好友邀请你加入德州桌">
      <div style={{ background: '#fff', borderRadius: 12, padding: 14, border: '1px solid #e0d4c4', fontSize: 13 }}>
        {preview?.ok ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>房间 #{preview.room_code}</div>
            <div style={{ color: '#6a5a48', lineHeight: 1.6 }}>
              模式：{preview.game_mode === 'advanced' ? '进阶锦标赛' : '经典比牌'}<br />
              买入：{preview.buy_in} 积分<br />
              当前 {preview.human_count} 人在座 · 最多 {preview.max_players} 人
            </div>
          </>
        ) : (
          <div style={{ color: '#8a7e72' }}>{preview?.error || '加载房间信息…'}</div>
        )}
        <button type="button" className="ui-btn" style={{ width: '100%', marginTop: 12 }}
          onClick={() => void shareOrCopy({ title: '加入德州桌', text: `🃏 来交易人生德州扑克房间 #${roomCode}`, url: link })}>
          复制邀请链接
        </button>
      </div>
    </PublicShell>
  );
}

export function ReferralPanel() {
  const addMessage = useGameStore(s => s.addMessage);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof fetchReferralInfo>> | null>(null);

  useEffect(() => {
    fetchReferralInfo().then(setInfo);
  }, []);

  if (!info?.ok) {
    return <div style={{ fontSize: 12, color: '#8a7e72' }}>加载邀请信息…</div>;
  }

  const link = buildInviteLink(info.invite_code || '');

  return (
    <div style={{ color: '#3d3530', fontSize: 12 }}>
      <div style={{ padding: 12, background: '#eef4ff', borderRadius: 10, marginBottom: 12, border: '1px solid #7aa8e8' }}>
        <div style={{ fontWeight: 700, color: '#3a6bb5', marginBottom: 6 }}>邀请好友 · 双方得积分</div>
        <div style={{ lineHeight: 1.55, color: '#5a4a3a' }}>
          好友注册 +{info.rewards?.invitee_signup ?? 500} · 你得 +{info.rewards?.inviter_signup ?? 300}<br />
          好友首次打牌 · 你再得 +{info.rewards?.inviter_first_poker ?? 200}
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#8a7e72', marginBottom: 4 }}>你的邀请码</div>
        <div style={{
          fontSize: 22, fontWeight: 800, letterSpacing: 4, textAlign: 'center',
          padding: '12px 8px', background: '#faf6ef', borderRadius: 8, border: '1px dashed #d4af37',
        }}>
          {info.invite_code}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" className="ui-btn" style={{ flex: 1 }}
          onClick={async () => {
            await navigator.clipboard.writeText(info.invite_code || '');
            addMessage('邀请码已复制');
          }}>
          复制码
        </button>
        <button type="button" className="ui-btn" style={{ flex: 1 }}
          onClick={async () => {
            const r = await shareOrCopy({
              title: '交易人生邀请',
              text: `🐧 来交易人生养 Agent！用我的邀请码 ${info.invite_code} 注册`,
              url: link,
            });
            addMessage(r === 'shared' ? '已分享' : '邀请链接已复制');
          }}>
          分享链接
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#8a7e72' }}>
        已邀请 {info.invites_count ?? 0} 人 · 其中 {info.poker_rewards ?? 0} 人已完成首局扑克
      </div>
    </div>
  );
}
