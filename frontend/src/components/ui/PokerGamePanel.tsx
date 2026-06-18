import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { PenguinAvatar } from './PenguinAvatar';
import { PokerDealingCards } from './PokerDealingCards';
import {
  pokerSolo, pokerQuickJoin, createPokerRoom, joinPokerRoomByCode, joinPokerRoom,
  startPokerRoom, listPokerRooms, startAiSpectator, type PokerRoom,
} from '../../lib/lifeEngagementApi';
import { PokerAdvancedSpectator } from './PokerAdvancedSpectator';
import { PokerStyleEditor } from './PokerStyleEditor';
import { isLoggedIn, getStoredAccount } from '../../lib/lifeAuth';

const POKER_SEAT_NUMS = [1, 2, 3, 4, 5, 6, 7] as const;

const BUY_IN_TIERS = [
  { id: 'casual', buyIn: 30, label: '休闲局', desc: '底注 30 · 适合新手' },
  { id: 'standard', buyIn: 80, label: '标准局', desc: '底注 80 · 奖金更高' },
  { id: 'high', buyIn: 200, label: '高手局', desc: '底注 200 · 高风险高回报' },
] as const;

const ADVANCED_BUY_IN_TIERS = [
  { id: 'adv1k', buyIn: 1000, label: '入门桌', desc: '起始筹码 1000 · 完整博弈' },
  { id: 'adv5k', buyIn: 5000, label: '标准桌', desc: '起始筹码 5000 · 标准盲注' },
  { id: 'adv10k', buyIn: 10000, label: '高额桌', desc: '起始筹码 10000 · 高额对局' },
] as const;

const MIN_DEAL_MS = 1600;
const HARD_TIMEOUT_MS = 25000;

type PokerGamePanelProps = {
  showSitButton?: boolean;
  compact?: boolean;
};

export function PokerGamePanel({ showSitButton = true, compact = false }: PokerGamePanelProps) {
  const points = useGameStore(s => s.points);
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const canOperateAgent = useGameStore(s => s.canOperateAgent);
  const sendAgentToFacility = useGameStore(s => s.sendAgentToFacility);
  const addMessage = useGameStore(s => s.addMessage);
  const showPokerResult = useGameStore(s => s.showPokerResult);
  const setNpcBubble = useGameStore(s => s.setNpcBubble);
  const setPokerTableDealingUntil = useGameStore(s => s.setPokerTableDealingUntil);
  const pokerRoom = useGameStore(s => s.pokerRoom);
  const applyPokerRoom = useGameStore(s => s.applyPokerRoom);
  const clearPokerRoom = useGameStore(s => s.clearPokerRoom);
  const leavePokerRoom = useGameStore(s => s.leavePokerRoom);
  const changePokerRoomSeat = useGameStore(s => s.changePokerRoomSeat);
  const seatAgentAtPoker = useGameStore(s => s.seatAgentAtPoker);
  const syncPokerRoom = useGameStore(s => s.syncPokerRoom);
  const restorePokerRoom = useGameStore(s => s.restorePokerRoom);
  const activeZone = useGameStore(s => s.activeZone);

  const [tierId, setTierId] = useState<string>('casual');
  const [advTierId, setAdvTierId] = useState<string>('adv1k');
  const [modeTab, setModeTab] = useState<'classic' | 'advanced'>('classic');
  const [spectateRoom, setSpectateRoom] = useState<{ id: string; buyIn: number } | null>(null);
  const [numAiPlayers, setNumAiPlayers] = useState(4);
  const [phase, setPhase] = useState<'idle' | 'dealing'>('idle');
  const [busy, setBusy] = useState<'sit' | 'quick' | 'create' | 'join' | 'start' | 'seat' | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [publicRooms, setPublicRooms] = useState<PokerRoom[]>([]);

  const refreshPublicRooms = useCallback(() => {
    listPokerRooms().then(r => { if (r.ok) setPublicRooms(r.rooms); });
  }, []);

  const inRoom = pokerRoom?.status === 'waiting';

  useEffect(() => {
    if (inRoom) return;
    refreshPublicRooms();
    const timer = setInterval(refreshPublicRooms, 5000);
    return () => clearInterval(timer);
  }, [inRoom, refreshPublicRooms]);

  useEffect(() => {
    if (activeZone === 'casino') void restorePokerRoom();
  }, [activeZone, restorePokerRoom]);

  const tier = BUY_IN_TIERS.find(t => t.id === tierId) ?? BUY_IN_TIERS[0];
  const advTier = ADVANCED_BUY_IN_TIERS.find(t => t.id === advTierId) ?? ADVANCED_BUY_IN_TIERS[0];
  const activeBuyIn = modeTab === 'advanced' ? advTier.buyIn : tier.buyIn;
  const operableAgents = Object.values(agents).filter(a => canOperateAgent(a.agentId));
  const agent = (selectedAgentId && canOperateAgent(selectedAgentId) ? agents[selectedAgentId] : null)
    || operableAgents.sort((a, b) => b.stress - a.stress)[0];
  const canAfford = points >= activeBuyIn;
  const seatedAgent = operableAgents.find(a => a.activity === 'poker');
  const isSeated = !!seatedAgent;
  const roomBuyIn = inRoom ? pokerRoom.buy_in : activeBuyIn;
  const playerLabel = (p: PokerRoom['players'][0]) => {
    const user = p.user_name || p.display_name || '玩家';
    const agent = p.agent_name;
    return agent && agent !== user ? `${user} · ${agent}` : user;
  };

  const humanCount = pokerRoom?.human_count ?? pokerRoom?.players.filter(p => !p.is_npc && !p.user_id.startsWith('npc_')).length ?? 0;
  const myUserId = getStoredAccount()?.id;
  const myPlayer = pokerRoom?.players.find(p => p.user_id === myUserId);
  const humanPlayers = pokerRoom?.players.filter(p => !p.is_npc && !p.user_id.startsWith('npc_')) ?? [];

  const seatOccupant = (seatId: string) =>
    humanPlayers.find(p => p.seat_id === seatId);

  const revealResults = (
    results: Array<{
      name: string; score: number; rank: number; won: number; is_npc?: boolean;
      hole_cards?: string[]; best_cards?: string[]; hand_name?: string; hand_combo?: string;
    }>,
    won?: number,
    pot?: number,
    net?: number,
    balance?: number,
    communityCards?: string[],
    tie?: boolean,
    winnersCount?: number,
    buyIn = tier.buyIn,
  ) => {
    if (balance != null) useGameStore.setState({ points: balance });
    showPokerResult({
      results,
      community_cards: communityCards,
      won: won ?? 0,
      net: net ?? (won ?? 0) - buyIn,
      buyIn,
      pot,
      balance,
      tie,
      winners_count: winnersCount,
    });
    const n = net ?? ((won ?? 0) - buyIn);
    if (n > 0 && tie) addMessage(`🤝 平局！与 ${winnersCount ?? ''} 人平分奖池 · 你获得 ${won} 积分 · 净赚 +${n}`);
    else if (n > 0) addMessage(`🎉 获胜！赢得奖池 ${won} 积分 · 净赚 +${n}`);
    else if (n < 0) addMessage(`本局未获胜 · 买入 ${buyIn} 积分`);
    else addMessage(`本局平局 · 买入 ${buyIn} 积分`);
  };

  const afterRoomJoin = async (room: NonNullable<typeof pokerRoom>, seatId?: string) => {
    applyPokerRoom(room);
    if (agent && seatId) await seatAgentAtPoker(agent.agentId, seatId);
    else if (agent && !isSeated) await seatAgentAtPoker(agent.agentId);
    void syncPokerRoom();
    refreshPublicRooms();
  };

  const startSolo = async () => {
    if (!agent || phase === 'dealing') return;
    if (!isLoggedIn()) {
      addMessage('请先登录后再开局');
      return;
    }

    setPhase('dealing');
    setPokerTableDealingUntil(performance.now() + HARD_TIMEOUT_MS);
    setNpcBubble('dealer', '发牌开始～', performance.now() + 6000);
    const dealStart = performance.now();

    try {
      const apiPromise = pokerSolo(agent.agentId, tier.buyIn);
      const timeoutPromise = new Promise<{ ok: false; error: string }>(resolve => {
        setTimeout(() => resolve({ ok: false, error: '发牌超时，请重试' }), HARD_TIMEOUT_MS);
      });
      const r = await Promise.race([apiPromise, timeoutPromise]);

      const wait = Math.max(0, MIN_DEAL_MS - (performance.now() - dealStart));
      if (wait > 0) await new Promise(res => setTimeout(res, wait));

      if (!r.ok) {
        addMessage(r.error || '开局失败');
        if ('balance' in r && r.balance != null) useGameStore.setState({ points: r.balance as number });
        return;
      }
      if (!r.results?.length) {
        addMessage('发牌完成但未收到结果，请重试');
        if (r.balance != null) useGameStore.setState({ points: r.balance });
        return;
      }
      clearPokerRoom();
      revealResults(r.results, r.won, r.pot, r.net, r.balance, r.community_cards, r.tie, r.winners_count);
    } catch {
      addMessage('发牌失败，请重试');
    } finally {
      setPhase('idle');
      setPokerTableDealingUntil(0);
    }
  };

  const startMultiplayer = async () => {
    if (!pokerRoom?.id || phase === 'dealing') return;
    setBusy('start');
    setPhase('dealing');
    setPokerTableDealingUntil(performance.now() + HARD_TIMEOUT_MS);
    setNpcBubble('dealer', '发牌开始～', performance.now() + 6000);
    const dealStart = performance.now();
    try {
      const r = await startPokerRoom(pokerRoom.id);
      const wait = Math.max(0, MIN_DEAL_MS - (performance.now() - dealStart));
      if (wait > 0) await new Promise(res => setTimeout(res, wait));
      if (!r.ok) {
        addMessage(r.error || '开局失败');
        return;
      }
      const isAdvanced = pokerRoom?.game_mode === 'advanced' || r.mode?.startsWith('advanced');
      if (isAdvanced && r.game && r.room_id) {
        clearPokerRoom();
        if (r.balance != null) useGameStore.setState({ points: r.balance });
        setSpectateRoom({ id: r.room_id, buyIn: roomBuyIn });
        addMessage('进阶锦标赛开始 · Agent 自主博弈中');
        return;
      }
      clearPokerRoom();
      if (r.balance != null) useGameStore.setState({ points: r.balance });
      revealResults(
        r.results ?? [], r.won, r.pot, r.net, r.balance,
        (r as { community_cards?: string[] }).community_cards,
        (r as { tie?: boolean }).tie,
        (r as { winners_count?: number }).winners_count,
        roomBuyIn,
      );
    } finally {
      setPhase('idle');
      setPokerTableDealingUntil(0);
      setBusy(null);
    }
  };

  if (spectateRoom) {
    return (
      <PokerAdvancedSpectator
        roomId={spectateRoom.id}
        buyIn={spectateRoom.buyIn}
        onComplete={settlement => {
          if (settlement.balance != null) useGameStore.setState({ points: settlement.balance });
          const w = settlement.winner?.name;
          addMessage(w ? `🏆 ${w} 赢得锦标赛` : '锦标赛结束');
          if (settlement.net != null && settlement.net > 0) {
            addMessage(`你的 Agent 净赚 +${settlement.net} 积分`);
          }
        }}
        onClose={() => setSpectateRoom(null)}
      />
    );
  }

  if (phase === 'dealing') {
    return (
      <div style={{ color: '#3d3530', textAlign: 'center', padding: '16px 8px 24px' }}>
        <PokerDealingCards active />
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 12, color: '#2ea872' }}>
          荷官 Jack 正在发牌…
        </div>
        <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 8, lineHeight: 1.5 }}>
          请稍候，牌桌同步动画中<br />完成后将自动展示开牌结果
        </div>
      </div>
    );
  }

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {(['classic', 'advanced'] as const).map(m => (
          <button key={m} type="button" className={`ui-btn ${modeTab === m ? 'active' : ''}`}
            style={{ flex: 1, fontSize: 11, fontWeight: 600 }}
            onClick={() => setModeTab(m)}>
            {m === 'classic' ? '经典比牌' : '进阶博弈'}
          </button>
        ))}
      </div>

      {modeTab === 'classic' ? (
      <div style={{ fontSize: 11, color: '#8a7e72', marginBottom: 10, lineHeight: 1.55, padding: '8px 10px', background: '#fff8e8', borderRadius: 8 }}>
        <b>经典模式</b>：直接发牌比大小（保留旧玩法）<br />
        <b>① 免费入座</b> → <b>② 多人房间</b> → <b>③ 开牌</b>
      </div>
      ) : (
      <div style={{ fontSize: 11, color: '#8a7e72', marginBottom: 10, lineHeight: 1.55, padding: '8px 10px', background: '#eef4ff', borderRadius: 8 }}>
        <b>进阶模式</b>：翻牌前→翻牌→转牌→河牌，加注/跟注/弃牌/全下<br />
        Agent 自主决策 · 筹码归零淘汰 · 最多 7 人 · 你只需观赛
      </div>
      )}

      <div style={{ fontSize: 11, color: '#d4af37', marginBottom: 8 }}>当前积分：{points}</div>

      {inRoom && (
        <div style={{ marginBottom: 10, padding: 10, background: '#eef4ff', borderRadius: 8, fontSize: 12, border: '1px solid #7aa8e8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontWeight: 700, color: '#3a6bb5' }}>房间 #{pokerRoom.room_code || pokerRoom.id}</span>
            <span style={{ fontSize: 11, color: '#6a8aad' }}>{humanCount} 人在座 · 买入 {roomBuyIn}</span>
          </div>
          <div style={{ fontSize: 11, color: '#5a7a9a', marginBottom: 8 }}>
            把编号告诉好友，对方在下方输入即可加入 · 可点击空位换座
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {POKER_SEAT_NUMS.map(n => {
              const seatId = `poker_s${n}`;
              const occ = seatOccupant(seatId);
              const isMine = occ?.user_id === myUserId;
              const taken = !!occ && !isMine;
              const isCurrent = myPlayer?.seat_id === seatId;
              return (
                <button
                  key={seatId}
                  type="button"
                  className={`ui-btn ${isCurrent ? 'active' : ''}`}
                  style={{
                    flex: '1 1 28%', fontSize: 10, padding: '6px 4px', minWidth: 52,
                    opacity: taken ? 0.45 : 1,
                    border: isCurrent ? '2px solid #3a6bb5' : undefined,
                  }}
                  disabled={taken || busy !== null}
                  title={taken ? `${occ?.user_name || occ?.agent_name || '玩家'} 已占` : `换到座位 ${n}`}
                  onClick={async () => {
                    if (isCurrent || taken) return;
                    setBusy('seat');
                    await changePokerRoomSeat(seatId);
                    setBusy(null);
                  }}>
                  座{n}{isMine ? '·我' : taken ? '·占' : ''}
                </button>
              );
            })}
          </div>
          {humanPlayers.map(p => (
            <div key={`${p.user_id}-${p.seat_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11 }}>
              <span style={{ width: 52, color: '#8a7e72' }}>{p.seat_id?.replace('poker_s', '座位 ')}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{playerLabel(p)}</span>
            </div>
          ))}
          <button className="ui-btn" style={{
            width: '100%', marginTop: 8, padding: '10px 0', fontWeight: 700,
            background: canAfford ? 'linear-gradient(135deg,#48d093,#2ea872)' : undefined,
            color: canAfford ? '#fff' : undefined,
          }}
            disabled={!canAfford || busy !== null}
            onClick={() => void startMultiplayer()}>
            {busy === 'start' ? '发牌中…' : modeTab === 'advanced'
              ? `开始进阶锦标赛（-${roomBuyIn} · Agent 自主博弈）`
              : `开始牌局 · 发牌（-${roomBuyIn} 积分）`}
          </button>
          <button className="ui-btn" style={{ width: '100%', marginTop: 6, fontSize: 11, opacity: 0.75 }}
            onClick={() => void leavePokerRoom().then(() => refreshPublicRooms())}>
            离开房间
          </button>
        </div>
      )}

      {!inRoom && (
        <div style={{ marginBottom: 10, padding: 10, background: '#faf6ef', borderRadius: 8, border: '1px solid #e8dcc8' }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>多人房间</div>
          <button className="ui-btn" style={{ width: '100%', marginBottom: 8 }}
            disabled={!agent || busy !== null}
            onClick={async () => {
              if (!agent) return;
              if (!isLoggedIn()) { addMessage('请先登录'); return; }
              setBusy('create');
              const r = await createPokerRoom(
                modeTab === 'advanced' ? advTier.buyIn : tier.buyIn,
                agent.agentId,
                modeTab,
              );
              if (!r.ok) {
                addMessage(r.error || '创建失败');
              } else if (r.room) {
                addMessage(r.message || `房间 ${r.room_code} 已创建`);
                await afterRoomJoin(r.room, r.seat_id);
              }
              setBusy(null);
            }}>
            {busy === 'create' ? '创建中…' : `创建${modeTab === 'advanced' ? '进阶' : ''}房间（买入 ${modeTab === 'advanced' ? advTier.buyIn : tier.buyIn}）`}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={roomCodeInput}
              onChange={e => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="5 位房间编号"
              maxLength={5}
              inputMode="numeric"
              style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #d4c8b8', fontSize: 13, letterSpacing: 2 }}
            />
            <button className="ui-btn" style={{ minWidth: 72 }}
              disabled={!agent || roomCodeInput.length !== 5 || busy !== null}
              onClick={async () => {
                if (!agent) return;
                if (!isLoggedIn()) { addMessage('请先登录'); return; }
                setBusy('join');
                const r = await joinPokerRoomByCode(roomCodeInput, agent.agentId);
                if (r.ok && r.room) {
                  addMessage(r.message || (r.already_joined ? '已在房间中' : `已加入房间 ${r.room_code}`));
                  await afterRoomJoin(r.room, r.seat_id);
                } else addMessage(r.error || '加入失败');
                setBusy(null);
              }}>
              {busy === 'join' ? '…' : '加入'}
            </button>
          </div>
          {publicRooms.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e0d4c4' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6a5a48', marginBottom: 6 }}>进行中的房间（{publicRooms.length}）</div>
              {publicRooms.map(room => {
                const names = room.player_names?.length
                  ? room.player_names
                  : room.players.filter(p => !p.is_npc && !p.user_id.startsWith('npc_'))
                    .map(p => p.user_name || p.display_name || p.agent_name || '玩家');
                const count = room.human_count ?? names.length;
                return (
                  <div key={room.id} style={{ padding: '8px 0', borderBottom: '1px dashed #eee8dc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                      <b>#{room.room_code || room.id}</b>
                      <span style={{ fontSize: 11, color: '#8a7e72' }}>{count} 人 · 买入 {room.buy_in}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6a8aad', margin: '4px 0 6px', lineHeight: 1.45 }}>
                      {names.join('、')}
                    </div>
                    <button className="ui-btn" style={{ width: '100%', fontSize: 11 }}
                      disabled={!agent || busy !== null}
                      onClick={async () => {
                        if (!agent) return;
                        setBusy('join');
                        const r = await joinPokerRoom(room.id, agent.agentId);
                        if (r.ok && r.room) {
                          addMessage(r.message || (r.already_joined ? '已在房间中' : `已加入房间 ${r.room_code}`));
                          await afterRoomJoin(r.room, r.seat_id);
                        } else addMessage(r.error || '加入失败');
                        setBusy(null);
                      }}>
                      加入此房间
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isSeated && seatedAgent && !inRoom && (
        <div style={{ marginBottom: 10, padding: 10, background: '#e8f8ef', borderRadius: 8, fontSize: 12, border: '1px solid #48d093' }}>
          <div style={{ fontWeight: 700, color: '#2ea872', marginBottom: 4 }}>✓ {seatedAgent.data.name} 已在牌桌</div>
          <div style={{ fontSize: 11, color: '#5a8a6a' }}>可创建/加入房间，或直接单人开局</div>
        </div>
      )}

      {agent ? (
        <div style={{ marginBottom: 10, padding: 8, background: '#faf6ef', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <PenguinAvatar color={agent.data.color} headwear={agent.data.headwear} hatStyle={agent.data.hatStyle} speciesId={agent.data.speciesId} outfitId={agent.data.outfitId} scarfEnabled={agent.data.scarfEnabled} hatEnabled={agent.data.hatEnabled} size={28} />
          <div>
            <b>{agent.data.name}</b>
            <div style={{ fontSize: 10, color: '#8a7e72' }}>压力 {Math.round(agent.stress)}%</div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 10, padding: 8, background: '#fff8e8', borderRadius: 8, fontSize: 12, color: '#8a6e3a' }}>
          请先在「Agent 工坊」创建你自己的 Agent
        </div>
      )}

      {!compact && modeTab === 'classic' && BUY_IN_TIERS.map(t => (
        <button key={t.id} className={`leisure-option ${tierId === t.id ? 'selected' : ''}`} onClick={() => setTierId(t.id)}>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontWeight: 600 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: '#8a7e72' }}>{t.desc}</div>
          </div>
          <span style={{ color: '#d4af37', fontWeight: 600, fontSize: 12 }}>买入 {t.buyIn}</span>
        </button>
      ))}

      {!compact && modeTab === 'advanced' && ADVANCED_BUY_IN_TIERS.map(t => (
        <button key={t.id} className={`leisure-option ${advTierId === t.id ? 'selected' : ''}`} onClick={() => setAdvTierId(t.id)}>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontWeight: 600 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: '#8a7e72' }}>{t.desc}</div>
          </div>
          <span style={{ color: '#3a6bb5', fontWeight: 600, fontSize: 12 }}>带入 {t.buyIn}</span>
        </button>
      ))}

      {modeTab === 'advanced' && agent && !inRoom && !spectateRoom && (
        <div style={{ marginBottom: 10, padding: 10, background: '#f0f4ff', borderRadius: 8, border: '1px solid #7aa8e8' }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#3a6bb5' }}>AI 观赛 · 你的 Agent 上场</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {[2, 3, 4, 5, 6, 7].map(n => (
              <button key={n} type="button" className={`ui-btn ${numAiPlayers === n ? 'active' : ''}`}
                style={{ flex: 1, fontSize: 10, padding: '4px 0' }}
                onClick={() => setNumAiPlayers(n)}>{n}人</button>
            ))}
          </div>
          <button className="ui-btn" style={{
            width: '100%', padding: '12px 0', fontWeight: 700,
            background: canAfford ? 'linear-gradient(135deg,#5b8def,#3a6bb5)' : undefined,
            color: canAfford ? '#fff' : undefined,
          }}
            disabled={!canAfford || busy !== null}
            onClick={async () => {
              if (!agent || !isLoggedIn()) { addMessage('请先登录'); return; }
              setBusy('start');
              const r = await startAiSpectator(agent.agentId, advTier.buyIn, numAiPlayers);
              setBusy(null);
              if (!r.ok) {
                addMessage(r.error || '开局失败');
                if (r.balance != null) useGameStore.setState({ points: r.balance });
                return;
              }
              if (r.balance != null) useGameStore.setState({ points: r.balance });
              if (r.room_id) {
                setSpectateRoom({ id: r.room_id, buyIn: advTier.buyIn });
                addMessage(r.message || '观赛开始');
              }
            }}>
            {busy === 'start' ? '启动中…' : `开始 AI 观赛（-${advTier.buyIn} · ${numAiPlayers} 人桌）`}
          </button>
        </div>
      )}

      {modeTab === 'advanced' && agent && (
        <div style={{ marginBottom: 10, padding: 10, background: '#faf6ef', borderRadius: 8 }}>
          <PokerStyleEditor agentId={agent.agentId} agentName={agent.data.name} compact={compact} />
        </div>
      )}

      {compact && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(modeTab === 'advanced' ? ADVANCED_BUY_IN_TIERS : BUY_IN_TIERS).map(t => (
            <button key={t.id} className={`ui-btn ${(modeTab === 'advanced' ? advTierId : tierId) === t.id ? 'active' : ''}`}
              style={{ flex: 1, fontSize: 10 }}
              onClick={() => (modeTab === 'advanced' ? setAdvTierId(t.id) : setTierId(t.id))}>
              {t.buyIn}
            </button>
          ))}
        </div>
      )}

      {showSitButton && !isSeated && (
        <button className="ui-btn" style={{ width: '100%', marginTop: compact ? 0 : 8, marginBottom: 8, padding: '9px 0' }}
          disabled={!agent || busy !== null}
          onClick={async () => {
            if (!agent) return;
            setBusy('sit');
            const ok = await sendAgentToFacility('poker', { agentId: agent.agentId, skipCost: true });
            if (ok) addMessage(`${agent.data.name} 已入座 · 可创建/加入房间或直接开局`);
            setBusy(null);
          }}>
          {busy === 'sit' ? 'Agent 正在前往…' : '① 免费入座'}
        </button>
      )}

      {!inRoom && modeTab === 'classic' && (
        <>
          <button className="ui-btn" style={{
            width: '100%', marginBottom: 8, padding: '12px 0',
            background: canAfford ? 'linear-gradient(135deg,#48d093,#2ea872)' : undefined,
            color: canAfford ? '#fff' : undefined,
            fontWeight: 700,
            fontSize: compact ? 12 : 14,
          }}
            disabled={!agent || !canAfford}
            onClick={() => void startSolo()}>
            {!canAfford ? `积分不足（需 ${tier.buyIn}）` : `单人开局 · 发牌（-${tier.buyIn} 积分）`}
          </button>

          <button className="ui-btn" style={{ width: '100%', marginBottom: 8 }}
            disabled={!agent || busy !== null}
            onClick={async () => {
              if (!agent) return;
              setBusy('quick');
              const r = await pokerQuickJoin(agent.agentId, tier.buyIn);
              if (!r.ok) {
                if (r.mode === 'no_room') addMessage('暂无公开房间 · 可创建房间或单人开局');
                else addMessage(r.error || '匹配失败');
              } else if (r.room) {
                addMessage(r.message || '已加入公开房间');
                await afterRoomJoin(r.room, r.seat_id);
              }
              setBusy(null);
            }}>
            {busy === 'quick' ? '匹配中…' : '快速加入公开房（免费）'}
          </button>
        </>
      )}
    </div>
  );
}
