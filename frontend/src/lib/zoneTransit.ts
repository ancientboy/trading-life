import type { ZoneId } from '../store/useGameStore';
import { OfficePath } from './pathfinding';
import { ZONES } from './pathfinding';
import { zoneAtPosition } from './collision';

const INTENT_ZONE: Record<string, ZoneId> = {
  dine: 'restaurant', massage: 'spa', poker: 'casino', rest: 'hall',
};

/** 推断 Agent 当前所在分区（跟随镜头 / 跨区导航） */
export function resolveAgentZone(char: {
  x: number; z: number;
  activity?: string | null;
  travelIntent?: string | null;
  transitZone?: ZoneId;
  inTransit?: boolean;
}): ZoneId {
  if (char.inTransit && char.transitZone) return char.transitZone;
  if (char.activity && INTENT_ZONE[char.activity]) return INTENT_ZONE[char.activity];
  if (char.travelIntent && INTENT_ZONE[char.travelIntent]) return INTENT_ZONE[char.travelIntent];
  return zoneAtPosition(char.x, char.z);
}

export function zoneForNode(nodeId: string | null): ZoneId | null {
  if (!nodeId) return null;
  const n = OfficePath.nodes[nodeId];
  if (!n) return null;
  for (const z of ZONES) {
    const hw = z.w / 2, hd = z.d / 2;
    if (n.x >= z.x - hw && n.x <= z.x + hw && n.z >= z.z - hd && n.z <= z.z + hd) return z.id as ZoneId;
  }
  if (nodeId.startsWith('bed_')) return 'spa';
  if (nodeId.startsWith('dine_')) return 'restaurant';
  if (nodeId.startsWith('poker_')) return 'casino';
  if (nodeId.startsWith('rest_l') || nodeId.startsWith('seat_') || nodeId.startsWith('desk_')) return 'hall';
  return null;
}

export function zoneForIntent(intent: string | null | undefined): ZoneId | null {
  return intent ? INTENT_ZONE[intent] ?? null : null;
}

export function isCrossZoneTravel(
  fromZone: ZoneId,
  destNode: string,
  travelIntent?: string | null,
): boolean {
  const dest = zoneForNode(destNode) ?? zoneForIntent(travelIntent);
  if (!dest || dest === fromZone) return false;
  if (fromZone === 'hall' && (dest === 'spa' || dest === 'casino' || dest === 'restaurant')) return true;
  if (fromZone !== 'hall' && dest === 'hall') return true;
  if (fromZone !== dest) return true;
  return false;
}

export const ZONE_TRANSIT_MS = 1100;
