import type { ZoneId } from '../store/useGameStore';
import { ZONE_CAMERA } from './worldMap';
import { ZONES } from './pathfinding';

/** 纸面分区画布尺寸（对齐 office-engine 比例） */
export const PAPER = {
  zoneW: 720,
  zoneH: 640,
  /** 世界单位 → 纸面像素 */
  ppu: 28,
};

export function worldToPaper(zone: ZoneId, wx: number, wz: number) {
  const cam = ZONE_CAMERA[zone];
  return {
    x: PAPER.zoneW / 2 + (wx - cam.x) * PAPER.ppu,
    y: PAPER.zoneH / 2 + (wz - cam.z) * PAPER.ppu,
  };
}

export function localToPaper(lx: number, lz: number) {
  return {
    x: PAPER.zoneW / 2 + lx * PAPER.ppu,
    y: PAPER.zoneH / 2 + lz * PAPER.ppu,
  };
}

export function paperToWorld(zone: ZoneId, px: number, py: number) {
  const cam = ZONE_CAMERA[zone];
  return {
    x: cam.x + (px - PAPER.zoneW / 2) / PAPER.ppu,
    z: cam.z + (py - PAPER.zoneH / 2) / PAPER.ppu,
  };
}

const ACTIVITY_ZONE: Record<string, ZoneId> = {
  dine: 'restaurant',
  massage: 'spa',
  poker: 'casino',
  rest: 'hall',
};

function inZoneBounds(wx: number, wz: number, zone: ZoneId): boolean {
  const meta = ZONES.find(z => z.id === zone);
  if (!meta) return false;
  const hw = meta.w / 2, hd = meta.d / 2;
  return wx >= meta.x - hw && wx <= meta.x + hw && wz >= meta.z - hd && wz <= meta.z + hd;
}

/** Agent 是否应在当前分区画布中显示（支持多人同区） */
export function agentVisibleInZone(
  char: {
    x: number; z: number; activity: string | null; travelIntent?: string | null;
    isWalking?: boolean; inTransit?: boolean;
  },
  zone: ZoneId,
): boolean {
  if (char.inTransit) return false;
  if (char.activity && ACTIVITY_ZONE[char.activity] === zone) return true;
  if (inZoneBounds(char.x, char.z, zone)) return true;
  return false;
}

/** 统计某分区内可见 Agent 数量 */
export function countAgentsInZone(
  agents: Record<string, { x: number; z: number; activity: string | null; travelIntent?: string | null; isWalking?: boolean }>,
  zone: ZoneId,
): number {
  return Object.values(agents).filter(a => agentVisibleInZone(a, zone)).length;
}
