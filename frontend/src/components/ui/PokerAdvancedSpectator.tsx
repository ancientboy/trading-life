import { useCallback, useEffect, useRef, useState } from 'react';
import { PokerCard, PokerCardRow } from './PokerCard';
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

const PACE_OPTIONS = [
  { id: 'slow', label: '慢速', intervalMs: 2800, steps: 8 },
  { id: 'normal', label: '正常', intervalMs: 1600, steps: 15 },
  { id: 'fast', label: '较快', intervalMs: 900, steps: 25 },
] as const;

type PaceId = typeof PACE_OPTIONS[number]['id'];

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
  const [paceId, setPaceId] = useState<PaceId>('normal');
  const [autoComplete, setAutoComplete] = useState(true);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sinceRef = useRef(0);
  const doneRef = useRef(false);
  const pollRef = useRef(0);
  const burstRef = useRef(false);
  const initialLoadRef = useRef(true);

  const pace = PACE_OPTIONS.find(p => p.id === paceId) ?? PACE_OPTIONS[1];

  const poll = useCallback(async (manual = false) => {
    pollRef.current += 1;
    const ticket = pollRef.current;
    if (initialLoadRef.current || manual) setLoading(true);
    try {
      const useBurst = autoComplete && !paused && !manual;
      const r = await fetchAdvancedPokerState(roomId, sinceRef.current, {
        autoRun: !paused,
        maxSteps: useBurst ? 40 : (manual ? 1 : pace.steps),
        runUntilComplete: useBurst && !burstRef.current,
      });
      if (useBurst) burstRef.current = true;
      initialLoadRef.current = false;
      if (ticket !== pollRef.current) return;
      if (!r.ok) {
        setError(r.error || '同步失败');
        return;
      }
      setError('');
      if (r.game) {
        setGame(r.game);
        sinceRef.current = r.game.event_count;
        const newLines = r.game.events.map(ev => formatEvent(ev)).filter(Boolean) as string[];
        if (newLines.length) setLog(prev => [...prev.slice(-80), ...newLines]);
      }
      if (r.status) setStatus(r.status);
      if (r.settlement && !doneRef.current) {
        doneRef.current = true;
        onComplete?.(r.settlement);
      }
    } catch {
      if (ticket === pollRef.current) setError('网络错误');
    } finally {
      if (ticket === pollRef.current) setLoading(false);
    }
  }, [roomId, paused, pace.steps, autoComplete, onComplete]);

  useEffect(() => {
    sinceRef.current = 0;
    doneRef.current = false;
    burstRef.current = false;
    initialLoadRef.current = true;
    setLog([]);
    setStatus('playing');
    void poll(true);
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paused || status === 'tournament_complete') return;
    if (autoComplete) {
      void poll(false);
      const t = setInterval(() => { void poll(false); }, 1200);
      return () => clearInterval(t);
    }
    const t = setInterval(() => { void poll(false); }, pace.intervalMs);
    return () => clearInterval(t);
  }, [poll, paused, pace.intervalMs, status, autoComplete]);

  if (!game && loading) {
    return (
      <div style={{ textAlign: 'center', padding: 24, color: '#6a5a48' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>正在进入观赛桌…</div>
        <div style={{ fontSize: 11, marginTop: 8, color: '#8a7e72' }}>7 人桌初始化中，请稍候</div>
      </div>
    );
  }

  if (!game) {
    return (
      <div style={{ textAlign: 'center', padding: 24, color: '#c0392b' }}>
        <div>{error || '无法加载牌局'}</div>
        <button className="ui-btn" style={{ marginTop: 12 }} onClick={() => void poll(true)}>重试</button>
      </div>
    );
  }

  const activePlayers = game.players.filter(p => !p.eliminated);
  const lastReason = game.last_reasoning;

  return (
    <div style={{ color: '#3d3530', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontWeight: 700, color: '#2ea872' }}>
          观赛 · 第 {game.hand_number} 手 · {PHASE_LABEL[game.phase] || game.phase}
        </span>
        <span style={{ fontSize: 11, color: '#8a7e72' }}>带入 {buyIn} · 盲注 {game.small_blind}/{game.big_blind}</span>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={`ui-btn ${autoComplete ? 'active' : ''}`}
          style={{ fontSize: 10, padding: '4px 10px', fontWeight: 700 }}
          onClick={() => { setAutoComplete(v => !v); burstRef.current = false; }}>
          {autoComplete ? '✓ 自动播到结束' : '手动步进'}
        </button>
        {!autoComplete && PACE_OPTIONS.map(p => (
          <button key={p.id} type="button" className={`ui-btn ${paceId === p.id ? 'active' : ''}`}
            style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => setPaceId(p.id)}>
            {p.label}
          </button>
        ))}
        <button type="button" className={`ui-btn ${paused ? 'active' : ''}`} style={{ fontSize: 10, padding: '4px 8px' }}
          onClick={() => setPaused(v => !v)}>
          {paused ? '▶ 继续' : '⏸ 暂停'}
        </button>
        {!autoComplete && (
          <button type="button" className="ui-btn" style={{ fontSize: 10, padding: '4px 8px' }}
            onClick={() => void poll(true)}>
            下一步
          </button>
        )}
        {loading && status !== 'tournament_complete' && (
          <span style={{ fontSize: 10, color: '#8a7e72' }}>{autoComplete ? '自动推进中…' : '同步中…'}</span>
        )}
      </div>

      {autoComplete && status === 'playing' && !paused && (
        <div style={{ fontSize: 10, color: '#6a8aad', marginBottom: 8, padding: '6px 10px', background: '#eef4ff', borderRadius: 6 }}>
          已开启自动观赛 — 无需点击，牌局将自动推进至锦标赛结束
        </div>
      )}

      <div style={{
        padding: 14, background: 'linear-gradient(160deg,#1a4d32,#0f3320)', borderRadius: 12,
        marginBottom: 10, color: '#e8f5e9', textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, marginBottom: 8, opacity: 0.9 }}>
          公共牌 · 底池 <b style={{ color: '#ffd54f' }}>{game.pot}</b>
          {game.current_bet > 0 && <span> · 当前注 {game.current_bet}</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, minHeight: 56, alignItems: 'center' }}>
          {game.community.length === 0 ? (
            <span style={{ opacity: 0.45, fontSize: 12 }}>尚未发公共牌</span>
          ) : (
            game.community.map(c => (
              <PokerCard key={c} card={c} />
            ))
          )}
        </div>
        {lastReason && status === 'playing' && (
          <div style={{
            marginTop: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.12)',
            borderRadius: 8, fontSize: 11, textAlign: 'left',
          }}>
            <b>{lastReason.name}</b>
            {' '}{actionLabel(lastReason.action)}{lastReason.amount ? ` ${lastReason.amount}` : ''}
            {lastReason.reason && (
              <div style={{ marginTop: 4, opacity: 0.92, color: '#c8e6c9' }}>💭 {lastReason.reason}</div>
            )}
          </div>
        )}
        {game.actor_name && status === 'playing' && !lastReason && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#a5d6a7' }}>行动中：<b>{game.actor_name}</b></div>
        )}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: '#6a5a48', marginBottom: 6 }}>
        全员底牌（观赛透视）
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {activePlayers.map(p => {
          const isActor = p.seat_index === game.actor_index;
          const isBtn = p.seat_index === game.button_index;
          const cards = p.hole_cards?.length === 2 ? p.hole_cards : [];
          const faceDown = cards.some(c => c === '??' || !c);
          return (
            <div key={p.seat_id} style={{
              padding: '10px 12px',
              background: p.folded ? '#f0ebe3' : isActor ? '#fff8e8' : '#faf6ef',
              borderRadius: 10,
              border: isBtn ? '2px solid #d4af37' : '1px solid #e0d4c4',
              opacity: p.eliminated ? 0.45 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: cards.length ? 8 : 0 }}>
                <span style={{ fontSize: 10, color: '#8a7e72', minWidth: 32 }}>
                  座{p.seat_id.replace('poker_s', '')}{isBtn ? '·D' : ''}
                </span>
                <span style={{ flex: 1, fontWeight: 700 }}>{p.name}</span>
                <span style={{ fontSize: 10, color: '#6a8aad' }}>{p.poker_preset?.toUpperCase()}</span>
                <span style={{ fontWeight: 700, color: '#2ea872' }}>{p.stack}</span>
                {p.bet_street > 0 && <span style={{ fontSize: 10, color: '#d4af37' }}>注{p.bet_street}</span>}
                {p.folded && <span style={{ fontSize: 10, color: '#c0392b', fontWeight: 600 }}>弃牌</span>}
                {p.all_in && !p.folded && <span style={{ fontSize: 10, color: '#e67e22', fontWeight: 600 }}>全下</span>}
                {isActor && !p.folded && <span style={{ fontSize: 10, color: '#2ea872' }}>◀ 行动中</span>}
              </div>
              {cards.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <PokerCardRow cards={cards} faceDown={faceDown} small />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {game.players.filter(p => p.eliminated).length > 0 && (
        <div style={{ fontSize: 10, color: '#8a7e72', marginBottom: 8 }}>
          已淘汰：{game.players.filter(p => p.eliminated).map(p => p.name).join('、')}
        </div>
      )}

      {status === 'tournament_complete' && (
        <div style={{ padding: 10, background: '#eef4ff', borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
          🏆 锦标赛结束 — 积分已结算
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: '#6a5a48', marginBottom: 4 }}>行动记录</div>
      <div style={{
        maxHeight: 140, overflowY: 'auto', fontSize: 11, color: '#5a4a3a',
        background: '#faf6ef', padding: 10, borderRadius: 8, lineHeight: 1.55,
      }}>
        {log.length === 0 && <span style={{ color: '#8a7e72' }}>等待首个动作…</span>}
        {log.slice(-20).map((line, i) => <div key={i}>{line}</div>)}
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 11, color: '#c0392b' }}>{error}</div>}

      {onClose && (
        <button className="ui-btn" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>关闭观赛</button>
      )}
    </div>
  );
}

function actionLabel(action?: string) {
  const m: Record<string, string> = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', all_in: '全下' };
  return m[action || ''] || action || '';
}

function formatEvent(ev: {
  kind: string; name?: string; action?: string; amount?: number;
  phase?: string; hand_name?: string; label?: string; reason?: string;
}): string | null {
  if (ev.kind === 'action') {
    return `▸ ${ev.name} ${actionLabel(ev.action)}${ev.amount ? ` ${ev.amount}` : ''}`;
  }
  if (ev.kind === 'blind') return `◎ ${ev.name} ${ev.label || '盲注'} ${ev.amount}`;
  if (ev.kind === 'street') return `—— ${PHASE_LABEL[ev.phase || ''] || ev.phase} ——`;
  if (ev.kind === 'showdown') return `★ ${ev.name} 摊牌 ${ev.hand_name || ''}${ev.amount ? ` +${ev.amount}` : ''}`;
  if (ev.kind === 'eliminated') return `✕ ${ev.name} 筹码耗尽，淘汰`;
  if (ev.kind === 'tournament_end') return '🏆 锦标赛结束';
  if (ev.kind === 'hand_start') return '━━━ 新一手开始 ━━━';
  if (ev.kind === 'win') return `★ ${ev.name} 赢得底池 ${ev.amount}${ev.reason ? `（${ev.reason}）` : ''}`;
  return null;
}
