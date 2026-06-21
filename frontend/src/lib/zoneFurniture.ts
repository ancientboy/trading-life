import type { ZoneId } from '../store/useGameStore';
import { paperToWorld, worldToPaper } from './zoneProjection';
import { HALL_DESKS_8, deskPaperPos, seatPaperPos } from './hallLayout';

export type PaperFacilityAction = 'dine' | 'massage' | 'poker' | 'rest' | 'desk';

/** 纸面坐标系下的分区家具（720×640） */
export interface PaperPoint { px: number; py: number }

export interface ChairSeat extends PaperPoint {
  id: string;
  facing: 'n' | 's' | 'e' | 'w';
}

export interface MassageBedDef extends PaperPoint {
  id: string;
  label: string;
  seat: PaperPoint;
}

export interface DiningTableDef extends PaperPoint {
  id: string;
  label: string;
  chairs: ChairSeat[];
}

/** 餐桌四椅布局 — 与经典贴图一致，椅背朝外、不压桌面（premium 圆桌 rx≈40） */
const DINE_CHAIR_DX = 54;
const DINE_CHAIR_DY = 50;

function makeDiningTable(id: string, px: number, py: number, label: string): DiningTableDef {
  return {
    id, px, py, label,
    chairs: [
      { id: `${id}_c1`, px, py: py + DINE_CHAIR_DY, facing: 'n' },
      { id: `${id}_c2`, px: px - DINE_CHAIR_DX, py, facing: 'e' },
      { id: `${id}_c3`, px: px + DINE_CHAIR_DX, py, facing: 'w' },
      { id: `${id}_c4`, px, py: py - DINE_CHAIR_DY, facing: 's' },
    ],
  };
}

export interface RestBoothDef extends PaperPoint {
  id: string;
  label: string;
  seats: ChairSeat[];
}

export interface PokerSeatDef extends ChairSeat {
  num: number;
}

export const SPA_BEDS: MassageBedDef[] = [
  { id: 'bed_1', px: 130, py: 260, label: '按摩床 1', seat: { px: 130, py: 260 } },
  { id: 'bed_2', px: 310, py: 260, label: '按摩床 2', seat: { px: 310, py: 260 } },
  { id: 'bed_3', px: 490, py: 260, label: '按摩床 3', seat: { px: 490, py: 260 } },
  { id: 'bed_4', px: 130, py: 420, label: '按摩床 4', seat: { px: 130, py: 420 } },
  { id: 'bed_5', px: 310, py: 420, label: '按摩床 5', seat: { px: 310, py: 420 } },
  { id: 'bed_6', px: 490, py: 420, label: '按摩床 6', seat: { px: 490, py: 420 } },
];

export const RESTAURANT_TABLES: DiningTableDef[] = [
  makeDiningTable('dine_1', 200, 280, '餐桌 A'),
  makeDiningTable('dine_2', 360, 280, '餐桌 B'),
  makeDiningTable('dine_3', 520, 280, '餐桌 C'),
  makeDiningTable('dine_4', 200, 470, '餐桌 D'),
  makeDiningTable('dine_5', 360, 470, '餐桌 E'),
  makeDiningTable('dine_6', 520, 470, '餐桌 F'),
];

export const CASINO_TABLE = { px: 360, py: 330, r: 118 };

/** 8 等分圆环，0 号位为正北荷官位（不放玩家椅） */
export const CASINO_SEAT_RING = 8;
export const CASINO_PLAYER_SEATS = 7;
export const CASINO_SEAT_DIST = 155;

export function casinoSeatSlotAngle(slotIndex: number): number {
  return -Math.PI / 2 + (slotIndex / CASINO_SEAT_RING) * Math.PI * 2;
}

/** 7 玩家位：顺时针 1–7，跳过北侧荷官位（slot 0） */
export const CASINO_SEATS: PokerSeatDef[] = Array.from({ length: CASINO_PLAYER_SEATS }, (_, idx) => {
  const num = idx + 1;
  const slot = num; // slot 1..7，跳过 0（荷官正后方）
  const ang = casinoSeatSlotAngle(slot);
  const px = CASINO_TABLE.px + Math.cos(ang) * CASINO_SEAT_DIST;
  const py = CASINO_TABLE.py + Math.sin(ang) * CASINO_SEAT_DIST;
  const compass = (['s', 'sw', 'w', 'nw', 'n', 'ne', 'e'] as const)[idx];
  const fMap: Record<string, 'n' | 's' | 'e' | 'w'> = {
    s: 's', sw: 's', w: 'w', nw: 'n', n: 'n', ne: 'n', e: 'e',
  };
  return {
    id: `poker_s${num}`, num, px, py,
    facing: fMap[compass] ?? 's',
  };
});

export const HALL_REST_BOOTHS: RestBoothDef[] = [
  {
    id: 'rest_l_1', px: 200, py: 520, label: '休息包厢 A',
    seats: [
      { id: 'rest_l_1_s1', px: 175, py: 535, facing: 'e' },
      { id: 'rest_l_1_s2', px: 225, py: 535, facing: 'w' },
    ],
  },
  {
    id: 'rest_l_2', px: 520, py: 520, label: '休息包厢 B',
    seats: [
      { id: 'rest_l_2_s1', px: 495, py: 535, facing: 'e' },
      { id: 'rest_l_2_s2', px: 545, py: 535, facing: 'w' },
    ],
  },
];

import { ARENA_PIT, ARENA_PODS } from './arenaLayout';
import type { NpcRole } from './npcOutfits';

export interface ZoneNpcDef {
  id: string;
  name: string;
  role: string;
  npcRole: NpcRole;
  px: number;
  py: number;
  color: string;
  greetings: string[];
}

export const ZONE_NPCS: Record<ZoneId, ZoneNpcDef[]> = {
  hall: [],
  reception: [{
    id: 'reception', name: '迎宾 Gugu', role: '前厅接待', npcRole: 'reception',
    px: 360, py: 362, color: '#d4af37',
    greetings: ['欢迎来到交易人生！', '需要创建新 Agent 吗？', '今日任务已更新～'],
  }],
  restaurant: [{
    id: 'lily', name: '服务员 Lily', role: '餐厅服务', npcRole: 'waiter',
    px: 360, py: 180, color: '#e879a9',
    greetings: ['欢迎光临，请入座～', '今日特餐：能量意面！', '用餐可恢复 30% 压力'],
  }],
  spa: [{
    id: 'masseur', name: '技师 Gaga', role: '按摩技师', npcRole: 'masseur',
    px: 600, py: 340, color: '#c8a8e8',
    greetings: ['请躺好，开始放松～', '深度理疗可减 50% 压力', '需要加钟吗？'],
  }],
  casino: [{
    id: 'dealer', name: '荷官 Jack', role: '德州荷官', npcRole: 'dealer',
    px: 360, py: 160, color: '#d4af37',
    greetings: ['欢迎入座，祝你好运！', '请各位 Agent 就位', '发牌开始～'],
  }],
  arena: [{
    id: 'ava', name: '解说 Ava', role: '竞技解说', npcRole: 'reception',
    px: 360, py: 130, color: '#4a90c8',
    greetings: ['欢迎来到交易竞技馆！', 'BTC 猜涨跌 60 秒一局', '短线大赛每 30 秒 AI 换向操作', '观众可押冠亚季军～'],
  }],
};

/** 纸面 → 世界坐标（写入寻路） */
export function paperSeatToWorld(zone: ZoneId, pt: PaperPoint) {
  return paperToWorld(zone, pt.px, pt.py);
}

export function syncFurnitureToPathfinding(
  nodes: Record<string, { x: number; z: number }>,
  zone: ZoneId,
) {
  if (zone === 'spa') {
    SPA_BEDS.forEach(b => { nodes[b.id] = paperSeatToWorld(zone, b.seat); });
    return;
  }
  if (zone === 'restaurant') {
    RESTAURANT_TABLES.forEach(t => {
      nodes[t.id] = paperSeatToWorld(zone, { px: t.px, py: t.py });
      t.chairs.forEach(c => { nodes[c.id] = paperSeatToWorld(zone, c); });
    });
    return;
  }
  if (zone === 'casino') {
    CASINO_SEATS.forEach(s => { nodes[s.id] = paperSeatToWorld(zone, s); });
    nodes.poker_table = paperSeatToWorld(zone, { px: CASINO_TABLE.px, py: CASINO_TABLE.py });
    return;
  }
  if (zone === 'arena') {
    nodes.arena_pit = paperSeatToWorld(zone, { px: ARENA_PIT.px, py: ARENA_PIT.py });
    ARENA_PODS.forEach(p => { nodes[p.id] = paperSeatToWorld(zone, p); });
    return;
  }
  if (zone === 'hall') {
    HALL_REST_BOOTHS.forEach(b => {
      nodes[b.id] = paperSeatToWorld(zone, { px: b.px, py: b.py });
      b.seats.forEach(s => { nodes[s.id] = paperSeatToWorld(zone, s); });
    });
  }
}

export type ActivityPose = 'stand' | 'sit' | 'lie' | 'desk';

export interface ActivitySlot {
  px: number;
  py: number;
  facing: 'n' | 's' | 'e' | 'w';
  pose: ActivityPose;
  slotId: string;
}

export function resolveActivitySlot(
  activity: string,
  nodeId: string | null,
  agentId: string,
): ActivitySlot | null {
  if (activity === 'massage') {
    const bed = SPA_BEDS.find(b => b.id === nodeId)
      || SPA_BEDS.find(b => b.id === nodeId?.replace(/_lie$/, ''))
      || SPA_BEDS[agentId.length % SPA_BEDS.length];
    if (!bed) return null;
    return { px: bed.px, py: bed.py, facing: 'n', pose: 'lie', slotId: bed.id };
  }
  if (activity === 'dine') {
    const chair = RESTAURANT_TABLES.flatMap(t => t.chairs).find(c => c.id === nodeId);
    if (chair) return { ...chair, pose: 'sit', slotId: chair.id };
    const table = RESTAURANT_TABLES.find(t => t.id === nodeId) || RESTAURANT_TABLES[agentId.length % RESTAURANT_TABLES.length];
    const ch = table.chairs[agentId.length % table.chairs.length];
    return { ...ch, pose: 'sit', slotId: ch.id };
  }
  if (activity === 'poker') {
    const seat = CASINO_SEATS.find(s => s.id === nodeId) || CASINO_SEATS[agentId.length % CASINO_SEATS.length];
    return { px: seat.px, py: seat.py, facing: seat.facing, pose: 'sit', slotId: seat.id };
  }
  if (activity === 'rest') {
    const seat = HALL_REST_BOOTHS.flatMap(b => b.seats).find(s => s.id === nodeId);
    if (seat) return { ...seat, pose: 'sit', slotId: seat.id };
    const booth = HALL_REST_BOOTHS.find(b => b.id === nodeId) || HALL_REST_BOOTHS[0];
    const s = booth.seats[agentId.length % booth.seats.length];
    return { ...s, pose: 'sit', slotId: s.id };
  }
  if (activity === 'desk') {
    const desk = HALL_DESKS_8.find(d => d.seatId === nodeId || d.id === nodeId);
    if (desk) {
      const sp = seatPaperPos(desk.row, desk.col);
      return { px: sp.px, py: sp.py, facing: 'n', pose: 'desk', slotId: desk.seatId };
    }
    const fallback = HALL_DESKS_8[agentId.length % HALL_DESKS_8.length];
    const sp = seatPaperPos(fallback.row, fallback.col);
    return { px: sp.px, py: sp.py, facing: 'n', pose: 'desk', slotId: fallback.seatId };
  }
  return null;
}

export function getActivitySeatPaper(
  activity: string,
  nodeId: string | null,
  agentId: string,
): PaperPoint | null {
  const slot = resolveActivitySlot(activity, nodeId, agentId);
  return slot ? { px: slot.px, py: slot.py } : null;
}

export function getAgentPaperPos(
  zone: ZoneId,
  char: {
    x: number; z: number; activity: string | null; destNode: string | null; agentId: string;
    activityPose?: ActivityPose;
  },
): { px: number; py: number } {
  if (char.activity) {
    const seat = getActivitySeatPaper(char.activity, char.destNode, char.agentId);
    if (seat) return seat;
  }
  if (char.activityPose === 'desk' && zone === 'hall') {
    const desk = char.destNode
      ? HALL_DESKS_8.find(d => d.seatId === char.destNode || d.id === char.destNode)
      : null;
    if (desk) {
      const seat = seatPaperPos(desk.row, desk.col);
      return { px: seat.px, py: seat.py };
    }
  }
  const w = worldToPaper(zone, char.x, char.z);
  return { px: w.x, py: w.y };
}

export function hitTestPaperFacilities(
  zone: ZoneId,
  paper: PaperPoint,
): { action: PaperFacilityAction; nodeId: string; id: string } | null {
  if (zone === 'spa') {
    for (const b of SPA_BEDS) {
      if (Math.hypot(paper.px - b.px, paper.py - b.py) < 52) {
        return { action: 'massage', nodeId: b.id, id: b.id };
      }
    }
  }
  if (zone === 'restaurant') {
    for (const t of RESTAURANT_TABLES) {
      if (Math.hypot(paper.px - t.px, paper.py - t.py) < 48) {
        return { action: 'dine', nodeId: t.id, id: t.id };
      }
    }
  }
  if (zone === 'casino') {
    if (Math.hypot(paper.px - CASINO_TABLE.px, paper.py - CASINO_TABLE.py) < CASINO_TABLE.r) {
      const seat = CASINO_SEATS.reduce((best, s) => {
        const d = Math.hypot(paper.px - s.px, paper.py - s.py);
        return !best || d < best.d ? { s, d } : best;
      }, null as { s: PokerSeatDef; d: number } | null);
      return { action: 'poker', nodeId: seat?.s.id ?? 'poker_s1', id: 'poker_table' };
    }
  }
  if (zone === 'hall') {
    for (const d of HALL_DESKS_8) {
      const p = deskPaperPos(d.row, d.col);
      if (Math.hypot(paper.px - p.px, paper.py - p.py) < 44) {
        return { action: 'desk', nodeId: d.seatId, id: d.id };
      }
    }
    for (const b of HALL_REST_BOOTHS) {
      if (Math.hypot(paper.px - b.px, paper.py - b.py) < 62) {
        return { action: 'rest', nodeId: b.id, id: b.id };
      }
    }
  }
  return null;
}

export function npcForZone(zone: ZoneId): ZoneNpcDef | undefined {
  return ZONE_NPCS[zone]?.[0];
}

export function greetingForActivity(zone: ZoneId): string | null {
  const npc = npcForZone(zone);
  if (!npc) return null;
  return npc.greetings[Math.floor(Math.random() * npc.greetings.length)];
}
