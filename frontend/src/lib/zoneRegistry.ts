import type { ZoneId } from '../store/useGameStore';
import type { RightTab } from '../store/useGameStore';

export interface ZoneDefinition {
  id: ZoneId;
  label: string;
  camera: { x: number; z: number };
  bounds: { x: number; z: number; w: number; d: number; color: string };
}

/** 分区元数据 — 标签、相机、世界边界 */
export const ZONE_DEFINITIONS: ZoneDefinition[] = [
  { id: 'hall', label: '交易大厅', camera: { x: 14, z: 7.5 }, bounds: { x: 14, z: 7.5, w: 28, d: 15, color: '#f5f0e8' } },
  { id: 'reception', label: '前厅接待', camera: { x: 14, z: 26 }, bounds: { x: 14, z: 26, w: 28, d: 6, color: '#faf6ef' } },
  { id: 'spa', label: '按摩放松区', camera: { x: 42, z: 7.5 }, bounds: { x: 42, z: 7.5, w: 28, d: 15, color: '#f5eef8' } },
  { id: 'restaurant', label: '餐厅', camera: { x: 14, z: 20 }, bounds: { x: 14, z: 20, w: 28, d: 10, color: '#fff8eb' } },
  { id: 'casino', label: '德州扑克', camera: { x: 42, z: 20 }, bounds: { x: 42, z: 20, w: 28, d: 10, color: '#1a1520' } },
  { id: 'arena', label: '交易竞技馆', camera: { x: 42, z: 26 }, bounds: { x: 42, z: 26, w: 28, d: 8, color: '#1a2840' } },
];

export const ZONE_LIST = ZONE_DEFINITIONS.map(z => ({ id: z.id, label: z.label }));

export const ZONE_CAMERA: Record<ZoneId, { x: number; z: number; label: string }> = Object.fromEntries(
  ZONE_DEFINITIONS.map(z => [z.id, { ...z.camera, label: z.label }]),
) as Record<ZoneId, { x: number; z: number; label: string }>;

export const ZONE_BOUNDS = ZONE_DEFINITIONS.map(z => ({
  id: z.id,
  label: z.label,
  x: z.bounds.x,
  z: z.bounds.z,
  w: z.bounds.w,
  d: z.bounds.d,
  color: z.bounds.color,
}));

export const SIDEBAR_TO_ZONE: Partial<Record<string, ZoneId>> = {
  hall: 'hall',
  restaurant: 'restaurant',
  spa: 'spa',
  casino: 'casino',
  events: 'arena',
};

export const ZONE_TO_RIGHT_TAB: Record<ZoneId, RightTab> = {
  hall: 'hall',
  reception: 'npc',
  restaurant: 'facility',
  spa: 'facility',
  casino: 'facility',
  arena: 'events',
};
