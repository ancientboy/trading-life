import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
  fetchGuessRound, placeGuessBet, fetchArenaRound, joinArena, arenaSpectateBet,
  fetchArenaLeaderboard, type GuessRoundState, type ArenaRoundState,
} from '../../lib/lifeEngagementApi';

export function TradingEventsPanel() {
  const agents = useGameStore(s => s.agents);
  const operableAgentIds = useGameStore(s => s.operableAgentIds);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const addMessage = useGameStore(s => s.addMessage);
  const points = useGameStore(s => s.points);

  const [tab, setTab] = useState<'guess' | 'arena'>('guess');
  const [guess, setGuess] = useState<GuessRoundState | null>(null);
  const [lastGuess, setLastGuess] = useState<Record<string, unknown> | null>(null);
  const [arena, setArena] = useState<ArenaRoundState | null>(null);
  const [highlights, setHighlights] = useState<Array<Record<string, unknown>>>([]);
  const [guessStake, setGuessStake] = useState(50);
  const [specStake, setSpecStake] = useState(50);
  const [specPick, setSpecPick] = useState('');
  const [busy, setBusy] = useState(false);

  const tradingAgents = useMemo(
    () => operableAgentIds.filter(id => agents[id]?.data?.agentType !== 'entertainment'),
    [operableAgentIds, agents],
  );
  const joinAgentId = selectedAgentId && tradingAgents.includes(selectedAgentId)
    ? selectedAgentId
    : tradingAgents[0] || '';

  const refresh = useCallback(async () => {
    if (tab === 'guess') {
      const r = await fetchGuessRound();
      if (r.ok) {
        setGuess(r.current ?? null);
        setLastGuess(r.last_settled ?? null);
      }
    } else {
      const [ar, lb] = await Promise.all([fetchArenaRound(), fetchArenaLeaderboard(8)]);
      if (ar.ok) setArena(ar.current ?? null);
      if (lb.ok) setHighlights(lb.highlights ?? []);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const betGuess = async (direction: 'up' | 'down') => {
    setBusy(true);
    try {
      const r = await placeGuessBet(direction, guessStake);
      if (!r.ok) {
        addMessage(r.error || '押注失败');
        return;
      }
      setGuess(r.current ?? null);
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      addMessage(`已押 ${direction === 'up' ? '涨' : '跌'} · ${guessStake} 积分`);
    } finally {
      setBusy(false);
    }
  };

  const doJoinArena = async () => {
    if (!joinAgentId) {
      addMessage('请先创建交易 Agent');
      return;
    }
    setBusy(true);
    try {
      const r = await joinArena(joinAgentId);
      if (!r.ok) {
        addMessage(r.error || '报名失败');
        return;
      }
      setArena(r.current ?? null);
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      addMessage(r.message || '已报名短线大赛');
    } finally {
      setBusy(false);
    }
  };

  const doSpecBet = async () => {
    if (!specPick) {
      addMessage('请选择押注选手');
      return;
    }
    setBusy(true);
    try {
      const r = await arenaSpectateBet(specPick, specStake);
      if (!r.ok) {
        addMessage(r.error || '押注失败');
        return;
      }
      setArena(r.current ?? null);
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      addMessage('观众押注已提交 · 猜冠军拿走奖池');
    } finally {
      setBusy(false);
    }
  };

  const pctChange = guess && guess.start_price
    ? ((Number(guess.end_price || guess.start_price) - Number(guess.start_price)) / Number(guess.start_price) * 100)
    : 0;

  return (
    <div style={{ color: '#3d3530', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button className="ui-btn" style={{ flex: 1, opacity: tab === 'guess' ? 1 : 0.55 }}
          onClick={() => setTab('guess')}>📊 猜涨跌 · 60s</button>
        <button className="ui-btn" style={{ flex: 1, opacity: tab === 'arena' ? 1 : 0.55 }}
          onClick={() => setTab('arena')}>🏆 短线大赛 · 3min</button>
      </div>

      <div style={{ fontSize: 11, color: '#8a7e72', marginBottom: 10 }}>
        积分 {points.toLocaleString()} · AI 按策略自主判定方向 · 观众可押冠军
      </div>

      {tab === 'guess' && guess && (
        <div style={{ padding: 12, background: '#faf6ef', borderRadius: 10, border: '1px solid #ebe4d8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700 }}>BTC 猜涨跌</span>
            <span style={{ fontFamily: 'monospace', color: '#3a6bb5' }}>{guess.seconds_left}s</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            开盘价 <b>${Math.round(Number(guess.start_price)).toLocaleString()}</b>
            {guess.status === 'settled' && (
              <> → 收盘 <b>${Math.round(Number(guess.end_price)).toLocaleString()}</b>
                <span style={{ color: pctChange >= 0 ? '#2ea872' : '#c07070', marginLeft: 6 }}>
                  {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(3)}%
                </span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
            <span>📈 涨池 {guess.pool_up}</span>
            <span>📉 跌池 {guess.pool_down}</span>
            <span>总 {guess.total_pool}</span>
          </div>
          {guess.my_bet ? (
            <div style={{ marginTop: 10, padding: 8, background: '#eef8f0', borderRadius: 6, fontSize: 11 }}>
              已押 {guess.my_bet.direction === 'up' ? '涨' : '跌'} · {guess.my_bet.stake} 积分
              {guess.my_bet.payout ? ` · 赢得 ${guess.my_bet.payout}` : ''}
            </div>
          ) : guess.betting_open ? (
            <>
              <input type="range" min={10} max={500} step={10} value={guessStake}
                onChange={e => setGuessStake(Number(e.target.value))} style={{ width: '100%', marginTop: 10 }} />
              <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 8 }}>押注 {guessStake} 积分 · 胜者按比例分池</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ui-btn" style={{ flex: 1, background: '#eef8f0' }} disabled={busy}
                  onClick={() => void betGuess('up')}>📈 押涨</button>
                <button className="ui-btn" style={{ flex: 1, background: '#ffefef' }} disabled={busy}
                  onClick={() => void betGuess('down')}>📉 押跌</button>
              </div>
            </>
          ) : (
            <p style={{ marginTop: 10, fontSize: 11, color: '#9a8b7a' }}>封盘中… 等待 {guess.seconds_left}s 后结算</p>
          )}
          {lastGuess && (
            <p style={{ marginTop: 10, fontSize: 10, color: '#9a8b7a' }}>
              上局：{lastGuess.winner_side === 'up' ? '涨' : lastGuess.winner_side === 'down' ? '跌' : '平'}
              · ${Math.round(Number(lastGuess.start_price))} → ${Math.round(Number(lastGuess.end_price))}
            </p>
          )}
        </div>
      )}

      {tab === 'arena' && arena && (
        <>
          <div style={{ padding: 12, background: '#eef4ff', borderRadius: 10, border: '1px solid #b8cce8', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700 }}>Agent 短线大赛</span>
              <span style={{ fontSize: 11, color: '#3a6bb5' }}>
                {arena.status === 'join' ? `报名 ${arena.join_seconds_left}s` : arena.status === 'running' ? `进行中 ${arena.seconds_left}s` : '结算中'}
              </span>
            </div>
            <div style={{ fontSize: 11, marginTop: 6, color: '#6b5e4e' }}>
              报名 {arena.entry_fee} 积分 · 奖池 {arena.prize_pool} · 观众池 {arena.spectate_pool}
            </div>
            {arena.can_join && !arena.my_entry && (
              <button className="ui-btn" style={{ width: '100%', marginTop: 10 }} disabled={busy || !joinAgentId}
                onClick={() => void doJoinArena()}>
                派 {agents[joinAgentId]?.data.name || '交易 Agent'} 参赛（AI 自主策略）
              </button>
            )}
            {arena.my_entry && (
              <div style={{ marginTop: 8, fontSize: 11, padding: 8, background: '#fff', borderRadius: 6 }}>
                已报名 · {arena.my_entry.direction} · {arena.my_entry.leverage}x
                {arena.my_entry.rank ? ` · 第 ${arena.my_entry.rank} 名 ${arena.my_entry.return_pct >= 0 ? '+' : ''}${arena.my_entry.return_pct}%` : ''}
                {arena.my_entry.prize ? ` · 奖金 +${arena.my_entry.prize}` : ''}
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>选手榜 · 收益率 PK</div>
          {arena.entries.map(e => (
            <div key={e.user_id} style={{
              padding: '6px 8px', marginBottom: 4, borderRadius: 6, fontSize: 11,
              background: e.rank === 1 ? '#fff8e8' : '#faf6ef',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>
                {e.rank ? `${e.rank}. ` : '· '}{e.agent_name}{e.is_npc ? ' 🤖' : ''}
                <span style={{ color: '#9a8b7a' }}> · {e.direction} {e.leverage}x</span>
              </span>
              <span style={{ color: (e.return_pct ?? 0) >= 0 ? '#2ea872' : '#c07070', fontWeight: 600 }}>
                {e.return_pct != null && e.return_pct !== 0
                  ? `${e.return_pct >= 0 ? '+' : ''}${e.return_pct}%`
                  : e.strategy_preset}
              </span>
            </div>
          ))}

          {arena.can_spectate_bet && arena.entries.length > 0 && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff8e8', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>观众押冠军</div>
              <select className="login-input" style={{ marginBottom: 8 }} value={specPick}
                onChange={e => setSpecPick(e.target.value)}>
                <option value="">选择选手</option>
                {arena.entries.filter(e => !e.is_npc).map(e => (
                  <option key={e.user_id} value={e.user_id}>{e.agent_name}</option>
                ))}
              </select>
              <input type="range" min={20} max={300} step={10} value={specStake}
                onChange={e => setSpecStake(Number(e.target.value))} style={{ width: '100%' }} />
              <button className="ui-btn" style={{ width: '100%', marginTop: 6 }} disabled={busy}
                onClick={() => void doSpecBet()}>
                押 {specStake} 积分 · 猜中冠军分观众池
              </button>
            </div>
          )}

          {highlights.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, margin: '14px 0 6px' }}>近期三甲</div>
              {highlights.slice(0, 5).map((h, i) => (
                <div key={i} style={{ fontSize: 10, color: '#8a7e72', padding: '2px 0' }}>
                  {h.rank}. {String(h.display_name)} {Number(h.return_pct) >= 0 ? '+' : ''}{h.return_pct}%
                  {h.prize ? ` +${h.prize}` : ''}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
