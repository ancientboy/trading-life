/** 交易大厅分区 — 本地坐标寻路（原点在房间中心） */
export const HallPath = {
  nodes: {
    desk_xau: { x: -6, z: -2 },
    desk_maj: { x: -3, z: -2 },
    desk_alt: { x: 0, z: -2 },
    desk_new: { x: 3, z: -2 },
    desk_mom: { x: 6, z: -2 },
    scr_ctr: { x: 0, z: -4.5 },
    aisle_c: { x: 0, z: 1.2 },
    aisle_l: { x: -4.5, z: 3.5 },
    aisle_r: { x: 4.5, z: 3.5 },
    rest_l_1: { x: -6.5, z: 5.8 },
    rest_l_2: { x: 6.5, z: 5.8 },
    booth_a1: { x: -5.2, z: 5.8 },
    booth_b1: { x: 5.2, z: 5.8 },
    coffee: { x: 2.4, z: 5.6 },
  } as Record<string, { x: number; z: number }>,

  deskByAgent: {
    xau: 'desk_xau', major: 'desk_maj', altcoin: 'desk_alt',
    newcoin: 'desk_new', momentum: 'desk_mom',
  } as Record<string, string>,

  boothByAgent: {
    xau: 'rest_l_1', major: 'rest_l_1', altcoin: 'rest_l_2',
    newcoin: 'rest_l_2', momentum: 'rest_l_2',
  } as Record<string, string>,

  hallWander: ['desk_xau', 'desk_maj', 'desk_alt', 'scr_ctr', 'rest_l_1', 'rest_l_2', 'coffee'],

  _edges: null as Record<string, string[]> | null,

  _buildEdges() {
    if (this._edges) return this._edges;
    const pairs: [string, string][] = [
      ['desk_xau', 'aisle_l'], ['desk_maj', 'aisle_c'], ['desk_alt', 'aisle_c'], ['desk_new', 'aisle_c'], ['desk_mom', 'aisle_r'],
      ['aisle_c', 'scr_ctr'],
      ['aisle_c', 'aisle_l'], ['aisle_c', 'aisle_r'],
      ['aisle_l', 'booth_a1'], ['booth_a1', 'rest_l_1'],
      ['aisle_r', 'booth_b1'], ['booth_b1', 'rest_l_2'],
      ['aisle_r', 'coffee'], ['desk_mom', 'coffee'],
    ];
    const adj: Record<string, string[]> = {};
    Object.keys(this.nodes).forEach(k => { adj[k] = []; });
    pairs.forEach(([a, b]) => { adj[a]?.push(b); adj[b]?.push(a); });
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
