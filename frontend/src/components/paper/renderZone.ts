import {
  HALL_COFFEE, HALL_DESKS_8, HALL_GRID, deskChartSeed, deskPaperPos, seatPaperPos,
} from '../../lib/hallLayout';
import { MARKET_TICKER_ITEMS, formatTickerPrice } from '../../lib/marketTicker';
import {
  SPA_BEDS, RESTAURANT_TABLES, CASINO_TABLE, CASINO_SEATS, HALL_REST_BOOTHS,
  ZONE_NPCS, getAgentPaperPos, type ZoneNpcDef,
} from '../../lib/zoneFurniture';
import type { ZoneId } from '../../store/useGameStore';
import type { CharState } from '../../lib/constants';
import { OfficePath } from '../../lib/pathfinding';
import { ZONE_LAYOUTS } from '../../lib/zoneLayouts';
import { PAPER, worldToPaper } from '../../lib/zoneProjection';
import {
  rrect, drawDesk, drawAgent, drawNavArrow,
  drawDiningTable, drawFacilityLabel,
  drawMarketBigScreen, drawCoffeeZone, drawChair, drawRestBooth,
  drawPokerTable8, drawNpc, drawSpeechBubble,
  drawCasinoVipBackdrop, drawCasinoVipDecor, drawCasinoAmbientLights, drawVipChair,
  drawCantoneseBackdrop, drawCantoneseDecor, drawCantoneseAmbientLights,
  drawSpaZenBackdrop, drawSpaVipDecor, drawSpaAmbientLights, drawSpaMassageBed,
  drawTableDishes, drawWaiterServeMotion, drawMassageTherapistHands,
} from './paperDraw';
import { leisurePhase, tableIdForDineAgent, bedIdForMassageAgent, getLeisureRenderPaperPos, DINE_SERVE_MS } from '../../lib/leisureActivity';
import { getDiningTableSprite } from '../../lib/diningTableSprite';
import { getRestSofaSprite } from '../../lib/restSofaSprite';

export interface PaperCamera {
  cw: number;
  ch: number;
  scale: number;
  panX: number;
  panY: number;
}

export function makePaperCamera(
  cw: number, ch: number, zoom: number, defaultZoom: number,
  panX: number, panY: number,
): PaperCamera {
  const base = Math.min(cw / PAPER.zoneW, ch / PAPER.zoneH) * 1.02;
  const scale = base * (zoom / defaultZoom);
  return { cw, ch, scale, panX, panY };
}

export function camToScreen(cam: PaperCamera, px: number, py: number) {
  const cx = PAPER.zoneW / 2 + cam.panX;
  const cy = PAPER.zoneH / 2 + cam.panY;
  return {
    x: cam.cw / 2 + (px - cx) * cam.scale,
    y: cam.ch / 2 + (py - cy) * cam.scale,
  };
}

export function screenToPaper(cam: PaperCamera, sx: number, sy: number) {
  const cx = PAPER.zoneW / 2 + cam.panX;
  const cy = PAPER.zoneH / 2 + cam.panY;
  return {
    x: cx + (sx - cam.cw / 2) / cam.scale,
    y: cy + (sy - cam.ch / 2) / cam.scale,
  };
}

function ws(cam: PaperCamera, v: number) {
  return v * cam.scale;
}

function pt(cam: PaperCamera, px: number, py: number) {
  return camToScreen(cam, px, py);
}

function drawBigTicker(
  ctx: CanvasRenderingContext2D, cam: PaperCamera, zone: ZoneId,
  ticker: Record<string, number>, t: number,
) {
  const s = pt(cam, 360, 95);
  const w = ws(cam, 380), h = ws(cam, 92);
  const items = MARKET_TICKER_ITEMS.map(item => ({
    label: item.label,
    price: formatTickerPrice(item, ticker),
    up: (ticker[item.key] ?? item.mock ?? 0) >= 0,
  }));
  drawMarketBigScreen(ctx, s.x, s.y, w, h, items, t, cam.scale);
}

function drawHallDesks(
  ctx: CanvasRenderingContext2D, cam: PaperCamera,
  agents: Record<string, CharState>, t: number, hoverId: string | null,
) {
  const deskLabels: Record<string, string> = {
    desk_xau: 'XAU', desk_maj: 'Major', desk_alt: 'Altcoin', desk_new: 'Newcoin',
    desk_mom: 'Momentum', desk_6: '工位 6', desk_7: '工位 7', desk_8: '工位 8',
  };
  const ds = HALL_GRID.deskScale;
  HALL_DESKS_8.forEach(desk => {
    const dp = deskPaperPos(desk.row, desk.col);
    const sp = seatPaperPos(desk.row, desk.col);
    const deskPt = pt(cam, dp.px, dp.py);
    const seatPt = pt(cam, sp.px, sp.py);
    const agent = Object.values(agents).find(a => OfficePath.deskByAgent[a.agentId] === desk.seatId);
    const agentAtDesk = agent && !agent.isWalking && !agent.activity && !agent.travelIntent && !agent.inTransit;
    const trading = agentAtDesk && (agent.state === 'trading' || agent.state === 'scanning');
    if (hoverId === desk.id) {
      ctx.strokeStyle = 'rgba(66,133,244,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(deskPt.x, deskPt.y, ws(cam, 52), ws(cam, 38), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawDesk(ctx, deskPt.x, deskPt.y, cam.scale * ds, {
      active: trading,
      chartSeed: deskChartSeed(desk.id, agent?.agentId),
      t,
    });
    drawChair(ctx, seatPt.x, seatPt.y, cam.scale * ds, 'n');
    drawFacilityLabel(
      ctx, deskPt.x, deskPt.y - ws(cam, 36),
      hoverId === desk.id ? '点击派遣' : `${deskLabels[desk.id] ?? '工位'}`,
      cam.scale, hoverId === desk.id,
    );
  });
}

function drawHallRest(ctx: CanvasRenderingContext2D, cam: PaperCamera, hoverId: string | null) {
  const sofaSprite = getRestSofaSprite();
  HALL_REST_BOOTHS.forEach((b, i) => {
    const s = pt(cam, b.px, b.py);
    drawRestBooth(ctx, s.x, s.y, cam.scale, i === 1);
    if (!sofaSprite) {
      b.seats.forEach(ch => {
        const cs = pt(cam, ch.px, ch.py);
        drawChair(ctx, cs.x, cs.y, cam.scale, ch.facing);
      });
    }
    drawFacilityLabel(ctx, s.x, s.y + ws(cam, 52), b.label, cam.scale, hoverId === b.id);
  });
}

function drawSpaScene(
  ctx: CanvasRenderingContext2D, cam: PaperCamera, t: number, hoverId: string | null,
  agents: Record<string, CharState>,
) {
  drawSpaVipDecor(ctx, (px, py) => pt(cam, px, py), v => ws(cam, v), cam.scale, t);
  drawSpaAmbientLights(ctx, cam, (px, py) => pt(cam, px, py), v => ws(cam, v));
  SPA_BEDS.forEach(b => {
    const s = pt(cam, b.px, b.py);
    drawSpaMassageBed(ctx, s.x, s.y, cam.scale, hoverId === b.id);
    drawFacilityLabel(ctx, s.x, s.y + ws(cam, 38), b.label, cam.scale, hoverId === b.id);
  });

  const now = performance.now();
  const masseur = ZONE_NPCS.spa[0];
  Object.values(agents).forEach(char => {
    if (char.activity !== 'massage') return;
    const bedId = bedIdForMassageAgent(char);
    const bed = SPA_BEDS.find(b => b.id === bedId);
    if (!bed) return;
    const phase = leisurePhase(char, now);
    const bedPt = pt(cam, bed.px, bed.py);
    if (phase === 'serve' || phase === 'active') {
      drawMassageTherapistHands(ctx, bedPt.x, bedPt.y, cam.scale, t);
    } else if (phase === 'arriving' && masseur) {
      const mPt = pt(cam, masseur.px, masseur.py);
      const elapsed = char.activityStartedAt ? now - char.activityStartedAt : 0;
      const progress = Math.min(1, elapsed / 900);
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const nx = mPt.x + (bedPt.x + ws(cam, 44) - mPt.x) * ease;
      const ny = mPt.y + (bedPt.y - mPt.y) * ease;
      ctx.font = `${Math.max(10, 12 * cam.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🧴', nx, ny);
    }
  });
}

function drawRestaurantScene(
  ctx: CanvasRenderingContext2D, cam: PaperCamera, hoverId: string | null, t: number,
  agents: Record<string, CharState>,
) {
  drawCantoneseDecor(ctx, (px, py) => pt(cam, px, py), v => ws(cam, v), cam.scale, t);
  drawCantoneseAmbientLights(ctx, cam, (px, py) => pt(cam, px, py), v => ws(cam, v));
  const diningSprite = getDiningTableSprite();
  const now = performance.now();
  const waiter = ZONE_NPCS.restaurant[0];

  RESTAURANT_TABLES.forEach(tbl => {
    const s = pt(cam, tbl.px, tbl.py);
    drawDiningTable(ctx, s.x, s.y, cam.scale);
    if (!diningSprite) {
      tbl.chairs.forEach(ch => {
        const cs = pt(cam, ch.px, ch.py);
        drawChair(ctx, cs.x, cs.y, cam.scale, ch.facing);
      });
    }
    drawFacilityLabel(ctx, s.x, s.y + ws(cam, 44), tbl.label, cam.scale, hoverId === tbl.id);
  });

  Object.values(agents).forEach(char => {
    if (char.activity !== 'dine') return;
    const tableId = tableIdForDineAgent(char);
    const table = RESTAURANT_TABLES.find(tbl => tbl.id === tableId);
    if (!table) return;
    const tablePt = pt(cam, table.px, table.py);
    const phase = leisurePhase(char, now);
    if (phase === 'active') {
      drawTableDishes(ctx, tablePt.x, tablePt.y, cam.scale, t, char.leisureTier === 'c' ? 4 : char.leisureTier === 'b' ? 3 : 2);
    } else if (phase === 'serve' && waiter) {
      const wPt = pt(cam, waiter.px, waiter.py);
      const elapsed = char.activityStartedAt ? now - char.activityStartedAt : 0;
      drawWaiterServeMotion(ctx, wPt.x, wPt.y, tablePt.x, tablePt.y, cam.scale, elapsed / DINE_SERVE_MS, t);
    }
  });
}

function punchCasinoTableHole(ctx: CanvasRenderingContext2D, cam: PaperCamera) {
  const s = pt(cam, CASINO_TABLE.px, CASINO_TABLE.py);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, ws(cam, CASINO_TABLE.r * 1.05), ws(cam, CASINO_TABLE.r * 0.72), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCasinoScene(
  ctx: CanvasRenderingContext2D, cam: PaperCamera, t: number, hoverId: string | null,
  pokerGlbReady: boolean,
) {
  drawCasinoVipDecor(ctx, (px, py) => pt(cam, px, py), v => ws(cam, v), cam.scale, t);
  drawCasinoAmbientLights(ctx, cam, (px, py) => pt(cam, px, py), v => ws(cam, v));

  const s = pt(cam, CASINO_TABLE.px, CASINO_TABLE.py);
  if (!pokerGlbReady) {
    drawPokerTable8(ctx, s.x, s.y, cam.scale, t);
  }
  CASINO_SEATS.forEach(seat => {
    const cs = pt(cam, seat.px, seat.py);
    drawVipChair(ctx, cs.x, cs.y, cam.scale * 0.85, seat.facing);
  });
  if (hoverId === 'poker_table') {
    ctx.strokeStyle = 'rgba(212,175,55,0.65)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(s.x, s.y, ws(cam, CASINO_TABLE.r), ws(cam, CASINO_TABLE.r * 0.7), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawFacilityLabel(ctx, s.x, s.y - ws(cam, 88), 'VIP 德州牌桌', cam.scale, hoverId === 'poker_table');
}

function drawNpcs(
  ctx: CanvasRenderingContext2D, cam: PaperCamera, zone: ZoneId, t: number,
  npcBubble: { npcId: string; text: string; until: number } | null,
) {
  (ZONE_NPCS[zone] ?? []).forEach((npc: ZoneNpcDef) => {
    const s = pt(cam, npc.px, npc.py);
    drawNpc(ctx, s.x, s.y, { npcRole: npc.npcRole, color: npc.color, name: npc.name, wave: t });
    if (npcBubble && npcBubble.npcId === npc.id && performance.now() < npcBubble.until) {
      drawSpeechBubble(ctx, s.x, s.y - ws(cam, 28), npcBubble.text, cam.scale);
    }
  });
}

function drawHallScene(
  ctx: CanvasRenderingContext2D, cam: PaperCamera, zone: ZoneId,
  agents: Record<string, CharState>, ticker: Record<string, number>, t: number,
  hoverId: string | null,
) {
  drawBigTicker(ctx, cam, zone, ticker, t);
  drawCoffeeZone(ctx, pt(cam, HALL_COFFEE.px, HALL_COFFEE.py).x, pt(cam, HALL_COFFEE.px, HALL_COFFEE.py).y, cam.scale, t);
  drawHallDesks(ctx, cam, agents, t, hoverId);
  drawHallRest(ctx, cam, hoverId);
}

function countInZone(agents: Record<string, CharState>, zone: ZoneId) {
  return Object.values(agents).filter(a => {
    if (a.activity === 'dine' && zone === 'restaurant') return true;
    if (a.activity === 'massage' && zone === 'spa') return true;
    if (a.activity === 'poker' && zone === 'casino') return true;
    if (a.activity === 'rest' && zone === 'hall') return true;
    return false;
  }).length;
}

export function renderZone(
  ctx: CanvasRenderingContext2D,
  zone: ZoneId,
  cam: PaperCamera,
  agents: Record<string, CharState>,
  opts: {
    hoverFacilityId: string | null; bob: number; dayMode: 'day' | 'night';
    ticker: Record<string, number>; t: number;
    npcBubble: { npcId: string; text: string; until: number } | null;
    pokerGlbReady?: boolean;
  },
) {
  const layout = ZONE_LAYOUTS[zone];
  if (zone === 'casino') {
    drawCasinoVipBackdrop(ctx, cam, (px, py) => pt(cam, px, py), v => ws(cam, v), opts.dayMode);
  } else if (zone === 'spa') {
    drawSpaZenBackdrop(ctx, cam, (px, py) => pt(cam, px, py), v => ws(cam, v), opts.dayMode);
  } else if (zone === 'restaurant') {
    drawCantoneseBackdrop(ctx, cam, (px, py) => pt(cam, px, py), v => ws(cam, v), opts.dayMode);
  } else {
    ctx.fillStyle = opts.dayMode === 'day' ? layout.floorColor : '#2a2838';
    ctx.fillRect(0, 0, cam.cw, cam.ch);
  }
  if (zone === 'casino' && opts.pokerGlbReady) punchCasinoTableHole(ctx, cam);

  switch (zone) {
    case 'hall':
      drawHallScene(ctx, cam, zone, agents, opts.ticker, opts.t, opts.hoverFacilityId);
      break;
    case 'spa':
      drawSpaScene(ctx, cam, opts.t, opts.hoverFacilityId, agents);
      drawNpcs(ctx, cam, zone, opts.t, opts.npcBubble);
      break;
    case 'restaurant':
      drawRestaurantScene(ctx, cam, opts.hoverFacilityId, opts.t, agents);
      drawNpcs(ctx, cam, zone, opts.t, opts.npcBubble);
      break;
    case 'casino':
      drawCasinoScene(ctx, cam, opts.t, opts.hoverFacilityId, !!opts.pokerGlbReady);
      drawNpcs(ctx, cam, zone, opts.t, opts.npcBubble);
      break;
    case 'reception':
      drawNpcs(ctx, cam, zone, opts.t, opts.npcBubble);
      break;
  }

  layout.navArrows.forEach(a => {
    const s = pt(cam, a.x, a.y);
    drawNavArrow(ctx, s.x, s.y, a.label, a.dir, opts.bob);
  });

  const n = countInZone(agents, zone);
  if (n > 0) {
    ctx.fillStyle = 'rgba(61,53,48,0.45)';
    ctx.font = `600 ${Math.max(10, ws(cam, 11))}px Inter,sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${n} 位 Agent 在此活动`, ws(cam, 12), cam.ch - ws(cam, 10));
  }
}

function agentFacing(char: CharState): CharState['facing'] {
  if (char.activity || char.activityPose === 'desk') return char.facing ?? 'n';
  const desk = OfficePath.deskByAgent[char.agentId];
  const atDesk = desk && !char.isWalking && !char.activity && !char.travelIntent
    && OfficePath.nodes[desk]
    && Math.hypot(char.x - OfficePath.nodes[desk].x, char.z - OfficePath.nodes[desk].z) < 1.2;
  if (atDesk && (char.state === 'trading' || char.state === 'scanning')) return 'n';
  return char.facing ?? 's';
}

function agentPose(char: CharState, now = performance.now()): CharState['activityPose'] | undefined {
  if (char.activity) {
    if (char.activity === 'massage') {
      const phase = leisurePhase(char, now);
      if (phase === 'arriving') return 'stand';
      return 'lie';
    }
    if (char.activityPose) return char.activityPose;
    return 'sit';
  }
  const desk = OfficePath.deskByAgent[char.agentId];
  const atDesk = desk && !char.isWalking && !char.travelIntent
    && OfficePath.nodes[desk]
    && Math.hypot(char.x - OfficePath.nodes[desk].x, char.z - OfficePath.nodes[desk].z) < 1.2;
  if (atDesk && (char.state === 'trading' || char.state === 'scanning' || char.activityPose === 'desk')) {
    return 'desk';
  }
  return char.isWalking ? 'stand' : char.activityPose;
}

export function renderAgents(
  ctx: CanvasRenderingContext2D,
  zone: ZoneId,
  cam: PaperCamera,
  agents: Record<string, CharState>,
  visible: (c: CharState) => boolean,
  opts: { selectedId: string | null; t: number; agentBubble?: { agentId: string; text: string; until: number } | null },
) {
  const now = performance.now();
  Object.values(agents).forEach(char => {
    if (!visible(char)) return;
    const leisurePos = getLeisureRenderPaperPos(zone, char, now);
    const paper = leisurePos ?? getAgentPaperPos(zone, char);
    const s = pt(cam, paper.px, paper.py);
    const pose = agentPose(char, now);
    const phase = char.activity ? leisurePhase(char, now) : 'active';
    const trading = char.state === 'trading' || char.state === 'scanning';
    drawAgent(ctx, s.x, s.y, char.data.color, {
      selected: char.agentId === opts.selectedId,
      trading,
      walking: char.isWalking,
      activity: char.activity,
      headwear: char.data.headwear,
      hatStyle: char.data.hatStyle,
      facing: agentFacing(char),
      pose,
      blanket: char.activity === 'massage' && (phase === 'serve' || phase === 'active'),
      t: opts.t,
    });
    const showName = char.agentId === opts.selectedId || char.activity || char.isWalking;
    if (showName) {
      ctx.fillStyle = '#3d3530';
      ctx.font = `600 ${Math.max(9, ws(cam, 10))}px Inter,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(char.data.name.split(' ')[0], s.x, s.y - ws(cam, 30));
    }
    if (opts.agentBubble && opts.agentBubble.agentId === char.agentId && now < opts.agentBubble.until) {
      drawSpeechBubble(ctx, s.x, s.y - ws(cam, 42), opts.agentBubble.text, ws(cam, 1));
    }
  });
}

export function getFacilityPaperPos(zone: ZoneId, facilityId: string) {
  const bed = SPA_BEDS.find(b => b.id === facilityId);
  if (bed) return { x: bed.px, y: bed.py };
  const table = RESTAURANT_TABLES.find(t => t.id === facilityId);
  if (table) return { x: table.px, y: table.py };
  const booth = HALL_REST_BOOTHS.find(b => b.id === facilityId);
  if (booth) return { x: booth.px, y: booth.py };
  if (facilityId === 'poker_table') return { x: CASINO_TABLE.px, y: CASINO_TABLE.py };
  return null;
}
