import type { ZoneId } from '../store/useGameStore';

/** 各分区独立场景 — 本地坐标系，原点在房间中心 */
export const ZONE_META: Record<ZoneId, { label: string; floorColor: string; w: number; d: number }> = {
  hall: { label: '交易大厅', floorColor: '#f5f0e8', w: 22, d: 14 },
  reception: { label: '前厅接待', floorColor: '#faf6ef', w: 18, d: 10 },
  restaurant: { label: '餐厅', floorColor: '#fff8eb', w: 20, d: 14 },
  spa: { label: '按摩放松区', floorColor: '#f0ebf8', w: 20, d: 14 },
  casino: { label: '德州扑克', floorColor: '#f5efe6', w: 20, d: 14 },
};

/** 德州牌桌中心（本地坐标） */
export const CASINO_TABLE = { x: 0, z: 0.5 };

/** 牌桌环绕空座位 — Agent 入座时对齐 */
export const CASINO_SEATS: { id: string; x: number; z: number; rotY: number }[] = [
  { id: 'xau', x: -2.8, z: 2.6, rotY: -0.35 },
  { id: 'major', x: -0.4, z: 3.5, rotY: Math.PI },
  { id: 'altcoin', x: 2.4, z: 2.5, rotY: 0.45 },
  { id: 'newcoin', x: 2.9, z: -0.2, rotY: 1.1 },
  { id: 'momentum', x: -2.5, z: -0.8, rotY: -1.0 },
];

/** 由座位生成的 Agent 展示坐标（略靠牌桌） */
function seatSpot(seat: { x: number; z: number }) {
  const tx = CASINO_TABLE.x, tz = CASINO_TABLE.z;
  const dx = tx - seat.x, dz = tz - seat.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  return { x: seat.x + (dx / len) * 0.35, z: seat.z + (dz / len) * 0.35 };
}

const CASINO_AGENT_SPOTS = Object.fromEntries(
  CASINO_SEATS.map(s => [s.id, seatSpot(s)]),
) as Record<string, { x: number; z: number }>;

/** 按摩隔间 — 一 Agent 一床位 */
export const SPA_CUBICLES: { id: string; agentId: string; x: number; z: number }[] = [
  { id: 'bed_xau', agentId: 'xau', x: -6, z: 2 },
  { id: 'bed_major', agentId: 'major', x: -3, z: 2 },
  { id: 'bed_alt', agentId: 'altcoin', x: 0, z: 2 },
  { id: 'bed_new', agentId: 'newcoin', x: 3, z: 2 },
  { id: 'bed_mom', agentId: 'momentum', x: 6, z: 2 },
];

/** 公共等候走廊沙发 */
export const SPA_WAIT_SOFAS: { x: number; z: number; rotY: number }[] = [
  { x: -4.5, z: -3.5, rotY: 0 },
  { x: 0, z: -3.8, rotY: 0 },
  { x: 4.5, z: -3.5, rotY: 0 },
];

/** 技师 NPC 待机点位 */
export const SPA_THERAPIST = { x: 7.8, z: -1.2 };

const SPA_AGENT_SPOTS = Object.fromEntries(
  SPA_CUBICLES.map(c => [c.agentId, { x: c.x, z: c.z }]),
) as Record<string, { x: number; z: number }>;

export const HALL_DESKS: [number, number, number][] = [
  [-6, 0.5, -2], [-3, 0.5, -2], [0, 0.5, -2], [3, 0.5, -2], [6, 0.5, -2],
];

export const HALL_AGENT_START: Record<string, { x: number; z: number }> = {
  xau: { x: -6, z: -2 }, major: { x: -3, z: -2 }, altcoin: { x: 0, z: -2 },
  newcoin: { x: 3, z: -2 }, momentum: { x: 6, z: -2 },
};

/** 大厅休息包厢（本地坐标） */
export const HALL_BOOTHS: { id: string; x: number; z: number; label: string }[] = [
  { id: 'rest_l_1', x: -5.8, z: 5.15, label: '休息包厢 A' },
  { id: 'rest_l_2', x: 5.8, z: 5.15, label: '休息包厢 B' },
];

export const HALL_COFFEE = { x: 2.4, z: 5.6 };

export function agentDisplayZone(char: { activity: string | null }): ZoneId {
  if (char.activity === 'dine') return 'restaurant';
  if (char.activity === 'massage') return 'spa';
  if (char.activity === 'poker') return 'casino';
  return 'hall';
}

/** 休闲区展示位 */
export const LEISURE_SPOTS: Record<ZoneId, Record<string, { x: number; z: number }>> = {
  hall: {},
  reception: {},
  restaurant: {
    xau: { x: -4, z: 1 }, major: { x: 0, z: 1 }, altcoin: { x: 4, z: 1 },
    newcoin: { x: -4, z: 4 }, momentum: { x: 4, z: 4 },
  },
  spa: SPA_AGENT_SPOTS,
  casino: CASINO_AGENT_SPOTS,
};

export const SIDEBAR_TO_ZONE: Partial<Record<string, ZoneId>> = {
  hall: 'hall',
  restaurant: 'restaurant',
  spa: 'spa',
  casino: 'casino',
};

export const ZONE_TO_RIGHT_TAB: Record<ZoneId, import('../store/useGameStore').RightTab> = {
  hall: 'hall',
  reception: 'npc',
  restaurant: 'facility',
  spa: 'facility',
  casino: 'facility',
};
