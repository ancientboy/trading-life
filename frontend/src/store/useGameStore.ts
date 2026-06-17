import { create } from 'zustand';
import { AGENT_META } from '../lib/constants';
import type { AgentData, CameraMode, CharState, QualityTier, TradeRecord } from '../lib/constants';
import { normalizeAgentMeta } from '../lib/agentAppearance';
import type { AgentMeta } from '../lib/constants';
import { OfficePath } from '../lib/pathfinding';
import { WORLD_MAP, ZONE_CAMERA } from '../lib/worldMap';
import { SIDEBAR_TO_ZONE, ZONE_TO_RIGHT_TAB } from '../lib/zones';
import { ensureHallPathGraph } from '../lib/hallLayout';
import { rebuildNavGraph, assignAgentSeatSlots } from '../lib/navGraph';
import { paperToWorld } from '../lib/zoneProjection';
import { syncFurnitureToPathfinding, getActivitySeatPaper, greetingForActivity, npcForZone, resolveActivitySlot } from '../lib/zoneFurniture';
import {
  loadCustomAgentMeta, saveCustomAgentMeta, registerCustomAgentSlots,
  nextCustomAgentId, type CustomAgentDraft,
} from '../lib/customAgents';
import { zoneAtPosition, invalidateCollisionCache } from '../lib/collision';
import { isCrossZoneTravel, zoneForNode, zoneForIntent, ZONE_TRANSIT_MS } from '../lib/zoneTransit';

export type RightTab = 'hall' | 'object' | 'agent' | 'npc' | 'facility' | 'assets' | 'strategy' | 'messages';
export type SidebarAction = 'hall' | 'agents' | 'strategy' | 'positions' | 'restaurant' | 'spa' | 'casino' | 'warehouse' | 'social' | 'logs';
export type ModalId = 'workshop' | 'strategy' | 'market' | 'rank' | 'settings' | 'help' | 'dine' | 'massage' | 'poker' | null;
export type ZoneId = 'hall' | 'reception' | 'spa' | 'restaurant' | 'casino';

const LEISURE_FACILITY: Record<'restaurant' | 'spa' | 'casino', string> = {
  restaurant: 'table',
  spa: 'bed',
  casino: 'poker',
};

interface GameStore {
  cameraMode: CameraMode;
  quality: QualityTier;
  effectsOn: boolean;
  simSpeed: 1 | 5 | 20;
  paused: boolean;
  dayMode: 'day' | 'night';
  selectedAgentId: string | null;
  selectedNpcId: string | null;
  selectedFacility: string | null;
  panelTab: 'overview' | 'config' | 'soul';
  rightTab: RightTab;
  rightPanelCollapsed: boolean;
  leftSidebarExpanded: boolean;
  minimalUi: boolean;
  sidebarActive: string;
  activeZone: ZoneId;
  activeModal: ModalId;
  followAgentId: string | null;
  cameraLookAt: { x: number; z: number };
  cameraZoom: number;
  mapOverview: boolean;
  agents: Record<string, CharState>;
  ticker: Record<string, number>;
  overview: {
    total_pnl?: number; total_wr?: number; total_capital?: number;
    total_initial?: number; total_pnl_pct?: number; total_trades?: number;
    runner?: { running: boolean };
  };
  tradeFeed: { agentId: string; agentName: string; trade: TradeRecord }[];
  profileSchema: { key: string; label: string; type: string; min?: number; max?: number; step?: number }[];
  profileConfig: Record<string, unknown>;
  soulMd: string;
  messages: { text: string; time: string }[];
  npcBubble: { npcId: string; text: string; until: number } | null;
  pokerGlbReady: boolean;

  setCameraMode: (m: CameraMode) => void;
  setQuality: (q: QualityTier) => void;
  setEffectsOn: (v: boolean) => void;
  setSimSpeed: (s: 1 | 5 | 20) => void;
  togglePause: () => void;
  setDayMode: (d: 'day' | 'night') => void;
  focusAgent: (id: string | null) => void;
  selectAgent: (id: string | null, opts?: { tab?: RightTab }) => void;
  selectNpc: (id: string | null) => void;
  selectFacility: (f: string | null) => void;
  setPanelTab: (t: 'overview' | 'config' | 'soul') => void;
  setRightTab: (t: RightTab) => void;
  toggleRightPanel: () => void;
  setLeftSidebarExpanded: (v: boolean) => void;
  toggleMinimalUi: () => void;
  setSidebarActive: (id: string) => void;
  navigateSidebar: (action: SidebarAction) => void;
  sendAgentToLeisure: (type: 'dine' | 'massage' | 'poker', agentId?: string) => void;
  sendAgentToFacility: (action: 'dine' | 'massage' | 'poker' | 'rest', opts?: { agentId?: string; nodeId?: string }) => void;
  createAgent: (draft: CustomAgentDraft) => boolean;
  openModal: (id: ModalId) => void;
  closeModal: () => void;
  flyToZone: (zone: ZoneId) => void;
  resetCamera: () => void;
  setFollowAgent: (id: string | null) => void;
  setCameraLookAt: (x: number, z: number, opts?: { zoom?: number; overview?: boolean }) => void;
  setCameraZoom: (zoom: number) => void;
  panCamera: (dx: number, dz: number) => void;
  initAgents: () => void;
  updateFromOverview: (data: {
    agents?: AgentData[];
    total_pnl?: number; total_wr?: number; total_capital?: number;
    total_initial?: number; total_pnl_pct?: number; total_trades?: number;
    runner?: { running: boolean };
  }) => void;
  setTicker: (t: Record<string, number>) => void;
  setProfile: (schema: GameStore['profileSchema'], config: Record<string, unknown>, soul: string) => void;
  patchChar: (id: string, patch: Partial<CharState>) => void;
  addMessage: (text: string) => void;
  setNpcBubble: (npcId: string | null, text: string, until: number) => void;
  setPokerGlbReady: (v: boolean) => void;
}

/** 大厅 Agent 使用本地坐标（分区中心为原点） */

export const useGameStore = create<GameStore>((set, get) => ({
  cameraMode: 'ortho',
  quality: 'medium',
  effectsOn: true,
  simSpeed: 1,
  paused: false,
  dayMode: 'day',
  selectedAgentId: null,
  selectedNpcId: null,
  selectedFacility: null,
  panelTab: 'overview',
  rightTab: 'hall',
  rightPanelCollapsed: false,
  leftSidebarExpanded: false,
  minimalUi: false,
  sidebarActive: 'hall',
  activeZone: 'hall',
  activeModal: null,
  followAgentId: null,
  cameraLookAt: { x: ZONE_CAMERA.hall.x, z: ZONE_CAMERA.hall.z },
  cameraZoom: WORLD_MAP.zoneZoom,
  mapOverview: false,
  agents: {},
  ticker: {},
  overview: {},
  tradeFeed: [],
  profileSchema: [],
  profileConfig: {},
  soulMd: '',
  messages: [],
  npcBubble: null,
  pokerGlbReady: false,

  setCameraMode: (m) => set({ cameraMode: m }),
  setQuality: (q) => set({ quality: q }),
  setEffectsOn: (v) => set({ effectsOn: v }),
  setSimSpeed: (s) => set({ simSpeed: s }),
  togglePause: () => set(s => ({ paused: !s.paused })),
  setDayMode: (d) => set({ dayMode: d }),
  selectAgent: (id, opts) => set({
    selectedAgentId: id,
    selectedNpcId: null,
    selectedFacility: null,
    rightTab: opts?.tab ?? 'agent',
    panelTab: 'overview',
    rightPanelCollapsed: false,
  }),
  focusAgent: (id) => set({
    selectedAgentId: id,
    selectedNpcId: null,
    selectedFacility: null,
    followAgentId: null,
    rightTab: 'hall',
    rightPanelCollapsed: false,
  }),
  selectNpc: (id) => set({ selectedNpcId: id, selectedAgentId: null, selectedFacility: null, rightTab: 'npc', rightPanelCollapsed: false }),
  selectFacility: (f) => set({ selectedFacility: f, selectedAgentId: null, selectedNpcId: null, rightTab: 'facility', rightPanelCollapsed: false }),
  setPanelTab: (t) => set({ panelTab: t }),
  setRightTab: (t) => set({ rightTab: t }),
  toggleRightPanel: () => set(s => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  setLeftSidebarExpanded: (v) => set({ leftSidebarExpanded: v }),
  toggleMinimalUi: () => set(s => ({ minimalUi: !s.minimalUi })),
  setSidebarActive: (id) => set({ sidebarActive: id }),

  navigateSidebar: (action) => {
    const s = get();
    const expand = { rightPanelCollapsed: false, activeModal: null as ModalId };
    const zone = SIDEBAR_TO_ZONE[action];
    if (zone) {
      const isLeisure = zone === 'restaurant' || zone === 'spa' || zone === 'casino';
      const cam = ZONE_CAMERA[zone];
      set({
        ...expand,
        sidebarActive: action,
        activeZone: zone,
        rightTab: ZONE_TO_RIGHT_TAB[zone],
        followAgentId: null,
        selectedNpcId: null,
        selectedFacility: isLeisure ? LEISURE_FACILITY[zone] : null,
        cameraLookAt: { x: cam.x, z: cam.z },
        cameraZoom: WORLD_MAP.zoneZoom,
        mapOverview: false,
      });
      return;
    }
    switch (action) {
      case 'agents': {
        const firstId = s.selectedAgentId || Object.keys(s.agents)[0] || 'xau';
        set({
          rightPanelCollapsed: false,
          sidebarActive: 'agents',
          activeZone: 'hall',
          rightTab: 'agent',
          selectedAgentId: firstId,
          activeModal: 'workshop',
          cameraLookAt: { x: ZONE_CAMERA.hall.x, z: ZONE_CAMERA.hall.z },
          cameraZoom: WORLD_MAP.defaultZoom,
          mapOverview: false,
        });
        break;
      }
      case 'strategy': {
        const firstId = s.selectedAgentId || Object.keys(s.agents)[0] || 'xau';
        set({
          rightPanelCollapsed: false,
          sidebarActive: 'strategy',
          activeZone: 'hall',
          rightTab: 'strategy',
          selectedAgentId: firstId,
          activeModal: 'strategy',
        });
        break;
      }
      case 'positions':
        set({ ...expand, sidebarActive: 'positions', activeZone: 'hall', rightTab: 'assets' });
        break;
      case 'logs':
        set({ ...expand, sidebarActive: 'logs', activeZone: 'hall', rightTab: 'messages' });
        break;
      case 'warehouse':
        set({ ...expand, sidebarActive: 'warehouse', activeZone: 'hall', rightTab: 'assets' });
        break;
      case 'social':
        set({ ...expand, sidebarActive: 'social', activeZone: 'hall', rightTab: 'hall' });
        break;
      default:
        break;
    }
  },
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  flyToZone: (zone) => {
    const cam = ZONE_CAMERA[zone];
    set({
      activeZone: zone,
      sidebarActive: zone === 'hall' ? 'hall' : zone,
      rightTab: ZONE_TO_RIGHT_TAB[zone],
      followAgentId: null,
      activeModal: null,
      selectedFacility: zone === 'restaurant' ? 'table' : zone === 'spa' ? 'bed' : zone === 'casino' ? 'poker' : null,
      cameraLookAt: { x: cam.x, z: cam.z },
      cameraZoom: WORLD_MAP.zoneZoom,
      mapOverview: false,
    });
  },

  sendAgentToLeisure: (type, agentId) => {
    get().sendAgentToFacility(type, { agentId });
  },

  sendAgentToFacility: (action, opts) => {
    const s = get();
    const id = opts?.agentId || s.selectedAgentId || Object.values(s.agents).sort((a, b) => b.stress - a.stress)[0]?.agentId;
    if (!id || !s.agents[id]) return;

    const zoneMap = { dine: 'restaurant' as ZoneId, massage: 'spa' as ZoneId, poker: 'casino' as ZoneId, rest: 'hall' as ZoneId };
    const intentMap = { dine: 'dine' as const, massage: 'massage' as const, poker: 'poker' as const, rest: 'rest' as const };
    const nodeMap = { dine: OfficePath.dineByAgent, massage: OfficePath.massageByAgent, poker: OfficePath.pokerByAgent, rest: OfficePath.boothByAgent };

    const zone = zoneMap[action];
    const cam = ZONE_CAMERA[zone];
    const node = opts?.nodeId || nodeMap[action][id];
    if (!node) return;

    let char = { ...s.agents[id], travelIntent: intentMap[action], activity: null, activityUntil: 0 };
    char = teleportAgentToDestination(char, node, performance.now());

    set({
      agents: { ...s.agents, [id]: char },
      selectedAgentId: id,
      followAgentId: null,
      activeZone: zone,
      sidebarActive: zone === 'hall' ? 'hall' : zone,
      rightTab: action === 'rest' ? 'hall' : 'facility',
      selectedFacility: action === 'rest' ? null : LEISURE_FACILITY[zone as keyof typeof LEISURE_FACILITY] ?? null,
      rightPanelCollapsed: false,
      activeModal: null,
      cameraLookAt: { x: cam.x, z: cam.z },
      cameraZoom: WORLD_MAP.zoneZoom,
      mapOverview: false,
    });
    get().addMessage(`${char.data.name} 已抵达${cam.label}`);
  },

  createAgent: (draft) => {
    const s = get();
    const customMeta = loadCustomAgentMeta();
    const id = nextCustomAgentId({ ...s.agents, ...customMeta });
    const slot = registerCustomAgentSlots(OfficePath, id, Object.keys(customMeta).length);
    if (!slot) {
      get().addMessage('工位已满，最多再创建 3 个自定义 Agent');
      return false;
    }
    assignAgentSeatSlots(OfficePath);
    const meta: AgentMeta = {
      id,
      name: draft.name.trim() || `Agent ${id}`,
      headwear: draft.headwear,
      hatStyle: draft.hatStyle,
      color: draft.color,
      desc: draft.desc.trim() || '自定义交易策略 Agent',
      strategy: draft.strategy.trim() || '自定义策略',
      market: draft.market.trim() || 'Crypto',
      interval: draft.interval.trim() || '15m/1h',
      risk: draft.risk || '中',
    };
    saveCustomAgentMeta({ ...customMeta, [id]: meta });
    const pos = OfficePath.nodes[slot];
    const char: CharState = {
      agentId: id, x: pos.x, z: pos.z,
      pathQueue: [], pathIndex: 0, isWalking: false, destNode: null,
      activity: null, activityUntil: 0, travelIntent: null,
      state: 'idle', stress: 0,
      moveTimer: 0, nextMoveTime: 1500 + Math.random() * 2500,
      facing: 'n',
      data: { ...meta, capital: 10000, initial_capital: 10000, pnl: 0, running: false },
    };
    set({
      agents: { ...s.agents, [id]: char },
      selectedAgentId: id,
      activeZone: 'hall',
      sidebarActive: 'hall',
      rightTab: 'agent',
      followAgentId: id,
      cameraLookAt: { x: ZONE_CAMERA.hall.x, z: ZONE_CAMERA.hall.z },
      cameraZoom: WORLD_MAP.defaultZoom,
      activeModal: 'workshop',
    });
    get().addMessage(`${meta.name} 已加入交易大厅工位`);
    return true;
  },
  resetCamera: () => set({
    activeZone: 'hall',
    followAgentId: null,
    sidebarActive: 'hall',
    rightTab: 'hall',
    activeModal: null,
    selectedNpcId: null,
    selectedFacility: null,
    cameraLookAt: { x: ZONE_CAMERA.hall.x, z: ZONE_CAMERA.hall.z },
    cameraZoom: WORLD_MAP.zoneZoom,
    mapOverview: false,
  }),
  setFollowAgent: (id) => set({ followAgentId: id, selectedAgentId: id, rightPanelCollapsed: false }),

  setCameraLookAt: (x, z, opts) => set(s => ({
    cameraLookAt: { x, z },
    cameraZoom: opts?.zoom ?? s.cameraZoom,
    mapOverview: opts?.overview ?? false,
  })),
  setCameraZoom: (zoom) => set({
    cameraZoom: Math.min(WORLD_MAP.maxZoom, Math.max(WORLD_MAP.minZoom, zoom)),
    mapOverview: false,
  }),
  panCamera: (dx, dz) => set(s => {
    const b = WORLD_MAP.panBounds;
    return {
      cameraLookAt: {
        x: Math.min(b.maxX, Math.max(b.minX, s.cameraLookAt.x + dx)),
        z: Math.min(b.maxZ, Math.max(b.minZ, s.cameraLookAt.z + dz)),
      },
      mapOverview: false,
    };
  }),

  initAgents: () => {
    ensureHallPathGraph(OfficePath);
    syncFurnitureToPathfinding(OfficePath.nodes, 'spa');
    syncFurnitureToPathfinding(OfficePath.nodes, 'restaurant');
    syncFurnitureToPathfinding(OfficePath.nodes, 'casino');
    syncFurnitureToPathfinding(OfficePath.nodes, 'hall');
    rebuildNavGraph(OfficePath);
    invalidateCollisionCache();
    const customMeta = loadCustomAgentMeta();
    Object.entries(customMeta).forEach(([id], i) => {
      if (!OfficePath.deskByAgent[id]) registerCustomAgentSlots(OfficePath, id, i);
    });
    assignAgentSeatSlots(OfficePath);

    const agents: Record<string, CharState> = {};
    const allIds = new Set([...Object.keys(AGENT_META), ...Object.keys(customMeta)]);

    allIds.forEach(id => {
      const nodeId = OfficePath.deskByAgent[id];
      if (!nodeId) return;
      const pos = OfficePath.nodes[nodeId];
      const raw = AGENT_META[id] || customMeta[id];
      if (!raw || !pos) return;
      const meta = normalizeAgentMeta(raw);
      agents[id] = {
        agentId: id, x: pos.x, z: pos.z,
        pathQueue: [], pathIndex: 0, isWalking: false, destNode: null,
        activity: null, activityUntil: 0, travelIntent: null,
        state: 'idle', stress: 0,
        moveTimer: 0, nextMoveTime: 1500 + Math.random() * 2500,
        facing: 'n',
        data: { ...meta },
      };
    });
    set({ agents });
  },

  updateFromOverview: (data) => {
    const prev = get();
    if (Object.keys(prev.agents).length === 0) {
      get().initAgents();
    }
    const agents = { ...get().agents };
    const tradeFeed: GameStore['tradeFeed'] = [];

    (data.agents || []).forEach((a) => {
      if (!agents[a.id]) return;
      const stress = Math.min(100, Math.max(0, -(a.pnl || 0) / 20 + (a.is_circuit_break ? 40 : 0)));
      let state: CharState['state'] = 'idle';
      if (a.is_circuit_break) state = 'panic';
      else if (a.positions?.length) state = 'trading';
      else if (a.running) state = 'scanning';
      agents[a.id] = { ...agents[a.id], data: { ...agents[a.id].data, ...a }, stress, state };
      (a.trades_history || []).slice(0, 20).forEach(trade => {
        tradeFeed.push({ agentId: a.id, agentName: a.name || agents[a.id].data.name, trade });
      });
    });

    tradeFeed.sort((a, b) => {
      const ta = a.trade.closed_at || a.trade.opened_at || '';
      const tb = b.trade.closed_at || b.trade.opened_at || '';
      return tb.localeCompare(ta);
    });

    const selectedAgentId = prev.selectedAgentId || Object.keys(agents)[0] || null;

    set({
      agents,
      selectedAgentId,
      tradeFeed: tradeFeed.slice(0, 80),
      overview: {
        total_pnl: data.total_pnl,
        total_wr: data.total_wr,
        total_capital: data.total_capital,
        total_initial: (data as { total_initial?: number }).total_initial,
        total_pnl_pct: (data as { total_pnl_pct?: number }).total_pnl_pct,
        total_trades: (data as { total_trades?: number }).total_trades,
        runner: data.runner,
      },
    });
  },

  setTicker: (t) => set({ ticker: t }),
  setProfile: (schema, config, soul) => set({ profileSchema: schema, profileConfig: config, soulMd: soul }),
  patchChar: (id, patch) => set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], ...patch } } })),
  addMessage: (text) => set(s => ({ messages: [...s.messages.slice(-49), { text, time: new Date().toLocaleTimeString() }] })),
  setNpcBubble: (npcId, text, until) => set({
    npcBubble: npcId && text ? { npcId, text, until } : null,
  }),
  setPokerGlbReady: (v) => set({ pokerGlbReady: v }),
}));

/** 用户派遣 / 卡住恢复：直接传送到目标节点并进入活动 */
export function teleportAgentToDestination(char: CharState, nodeId: string, now: number): CharState {
  const pos = OfficePath.nodes[nodeId];
  if (!pos) {
    return { ...char, travelIntent: null, isWalking: false, pathQueue: [], pathIndex: 0, inTransit: false };
  }
  const c: CharState = {
    ...char,
    destNode: nodeId,
    isWalking: false,
    pathQueue: [],
    pathIndex: 0,
    inTransit: false,
    transitUntil: 0,
    transitZone: undefined,
    x: pos.x,
    z: pos.z,
  };
  if (c.travelIntent) return onPathComplete(c, now);
  return { ...c, destNode: null };
}

export function assignPath(char: CharState, nodeId: string): CharState {
  const store = useGameStore.getState();
  const fromZone = zoneAtPosition(char.x, char.z);
  const destZone = zoneForNode(nodeId) ?? zoneForIntent(char.travelIntent);

  if (destZone && isCrossZoneTravel(fromZone, nodeId, char.travelIntent)) {
    const now = performance.now();
    store.flyToZone(destZone);
    return {
      ...char,
      destNode: nodeId,
      isWalking: false,
      pathQueue: [],
      pathIndex: 0,
      inTransit: true,
      transitUntil: now + ZONE_TRANSIT_MS,
      transitZone: destZone,
    };
  }

  const pts = OfficePath.pathToNode(char.x, char.z, nodeId);
  if (pts.length < 2) {
    if (char.travelIntent) return teleportAgentToDestination({ ...char, destNode: nodeId }, nodeId, performance.now());
    return { ...char, destNode: nodeId, isWalking: false, pathQueue: [], inTransit: false, travelIntent: null };
  }
  return {
    ...char, destNode: nodeId, pathQueue: pts.slice(1), pathIndex: 0, isWalking: true,
    inTransit: false, transitUntil: 0, transitZone: undefined,
  };
}

export function pickWanderTarget(char: CharState): string {
  const desk = OfficePath.deskByAgent[char.agentId];
  const booth = OfficePath.boothByAgent[char.agentId];
  if (char.state === 'panic') return 'scr_ctr';
  if (char.stress > 65) {
    const r = Math.random();
    if (r > 0.55) return OfficePath.massageByAgent[char.agentId];
    if (r > 0.3) return OfficePath.dineByAgent[char.agentId];
    if (r > 0.15) return OfficePath.pokerByAgent[char.agentId];
    return booth;
  }
  if (char.state === 'trading') {
    const r = Math.random();
    if (r > 0.7) return booth;
    if (r > 0.4) return 'scr_ctr';
    return desk;
  }
  if (char.state === 'scanning') {
    const r = Math.random();
    if (r > 0.5) return 'scr_ctr';
    if (r > 0.25) return booth;
    return desk;
  }
  const r = Math.random();
  if (char.stress > 45) {
    if (r > 0.7) return OfficePath.massageByAgent[char.agentId];
    if (r > 0.5) return OfficePath.dineByAgent[char.agentId];
    if (r > 0.35) return OfficePath.pokerByAgent[char.agentId];
  }
  if (r > 0.65) return booth;
  if (r > 0.45) return 'scr_ctr';
  return desk;
}

export function onPathComplete(char: CharState, now: number): CharState {
  const node = char.destNode;
  if (char.travelIntent) {
    const intent = char.travelIntent;
    return startActivity({ ...char, travelIntent: null }, intent, now,
      intent === 'poker' ? 12000 : intent === 'massage' ? 10000 : intent === 'rest' ? 9000 : 9000);
  }
  if (node === OfficePath.boothByAgent[char.agentId] || node?.startsWith('rest_l')) return startActivity(char, 'rest', now, 9000);
  if (node === OfficePath.massageByAgent[char.agentId] || node?.startsWith('bed_')) return startActivity(char, 'massage', now, 10000);
  if (node === OfficePath.dineByAgent[char.agentId] || node?.startsWith('dine_')) return startActivity(char, 'dine', now, 9000);
  if (node === OfficePath.pokerByAgent[char.agentId] || node?.startsWith('poker_s')) return startActivity(char, 'poker', now, 12000);
  if (node?.startsWith('seat_')) {
    return {
      ...char, destNode: node, isWalking: false, pathQueue: [],
      activityPose: 'desk', facing: 'n' as const,
    };
  }
  return { ...char, destNode: null, isWalking: false, pathQueue: [] };
}

function startActivity(char: CharState, activity: CharState['activity'], now: number, dur: number): CharState {
  const seatMap: Record<string, Record<string, string>> = {
    rest: OfficePath.boothByAgent, massage: OfficePath.massageByAgent,
    dine: OfficePath.dineByAgent, poker: OfficePath.pokerByAgent,
  };
  const nodeId = char.destNode || seatMap[activity!]?.[char.agentId];
  const zoneMap = { dine: 'restaurant' as const, massage: 'spa' as const, poker: 'casino' as const, rest: 'hall' as const };
  const zone = activity ? zoneMap[activity] : null;
  const slot = activity ? resolveActivitySlot(activity, nodeId, char.agentId) : null;
  let wx = char.x, wz = char.z;
  let facing = char.facing;
  let activityPose: CharState['activityPose'] = 'sit';
  if (slot && zone) {
    const w = paperToWorld(zone, slot.px, slot.py);
    wx = w.x; wz = w.z;
    facing = slot.facing;
    activityPose = slot.pose;
  }
  const store = useGameStore.getState();
  if (zone && activity) {
    const greet = greetingForActivity(zone);
    const npc = npcForZone(zone);
    if (greet && npc) store.addMessage(`🐧 ${npc.name}：${greet}`);
    store.setNpcBubble(npc?.id ?? null, greet ?? '', now + 4500);
  }
  return {
    ...char, activity, activityUntil: now + dur + Math.random() * 5000,
    travelIntent: null, isWalking: false, pathQueue: [], destNode: slot?.slotId ?? nodeId,
    x: wx, z: wz, facing, activityPose,
    stress: activity === 'massage' ? Math.max(0, char.stress - 50)
      : activity === 'dine' ? Math.max(0, char.stress - 30)
      : activity === 'poker' ? 0
      : activity === 'rest' ? Math.max(0, char.stress - 20) : char.stress,
  };
}

/** 高压力时自动派遣 Agent 步行去休闲区 */
export function maybeDispatchLeisure(char: CharState): CharState {
  if (char.isWalking || char.activity || char.travelIntent || char.stress < 50) return char;
  const r = Math.random();
  let intent: CharState['travelIntent'] = null;
  let node = '';
  if (r > 0.55) { intent = 'massage'; node = OfficePath.massageByAgent[char.agentId]; }
  else if (r > 0.3) { intent = 'dine'; node = OfficePath.dineByAgent[char.agentId]; }
  else { intent = 'poker'; node = OfficePath.pokerByAgent[char.agentId]; }
  return { ...assignPath(char, node), travelIntent: intent };
}
