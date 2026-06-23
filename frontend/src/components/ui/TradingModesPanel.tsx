import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { dedupeAsync } from '../../lib/pollGuard';
import {
  fetchTradingModes, placeLeverageBet, placePkBet, joinFaction,
  fetchComebackStatus, placeComebackBet, fetchPkStreakBoard, fetchGuessRoundFresh,
  type TradingModesState,
} from '../../lib/lifeEngagementApi';
import { guessPhaseLabel } from '../../lib/guessDisplay';
import { PersonalityCard } from './PersonalityCard';

type ModeTab = 'leverage' | 'pk' | 'faction' | 'comeback';

const EMPTY_FACTION = {
  day_key: '',
  bull: { net_pnl: 0, contrib: 0, members: 0, lead_pct: 0 },
  bear: { net_pnl: 0, contrib: 0, members: 0, lead_pct: 0 },
  leading: 'bull' as const,
  settle_hour: 22,
};

export function TradingModesPanel() {
  const addMessage = useGameStore(s => s.addMessage);
  const points = useGameStore(s => s.points);
  const triggerTradingReaction = useGameStore(s => s.triggerTradingReaction);
  const flyToZone = useGameStore(s => s.flyToZone);
  const setRightTab = useGameStore(s => s.setRightTab);
  const guess = useGameStore(s => s.guessRound);
  const arenaLive = useGameStore(s => s.arenaLive);
  const setGuessRound = useGameStore(s => s.setGuessRound);

  const [tab, setTab] = useState<ModeTab>('pk');
  const [modes, setModes] = useState<TradingModesState | null>(null);
  const [pkStake, setPkStake] = useState(50);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [streakBoard, setStreakBoard] = useState<Array<{ display_name: string; wins: number; rank: number }>>([]);

  const toast = (msg: string) => {
    setFlash(msg);
    addMessage(msg);
    setTimeout(() => setFlash(null), 2400);
  };

  const refresh = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    setLoading(true);
    setLoadError(null);
    try {
      const [m, sb] = await Promise.all([
        dedupeAsync('trading-modes', () => fetchTradingModes()),
        dedupeAsync('pk-streak', () => fetchPkStreakBoard()),
      ]);
      if (m.ok) setModes(m);
      else setLoadError(m.error || '玩法数据加载失败');
      if (sb.ok) setStreakBoard(sb.entries ?? []);
    } catch {
      setLoadError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 12000);
    return () => clearInterval(id);
  }, [refresh]);

  const pl = modes?.pending_leverage;
  const fs = modes?.faction_status ?? EMPTY_FACTION;
  const cb = modes?.comeback;
  const guessOpen = !!guess?.betting_open;
  const guessNeedsBet = tab === 'pk' || tab === 'leverage' || tab === 'comeback';

  const ensureGuessOpen = async (): Promise<boolean> => {
    try {
      const gr = await fetchGuessRoundFresh();
      if (gr.ok && gr.current) {
        setGuessRound(gr.current);
        if (gr.current.betting_open) return true;
      }
    } catch { /* fall through */ }
    toast('当前猜涨跌局已封盘，请等待下一局（约 60s 一轮）');
    return false;
  };

  const doLeverage = async (direction: 'up' | 'down', leverage: number) => {
    if (!pl) { toast('需先赢得一局普通猜涨跌，解锁利润后再杠杆'); return; }
    if (!await ensureGuessOpen()) return;
    setBusy(true);
    try {
      const r = await placeLeverageBet(direction, leverage, pl.source_round_id || '');
      if (!r.ok) { toast(r.error || '杠杆押注失败'); return; }
      if (r.modes) setModes(r.modes);
      toast(r.message || `杠杆 ${leverage}x 已押`);
      triggerTradingReaction('leverage', leverage);
      flyToZone('arena');
    } catch { toast('网络错误'); } finally { setBusy(false); }
  };

  const doPk = async (direction: 'up' | 'down') => {
    if (!await ensureGuessOpen()) return;
    if (pkStake > points) { toast(`积分不足，需要 ${pkStake} 积分`); return; }
    setBusy(true);
    try {
      const r = await placePkBet(direction, pkStake, true);
      if (!r.ok) { toast(r.error || 'PK 失败'); return; }
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      if (r.modes) setModes(r.modes);
      toast(r.message || 'PK 已开局 · 等待本局猜涨跌结算');
      triggerTradingReaction('pk');
      flyToZone('arena');
      setRightTab('events');
    } catch { toast('网络错误'); } finally { setBusy(false); }
  };

  const doFaction = async (faction: 'bull' | 'bear') => {
    setBusy(true);
    try {
      const r = await joinFaction(faction);
      if (!r.ok) { toast(r.error || '加入阵营失败'); return; }
      if (r.modes) setModes(r.modes);
      toast(`已加入${faction === 'bull' ? '多头' : '空头'}阵营 · 猜涨跌自动计入阵营净值`);
    } catch { toast('网络错误'); } finally { setBusy(false); }
  };

  const doComeback = async (direction: 'up' | 'down') => {
    if (!await ensureGuessOpen()) return;
    setBusy(true);
    try {
      const r = await placeComebackBet(direction);
      if (!r.ok) { toast(r.error || '逆袭押注失败'); return; }
      if (r.modes) setModes(r.modes);
      toast(r.message || '逆袭局已押');
    } catch { toast('网络错误'); } finally { setBusy(false); }
  };

  const checkComeback = async () => {
    setBusy(true);
    try {
      const r = await fetchComebackStatus();
      if (r.modes) setModes(r.modes);
      if (r.triggered) toast('逆袭副本已开启！');
      else toast('暂未触发逆袭条件（当日净亏需达阈值）');
    } catch { toast('网络错误'); } finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 12, position: 'relative', zIndex: 2 }}>
      {flash && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 5, marginBottom: 8, padding: '8px 10px',
          borderRadius: 8, background: '#e8f5e9', border: '1px solid #66bb6a',
          fontSize: 11, color: '#2e7d32', fontWeight: 600,
        }}>{flash}</div>
      )}

      {loading && !modes && (
        <div style={{ fontSize: 11, color: '#9a8b7a', marginBottom: 8 }}>加载四大玩法…</div>
      )}
      {loadError && (
        <div style={{ marginBottom: 8, padding: 8, background: '#fff8e8', borderRadius: 8, fontSize: 11 }}>
          {loadError}
          <button type="button" className="ui-btn" style={{ marginLeft: 8, fontSize: 10 }}
            onClick={() => void refresh()}>重试</button>
        </div>
      )}

      {guess && (
        <div style={{
          marginBottom: 10, padding: '6px 10px', borderRadius: 8, fontSize: 10,
          background: guessOpen ? '#eef8f0' : '#faf6ef', color: '#6b5e4e',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{guessPhaseLabel(guess)}</span>
          <span>BTC ${Math.round(Number(guess.start_price || 0)).toLocaleString()}</span>
        </div>
      )}

      <PersonalityCard personality={modes?.personality} />

      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {([
          ['leverage', '🎰 杠杆'],
          ['pk', '⚔️ PK'],
          ['faction', '🛡 阵营'],
          ['comeback', '🔄 逆袭'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={`ui-btn${tab === id ? ' active' : ''}`} style={{
            flex: '1 1 45%', fontSize: 10,
          }} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'leverage' && (
        <div style={{ padding: 10, background: '#fff8e8', borderRadius: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>杠杆翻倍 · 用利润博下一根 K 线</div>
          {pl ? (
            <div style={{ marginBottom: 8, color: '#2e7d32' }}>
              可用利润 <b>{pl.profit}</b> 积分 · 剩余 {modes?.leverage_uses_left ?? 0} 次
            </div>
          ) : (
            <div style={{ marginBottom: 8, color: '#c65a00' }}>
              先在上方「猜涨跌」赢一局，结算后 120 秒内可杠杆出击
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[2, 5, 10].map(lev => (
              <button key={lev} type="button" className="ui-btn" style={{ flex: 1, fontSize: 10 }}
                disabled={busy || !guessOpen}
                onClick={() => void (pl ? doLeverage('up', lev) : toast('需先赢得一局猜涨跌'))}>
                {lev}x 涨
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[2, 5, 10].map(lev => (
              <button key={lev} type="button" className="ui-btn" style={{ flex: 1, fontSize: 10, background: '#ffefef' }}
                disabled={busy || !guessOpen}
                onClick={() => void (pl ? doLeverage('down', lev) : toast('需先赢得一局猜涨跌'))}>
                {lev}x 跌
              </button>
            ))}
          </div>
          <p style={{ fontSize: 9, color: '#9a8b7a', marginTop: 8 }}>赢则利润×杠杆；输则清空本局利润</p>
        </div>
      )}

      {tab === 'pk' && (
        <div style={{ padding: 10, background: '#eef4ff', borderRadius: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>1v1 对冲 PK · 反向零和</div>
          <div style={{ marginBottom: 6 }}>连胜 {modes?.pk_streak ?? 0} · 最佳 {modes?.pk_best_streak ?? 0}</div>
          <input type="range" min={20} max={300} step={10} value={pkStake}
            onChange={e => setPkStake(Number(e.target.value))} style={{ width: '100%' }} />
          <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 8 }}>押注 {pkStake} · 积分 {points}</div>
          {!guessOpen && guessNeedsBet && (
            <p style={{ fontSize: 9, color: '#c65a00', marginBottom: 8 }}>
              猜涨跌封盘中 · {guess.seconds_left}s 后结算 · 押注/PK 暂不可用
              {arenaLive?.can_join ? ' · 大赛报名仍开放' : ''}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ui-btn" style={{ flex: 1 }} disabled={busy || !guessOpen}
              onClick={() => void doPk('up')}>📈 押涨 PK</button>
            <button type="button" className="ui-btn" style={{ flex: 1, background: '#ffefef' }} disabled={busy || !guessOpen}
              onClick={() => void doPk('down')}>📉 押跌 PK</button>
          </div>
          {streakBoard.length > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: '10px 0 4px' }}>本周 PK 胜场</div>
              {streakBoard.slice(0, 5).map(e => (
                <div key={e.rank} style={{ fontSize: 10, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{e.rank}. {e.display_name}</span>
                  <span>{e.wins} 胜</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'faction' && (
        <div style={{ padding: 10, background: '#f0fff4', borderRadius: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>多 / 空阵营团战 · 每日 {fs.settle_hour}:00 分红</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, padding: 8, background: '#e8f5e9', borderRadius: 6, textAlign: 'center' }}>
              🐂 多头<br />{fs.bull.members} 人 · 净值 {fs.bull.net_pnl >= 0 ? '+' : ''}{fs.bull.net_pnl}
            </div>
            <div style={{ flex: 1, padding: 8, background: '#ffebee', borderRadius: 6, textAlign: 'center' }}>
              🐻 空头<br />{fs.bear.members} 人 · 净值 {fs.bear.net_pnl >= 0 ? '+' : ''}{fs.bear.net_pnl}
            </div>
          </div>
          <div style={{ fontSize: 10, marginBottom: 8, color: '#6b5e4e' }}>
            当前领先：<b>{fs.leading === 'bull' ? '多头' : '空头'}</b>
            {modes?.faction && ` · 你已加入${modes.faction === 'bull' ? '多头' : '空头'}`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ui-btn" style={{ flex: 1, background: '#e8f5e9' }} disabled={busy}
              onClick={() => void doFaction('bull')}>加入多头</button>
            <button type="button" className="ui-btn" style={{ flex: 1, background: '#ffebee' }} disabled={busy}
              onClick={() => void doFaction('bear')}>加入空头</button>
          </div>
        </div>
      )}

      {tab === 'comeback' && (
        <div style={{ padding: 10, background: '#f3e5f5', borderRadius: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>爆仓逆袭副本 · 2x 低倍安全局</div>
          {cb?.active ? (
            <>
              <div style={{ marginBottom: 8 }}>
                逆袭金 <b>{cb.balance ?? cb.seed ?? 100}</b> · 剩余 {cb.rounds_left ?? 0} 局
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ui-btn" style={{ flex: 1 }} disabled={busy || (cb.rounds_left ?? 0) <= 0 || !guessOpen}
                  onClick={() => void doComeback('up')}>📈 2x 押涨</button>
                <button type="button" className="ui-btn" style={{ flex: 1, background: '#ffefef' }} disabled={busy || (cb.rounds_left ?? 0) <= 0 || !guessOpen}
                  onClick={() => void doComeback('down')}>📉 2x 押跌</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ color: '#9a8b7a', marginBottom: 8 }}>当日净亏达阈值后自动开启免费逆袭通道</p>
              <button type="button" className="ui-btn" style={{ width: '100%' }} disabled={busy}
                onClick={() => void checkComeback()}>
                检查逆袭资格
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
