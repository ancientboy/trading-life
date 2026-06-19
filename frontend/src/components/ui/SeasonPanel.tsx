import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
  fetchSeasonLeaderboard, buySeasonCosmetic,
  listSeatAuctions, bidSeat, fetchDispatchQueue, processDispatchQueue,
  type LeaderboardEntry, type SeasonCosmetic, type SeatAuction,
} from '../../lib/lifeEngagementApi';
import { buildLeaderboardLink, shareOrCopy, shareResultMessage, buildWeeklyReportLink, buildWeeklyReportShareText, downloadWeeklyReportCard } from '../../lib/shareUtils';
import { fetchWeeklyReport, type WeeklyReportData } from '../../lib/lifeEngagementApi';

export function SeasonPanel() {
  const points = useGameStore(s => s.points);
  const season = useGameStore(s => s.season);
  const seasonScore = useGameStore(s => s.seasonScore);
  const seasonCosmetics = useGameStore(s => s.seasonCosmetics);
  const syncEngagement = useGameStore(s => s.syncEngagement);
  const addMessage = useGameStore(s => s.addMessage);
  const flyToZone = useGameStore(s => s.flyToZone);

  const [tab, setTab] = useState<'rank' | 'season' | 'pvp' | 'auction'>(() => {
    const saved = sessionStorage.getItem('tl_season_initial_tab');
    sessionStorage.removeItem('tl_season_initial_tab');
    if (saved === 'rank' || saved === 'season' || saved === 'pvp' || saved === 'auction') return saved;
    return 'rank';
  });
  const [metric, setMetric] = useState('points');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [auctions, setAuctions] = useState<SeatAuction[]>([]);
  const [queueLen, setQueueLen] = useState(0);
  const [bidSeatId, setBidSeatId] = useState('poker_s1');
  const [bidAmount, setBidAmount] = useState(20);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportData | null>(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);

  useEffect(() => { syncEngagement(); }, [syncEngagement]);

  useEffect(() => {
    fetchWeeklyReport().then(r => { if (r.ok && r.report) setWeeklyReport(r.report); });
  }, [tab]);

  useEffect(() => {
    fetchSeasonLeaderboard(metric).then(r => { if (r.ok) setEntries(r.entries); });
    listSeatAuctions().then(r => { if (r.ok) setAuctions(r.auctions); });
    fetchDispatchQueue().then(r => { if (r.ok) setQueueLen(r.queue.length); });
  }, [metric, tab]);

  const daysLeft = season ? Math.max(0, Math.ceil((season.ends_at - Date.now()) / 86400000)) : 0;
  const metricLabel: Record<string, string> = { points: '积分', social: '社交', pvp: 'PvP', pnl: 'PnL' };
  const tabLabel: Record<string, string> = { rank: '排行榜', season: '赛季', pvp: '德州说明', auction: '座位拍卖' };

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

      {weeklyReport && (
        <div style={{ padding: 12, background: 'linear-gradient(135deg,#eef4ff,#faf6ef)', borderRadius: 10, marginBottom: 12, border: '1px solid #7aa8e8', fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: '#3a6bb5', marginBottom: 6 }}>📊 本周战报 · {weeklyReport.week_label}</div>
          <div style={{ lineHeight: 1.55, color: '#5a4a3a', marginBottom: 10 }}>
            🃏 {weeklyReport.poker_games} 局 · {weeklyReport.poker_wins} 胜 · 净 {weeklyReport.points_net >= 0 ? '+' : ''}{weeklyReport.points_net}<br />
            ✨ 最佳 {weeklyReport.best_hand_name}
            {weeklyReport.season_rank_hint ? ` · 约第 ${weeklyReport.season_rank_hint} 名` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="ui-btn" style={{ flex: 1, fontSize: 11 }} disabled={weeklyBusy}
              onClick={async () => {
                setWeeklyBusy(true);
                try {
                  const r = await shareOrCopy({
                    title: '交易人生本周战报',
                    text: buildWeeklyReportShareText(weeklyReport),
                    url: buildWeeklyReportLink(),
                  });
                  addMessage(shareResultMessage(r));
                } finally { setWeeklyBusy(false); }
              }}>
              分享战报
            </button>
            <button type="button" className="ui-btn" style={{ flex: 1, fontSize: 11 }} disabled={weeklyBusy}
              onClick={async () => {
                setWeeklyBusy(true);
                try {
                  await downloadWeeklyReportCard(weeklyReport, buildWeeklyReportLink());
                  addMessage('战报海报已保存');
                } catch { addMessage('生成海报失败'); }
                finally { setWeeklyBusy(false); }
              }}>
              海报
            </button>
          </div>
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
          <button type="button" className="ui-btn" style={{ width: '100%', marginTop: 10 }}
            onClick={async () => {
              const r = await shareOrCopy({
                title: '交易人生赛季榜',
                text: `🏆 ${season?.name || '赛季'}排行榜 · ${metricLabel[metric]}`,
                url: buildLeaderboardLink(),
              });
              addMessage(shareResultMessage(r));
            }}>
            分享排行榜
          </button>
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
          <div style={{ fontSize: 12, lineHeight: 1.6, padding: '10px 12px', background: '#fff8e8', borderRadius: 8, marginBottom: 10 }}>
            <b>德州扑克房间已移至德州区</b><br />
            请前往左侧「德州」分区，在牌桌旁面板中：<br />
            · 创建房间（获得 5 位数字编号）<br />
            · 输入编号加入好友房间<br />
            · 入座后在牌桌看到所有玩家<br />
            · 点「开始牌局」才扣买入积分
          </div>
          <button className="ui-btn" style={{ width: '100%' }} onClick={() => flyToZone('casino')}>
            前往德州区
          </button>
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
