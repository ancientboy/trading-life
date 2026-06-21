import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { LogicDrawer } from './LogicDrawer';
import { TradingModesPanel } from './TradingModesPanel';
import {
  placeGuessBet, joinArena, arenaSpectateBet,
  fetchArenaLeaderboard, fetchArenaWinRate,
  type ArenaRoundState, type ArenaWinRateEntry, type ArenaEntry,
  type PkResultInfo,
} from '../../lib/lifeEngagementApi';
import { guessClockFromRound } from '../../lib/guessClock';
import { shareOrCopy, shareResultMessage, appBaseUrl } from '../../lib/shareUtils';

const RANK_LABELS: Record<number, string> = { 1: '🥇 冠军', 2: '🥈 亚军', 3: '🥉 季军' };

export function TradingEventsPanel() {
  const agents = useGameStore(s => s.agents);
  const canOperateAgent = useGameStore(s => s.canOperateAgent);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const selectedArenaEntryId = useGameStore(s => s.selectedArenaEntryId);
  const setSelectedArenaEntryId = useGameStore(s => s.setSelectedArenaEntryId);
  const arenaLive = useGameStore(s => s.arenaLive);
  const guess = useGameStore(s => s.guessRound);
  const guessPollMeta = useGameStore(s => s.guessPollMeta);
  const arenaPollMeta = useGameStore(s => s.arenaPollMeta);
  const setGuessRound = useGameStore(s => s.setGuessRound);
  const setArenaLive = useGameStore(s => s.setArenaLive);
  const syncTradingLive = useGameStore(s => s.syncTradingLive);
  const tradingLiveSyncing = useGameStore(s => s.tradingLiveSyncing);
  const tradingLiveError = useGameStore(s => s.tradingLiveError);
  const showGuessResult = useGameStore(s => s.showGuessResult);
  const showArenaResult = useGameStore(s => s.showArenaResult);
  const showPkResult = useGameStore(s => s.showPkResult);
  const addMessage = useGameStore(s => s.addMessage);
  const points = useGameStore(s => s.points);

  const [tab, setTab] = useState<'guess' | 'arena' | 'modes'>('arena');
  const [lastGuess, setLastGuess] = useState<Record<string, unknown> | null>(null);
  const arena = arenaLive;
  const [highlights, setHighlights] = useState<Array<Record<string, unknown>>>([]);
  const [winRates, setWinRates] = useState<ArenaWinRateEntry[]>([]);
  const [guessStake, setGuessStake] = useState(50);
  const [specStake, setSpecStake] = useState(50);
  const [specPick, setSpecPick] = useState('');
  const [specRank, setSpecRank] = useState(1);
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const shownGuessRef = useRef<Set<string>>(new Set());
  const shownArenaRef = useRef<Set<string>>(new Set());
  const shownPkRef = useRef<Set<string>>(new Set());
  const prevArenaLegsRef = useRef<Record<string, number>>({});

  const tradingAgents = useMemo(
    () => Object.keys(agents).filter(id => canOperateAgent(id) && agents[id]?.data?.agentType !== 'entertainment'),
    [agents, canOperateAgent],
  );
  const joinAgentId = selectedAgentId && tradingAgents.includes(selectedAgentId)
    ? selectedAgentId
    : tradingAgents[0] || '';

  const maybeShowGuessResult = useCallback((
    settled: Record<string, unknown> | null | undefined,
    lastMy: { direction?: string; stake?: number; payout?: number; won?: boolean; first_win?: boolean } | null | undefined,
  ) => {
    if (!settled || !lastMy?.direction) return;
    const rid = String(settled.id || settled.round_id || '');
    if (!rid || shownGuessRef.current.has(rid)) return;
    shownGuessRef.current.add(rid);
    const won = !!lastMy.won && (lastMy.payout ?? 0) > 0;
    showGuessResult({
      won,
      direction: lastMy.direction as 'up' | 'down',
      stake: Number(lastMy.stake) || 0,
      payout: Number(lastMy.payout) || 0,
      start_price: Number(settled.start_price) || 0,
      end_price: Number(settled.end_price) || 0,
      first_win: !!lastMy.first_win && won,
      pending_leverage: lastMy.pending_leverage,
    });
  }, [showGuessResult]);

  const maybeShowPkResult = useCallback((pk: PkResultInfo | null | undefined) => {
    if (!pk?.round_id) return;
    const rid = pk.round_id;
    if (shownPkRef.current.has(rid)) return;
    shownPkRef.current.add(rid);
    showPkResult({
      won: !!pk.won,
      my_direction: pk.my_direction,
      winner_side: pk.winner_side,
      opponent_name: pk.opponent_name,
      stake: pk.stake,
      won_amount: pk.won_amount,
      streak: pk.streak,
    });
  }, [showPkResult]);

  const maybeShowArenaResult = useCallback((lastSettled: ArenaRoundState | null | undefined) => {
    if (!lastSettled?.round_id) return;
    const rid = lastSettled.round_id;
    if (shownArenaRef.current.has(rid)) return;
    const my = lastSettled.my_entry;
    const specHits = (lastSettled.my_spectator_bets || []).some(b => (b.payout ?? 0) > 0);
    if (!my && !specHits) return;
    shownArenaRef.current.add(rid);
    showArenaResult({
      duration_label: lastSettled.duration_label,
      entries: lastSettled.entries || [],
      my_entry: my,
      my_spectator_bets: lastSettled.my_spectator_bets,
      first_podium: !!lastSettled.first_podium && !!my?.rank && my.rank <= 3,
    });
  }, [showArenaResult]);

  useEffect(() => {
    void syncTradingLive();
  }, [syncTradingLive]);

  useEffect(() => {
    if (!guessPollMeta) return;
    setLastGuess(guessPollMeta.last_settled ?? null);
    maybeShowGuessResult(guessPollMeta.last_settled, guessPollMeta.last_my_bet);
    maybeShowPkResult(guessPollMeta.last_pk_result);
  }, [guessPollMeta, maybeShowGuessResult, maybeShowPkResult]);

  useEffect(() => {
    if (!arenaPollMeta?.last_settled) return;
    maybeShowArenaResult(arenaPollMeta.last_settled);
  }, [arenaPollMeta, maybeShowArenaResult]);

  useEffect(() => {
    const cur = arena;
    if (!cur?.entries) return;
    cur.entries.forEach(e => {
      const prevLegs = prevArenaLegsRef.current[e.user_id] ?? 0;
      const nowLegs = e.legs_count ?? e.recent_legs?.length ?? 0;
      if (cur.status === 'running' && nowLegs > prevLegs) {
        prevArenaLegsRef.current[e.user_id] = nowLegs;
      } else if (!prevArenaLegsRef.current[e.user_id]) {
        prevArenaLegsRef.current[e.user_id] = nowLegs;
      }
    });
  }, [arena]);

  const refreshExtras = useCallback(async () => {
    if (tab === 'arena') {
      const [lb, wr] = await Promise.all([
        fetchArenaLeaderboard(8), fetchArenaWinRate(12),
      ]);
      if (lb.ok) setHighlights(lb.highlights ?? []);
      if (wr.ok) setWinRates(wr.entries ?? []);
    }
  }, [tab]);

  useEffect(() => {
    void refreshExtras();
    const id = setInterval(() => void refreshExtras(), 15000);
    return () => clearInterval(id);
  }, [refreshExtras]);

  const selectedEntry: ArenaEntry | null = useMemo(() => {
    if (!arena?.entries?.length) return null;
    if (selectedArenaEntryId) {
      return arena.entries.find(e => e.user_id === selectedArenaEntryId) ?? null;
    }
    return arena.my_entry ?? null;
  }, [arena, selectedArenaEntryId]);

  const betGuess = async (direction: 'up' | 'down') => {
    setBusy(true);
    try {
      const r = await placeGuessBet(direction, guessStake);
      if (!r.ok) {
        addMessage(r.error || '押注失败');
        return;
      }
      setGuessRound(r.current ?? null);
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      addMessage(`已押 ${direction === 'up' ? '涨' : '跌'} · ${guessStake} 积分`);
      void syncTradingLive();
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
      setArenaLive(r.current ?? null);
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      addMessage(r.message || '已报名短线大赛');
      void syncTradingLive();
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
      const r = await arenaSpectateBet(specPick, specStake, specRank);
      if (!r.ok) {
        addMessage(r.error || '押注失败');
        return;
      }
      setArenaLive(r.current ?? null);
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      addMessage(r.message || `已押 ${RANK_LABELS[specRank] || specRank} · ${specStake} 积分`);
      void syncTradingLive();
    } finally {
      setBusy(false);
    }
  };

  const shareArena = async () => {
    if (!arena) return;
    setShareBusy(true);
    try {
      const top = arena.entries[0];
      const text = `🏆 交易人生竞技 · ${arena.duration_label || '短线大赛'}\n`
        + `${arena.status === 'running' ? '进行中' : '报名中'} · 奖池 ${arena.prize_pool}\n`
        + (top ? `领跑：${top.agent_name} ${top.return_pct != null ? (top.return_pct >= 0 ? '+' : '') + top.return_pct + '%' : ''}\n` : '')
        + `来押冠/亚/季军！`;
      const r = await shareOrCopy({ title: '交易人生 · 交易竞技', text, url: appBaseUrl() });
      addMessage(shareResultMessage(r));
    } finally {
      setShareBusy(false);
    }
  };

  const pctChange = guess && guess.start_price
    ? ((Number(guess.end_price || guess.start_price) - Number(guess.start_price)) / Number(guess.start_price) * 100)
    : 0;
  const guessClock = guessClockFromRound(guess, clockNow);
  const guessTimer = guessClock.settling
    ? '结算中'
    : `${guessClock.bettingOpen ? guessClock.bettingSecondsLeft : guessClock.secondsLeft}s`;

  return (
    <div style={{ color: '#3d3530', fontSize: 13 }}>
      <div style={{
        padding: '10px 12px', marginBottom: 10, borderRadius: 10,
        background: 'linear-gradient(135deg,#fff3e0,#eef4ff)', border: '2px solid #ffb74d',
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#c65a00', marginBottom: 4 }}>🏆 交易竞技馆</div>
        <div style={{ fontSize: 11, color: '#7a6e62' }}>猜涨跌 · 短线大赛 · PK / 杠杆 / 阵营 / 逆袭</div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="ui-btn" style={{ flex: '1 1 30%', minWidth: 88, opacity: tab === 'guess' ? 1 : 0.55 }}
          onClick={() => setTab('guess')}>📊 猜涨跌</button>
        <button className="ui-btn" style={{ flex: '1 1 30%', minWidth: 88, opacity: tab === 'arena' ? 1 : 0.55 }}
          onClick={() => setTab('arena')}>🏆 短线大赛</button>
        <button className="ui-btn" style={{ flex: '1 1 30%', minWidth: 88, opacity: tab === 'modes' ? 1 : 0.55 }}
          onClick={() => setTab('modes')}>⚡ 进阶玩法</button>
      </div>

      <div style={{ fontSize: 11, color: '#8a7e72', marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>积分 {points.toLocaleString()}</span>
        {tab === 'arena' && (
          <button type="button" className="ui-btn" style={{ fontSize: 10, padding: '2px 8px' }}
            disabled={shareBusy} onClick={() => void shareArena()}>
            {shareBusy ? '…' : '分享邀请'}
          </button>
        )}
      </div>

      {(tradingLiveSyncing || tradingLiveError) && (
        <div style={{
          marginBottom: 10, padding: '8px 10px', borderRadius: 8, fontSize: 11,
          background: tradingLiveError ? '#fff8e8' : '#f5f5f5', color: '#6b5e4e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{tradingLiveError || '正在同步竞技数据…'}</span>
          <button type="button" className="ui-btn" style={{ fontSize: 10, padding: '2px 8px' }}
            disabled={tradingLiveSyncing} onClick={() => void syncTradingLive()}>
            刷新
          </button>
        </div>
      )}

      {tab === 'guess' && !guess && (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#9a8b7a' }}>
          {tradingLiveSyncing ? '加载猜涨跌…' : '暂无猜涨跌数据，请点刷新或稍候'}
        </div>
      )}

      {tab === 'guess' && guess && (
        <div style={{ padding: 12, background: '#faf6ef', borderRadius: 10, border: '1px solid #ebe4d8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700 }}>BTC 猜涨跌</span>
            <span style={{ fontFamily: 'monospace', color: '#3a6bb5' }}>{guessTimer}</span>
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
          ) : guessClock.bettingOpen ? (
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
            <p style={{ marginTop: 10, fontSize: 11, color: '#9a8b7a' }}>
              {guessClock.settling
                ? '结算中… 约数秒内开新局'
                : `封盘中… 等待 ${guessClock.secondsLeft}s 后结算`}
            </p>
          )}
          {lastGuess && (
            <p style={{ marginTop: 10, fontSize: 10, color: '#9a8b7a' }}>
              上局：{lastGuess.winner_side === 'up' ? '涨' : lastGuess.winner_side === 'down' ? '跌' : '平'}
              · ${Math.round(Number(lastGuess.start_price))} → ${Math.round(Number(lastGuess.end_price))}
            </p>
          )}
        </div>
      )}

      {tab === 'arena' && !arena && (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#9a8b7a' }}>
          {tradingLiveSyncing ? '加载短线大赛…' : '暂无大赛数据，后台约 20 秒内自动开局'}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="ui-btn" style={{ fontSize: 11 }}
              disabled={tradingLiveSyncing} onClick={() => void syncTradingLive()}>
              立即刷新
            </button>
          </div>
        </div>
      )}

      {tab === 'arena' && arena && (
        <>
          <div style={{ padding: 12, background: '#eef4ff', borderRadius: 10, border: '1px solid #b8cce8', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontWeight: 700 }}>Agent 短线大赛</span>
                <span style={{
                  marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  background: arena.duration_mode === 'speed' ? '#ffe082' : '#c8e6c9',
                }}>
                  {arena.duration_label || (arena.duration_mode === 'speed' ? '极速 60s' : '标准 3min')}
                </span>
              </div>
              <span style={{ fontSize: 11, color: '#3a6bb5' }}>
                {arena.status === 'join' ? `报名 ${arena.join_seconds_left}s` : arena.status === 'running' ? `进行中 ${arena.seconds_left}s` : '结算中'}
              </span>
            </div>
            <div style={{ fontSize: 11, marginTop: 6, color: '#6b5e4e' }}>
              报名 {arena.entry_fee} 积分 · 奖池 {arena.prize_pool} · 观众池 {arena.spectate_pool}
              {arena.leg_interval_sec ? ` · AI 每 ${arena.leg_interval_sec}s 换向操作` : ''}
            </div>
            {arena.can_join && !arena.my_entry && (
              <button className="ui-btn" style={{ width: '100%', marginTop: 10 }} disabled={busy || !joinAgentId}
                onClick={() => void doJoinArena()}>
                派 {agents[joinAgentId]?.data.name || '交易 Agent'} 参赛
              </button>
            )}
            {arena.my_entry && (
              <div style={{ marginTop: 8, fontSize: 11, padding: 8, background: '#fff', borderRadius: 6 }}>
                已报名 · {arena.my_entry.signal_summary || `${arena.my_entry.direction} · ${arena.my_entry.leverage}x`}
                {(arena.my_entry.legs_count ?? 0) > 0 ? ` · ${arena.my_entry.legs_count} 轮操作` : ''}
                {arena.my_entry.rank ? ` · 第 ${arena.my_entry.rank} 名 ${arena.my_entry.return_pct != null && arena.my_entry.return_pct >= 0 ? '+' : ''}${arena.my_entry.return_pct}%` : ''}
                {arena.my_entry.prize ? ` · 奖金 +${arena.my_entry.prize}` : ''}
              </div>
            )}
          </div>

          {selectedEntry && (
            <LogicDrawer
              entry={selectedEntry}
              onClose={() => setSelectedArenaEntryId(null)}
            />
          )}

          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>选手榜 · 点击看交易逻辑</div>
          {arena.entries.map(e => (
            <div key={e.user_id} role="button" tabIndex={0}
              onClick={() => setSelectedArenaEntryId(e.user_id)}
              onKeyDown={ev => { if (ev.key === 'Enter') setSelectedArenaEntryId(e.user_id); }}
              style={{
                padding: '6px 8px', marginBottom: 4, borderRadius: 6, fontSize: 11, cursor: 'pointer',
                background: selectedArenaEntryId === e.user_id ? '#e8f0ff' : e.rank === 1 ? '#fff8e8' : '#faf6ef',
                border: selectedArenaEntryId === e.user_id ? '1px solid #4a90c8' : '1px solid transparent',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  {e.rank ? `${e.rank}. ` : '· '}{e.agent_name}{e.is_npc ? ' 🤖' : ''}
                  <span style={{ color: '#9a8b7a' }}> · {e.direction} {e.leverage}x</span>
                  {(e.legs_count ?? 0) > 0 && <span style={{ color: '#9a8b7a' }}> · {e.legs_count}轮</span>}
                </span>
                <span style={{ color: (e.return_pct ?? 0) >= 0 ? '#2ea872' : '#c07070', fontWeight: 600 }}>
                  {e.return_pct != null && e.return_pct !== 0
                    ? `${e.return_pct >= 0 ? '+' : ''}${e.return_pct}%`
                    : e.signal_summary || e.strategy_preset}
                </span>
              </div>
              {e.recent_legs && e.recent_legs.length > 0 && arena.status === 'running' && (
                <div style={{ fontSize: 9, color: '#9a8b7a', marginTop: 3 }}>
                  近轮：{e.recent_legs.slice(0, 3).map(l =>
                    `${l.direction} ${l.return_pct >= 0 ? '+' : ''}${l.return_pct}%`,
                  ).join(' · ')}
                </div>
              )}
            </div>
          ))}

          {arena.can_spectate_bet && arena.entries.length > 0 && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff8e8', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>观众押注 · 冠 / 亚 / 季军</div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {[1, 2, 3].map(r => (
                  <button key={r} type="button" className="ui-btn" style={{
                    flex: 1, fontSize: 10, opacity: specRank === r ? 1 : 0.5,
                    background: specRank === r ? '#ffe082' : undefined,
                  }} onClick={() => setSpecRank(r)}>
                    {RANK_LABELS[r]}
                  </button>
                ))}
              </div>
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
                押 {specStake} 积分 · 猜 {RANK_LABELS[specRank]} 分观众池
              </button>
            </div>
          )}

          {arena.my_spectator_bets && arena.my_spectator_bets.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: '#8a7e72' }}>
              我的押注：{arena.my_spectator_bets.map(b =>
                `${RANK_LABELS[b.pick_rank || 1] || b.pick_rank} ${b.stake}${b.payout ? `→+${b.payout}` : ''}`,
              ).join(' · ')}
            </div>
          )}

          {winRates.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, margin: '14px 0 6px' }}>📈 竞技胜率榜</div>
              {winRates.slice(0, 6).map(w => (
                <div key={w.user_id} style={{
                  fontSize: 10, padding: '4px 0', display: 'flex', justifyContent: 'space-between',
                  borderBottom: '1px dashed #eee8dc',
                }}>
                  <span>{w.rank}. {w.display_name}</span>
                  <span style={{ fontWeight: 600, color: '#3a6bb5' }}>{w.win_rate}% ({w.wins}/{w.entries})</span>
                </div>
              ))}
            </>
          )}

          {highlights.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, margin: '14px 0 6px' }}>近期三甲</div>
              {highlights.slice(0, 5).map((h, i) => (
                <div key={i} style={{ fontSize: 10, color: '#8a7e72', padding: '2px 0' }}>
                  {h.rank}. {String(h.display_name)} {Number(h.return_pct) >= 0 ? '+' : ''}{h.return_pct}%
                  {h.legs_count ? ` · ${h.legs_count}轮` : ''}
                  {h.prize ? ` +${h.prize}` : ''}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {tab === 'modes' && <TradingModesPanel />}
    </div>
  );
}
