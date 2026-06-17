import type { ZoneId } from '../store/useGameStore';
import { hallObstacleRects, paperToWorldHall } from './hallLayout';
import { paperToWorld } from './zoneProjection';

export interface ObstacleCircle {
  x: number; z: number; r: number;
}

function paperRectToWorld(zone: ZoneId, rect: { x: number; y: number; w: number; h: number }) {
  const tl = paperToWorld(zone, rect.x - rect.w / 2, rect.y - rect.h / 2);
  const br = paperToWorld(zone, rect.x + rect.w / 2, rect.y + rect.h / 2);
  return { minX: Math.min(tl.x, br.x), maxX: Math.max(tl.x, br.x), minZ: Math.min(tl.z, br.z), maxZ: Math.max(tl.z, br.z) };
}

let hallWorldRects: { minX: number; maxX: number; minZ: number; maxZ: number }[] | null = null;

function getHallRects() {
  if (!hallWorldRects) {
    hallWorldRects = hallObstacleRects().map(r => {
      const tl = paperToWorldHall(r.x, r.y);
      const br = paperToWorldHall(r.x + r.w, r.y + r.h);
      return {
        minX: Math.min(tl.x, br.x), maxX: Math.max(tl.x, br.x),
        minZ: Math.min(tl.z, br.z), maxZ: Math.max(tl.z, br.z),
      };
    });
  }
  return hallWorldRects;
}

export function zoneAtPosition(wx: number, wz: number): ZoneId {
  if (wx < 28) {
    if (wz < 15) return 'hall';
    if (wz < 25) return 'restaurant';
    return 'reception';
  }
  if (wz < 15) return 'spa';
  return 'casino';
}

export function isWorldBlocked(wx: number, wz: number, agentRadius = 0.35): boolean {
  const zone = zoneAtPosition(wx, wz);
  if (zone !== 'hall') return false;
  for (const r of getHallRects()) {
    if (wx + agentRadius > r.minX && wx - agentRadius < r.maxX
      && wz + agentRadius > r.minZ && wz - agentRadius < r.maxZ) {
      return true;
    }
  }
  return false;
}

/** 尝试移动，遇障碍则取消步进 */
export function moveWithCollision(
  x: number, z: number, nx: number, nz: number,
): { x: number; z: number; blocked: boolean } {
  if (!isWorldBlocked(nx, nz)) return { x: nx, z: nz, blocked: false };
  if (!isWorldBlocked(nx, z)) return { x: nx, z, blocked: true };
  if (!isWorldBlocked(x, nz)) return { x, z: nz, blocked: true };
  return { x, z, blocked: true };
}

export function invalidateCollisionCache() {
  hallWorldRects = null;
}
