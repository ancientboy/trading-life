import { HALL_DESKS_8 } from './hallLayout';
import { SPA_BEDS, RESTAURANT_TABLES, CASINO_SEATS, HALL_REST_BOOTHS, resolveActivitySlot } from './zoneFurniture';

export interface SeatOccupant {
  user_id: string;
  agent_id: string;
  activity: string;
  until_ts: number;
}

export type SeatMap = Record<string, SeatOccupant>;

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

/** 座位被占时自动选备选位 */
export function resolveAvailableSeat(
  activity: string,
  preferredNodeId: string | null,
  agentId: string,
  occupied: SeatMap,
  nowMs = Date.now(),
): string | null {
  const slot = resolveActivitySlot(activity, preferredNodeId, agentId);
  if (slot && isSeatFree(slot.slotId, agentId, occupied, nowMs)) return slot.slotId;

  const candidates = seatsForActivity(activity);
  const start = agentId.length % Math.max(candidates.length, 1);
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[(start + i) % candidates.length];
    if (isSeatFree(id, agentId, occupied, nowMs)) return id;
  }
  return null;
}

export function hasFreeSeat(activity: string, agentId: string, occupied: SeatMap, nowMs = Date.now()): boolean {
  return resolveAvailableSeat(activity, null, agentId, occupied, nowMs) !== null;
}
