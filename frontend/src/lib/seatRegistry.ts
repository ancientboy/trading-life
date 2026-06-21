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
  if (occ.until_ts > 0 && occ.until_ts < nowMs) return true;
  return false;
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

/** 合并服务端占座与本地 Agent 当前占用，避免多人叠坐 */
export function mergeLocalSeatOccupancy(
  serverSeats: SeatMap,
  agents: Record<string, CharState>,
  nowMs = seatNowMs(),
): SeatMap {
  const merged: SeatMap = { ...serverSeats };
  for (const char of Object.values(agents)) {
    if (!char.destNode) continue;
    const seatId = char.destNode;
    const activity = char.activity ?? (char.activityPose === 'desk' ? 'desk' : null);
    if (!activity || !LOCAL_SEAT_ACTIVITIES.has(activity)) continue;
    if (!allSeatIds().includes(seatId)) continue;
    merged[seatId] = {
      user_id: 'local',
      agent_id: char.agentId,
      activity,
      until_ts: activityWallExpiry(char, nowMs),
    };
  }
  return merged;
}
