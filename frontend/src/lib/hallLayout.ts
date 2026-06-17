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

export const HALL_COFFEE = { px: 52, py: 310 };

export function deskChartSeed(deskId: string, agentId?: string): number {
  let h = 0;
  const s = agentId || deskId;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 大厅碰撞障碍（纸面坐标矩形） */
export function hallObstacleRects(): { x: number; y: number; w: number; h: number }[] {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const dw = 82 * HALL_GRID.deskScale;
  const dh = 50 * HALL_GRID.deskScale;
  HALL_DESKS_8.forEach(d => {
    const p = deskPaperPos(d.row, d.col);
    rects.push({ x: p.px - dw / 2, y: p.py - dh / 2, w: dw, h: dh });
  });
  rects.push({ x: 120, y: 470, w: 130, h: 70 });
  rects.push({ x: 440, y: 470, w: 130, h: 70 });
  rects.push({ x: 10, y: 280, w: 90, h: 55 });
  rects.push({ x: 200, y: 55, w: 320, h: 75 });
  return rects;
}

/** 大厅内部走道节点（纸面坐标） */
const HALL_WALK = {
  row0Y: 278,
  row1Y: 428,
  hubX: 340,
  hubY: 360,
  scrX: 360,
  scrY: 95,
};

/** 同步工位/走道/枢纽到寻路，并连接 8 工位图 */
export function ensureHallPathGraph(
  OfficePath: {
    nodes: Record<string, { x: number; z: number }>;
    _edges: Record<string, string[]> | null;
    _buildEdges: () => Record<string, string[]>;
  },
) {
  syncHallDesksToPathfinding(OfficePath.nodes);

  HALL_DESKS_8.forEach(d => {
    const px = HALL_GRID.originX + d.col * HALL_GRID.colGap;
    OfficePath.nodes[`walk_r0_c${d.col}`] = paperToWorld('hall', px, HALL_WALK.row0Y);
    OfficePath.nodes[`walk_r1_c${d.col}`] = paperToWorld('hall', px, HALL_WALK.row1Y);
  });
  OfficePath.nodes.u_ctr = paperToWorld('hall', HALL_WALK.hubX, HALL_WALK.hubY);
  OfficePath.nodes.scr_ctr = paperToWorld('hall', HALL_WALK.scrX, HALL_WALK.scrY);
  OfficePath.nodes.hall_coffee = paperToWorld('hall', HALL_COFFEE.px, HALL_COFFEE.py);

  OfficePath._edges = null;
  const edges = OfficePath._buildEdges();
  const add = (a: string, b: string) => {
    if (!OfficePath.nodes[a] || !OfficePath.nodes[b]) return;
    if (!edges[a]) edges[a] = [];
    if (!edges[b]) edges[b] = [];
    if (!edges[a].includes(b)) edges[a].push(b);
    if (!edges[b].includes(a)) edges[b].push(a);
  };

  const row0 = ['seat_xau', 'seat_maj', 'seat_alt', 'seat_new'];
  const row1 = ['seat_mom', 'seat_6', 'seat_7', 'seat_8'];
  row0.forEach((id, c) => add(id, `walk_r0_c${c}`));
  row1.forEach((id, c) => add(id, `walk_r1_c${c}`));
  for (let c = 0; c < 3; c++) {
    add(`walk_r0_c${c}`, `walk_r0_c${c + 1}`);
    add(`walk_r1_c${c}`, `walk_r1_c${c + 1}`);
  }
  for (let c = 0; c < 4; c++) add(`walk_r0_c${c}`, `walk_r1_c${c}`);
  add('walk_r1_c1', 'u_ctr');
  add('walk_r1_c2', 'u_ctr');
  add('u_ctr', 'scr_ctr');
  add('walk_r1_c0', 'rest_l_1');
  add('walk_r1_c3', 'rest_l_2');
  add('walk_r1_c3', 'hall_coffee');
  add('walk_r1_c3', 'door_ts');
  add('walk_r0_c2', 'door_tr');
  add('door_ts', 'spa_c');
  add('door_tr', 'rest_d');
  add('door_sc', 'cas_d');
}

export function paperToWorldHall(px: number, py: number) {
  return paperToWorld('hall', px, py);
}

export function worldToPaperHall(wx: number, wz: number) {
  return worldToPaper('hall', wx, wz);
}
