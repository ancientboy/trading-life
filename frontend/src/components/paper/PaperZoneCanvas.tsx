import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { tickCharacterSim } from '../../lib/characterSimLoop';
import { WORLD_MAP, ZONE_CAMERA } from '../../lib/worldMap';
import { hitTestPaperFacilities, getAgentPaperPos, ZONE_NPCS } from '../../lib/zoneFurniture';
import { ZONE_LAYOUTS } from '../../lib/zoneLayouts';
import { PAPER, agentVisibleInZone } from '../../lib/zoneProjection';
import {
  makePaperCamera, camToScreen, screenToPaper, renderZone, renderAgents,
} from './renderZone';
import { drawZoneTransitOverlay } from './paperDraw';

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
  const pokerGlbReady = useGameStore(s => s.pokerGlbReady);

  const flyToZone = useGameStore(s => s.flyToZone);
  const selectAgent = useGameStore(s => s.selectAgent);
  const selectNpc = useGameStore(s => s.selectNpc);
  const sendAgentToFacility = useGameStore(s => s.sendAgentToFacility);
  const panCamera = useGameStore(s => s.panCamera);
  const setCameraZoom = useGameStore(s => s.setCameraZoom);
  const setCameraLookAt = useGameStore(s => s.setCameraLookAt);

  const getPan = useCallback(() => {
    const cam = ZONE_CAMERA[activeZone];
    return {
      panX: (cameraLookAt.x - cam.x) * PAPER.ppu,
      panY: (cameraLookAt.z - cam.z) * PAPER.ppu,
    };
  }, [activeZone, cameraLookAt]);

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

    renderZone(ctx, activeZone, cam, agents, {
      hoverFacilityId: hoverFacilityId,
      bob: bobRef.current,
      dayMode,
      ticker,
      t,
      npcBubble: performance.now() < (npcBubble?.until ?? 0) ? npcBubble : null,
      pokerGlbReady,
    });

    const transit = Object.values(agents).find(a => a.inTransit);
    if (transit) {
      const label = ZONE_CAMERA[transit.transitZone ?? activeZone]?.label ?? '目标区域';
      drawZoneTransitOverlay(ctx, cw, ch, t, label);
    } else {
      renderAgents(ctx, activeZone, cam, agents, c => agentVisibleInZone(c, activeZone), {
        selectedId: selectedAgentId,
        t,
      });
    }
  }, [activeZone, agents, selectedAgentId, cameraZoom, dayMode, getPan, hoverFacilityId, ticker, npcBubble, pokerGlbReady]);

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      bobRef.current += dt;
      if (!paused) tickCharacterSim(dt);
      if (followAgentId && agents[followAgentId] && !agents[followAgentId].inTransit) {
        const a = agents[followAgentId];
        if (Math.abs(a.x - cameraLookAt.x) > 0.15 || Math.abs(a.z - cameraLookAt.z) > 0.15) {
          setCameraLookAt(a.x, a.z);
        }
      }
      paint();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paused, followAgentId, agents, cameraLookAt, activeZone, paint, setCameraLookAt]);

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
    setHoverFacilityId(hit?.type === 'facility' ? hit.id : null);
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
    else if (hit.type === 'agent') selectAgent(hit.id);
    else if (hit.type === 'npc') selectNpc(hit.id);
    else if (hit.type === 'facility') sendAgentToFacility(hit.action, { nodeId: hit.nodeId });
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
