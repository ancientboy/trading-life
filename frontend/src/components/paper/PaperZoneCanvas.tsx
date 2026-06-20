import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { tickCharacterSim } from '../../lib/characterSimLoop';
import { WORLD_MAP, ZONE_CAMERA } from '../../lib/worldMap';
import { hitTestPaperFacilities, getAgentPaperPos, ZONE_NPCS } from '../../lib/zoneFurniture';
import { ARENA_PIT, hitTestArenaPod, type ArenaDisplayData } from './arenaDraw';
import { fetchArenaRound, fetchGuessRound, fetchPublicArenaLive, type GuessRoundState } from '../../lib/lifeEngagementApi';
import { fetchMarketKlines } from '../../lib/lifeApi';
import { ZONE_LAYOUTS } from '../../lib/zoneLayouts';
import { PAPER, agentVisibleInZone } from '../../lib/zoneProjection';
import {
  makePaperCamera, camToScreen, screenToPaper, renderZone, renderAgents, renderPokerRoomGuests,
} from './renderZone';
import { resolveAgentZone } from '../../lib/zoneTransit';
import { getStoredAccount } from '../../lib/lifeAuth';

export function PaperZoneCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const bobRef = useRef(0);
  const dragRef = useRef<{ active: boolean; lx: number; ly: number; sx: number; sy: number }>({
    active: false, lx: 0, ly: 0, sx: 0, sy: 0,
  });
  const [hoverFacilityId, setHoverFacilityId] = useState<string | null>(null);

  const activeZone = useGameStore(s => s.activeZone);
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const cameraLookAt = useGameStore(s => s.cameraLookAt);
  const cameraZoom = useGameStore(s => s.cameraZoom);
  const dayMode = useGameStore(s => s.dayMode);
  const followAgentId = useGameStore(s => s.followAgentId);
  const paused = useGameStore(s => s.paused);
  const ticker = useGameStore(s => s.ticker);
  const npcBubble = useGameStore(s => s.npcBubble);
  const agentBubble = useGameStore(s => s.agentBubble);
  const pokerTableDealingUntil = useGameStore(s => s.pokerTableDealingUntil);
  const pokerRoom = useGameStore(s => s.pokerRoom);
  const zoneSkins = useGameStore(s => s.zoneSkins);
  const arenaLive = useGameStore(s => s.arenaLive);
  const setArenaLive = useGameStore(s => s.setArenaLive);
  const setSelectedArenaEntryId = useGameStore(s => s.setSelectedArenaEntryId);
  const setRightTab = useGameStore(s => s.setRightTab);
  const toggleRightPanel = useGameStore(s => s.toggleRightPanel);
  const rightPanelCollapsed = useGameStore(s => s.rightPanelCollapsed);

  const prevLegsRef = useRef<Record<string, number>>({});
  const [arenaPulseSlots, setArenaPulseSlots] = useState<Set<number>>(new Set());
  const [hoverPodId, setHoverPodId] = useState<string | null>(null);
  const [guessRound, setGuessRound] = useState<GuessRoundState | null>(null);
  const [klineCloses, setKlineCloses] = useState<number[]>([]);

  const flyToZone = useGameStore(s => s.flyToZone);
  const selectAgent = useGameStore(s => s.selectAgent);
  const selectNpc = useGameStore(s => s.selectNpc);
  const sendAgentToFacility = useGameStore(s => s.sendAgentToFacility);
  const sendAgentToDesk = useGameStore(s => s.sendAgentToDesk);
  const openModal = useGameStore(s => s.openModal);
  const setNpcBubble = useGameStore(s => s.setNpcBubble);
  const panCamera = useGameStore(s => s.panCamera);
  const setCameraZoom = useGameStore(s => s.setCameraZoom);
  const setCameraLookAt = useGameStore(s => s.setCameraLookAt);
  const followAgentZone = useGameStore(s => s.followAgentZone);

  const getPan = useCallback(() => {
    const cam = ZONE_CAMERA[activeZone];
    return {
      panX: (cameraLookAt.x - cam.x) * PAPER.ppu,
      panY: (cameraLookAt.z - cam.z) * PAPER.ppu,
    };
  }, [activeZone, cameraLookAt]);

  useEffect(() => {
    if (activeZone !== 'arena') return;
    const pollArena = () => fetchArenaRound().then(r => {
      if (r.ok && r.current) setArenaLive(r.current);
      else {
        fetchPublicArenaLive().then(pr => {
          if (pr.ok && pr.current) setArenaLive(pr.current);
        }).catch(() => {});
      }
    }).catch(() => {
      fetchPublicArenaLive().then(pr => {
        if (pr.ok && pr.current) setArenaLive(pr.current);
      }).catch(() => {});
    });
    pollArena();
    const id = setInterval(pollArena, 4000);
    return () => clearInterval(id);
  }, [activeZone, setArenaLive]);

  useEffect(() => {
    if (activeZone !== 'arena') return;
    const pollDisplay = () => {
      fetchGuessRound().then(r => {
        if (r.ok && r.current) setGuessRound(r.current);
      }).catch(() => {});
      fetchMarketKlines('BTCUSDT', '1m', 48).then(r => {
        if (r.ok && r.candles?.length) setKlineCloses(r.candles.map(c => c.close));
      }).catch(() => {});
    };
    pollDisplay();
    const id = setInterval(pollDisplay, 4000);
    return () => clearInterval(id);
  }, [activeZone]);

  useEffect(() => {
    if (!arenaLive?.entries) return;
    const pulse = new Set<number>();
    arenaLive.entries.forEach((e, i) => {
      const prev = prevLegsRef.current[e.user_id] ?? 0;
      const now = e.legs_count ?? e.recent_legs?.length ?? 0;
      if (arenaLive.status === 'running' && now > prev) pulse.add(i);
      prevLegsRef.current[e.user_id] = now;
    });
    if (pulse.size) {
      setArenaPulseSlots(pulse);
      const t = setTimeout(() => setArenaPulseSlots(new Set()), 1200);
      return () => clearTimeout(t);
    }
  }, [arenaLive]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { panX, panY } = getPan();
    const cam = makePaperCamera(cw, ch, cameraZoom, WORLD_MAP.defaultZoom, panX, panY);
    const t = performance.now() / 1000;

    let arenaDisplay: ArenaDisplayData | null = null;
    if (activeZone === 'arena') {
      const btc = ticker.BTCUSDT;
      const start = guessRound?.start_price;
      const end = guessRound?.end_price;
      const price = btc || end || start;
      arenaDisplay = {
        btcPrice: price,
        startPrice: start,
        endPrice: end,
        pctChange: price && start ? ((price - start) / start) * 100 : undefined,
        secondsLeft: guessRound?.seconds_left,
        bettingOpen: guessRound?.betting_open,
        poolUp: guessRound?.pool_up,
        poolDown: guessRound?.pool_down,
        statusLabel: guessRound
          ? (guessRound.betting_open ? '押注中' : guessRound.status === 'locked' ? '封盘中' : '进行中')
          : (btc ? 'LIVE' : undefined),
        klineCloses: klineCloses.length >= 4 ? klineCloses : undefined,
      };
    }

    renderZone(ctx, activeZone, cam, agents, {
      hoverFacilityId: hoverFacilityId,
      bob: bobRef.current,
      dayMode,
      ticker,
      t,
      npcBubble: performance.now() < (npcBubble?.until ?? 0) ? npcBubble : null,
      pokerTableDealing: performance.now() < pokerTableDealingUntil,
      zoneSkins,
      arenaLive: activeZone === 'arena' ? arenaLive : null,
      arenaDisplay,
      arenaPulseSlots,
      hoverPodId,
    });

    renderAgents(ctx, activeZone, cam, agents, c => agentVisibleInZone(c, activeZone), {
      selectedId: selectedAgentId,
      t,
      agentBubble,
    });

    if (activeZone === 'casino' && pokerRoom?.players?.length) {
      renderPokerRoomGuests(
        ctx, activeZone, cam, pokerRoom.players, agents,
        getStoredAccount()?.id, t,
      );
    }
  }, [activeZone, agents, selectedAgentId, cameraZoom, dayMode, getPan, hoverFacilityId, ticker, npcBubble, agentBubble, pokerTableDealingUntil, pokerRoom, zoneSkins, arenaLive, guessRound, klineCloses, arenaPulseSlots, hoverPodId]);

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      bobRef.current += dt;
      if (!paused) tickCharacterSim(dt);
      if (followAgentId && agents[followAgentId]) {
        const a = agents[followAgentId];
        const agentZone = resolveAgentZone(a);
        const st = useGameStore.getState();
        if (agentZone !== st.activeZone) followAgentZone(agentZone);
        const cam = st.cameraLookAt;
        if (Math.abs(a.x - cam.x) > 0.12 || Math.abs(a.z - cam.z) > 0.12) {
          setCameraLookAt(a.x, a.z);
        }
      }
      paint();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paused, followAgentId, agents, activeZone, paint, setCameraLookAt, followAgentZone]);

  useEffect(() => {
    const onResize = () => paint();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paint]);

  const hitTest = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const { panX, panY } = getPan();
    const cam = makePaperCamera(cw, ch, cameraZoom, WORLD_MAP.defaultZoom, panX, panY);
    const paper = screenToPaper(cam, sx, sy);

    const layout = ZONE_LAYOUTS[activeZone];
    for (const a of layout.navArrows) {
      const s = camToScreen(cam, a.x, a.y);
      if (Math.hypot(sx - s.x, sy - s.y) < 36) {
        return { type: 'nav' as const, target: a.target };
      }
    }

    if (activeZone === 'arena') {
      const pod = hitTestArenaPod({ px: paper.x, py: paper.y });
      if (pod) {
        return { type: 'arena_pod' as const, slot: pod.slot, id: pod.id };
      }
      if (Math.hypot(paper.x - ARENA_PIT.px, paper.y - ARENA_PIT.py) < ARENA_PIT.r) {
        return { type: 'arena_pit' as const, id: 'arena_pit' };
      }
    }

    const fac = hitTestPaperFacilities(activeZone, { px: paper.x, py: paper.y });
    if (fac) {
      return { type: 'facility' as const, action: fac.action, nodeId: fac.nodeId, id: fac.id };
    }

    for (const npc of ZONE_NPCS[activeZone] ?? []) {
      if (Math.hypot(paper.x - npc.px, paper.y - npc.py) < 32) {
        return { type: 'npc' as const, id: npc.id };
      }
    }

    let best: { id: string; d: number } | null = null;
    Object.values(agents).forEach(char => {
      if (!agentVisibleInZone(char, activeZone)) return;
      const ap = getAgentPaperPos(activeZone, char);
      const d = Math.hypot(paper.x - ap.px, paper.y - ap.py);
      if (d < 22 && (!best || d < best.d)) best = { id: char.agentId, d };
    });
    if (best) return { type: 'agent' as const, id: best.id };
    return null;
  }, [activeZone, agents, cameraZoom, getPan]);

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lx;
      const dy = e.clientY - dragRef.current.ly;
      dragRef.current.lx = e.clientX;
      dragRef.current.ly = e.clientY;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const { panX, panY } = getPan();
      const cam = makePaperCamera(cw, ch, cameraZoom, WORLD_MAP.defaultZoom, panX, panY);
      panCamera(-dx / cam.scale / PAPER.ppu, -dy / cam.scale / PAPER.ppu);
      return;
    }
    const hit = hitTest(e.clientX, e.clientY);
    setHoverFacilityId(hit?.type === 'facility' ? hit.id : (hit?.type === 'arena_pod' || hit?.type === 'arena_pit') ? hit.id : null);
    setHoverPodId(hit?.type === 'arena_pod' ? hit.id : null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { active: true, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current.active = false;
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    if (moved > 6) return;

    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    if (hit.type === 'nav') flyToZone(hit.target);
    else if (hit.type === 'arena_pod' || hit.type === 'arena_pit') {
      if (hit.type === 'arena_pod') {
        const entry = arenaLive?.entries?.[hit.slot];
        if (entry) setSelectedArenaEntryId(entry.user_id);
      }
      if (rightPanelCollapsed) toggleRightPanel();
      setRightTab('events');
      useGameStore.setState({ sidebarActive: 'events', activeZone: 'arena' });
    }
    else if (hit.type === 'agent') selectAgent(hit.id);
    else if (hit.type === 'npc') {
      if (hit.id === 'dealer') {
        openModal('poker');
        setNpcBubble('dealer', '欢迎！入座后点「开始牌局」发牌 🃏', performance.now() + 5000);
      } else if (hit.id === 'ava') {
        if (rightPanelCollapsed) toggleRightPanel();
        setRightTab('events');
        setNpcBubble('ava', '欢迎来到交易竞技馆！猜涨跌 / 短线大赛 / 押冠亚季军 🏆', performance.now() + 6000);
      } else if (hit.id === 'lily') openModal('dine');
      else if (hit.id === 'masseur') openModal('massage');
      else selectNpc(hit.id);
    }     else if (hit.type === 'facility') {
      if (hit.action === 'desk') {
        void sendAgentToDesk(undefined, hit.nodeId);
      } else if (hit.action === 'poker') {
        void sendAgentToFacility('poker', { nodeId: hit.nodeId, skipCost: true }).then(ok => {
          if (ok) openModal('poker');
        });
      } else {
        void sendAgentToFacility(hit.action, { nodeId: hit.nodeId, skipCost: true });
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setCameraZoom(cameraZoom + (e.deltaY < 0 ? 3 : -3));
  };

  return (
    <canvas
      ref={canvasRef}
      className="paper-zone-canvas"
      style={{
        width: '100%', height: '100%', display: 'block', touchAction: 'none',
        cursor: hoverFacilityId ? 'pointer' : dragRef.current.active ? 'grabbing' : 'grab',
        position: 'relative',
        zIndex: 1,
        background: 'transparent',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHoverFacilityId(null)}
      onWheel={onWheel}
    />
  );
}
