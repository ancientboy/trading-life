import type { ZoneId } from '../store/useGameStore';
import { paperToWorld, worldToPaper } from './zoneProjection';

/** 对齐 144 office-engine：4列×2行，列距 160、行距 150 */
export const HALL_GRID = {
  originX: 100,
  originY: 195,
  colGap: 160,
  rowGap: 150,
  chairOffsetY: 52,
  deskScale: 0.62,
};

export interface HallDeskDef {
  id: string;
  row: number;
  col: number;
  seatId: string;
}

/** 8 个独立交易工位 */
export const HALL_DESKS_8: HallDeskDef[] = [
  { id: 'desk_xau', row: 0, col: 0, seatId: 'seat_xau' },
  { id: 'desk_maj', row: 0, col: 1, seatId: 'seat_maj' },
  { id: 'desk_alt', row: 0, col: 2, seatId: 'seat_alt' },
  { id: 'desk_new', row: 0, col: 3, seatId: 'seat_new' },
  { id: 'desk_mom', row: 1, col: 0, seatId: 'seat_mom' },
  { id: 'desk_6', row: 1, col: 1, seatId: 'seat_6' },
  { id: 'desk_7', row: 1, col: 2, seatId: 'seat_7' },
  { id: 'desk_8', row: 1, col: 3, seatId: 'seat_8' },
];

export function deskPaperPos(row: number, col: number) {
  return {
    px: HALL_GRID.originX + col * HALL_GRID.colGap,
    py: HALL_GRID.originY + row * HALL_GRID.rowGap,
  };
}

export function seatPaperPos(row: number, col: number) {
  const d = deskPaperPos(row, col);
  return { px: d.px, py: d.py + HALL_GRID.chairOffsetY };
}

export function deskById(id: string) {
  return HALL_DESKS_8.find(d => d.id === id);
}

const DESK_DISPLAY_LABELS: Record<string, string> = {
  desk_xau: 'XAU',
  desk_maj: 'Major',
  desk_alt: 'Altcoin',
  desk_new: 'Newcoin',
  desk_mom: 'Momentum',
  desk_6: '工位 6',
  desk_7: '工位 7',
  desk_8: '工位 8',
};

/** 工位 seatId / deskId → 展示名 */
export function deskDisplayLabel(seatOrDeskId: string): string {
  const desk = HALL_DESKS_8.find(d => d.seatId === seatOrDeskId || d.id === seatOrDeskId);
  if (!desk) return seatOrDeskId;
  return DESK_DISPLAY_LABELS[desk.id] ?? desk.id.replace('desk_', '工位 ');
}

/** 同步工位/站立点到寻路（角色站在椅子前，不在桌面） */
export function syncHallDesksToPathfinding(
  nodes: Record<string, { x: number; z: number }>,
) {
  HALL_DESKS_8.forEach(d => {
    const seat = seatPaperPos(d.row, d.col);
    const w = paperToWorld('hall', seat.px, seat.py);
    nodes[d.seatId] = w;
    nodes[d.id] = w;
  });
}

export const HALL_COFFEE = { px: 34, py: 268, vertical: true as const };
export const HALL_COFFEE_SIZE = { w: 52, h: 118 };

export function deskChartSeed(deskId: string, agentId?: string): number {
  let h = 0;
  const s = agentId || deskId;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 大厅碰撞障碍 — 仅桌面，不挡椅子接近区与沙发区 */
export function hallObstacleRects(): { x: number; y: number; w: number; h: number }[] {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const dw = 82 * HALL_GRID.deskScale;
  const dh = 50 * HALL_GRID.deskScale;
  HALL_DESKS_8.forEach(d => {
    const p = deskPaperPos(d.row, d.col);
    rects.push({ x: p.px - dw / 2, y: p.py - dh / 2, w: dw, h: dh * 0.85 });
  });
  // 行情大屏 — 缩小为屏幕本体，前方走道可通行
  rects.push({ x: 240, y: 68, w: 240, h: 48 });
  // 咖啡区 — 左侧竖向
  rects.push({
    x: HALL_COFFEE.px - HALL_COFFEE_SIZE.w / 2,
    y: HALL_COFFEE.py - HALL_COFFEE_SIZE.h / 2,
    w: HALL_COFFEE_SIZE.w,
    h: HALL_COFFEE_SIZE.h,
  });
  return rects;
}

/** 同步工位节点 — 完整导航图由 navGraph.rebuildNavGraph 构建 */
export function ensureHallPathGraph(
  OfficePath: {
    nodes: Record<string, { x: number; z: number }>;
    _edges: Record<string, string[]> | null;
    _buildEdges: () => Record<string, string[]>;
  },
) {
  syncHallDesksToPathfinding(OfficePath.nodes);
}

export function paperToWorldHall(px: number, py: number) {
  return paperToWorld('hall', px, py);
}

export function worldToPaperHall(wx: number, wz: number) {
  return worldToPaper('hall', wx, wz);
}
