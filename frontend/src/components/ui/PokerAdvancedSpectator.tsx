import { useEffect, useRef, useState } from 'react';
import { formatPokerCard } from '../../lib/pokerCards';
import type { AdvancedPokerGame } from '../../lib/lifeEngagementApi';
import { fetchAdvancedPokerState } from '../../lib/lifeEngagementApi';

const PHASE_LABEL: Record<string, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  between_hands: '局间休息',
  complete: '锦标赛结束',
  waiting: '等待',
};

type Props = {
  roomId: string;
  buyIn: number;
  onComplete?: (settlement: NonNullable<Awaited<ReturnType<typeof fetchAdvancedPokerState>>['settlement']>) => void;
  onClose?: () => void;
};

export function PokerAdvancedSpectator({ roomId, buyIn, onComplete, onClose }: Props) {
  const [game, setGame] = useState<AdvancedPokerGame | null>(null);
  const [status, setStatus] = useState('playing');
  const [log, setLog] = useState<string[]>([]);
  const sinceRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const r = await fetchAdvancedPokerState(roomId, sinceRef.current);
      if (cancelled || !r.ok) return;
      if (r.game) {
        setGame(r.game);
        sinceRef.current = r.game.event_count;
        const newLines = r.game.events.map(ev => formatEvent(ev)).filter(Boolean) as string[];
        if (newLines.length) setLog(prev => [...prev.slice(-40), ...newLines]);
      }
      if (r.status) setStatus(r.status);
      if (r.settlement && !doneRef.current) {
        doneRef.current = true;
        onComplete?.(r.settlement);
      }
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(t); };
  }, [roomId, onComplete]);

  if (!game) {
    return (
      <div style={{ textAlign: 'center', padding: 24, color: '#6a5a48' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>荷官发牌中…</div>
        <div style={{ fontSize: 11, marginTop: 8, color: '#8a7e72' }}>AI 选手正在入座</div>
      </div>
    );
  }

  return (
    <div style={{ color: '#3d3530', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: '#2ea872' }}>
          进阶观赛 · 第 {game.hand_number} 手 · {PHASE_LABEL[game.phase] || game.phase}
        </span>
        <span style={{ fontSize: 11, color: '#8a7e72' }}>买入 {buyIn}</span>
      </div>

      <div style={{ padding: 10, background: '#1a3d2a', borderRadius: 8, marginBottom: 10, color: '#e8f5e9' }}>
        <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.85 }}>公共牌 · 底池 {game.pot}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 36 }}>
          {game.community.length === 0 && <span style={{ opacity: 0.5 }}>—</span>}
          {game.community.map(c => (
            <span key={c} style={{ background: '#fff', color: '#1a1a1a', padding: '4px 8px', borderRadius: 4, fontWeight: 700, fontSize: 13 }}>
              {formatPokerCard(c)}
            </span>
          ))}
        </div>
        {game.actor_name && status === 'playing' && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#a5d6a7' }}>
            行动中：<b>{game.actor_name}</b>
            {game.last_reasoning?.reason && (
              <span style={{ marginLeft: 8, opacity: 0.9 }}>💭 {game.last_reasoning.reason}</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {game.players.map(p => (
          <div key={p.seat_id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
            background: p.eliminated ? '#f5f0ea' : p.seat_index === game.actor_index ? '#fff8e8' : '#faf6ef',
            borderRadius: 8, opacity: p.eliminated ? 0.5 : 1,
            border: p.seat_index === game.button_index ? '1px solid #d4af37' : '1px solid #e8dcc8',
          }}>
            <span style={{ width: 36, fontSize: 10, color: '#8a7e72' }}>座{p.seat_id.replace('poker_s', '')}</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontSize: 10, color: '#6a8aad' }}>{p.poker_preset?.toUpperCase()}</span>
            <span style={{ fontWeight: 700, color: '#2ea872', minWidth: 56, textAlign: 'right' }}>{p.stack}</span>
            {p.folded && <span style={{ fontSize: 10, color: '#c0392b' }}>弃牌</span>}
            {p.all_in && !p.folded && <span style={{ fontSize: 10, color: '#d4af37' }}>全下</span>}
            {!p.folded && p.hole_cards?.length === 2 && (
              <span style={{ fontSize: 11, color: '#5a4a3a' }}>
                {p.hole_cards.map(c => formatPokerCard(c)).join(' ')}
              </span>
            )}
          </div>
        ))}
      </div>

      {status === 'tournament_complete' && (
        <div style={{ padding: 10, background: '#eef4ff', borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
          🏆 锦标赛结束 — 筹码归零者已淘汰
        </div>
      )}

      <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 10, color: '#6a5a48', background: '#faf6ef', padding: 8, borderRadius: 6 }}>
        {log.slice(-15).map((line, i) => <div key={i} style={{ padding: '2px 0' }}>{line}</div>)}
      </div>

      {onClose && (
        <button className="ui-btn" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>关闭观赛</button>
      )}
    </div>
  );
}

function formatEvent(ev: { kind: string; name?: string; action?: string; amount?: number; phase?: string; hand_name?: string }): string | null {
  if (ev.kind === 'action') {
    const actMap: Record<string, string> = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', all_in: '全下' };
    const label = actMap[ev.action || ''] || ev.action;
    return `${ev.name} ${label}${ev.amount ? ` ${ev.amount}` : ''}`;
  }
  if (ev.kind === 'street') return `—— ${PHASE_LABEL[ev.phase || ''] || ev.phase} ——`;
  if (ev.kind === 'showdown') return `${ev.name} 摊牌 ${ev.hand_name || ''} +${ev.amount}`;
  if (ev.kind === 'eliminated') return `${ev.name} 筹码耗尽，淘汰`;
  if (ev.kind === 'tournament_end') return '🏆 锦标赛结束';
  if (ev.kind === 'hand_start') return '--- 新一手开始 ---';
  return null;
}
