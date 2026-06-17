/**
 * 统一导航图 — 纸面坐标驱动，按区域走道 + 座位槽位建图
 * 替换 legacy pathfinding 中混杂的旧节点边
 */
import type { ZoneId } from '../store/useGameStore';
import { paperToWorld } from './zoneProjection';
import {
  SPA_BEDS, RESTAURANT_TABLES, CASINO_SEATS, CASINO_TABLE,
  HALL_REST_BOOTHS, syncFurnitureToPathfinding,
} from './zoneFurniture';
import { HALL_DESKS_8, HALL_GRID, HALL_COFFEE, seatPaperPos, syncHallDesksToPathfinding } from './hallLayout';
import { ZONE_LAYOUTS } from './zoneLayouts';

type PathStore = {
  nodes: Record<string, { x: number; z: number }>;
  _edges: Record<string, string[]> | null;
  deskByAgent: Record<string, string>;
  boothByAgent: Record<string, string>;
  massageByAgent: Record<string, string>;
  dineByAgent: Record<string, string>;
  pokerByAgent: Record<string, string>;
};

const HALL_WALK = { row0Y: 278, row1Y: 428, hubX: 340, hubY: 360, scrX: 360, scrY: 155 };

function pw(zone: ZoneId, px: number, py: number) {
  return paperToWorld(zone, px, py);
}

function agentSeatIndex(agentId: string, count: number) {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) | 0;
  return Math.abs(h) % count;
}

/** 为每个 Agent 分配具体座位槽位（非家具中心点） */
export function assignAgentSeatSlots(OfficePath: PathStore) {
  const agents = [...new Set([
    ...Object.keys(OfficePath.deskByAgent),
    ...Object.keys(OfficePath.boothByAgent),
  ])];
  agents.forEach((id, i) => {
    const booth = HALL_REST_BOOTHS[i % HALL_REST_BOOTHS.length];
    OfficePath.boothByAgent[id] = booth.seats[agentSeatIndex(id, booth.seats.length)].id;

    const bed = SPA_BEDS[i % SPA_BEDS.length];
    OfficePath.massageByAgent[id] = bed.id;

    const table = RESTAURANT_TABLES[i % RESTAURANT_TABLES.length];
    OfficePath.dineByAgent[id] = table.chairs[agentSeatIndex(id, table.chairs.length)].id;

    OfficePath.pokerByAgent[id] = CASINO_SEATS[agentSeatIndex(id, CASINO_SEATS.length)].id;
  });
}

/** 重建完整导航图（init 时调用一次） */
export function rebuildNavGraph(OfficePath: PathStore) {
  syncHallDesksToPathfinding(OfficePath.nodes);
  syncFurnitureToPathfinding(OfficePath.nodes, 'spa');
  syncFurnitureToPathfinding(OfficePath.nodes, 'restaurant');
  syncFurnitureToPathfinding(OfficePath.nodes, 'casino');
  syncFurnitureToPathfinding(OfficePath.nodes, 'hall');
  assignAgentSeatSlots(OfficePath);

  // 走道 / 门户节点（纸面坐标）
  for (let c = 0; c < 4; c++) {
    const px = HALL_GRID.originX + c * HALL_GRID.colGap;
    OfficePath.nodes[`walk_r0_c${c}`] = pw('hall', px, HALL_WALK.row0Y);
    OfficePath.nodes[`walk_r1_c${c}`] = pw('hall', px, HALL_WALK.row1Y);
  }
  OfficePath.nodes.u_ctr = pw('hall', HALL_WALK.hubX, HALL_WALK.hubY);
  OfficePath.nodes.scr_ctr = pw('hall', HALL_WALK.scrX, HALL_WALK.scrY);
  OfficePath.nodes.hall_coffee = pw('hall', HALL_COFFEE.px, HALL_COFFEE.py);

  // 门户 — 对齐 zoneLayouts 导航箭头
  OfficePath.nodes.door_ts = pw('hall', 698, 300);
  OfficePath.nodes.door_sc = pw('hall', 698, 430);
  OfficePath.nodes.door_tr = pw('hall', 360, 598);
  OfficePath.nodes.spa_entry = pw('spa', 22, 320);
  OfficePath.nodes.rest_entry = pw('restaurant', 360, 42);
  OfficePath.nodes.cas_entry = pw('casino', 22, 320);
  OfficePath.nodes.recv_ctr = pw('reception', 360, 400);

  // 各区域内部走道
  OfficePath.nodes.spa_aisle_l = pw('spa', 80, 340);
  OfficePath.nodes.spa_aisle_m = pw('spa', 310, 340);
  OfficePath.nodes.spa_aisle_r = pw('spa', 540, 340);
  OfficePath.nodes.rest_aisle_t = pw('restaurant', 360, 200);
  OfficePath.nodes.rest_aisle_b = pw('restaurant', 360, 400);
  OfficePath.nodes.cas_aisle = pw('casino', 360, 200);

  // 沙发区接近点（不走沙发碰撞区）
  OfficePath.nodes.approach_rest_1 = pw('hall', 200, 490);
  OfficePath.nodes.approach_rest_2 = pw('hall', 520, 490);

  const adj: Record<string, string[]> = {};
  const ensure = (id: string) => { if (!adj[id]) adj[id] = []; };
  const link = (a: string, b: string) => {
    if (!OfficePath.nodes[a] || !OfficePath.nodes[b]) return;
    ensure(a); ensure(b);
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  };

  // ── 大厅：工位 → 行走道 → 枢纽（不竖穿工位）──
  HALL_DESKS_8.forEach(d => {
    const c = d.col;
    link(d.seatId, `walk_r${d.row}_c${c}`);
  });
  for (let c = 0; c < 3; c++) {
    link(`walk_r0_c${c}`, `walk_r0_c${c + 1}`);
    link(`walk_r1_c${c}`, `walk_r1_c${c + 1}`);
  }
  for (let c = 0; c < 4; c++) {
    link(`walk_r0_c${c}`, 'u_ctr');
    link(`walk_r1_c${c}`, 'u_ctr');
  }
  link('u_ctr', 'scr_ctr');
  link('u_ctr', 'hall_coffee');
  link('walk_r1_c0', 'approach_rest_1');
  link('walk_r1_c3', 'approach_rest_2');
  HALL_REST_BOOTHS.forEach((b, i) => {
    const approach = i === 0 ? 'approach_rest_1' : 'approach_rest_2';
    link(approach, b.id);
    b.seats.forEach(s => link(b.id, s.id));
  });

  // 跨区门户
  link('walk_r1_c3', 'door_ts');
  link('door_ts', 'spa_entry');
  link('walk_r0_c2', 'door_tr');
  link('door_tr', 'rest_entry');
  link('walk_r1_c3', 'door_sc');
  link('door_sc', 'cas_entry');

  // ── 按摩区 ──
  link('spa_entry', 'spa_aisle_l');
  link('spa_aisle_l', 'spa_aisle_m');
  link('spa_aisle_m', 'spa_aisle_r');
  SPA_BEDS.forEach(b => {
    const aisle = b.px < 220 ? 'spa_aisle_l' : b.px < 400 ? 'spa_aisle_m' : 'spa_aisle_r';
    link(aisle, b.id);
  });

  // ── 餐厅 ──
  link('rest_entry', 'rest_aisle_t');
  link('rest_aisle_t', 'rest_aisle_b');
  RESTAURANT_TABLES.forEach(t => {
    link(t.py < 400 ? 'rest_aisle_t' : 'rest_aisle_b', t.id);
    t.chairs.forEach(ch => link(t.id, ch.id));
  });

  // ── 德州 ──
  link('cas_entry', 'cas_aisle');
  link('cas_aisle', 'poker_table');
  CASINO_SEATS.forEach(s => link('poker_table', s.id));

  OfficePath._edges = adj;
}

/** 寻路时优先走道/座位节点，避免吸附到 legacy 远点 */
export function nearestNavNode(
  nodes: Record<string, { x: number; z: number }>,
  x: number, z: number,
  preferredPrefixes: string[] = ['walk_', 'seat_', 'approach_', 'spa_', 'rest_', 'cas_', 'bed_', 'dine_', 'poker_', 'u_ctr', 'door_'],
): string {
  let best = '', bestD = Infinity;
  const entries = Object.entries(nodes);
  const tryFind = (filter: (id: string) => boolean) => {
    entries.forEach(([id, n]) => {
      if (!filter(id)) return;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    });
  };
  for (const p of preferredPrefixes) tryFind(id => id.startsWith(p));
  if (!best) tryFind(() => true);
  return best;
}
