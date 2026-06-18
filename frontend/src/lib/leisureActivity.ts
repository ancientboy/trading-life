import type { CharState } from './constants';
import { RESTAURANT_TABLES, SPA_BEDS, HALL_REST_BOOTHS } from './zoneFurniture';

export type LeisurePhase = 'arriving' | 'serve' | 'active';

const DINE_SERVE_MS = 1400;
const MASSAGE_ARRIVE_MS = 900;
const MASSAGE_SERVE_MS = 3200;

export function leisurePhase(char: CharState, now = performance.now()): LeisurePhase {
  if (!char.activity || char.activityStartedAt == null) return 'active';
  const elapsed = now - char.activityStartedAt;
  if (char.activity === 'dine') {
    return elapsed < DINE_SERVE_MS ? 'serve' : 'active';
  }
  if (char.activity === 'massage') {
    if (elapsed < MASSAGE_ARRIVE_MS) return 'arriving';
    if (elapsed < MASSAGE_SERVE_MS) return 'serve';
    return 'active';
  }
  return 'active';
}

export function tableIdForDineAgent(char: CharState): string | null {
  if (char.activity !== 'dine' || !char.destNode) return null;
  if (char.destNode.startsWith('dine_') && !char.destNode.includes('_c')) return char.destNode;
  const chair = RESTAURANT_TABLES.flatMap(t => t.chairs).find(c => c.id === char.destNode);
  if (chair) {
    return RESTAURANT_TABLES.find(t => t.chairs.some(c => c.id === chair.id))?.id ?? null;
  }
  return null;
}

export function bedIdForMassageAgent(char: CharState): string | null {
  if (char.activity !== 'massage' || !char.destNode) return null;
  return char.destNode.startsWith('bed_') ? char.destNode : null;
}

/** 休闲活动渲染位置（含按摩上床过渡） */
export function getLeisureRenderPaperPos(
  zone: string,
  char: CharState,
  now = performance.now(),
): { px: number; py: number } | null {
  if (zone === 'spa' && char.activity === 'massage') {
    const bed = SPA_BEDS.find(b => b.id === char.destNode);
    if (!bed) return null;
    const phase = leisurePhase(char, now);
    if (phase === 'arriving') return { px: bed.px + 44, py: bed.py + 10 };
    return { px: bed.px, py: bed.py };
  }
  if (zone === 'restaurant' && char.activity === 'dine') {
    const chair = RESTAURANT_TABLES.flatMap(t => t.chairs).find(c => c.id === char.destNode);
    if (chair) return { px: chair.px, py: chair.py };
  }
  if (zone === 'hall' && char.activity === 'rest') {
    const seat = HALL_REST_BOOTHS.flatMap(b => b.seats).find(s => s.id === char.destNode);
    if (seat) {
      const tuck = seat.facing === 'e' ? -10 : 10;
      return { px: seat.px + tuck, py: seat.py - 6 };
    }
    const booth = HALL_REST_BOOTHS.find(b => b.id === char.destNode);
    if (booth) return { px: booth.px, py: booth.py - 4 };
  }
  return null;
}

export { DINE_SERVE_MS, MASSAGE_ARRIVE_MS, MASSAGE_SERVE_MS };
