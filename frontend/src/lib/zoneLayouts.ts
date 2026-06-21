import type { ZoneId } from '../store/useGameStore';

export interface NavArrowDef {
  x: number;
  y: number;
  dir: 'n' | 's' | 'e' | 'w';
  label: string;
  target: ZoneId;
}

export type FacilityAction = 'dine' | 'massage' | 'poker' | 'rest';

export interface FacilityDef {
  id: string;
  /** pathfinding 节点 id */
  nodeId: string;
  r: number;
  label: string;
  action: FacilityAction;
}

export interface ZoneLayout {
  floorColor: string;
  accent: string;
  navArrows: NavArrowDef[];
  facilities: FacilityDef[];
}

/** 各分区布局 — 家具坐标通过 pathfinding 节点投影 */
export const ZONE_LAYOUTS: Record<ZoneId, ZoneLayout> = {
  hall: {
    floorColor: '#f5f0e8',
    accent: 'rgba(66,133,244,0.06)',
    navArrows: [
      { x: 360, y: 598, dir: 's', label: '餐厅', target: 'restaurant' },
      { x: 698, y: 300, dir: 'e', label: '按摩', target: 'spa' },
      { x: 698, y: 430, dir: 'e', label: '德州', target: 'casino' },
      { x: 698, y: 520, dir: 'e', label: '竞技馆', target: 'arena' },
      { x: 360, y: 42, dir: 'n', label: '前厅', target: 'reception' },
    ],
    facilities: [
      { id: 'rest_l_1', nodeId: 'rest_l_1', r: 58, label: '休息包厢 A', action: 'rest' },
      { id: 'rest_l_2', nodeId: 'rest_l_2', r: 58, label: '休息包厢 B', action: 'rest' },
    ],
  },
  reception: {
    floorColor: '#faf6ef',
    accent: 'rgba(180,160,120,0.08)',
    navArrows: [{ x: 360, y: 580, dir: 's', label: '大厅', target: 'hall' }],
    facilities: [{ id: 'recv_ctr', nodeId: 'recv_ctr', r: 70, label: '接待台', action: 'rest' }],
  },
  restaurant: {
    floorColor: '#faf3e8',
    accent: 'rgba(196,48,48,0.08)',
    navArrows: [{ x: 360, y: 42, dir: 'n', label: '大厅', target: 'hall' }],
    facilities: [
      { id: 'dine_1', nodeId: 'dine_1', r: 48, label: '餐桌 A', action: 'dine' },
      { id: 'dine_2', nodeId: 'dine_2', r: 48, label: '餐桌 B', action: 'dine' },
      { id: 'dine_3', nodeId: 'dine_3', r: 48, label: '餐桌 C', action: 'dine' },
      { id: 'dine_4', nodeId: 'dine_4', r: 48, label: '餐桌 D', action: 'dine' },
      { id: 'dine_5', nodeId: 'dine_5', r: 48, label: '餐桌 E', action: 'dine' },
      { id: 'dine_6', nodeId: 'dine_6', r: 48, label: '餐桌 F', action: 'dine' },
    ],
  },
  spa: {
    floorColor: '#e8eef5',
    accent: 'rgba(120,160,190,0.14)',
    navArrows: [{ x: 22, y: 320, dir: 'w', label: '大厅', target: 'hall' }],
    facilities: [
      { id: 'bed_1', nodeId: 'bed_1', r: 52, label: '按摩床 1', action: 'massage' },
      { id: 'bed_2', nodeId: 'bed_2', r: 52, label: '按摩床 2', action: 'massage' },
      { id: 'bed_3', nodeId: 'bed_3', r: 52, label: '按摩床 3', action: 'massage' },
      { id: 'bed_4', nodeId: 'bed_4', r: 52, label: '按摩床 4', action: 'massage' },
      { id: 'bed_5', nodeId: 'bed_5', r: 52, label: '按摩床 5', action: 'massage' },
      { id: 'bed_6', nodeId: 'bed_6', r: 52, label: '按摩床 6', action: 'massage' },
    ],
  },
  casino: {
    floorColor: '#2a2220',
    accent: 'rgba(212,175,55,0.14)',
    navArrows: [
      { x: 22, y: 320, dir: 'w', label: '大厅', target: 'hall' },
      { x: 360, y: 580, dir: 's', label: '竞技馆', target: 'arena' },
    ],
    facilities: [
      { id: 'poker_table', nodeId: 'poker_table', r: 118, label: 'VIP 牌桌', action: 'poker' },
    ],
  },
  arena: {
    floorColor: '#1a2840',
    accent: 'rgba(74,144,200,0.14)',
    navArrows: [
      { x: 22, y: 320, dir: 'w', label: '大厅', target: 'hall' },
      { x: 360, y: 42, dir: 'n', label: '德州', target: 'casino' },
    ],
    facilities: [],
  },
};
