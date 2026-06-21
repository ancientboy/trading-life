import type { ZoneId } from '../store/useGameStore';
import { ZONE_CAMERA as REGISTRY_CAMERA } from './zoneRegistry';

/** 大地图 — 默认聚焦交易大厅，纯俯视 2D */
export const WORLD_MAP = {
  centerX: 28,
  centerZ: 15,
  /** 默认：交易大厅单区视角 — 数值越小画面越大 */
  defaultZoom: 38,
  zoneZoom: 68,
  overviewZoom: 34,
  minZoom: 32,
  maxZoom: 88,
  cameraHeight: 42,
  panBounds: { minX: 2, maxX: 52, minZ: 0, maxZ: 28 },
};

export { REGISTRY_CAMERA as ZONE_CAMERA };

/** 区域导航悬浮箭头（点击切换视角） */
export const ZONE_NAV_ARROWS: {
  x: number; z: number; rotY: number; label: string; target: ZoneId; showWhen: ZoneId | 'always';
}[] = [
  { x: 14, z: 14.2, rotY: 0, label: '餐厅', target: 'restaurant', showWhen: 'hall' },
  { x: 27.2, z: 7.5, rotY: -Math.PI / 2, label: '按摩区', target: 'spa', showWhen: 'hall' },
  { x: 27.2, z: 12.5, rotY: -Math.PI / 2, label: '德州扑克', target: 'casino', showWhen: 'hall' },
  { x: 27.2, z: 17.5, rotY: -Math.PI / 2, label: '交易竞技', target: 'arena', showWhen: 'hall' },
  { x: 14, z: 16.8, rotY: Math.PI, label: '交易大厅', target: 'hall', showWhen: 'restaurant' },
  { x: 25.5, z: 7.5, rotY: Math.PI, label: '交易大厅', target: 'hall', showWhen: 'spa' },
  { x: 25.5, z: 18.5, rotY: Math.PI, label: '交易大厅', target: 'hall', showWhen: 'casino' },
  { x: 25.5, z: 22.5, rotY: Math.PI, label: '交易竞技', target: 'arena', showWhen: 'casino' },
  { x: 25.5, z: 18.5, rotY: Math.PI, label: '交易大厅', target: 'hall', showWhen: 'arena' },
  { x: 25.5, z: 22.5, rotY: 0, label: '德州扑克', target: 'casino', showWhen: 'arena' },
  { x: 14, z: 22.5, rotY: Math.PI, label: '交易大厅', target: 'hall', showWhen: 'reception' },
];

/** 世界坐标休息包厢（更大卡座） */
export const WORLD_BOOTHS = [
  { id: 'rest_l_1', x: 4.2, z: 12.65, flip: false },
  { id: 'rest_l_2', x: 8.2, z: 12.78, flip: true },
];
