import type { CharState } from './constants';
import { HALL_DESKS_8 } from './hallLayout';
import { SPA_BEDS, RESTAURANT_TABLES, CASINO_SEATS, HALL_REST_BOOTHS, resolveActivitySlot } from './zoneFurniture';

export interface SeatOccupant {
  user_id: string;
  agent_id: string;
  activity: string;
  until_ts: number;
}

export type SeatMap = Record<string, SeatOccupant>;

/** 与服务端 seat_occupancy.until_ts 对齐的 wall-clock 毫秒 */
export function seatNowMs(): number {
  return Date.now();
}

/** activityUntil 使用 performance.now()；换算为 Unix 毫秒供占座合并 */
export function activityWallExpiry(char: CharState, wallNowMs = seatNowMs()): number {
  const until = char.activityUntil;
  if (until <= 0) return wallNowMs + 60_000;
  if (until > 1e12) return until;
  const started = char.activityStartedAt ?? 0;
  if (started > 0 && started < 1e12 && until > started) {
    return wallNowMs + (until - started);
  }
  return wallNowMs + 60_000;
}

/** 所有可坐位置（每座同时最多一人） */
export function allSeatIds(): string[] {
  const seats: string[] = [];
  SPA_BEDS.forEach(b => seats.push(b.id));
  RESTAURANT_TABLES.forEach(t => t.chairs.forEach(c => seats.push(c.id)));
  CASINO_SEATS.forEach(s => seats.push(s.id));
  HALL_REST_BOOTHS.forEach(b => b.seats.forEach(s => seats.push(s.id)));
  HALL_DESKS_8.forEach(d => seats.push(d.seatId));
  return seats;
}

export function seatsForActivity(activity: string): string[] {
  switch (activity) {
    case 'massage': return SPA_BEDS.map(b => b.id);
    case 'dine': return RESTAURANT_TABLES.flatMap(t => t.chairs.map(c => c.id));
    case 'poker': return CASINO_SEATS.map(s => s.id);
    case 'rest': return HALL_REST_BOOTHS.flatMap(b => b.seats.map(s => s.id));
    case 'desk': return HALL_DESKS_8.map(d => d.seatId);
    default: return [];
  }
}

function isSeatFree(seatId: string, agentId: string, occupied: SeatMap, nowMs: number): boolean {
  const occ = occupied[seatId];
  if (!occ) return true;
  if (occ.agent_id === agentId) return true;
  // until_ts<=0 为过期/脏数据（服务端 purge 亦只删 until_ts>0 且已过期）
  if (occ.until_ts <= 0 || occ.until_ts < nowMs) return true;
  return false;
}

/** 某活动当前可用座位数（用于失败提示） */
export function countFreeSeats(
  activity: string,
  agentId: string,
  occupied: SeatMap,
  nowMs = seatNowMs(),
): { free: number; total: number } {
  const candidates = seatsForActivity(activity);
  const free = candidates.filter(id => isSeatFree(id, agentId, occupied, nowMs)).length;
  return { free, total: candidates.length };
}

export const ACTIVITY_SEAT_LABEL: Record<string, string> = {
  massage: '按摩床',
  dine: '餐厅座位',
  poker: '德州牌桌',
  rest: '休息沙发',
  desk: '工位',
};

export const ACTIVITY_ZONE: Record<string, import('../store/useGameStore').ZoneId> = {
  rest: 'hall',
  desk: 'hall',
  dine: 'restaurant',
  massage: 'spa',
  poker: 'casino',
};

/** 座位已满时的提示文案（避免「0/4 空位」被误解为「0 人占用」） */
export function formatSeatCapacityMessage(label: string, free: number, total: number): string {
  if (free <= 0) return `${label}已满（共 ${total} 座，均已占用）`;
  return `${label}剩余 ${free} 个空位（共 ${total} 座）`;
}

/** 仅分配指定工位/座位，被占则返回 null（不自动换座） */
export function resolvePreferredSeat(
  activity: string,
  preferredNodeId: string | null,
  agentId: string,
  occupied: SeatMap,
  nowMs = seatNowMs(),
): string | null {
  const slot = resolveActivitySlot(activity, preferredNodeId, agentId);
  if (!slot) return null;
  return isSeatFree(slot.slotId, agentId, occupied, nowMs) ? slot.slotId : null;
}

/** 座位被占时自动选备选位（休闲设施等场景） */
export function resolveAvailableSeat(
  activity: string,
  preferredNodeId: string | null,
  agentId: string,
  occupied: SeatMap,
  nowMs = seatNowMs(),
): string | null {
  const preferred = resolvePreferredSeat(activity, preferredNodeId, agentId, occupied, nowMs);
  if (preferred) return preferred;

  const candidates = seatsForActivity(activity);
  const start = agentId.length % Math.max(candidates.length, 1);
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[(start + i) % candidates.length];
    if (isSeatFree(id, agentId, occupied, nowMs)) return id;
  }
  return null;
}

export function hasFreeSeat(activity: string, agentId: string, occupied: SeatMap, nowMs = seatNowMs()): boolean {
  return resolveAvailableSeat(activity, null, agentId, occupied, nowMs) !== null;
}

const LOCAL_SEAT_ACTIVITIES = new Set(['dine', 'massage', 'poker', 'rest', 'desk']);

const VALID_SEAT_IDS = new Set(allSeatIds());

function agentOccupiesSeat(char: CharState): boolean {
  if (char.isWalking || char.inTransit) return false;
  if (char.travelIntent && !char.activity) return false;
  if (!char.destNode) return false;
  const activity = char.activity ?? (char.activityPose === 'desk' ? 'desk' : null);
  if (!activity || !LOCAL_SEAT_ACTIVITIES.has(activity)) return false;
  return allSeatIds().includes(char.destNode);
}

/** 合并服务端占座与本地 Agent 当前占用，避免多人叠坐 */
export function mergeLocalSeatOccupancy(
  serverSeats: SeatMap,
  agents: Record<string, CharState>,
  nowMs = seatNowMs(),
): SeatMap {
  const localAgentIds = new Set(Object.keys(agents));
  const merged: SeatMap = {};
  for (const [seatId, occ] of Object.entries(serverSeats)) {
    if (!VALID_SEAT_IDS.has(seatId)) continue;
    if (occ.until_ts <= 0 || occ.until_ts < nowMs) continue;
    // 服务端残留占座：本地已无该 Agent 时忽略（避免「视觉空座但 0/4 满」）
    if (occ.agent_id && !localAgentIds.has(occ.agent_id)) continue;
    merged[seatId] = occ;
  }
  for (const char of Object.values(agents)) {
    if (!agentOccupiesSeat(char)) continue;
    const seatId = char.destNode!;
    const activity = char.activity ?? (char.activityPose === 'desk' ? 'desk' : null)!;
    merged[seatId] = {
      user_id: 'local',
      agent_id: char.agentId,
      activity,
      until_ts: activityWallExpiry(char, nowMs),
    };
  }
  return merged;
}
