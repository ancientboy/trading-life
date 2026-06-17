import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
  fetchSeasonLeaderboard, buySeasonCosmetic,
  listPokerRooms, createPokerRoom, joinPokerRoom, playPokerRound,
  pokerSolo, pokerQuickJoin,
  listSeatAuctions, bidSeat, fetchDispatchQueue, processDispatchQueue,
  type LeaderboardEntry, type SeasonCosmetic, type PokerRoom, type SeatAuction,
} from '../../lib/lifeEngagementApi';

export function SeasonPanel() {
  const points = useGameStore(s => s.points);
  const season = useGameStore(s => s.season);
  const seasonScore = useGameStore(s => s.seasonScore);
  const seasonCosmetics = useGameStore(s => s.seasonCosmetics);
  const syncEngagement = useGameStore(s => s.syncEngagement);
  const addMessage = useGameStore(s => s.addMessage);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const agents = useGameStore(s => s.agents);

  const [tab, setTab] = useState<'rank' | 'season' | 'pvp' | 'auction'>('rank');
  const [metric, setMetric] = useState('points');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [rooms, setRooms] = useState<PokerRoom[]>([]);
  const [auctions, setAuctions] = useState<SeatAuction[]>([]);
  const [queueLen, setQueueLen] = useState(0);
  const [bidSeatId, setBidSeatId] = useState('poker_s1');
  const [bidAmount, setBidAmount] = useState(20);
  const [lastPokerResults, setLastPokerResults] = useState<
    Array<{ name: string; score: number; rank: number; won: number; is_npc?: boolean }>
  >([]);

  const selectedAgent = () => selectedAgentId || Object.keys(agents)[0] || '';

  const showPokerResults = (results?: Array<{ name: string; score: number; rank: number; won: number; is_npc?: boolean }>, won?: number) => {
    if (!results?.length) return;
    setLastPokerResults(results);
    const me = results.find(r => !r.is_npc);
    const summary = me
      ? `第 ${me.rank} 名 · 得分 ${me.score}${won ? ` · 赢得 ${won}` : ''}`
      : '开牌完成';
    addMessage(summary);
    if (won) syncEngagement();
  };

  useEffect(() => { syncEngagement(); }, [syncEngagement]);

  useEffect(() => {
    fetchSeasonLeaderboard(metric).then(r => { if (r.ok) setEntries(r.entries); });
    listPokerRooms().then(r => { if (r.ok) setRooms(r.rooms); });
    listSeatAuctions().then(r => { if (r.ok) setAuctions(r.auctions); });
    fetchDispatchQueue().then(r => { if (r.ok) setQueueLen(r.queue.length); });
  }, [metric, tab]);

  const daysLeft = season ? Math.max(0, Math.ceil((season.ends_at - Date.now()) / 86400000)) : 0;
  const metricLabel: Record<string, string> = { points: '积分', social: '社交', pvp: 'PvP', pnl: 'PnL' };
  const tabLabel: Record<string, string> = { rank: '排行榜', season: '赛季', pvp: '德州局', auction: '座位拍卖' };

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['rank', 'season', 'pvp', 'auction'] as const).map(t => (
          <button key={t} className={`panel-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {season && (
        <div style={{ padding: 10, background: '#faf6ef', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          <div style={{ fontWeight: 700 }}>{season.name}</div>
          <div style={{ color: '#8a7e72' }}>剩余 {daysLeft} 天 · 当前积分 {points}</div>
          {seasonScore && (
            <div style={{ marginTop: 4, fontSize: 11 }}>
              赛季分 {seasonScore.points_earned} · 社交 {seasonScore.social_score} · PvP胜 {seasonScore.pvp_wins}
            </div>
          )}
        </div>
      )}

      {tab === 'rank' && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {['points', 'social', 'pvp', 'pnl'].map(m => (
              <button key={m} className="ui-btn" style={{ fontSize: 10, opacity: metric === m ? 1 : 0.55 }} onClick={() => setMetric(m)}>
                {metricLabel[m]}
              </button>
            ))}
          </div>
          {entries.map(e => (
            <div key={e.user_id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px dashed #eee8dc', fontSize: 12 }}>
              <span style={{ width: 24, color: e.rank <= 3 ? '#d4af37' : '#999' }}>{e.rank}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{e.name}</span>
              <span className="gold">{Math.round(e.points_earned || e.social_score || e.pvp_wins || e.pnl_score)}</span>
            </div>
          ))}
        </>
      )}

      {tab === 'season' && seasonCosmetics.map((item: SeasonCosmetic) => (
        <button key={item.item_id} className="leisure-option" onClick={async () => {
          const r = await buySeasonCosmetic(item.item_id);
          if (r.ok) {
            addMessage(`已解锁 ${item.label}`);
            if (r.balance != null) useGameStore.setState({ points: r.balance });
            syncEngagement();
          } else addMessage(r.error || '购买失败');
        }}>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontWeight: 600 }}>{item.label}</div>
            <div style={{ fontSize: 10, color: '#8a7e72' }}>{item.item_type}</div>
          </div>
          <span style={{ color: '#d4af37' }}>{item.cost} 积分</span>
        </button>
      ))}

      {tab === 'pvp' && (
        <>
          <div style={{ fontSize: 11, color: '#8a7e72', marginBottom: 8, lineHeight: 1.5 }}>
            多人：手动建房/加入，满员后开牌。快速加入优先匹配公开房，无人则自动与 NPC 对战。
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className="ui-btn" style={{ flex: 1 }} onClick={async () => {
              const aid = selectedAgent();
              if (!aid) { addMessage('请先选择 Agent'); return; }
              const r = await pokerQuickJoin(aid, 30);
              if (!r.ok) { addMessage(r.error || '快速加入失败'); return; }
              if (r.mode === 'waiting') addMessage(r.message || '已加入房间，等待其他玩家…');
              else if (r.mode === 'solo_npc') addMessage('无人房间，已自动与 NPC 开牌');
              else if (r.mode === 'quick_match') addMessage('匹配成功，已开牌');
              if (r.balance != null) useGameStore.setState({ points: r.balance });
              showPokerResults(r.results, r.won);
              listPokerRooms().then(x => { if (x.ok) setRooms(x.rooms); });
            }}>快速加入（30 积分）</button>
            <button className="ui-btn" style={{ flex: 1 }} onClick={async () => {
              const aid = selectedAgent();
              if (!aid) { addMessage('请先选择 Agent'); return; }
              const r = await pokerSolo(aid, 30);
              if (!r.ok) { addMessage(r.error || '单人模式失败'); return; }
              if (r.balance != null) useGameStore.setState({ points: r.balance });
              addMessage('单人 vs NPC 已开牌（荷官 Jack + Lily + Gaga）');
              showPokerResults(r.results, r.won);
              listPokerRooms().then(x => { if (x.ok) setRooms(x.rooms); });
            }}>单人 vs NPC</button>
          </div>
          <button className="ui-btn" style={{ width: '100%', marginBottom: 8 }} onClick={async () => {
            const r = await createPokerRoom(30);
            if (r.ok) { addMessage(`牌局 ${r.room_id} 已创建`); listPokerRooms().then(x => { if (x.ok) setRooms(x.rooms); }); }
          }}>创建德州房间（30 积分）</button>
          {lastPokerResults.length > 0 && (
            <div style={{ padding: 8, background: '#faf6ef', borderRadius: 8, marginBottom: 8, fontSize: 11 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>上次开牌</div>
              {lastPokerResults.map(r => (
                <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{r.rank}. {r.name}{r.is_npc ? ' 🤖' : ''}</span>
                  <span>{r.score} 分{r.won ? ` · +${r.won}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          {rooms.map(room => (
            <div key={room.id} className="leisure-option" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{room.id.slice(-8)}</b>
                <span style={{ fontSize: 11 }}>{room.status} · 池 {room.pot}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="ui-btn" style={{ flex: 1, fontSize: 11 }} disabled={room.status !== 'waiting'}
                  onClick={async () => {
                    const aid = selectedAgent();
                    if (!aid) return;
                    const r = await joinPokerRoom(room.id, aid);
                    if (r.ok) addMessage('已加入牌局');
                    else addMessage(r.error || '失败');
                    if (r.balance != null) useGameStore.setState({ points: r.balance });
                    listPokerRooms().then(x => { if (x.ok) setRooms(x.rooms); });
                  }}>加入</button>
                <button className="ui-btn" style={{ flex: 1, fontSize: 11 }} disabled={room.status !== 'playing'}
                  onClick={async () => {
                    const r = await playPokerRound(room.id);
                    if (r.ok) {
                      if (r.balance != null) useGameStore.setState({ points: r.balance });
                      showPokerResults(r.results, r.won);
                    } else addMessage(r.error || '开牌失败');
                    listPokerRooms().then(x => { if (x.ok) setRooms(x.rooms); });
                  }}>开牌</button>
              </div>
            </div>
          ))}
          {queueLen > 0 && (
            <button className="ui-btn" style={{ width: '100%', marginTop: 8 }} onClick={async () => {
              const r = await processDispatchQueue();
              if (r.processed?.length) addMessage(`已处理 ${r.processed.length} 条队列派遣`);
            }}>派遣队列（{queueLen}）</button>
          )}
        </>
      )}

      {tab === 'auction' && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={bidSeatId} onChange={e => setBidSeatId(e.target.value)} style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #d4c8b8' }} />
            <input type="number" value={bidAmount} onChange={e => setBidAmount(+e.target.value)} style={{ width: 64, padding: 6, borderRadius: 6, border: '1px solid #d4c8b8' }} />
            <button className="ui-btn" onClick={async () => {
              const r = await bidSeat(bidSeatId, bidAmount);
              if (r.ok) addMessage(`出价 ${r.bid}`);
              else addMessage(r.error || '失败');
              listSeatAuctions().then(x => { if (x.ok) setAuctions(x.auctions); });
            }}>出价</button>
          </div>
          {auctions.map(a => (
            <div key={a.seat_id} style={{ fontSize: 11, padding: '4px 0' }}>{a.seat_id} · {a.high_bid} 积分</div>
          ))}
        </>
      )}
    </div>
  );
}
