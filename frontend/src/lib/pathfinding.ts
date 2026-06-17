import { p2 } from './constants';

export const OfficePath = {
  nodes: {
    a_w: p2(220,780), a_xau: p2(420,780), a_maj: p2(700,780), a_alt: p2(980,780),
    a_new: p2(1260,780), a_mom: p2(1540,780), a_e: p2(2180,780),
    desk_xau: p2(420,560), desk_maj: p2(700,560), desk_alt: p2(980,560),
    desk_new: p2(1260,560), desk_mom: p2(1540,560),
    u_ctr: p2(1200,420), scr_ctr: p2(1200,130),
    d_xau: p2(420,980), d_maj: p2(700,980), d_alt: p2(980,980),
    rest_l_1: p2(420,1265), rest_l_2: p2(820,1278),
    booth_a1: p2(320,1265), booth_a2: p2(520,1265),
    booth_b1: p2(720,1278), booth_b2: p2(920,1278),
    recv_ctr: p2(1200,2400),
    door_ts: p2(2390,780), door_tr: p2(1200,1350), door_sc: p2(3600,1350),
    hub_tr: p2(1200,1160),
    spa_c: p2(3000,780), spa_d: p2(3000,1050),
    bed_1: p2(2700,1180), bed_2: p2(3000,1180), bed_3: p2(3300,1180),
    rest_c: p2(1200,1480), rest_d: p2(1200,1580),
    dine_1: p2(700,1850), dine_2: p2(1200,1850), dine_3: p2(1700,1850),
    cas_c: p2(3600,1480), cas_d: p2(3600,1580),
    poker_1: p2(3300,2050), poker_2: p2(3600,2180), poker_3: p2(3900,2050),
  } as Record<string, { x: number; z: number }>,
  deskByAgent: { xau:'seat_xau', major:'seat_maj', altcoin:'seat_alt', newcoin:'seat_new', momentum:'seat_mom' } as Record<string,string>,
  boothByAgent: { xau:'rest_l_1', major:'rest_l_2', altcoin:'rest_l_1', newcoin:'rest_l_2', momentum:'rest_l_2' } as Record<string,string>,
  massageByAgent: { xau:'bed_1', major:'bed_2', altcoin:'bed_3', newcoin:'bed_4', momentum:'bed_5' } as Record<string,string>,
  dineByAgent: { xau:'dine_1', major:'dine_2', altcoin:'dine_3', newcoin:'dine_1', momentum:'dine_2' } as Record<string,string>,
  pokerByAgent: { xau:'poker_s1', major:'poker_s2', altcoin:'poker_s3', newcoin:'poker_s4', momentum:'poker_s5' } as Record<string,string>,
  wanderTargets: ['desk_xau','desk_maj','scr_ctr','rest_l_1','bed_2','dine_2','poker_2','recv_ctr'],
  _edges: null as Record<string, string[]> | null,
  _buildEdges() {
    if (this._edges) return this._edges;
    const pairs: [string,string][] = [
      ['a_w','a_xau'],['a_xau','a_maj'],['a_maj','a_alt'],['a_alt','a_new'],['a_new','a_mom'],['a_mom','a_e'],
      ['a_xau','desk_xau'],['a_maj','desk_maj'],['a_alt','desk_alt'],['a_new','desk_new'],['a_mom','desk_mom'],
      ['a_xau','u_ctr'],['a_maj','u_ctr'],['a_alt','u_ctr'],['u_ctr','scr_ctr'],
      ['a_xau','d_xau'],['a_maj','d_maj'],['a_alt','d_alt'],
      ['d_xau','booth_a1'],['booth_a1','rest_l_1'],['booth_a1','booth_a2'],
      ['d_maj','booth_b1'],['booth_b1','rest_l_2'],['booth_b1','booth_b2'],
      ['a_e','door_ts'],['door_ts','spa_c'],['spa_c','spa_d'],
      ['spa_d','bed_1'],['spa_d','bed_2'],['spa_d','bed_3'],['spa_d','bed_4'],['spa_d','bed_5'],['spa_d','bed_6'],
      ['d_maj','hub_tr'],['hub_tr','door_tr'],['door_tr','rest_d'],['rest_d','rest_c'],
      ['rest_c','dine_1'],['rest_c','dine_2'],['rest_c','dine_3'],
      ['door_sc','cas_d'],['cas_d','cas_c'],['cas_c','poker_table'],
      ['poker_table','poker_s1'],['poker_table','poker_s2'],['poker_table','poker_s3'],['poker_table','poker_s4'],
      ['poker_table','poker_s5'],['poker_table','poker_s6'],['poker_table','poker_s7'],['poker_table','poker_s8'],
      ['d_xau','recv_ctr'],['recv_ctr','a_xau'],
    ];
    const adj: Record<string, string[]> = {};
    Object.keys(this.nodes).forEach(k => { adj[k] = []; });
    pairs.forEach(([a,b]) => { adj[a]?.push(b); adj[b]?.push(a); });
    this._edges = adj;
    return adj;
  },
  nearestNode(x: number, z: number) {
    let best = '', bestD = Infinity;
    Object.entries(this.nodes).forEach(([id, n]) => {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  },
  findPath(fromId: string, toId: string) {
    if (fromId === toId) return [this.nodes[toId]];
    const adj = this._buildEdges();
    const q: string[][] = [[fromId]];
    const seen = new Set([fromId]);
    while (q.length) {
      const path = q.shift()!;
      const cur = path[path.length - 1];
      for (const nb of adj[cur] || []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const np = [...path, nb];
        if (nb === toId) return np.map(id => this.nodes[id]);
        q.push(np);
      }
    }
    return [this.nodes[toId]];
  },
  pathToNode(x: number, z: number, nodeId: string) {
    return this.findPath(this.nearestNode(x, z), nodeId);
  },
};

export const ZONES = [
  { id: 'hall', label: '交易大厅', x: 14, z: 7.5, w: 28, d: 15, color: '#f5f0e8' },
  { id: 'reception', label: '前厅接待', x: 14, z: 26, w: 28, d: 6, color: '#faf6ef' },
  { id: 'spa', label: '按摩放松区', x: 42, z: 7.5, w: 28, d: 15, color: '#f5eef8' },
  { id: 'restaurant', label: '餐厅', x: 14, z: 20, w: 28, d: 10, color: '#fff8eb' },
  { id: 'casino', label: '德州扑克', x: 42, z: 20, w: 28, d: 10, color: '#1a1520' },
];
