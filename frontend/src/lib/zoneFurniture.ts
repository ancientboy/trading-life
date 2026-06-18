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
  {
    id: 'dine_1', px: 200, py: 280, label: '餐桌 A',
    chairs: [
      { id: 'dine_1_c1', px: 200, py: 330, facing: 'n' },
      { id: 'dine_1_c2', px: 165, py: 280, facing: 'e' },
      { id: 'dine_1_c3', px: 235, py: 280, facing: 'w' },
    ],
  },
  {
    id: 'dine_2', px: 360, py: 280, label: '餐桌 B',
    chairs: [
      { id: 'dine_2_c1', px: 360, py: 330, facing: 'n' },
      { id: 'dine_2_c2', px: 325, py: 280, facing: 'e' },
      { id: 'dine_2_c3', px: 395, py: 280, facing: 'w' },
    ],
  },
  {
    id: 'dine_3', px: 520, py: 280, label: '餐桌 C',
    chairs: [
      { id: 'dine_3_c1', px: 520, py: 330, facing: 'n' },
      { id: 'dine_3_c2', px: 485, py: 280, facing: 'e' },
      { id: 'dine_3_c3', px: 555, py: 280, facing: 'w' },
    ],
  },
  {
    id: 'dine_4', px: 200, py: 470, label: '餐桌 D',
    chairs: [
      { id: 'dine_4_c1', px: 200, py: 520, facing: 'n' },
      { id: 'dine_4_c2', px: 165, py: 470, facing: 'e' },
      { id: 'dine_4_c3', px: 235, py: 470, facing: 'w' },
    ],
  },
  {
    id: 'dine_5', px: 360, py: 470, label: '餐桌 E',
    chairs: [
      { id: 'dine_5_c1', px: 360, py: 520, facing: 'n' },
      { id: 'dine_5_c2', px: 325, py: 470, facing: 'e' },
      { id: 'dine_5_c3', px: 395, py: 470, facing: 'w' },
    ],
  },
  {
    id: 'dine_6', px: 520, py: 470, label: '餐桌 F',
    chairs: [
      { id: 'dine_6_c1', px: 520, py: 520, facing: 'n' },
      { id: 'dine_6_c2', px: 485, py: 470, facing: 'e' },
      { id: 'dine_6_c3', px: 555, py: 470, facing: 'w' },
    ],
  },
];

export const CASINO_TABLE = { px: 360, py: 330, r: 118 };

export const CASINO_SEATS: PokerSeatDef[] = Array.from({ length: 8 }, (_, i) => {
  const ang = -Math.PI / 2 + (i / 8) * Math.PI * 2;
  const dist = 155;
  const px = CASINO_TABLE.px + Math.cos(ang) * dist;
  const py = CASINO_TABLE.py + Math.sin(ang) * dist;
  const facing = (['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'] as const)[i];
  const fMap: Record<string, 'n' | 's' | 'e' | 'w'> = {
    s: 's', sw: 's', w: 'w', nw: 'n', n: 'n', ne: 'n', e: 'e', se: 's',
  };
  return {
    id: `poker_s${i + 1}`, num: i + 1, px, py,
    facing: fMap[facing] ?? 's',
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
    px: 360, py: 400, color: '#d4af37',
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
    const desk = HALL_DESKS_8.find(d => d.seatId === char.destNode)
      || HALL_DESKS_8[char.agentId.length % HALL_DESKS_8.length];
    const seat = seatPaperPos(desk.row, desk.col);
    return { px: seat.px, py: seat.py };
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
