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
  canCreateAgentType, createLimitMessage, type CustomAgentDraft,
} from '../lib/customAgents';
import {
  fetchLifeState, migrateLifeState, lifeIdleTick, lifeSessionStart,
  lifeActivityComplete, lifeDispatch, lifeClaimTask, lifeShopBuy,
  lifeCreateAgent, lifeSaveAgentSoul, lifeAgentSpeak,
  fetchSeats, claimSeat, releaseSeat, type LifeState,
} from '../lib/lifeApi';
import { resolveAvailableSeat, hasFreeSeat, type SeatMap } from '../lib/seatRegistry';
import { loadPoints, loadLastIdleTick } from '../lib/pointsSystem';
import { FACILITY_BASE_COST } from '../lib/facilityCosts';
import { homeNodeForAgent } from '../lib/agentHome';
import { isLoggedIn } from '../lib/lifeAuth';
import {
  fetchSeasonCurrent, fetchNpcEvents, syncMood, tableSpeak, enqueueDispatch,
  chatChannelForZone, type ChatMessage, type NpcEvent, type SeasonInfo, type SeasonScore, type SeasonCosmetic,
} from '../lib/lifeEngagementApi';
import { zoneAtPosition, invalidateCollisionCache } from '../lib/collision';
import { isCrossZoneTravel, zoneForNode, zoneForIntent, ZONE_TRANSIT_MS } from '../lib/zoneTransit';

export type RightTab = 'hall' | 'object' | 'agent' | 'npc' | 'facility' | 'assets' | 'strategy' | 'messages' | 'tasks' | 'social';
export type SidebarAction = 'hall' | 'agents' | 'strategy' | 'positions' | 'restaurant' | 'spa' | 'casino' | 'warehouse' | 'social' | 'logs' | 'tasks';
export type ModalId = 'workshop' | 'strategy' | 'market' | 'rank' | 'settings' | 'help' | 'dine' | 'massage' | 'poker' | 'shop' | 'tasks' | null;
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
  /** 用户积分 — 后端持久化 */
  points: number;
  dailyTasks: LifeState['daily_tasks'];
  dailyTaskDefs: LifeState['daily_task_defs'];
  dailyDate: string;
  seatOccupancy: SeatMap;
  shopUnlocks: string[];
  shopCatalog: LifeState['shop_catalog'];
  facilityCosts: Record<string, number>;
  agentBubble: { agentId: string; text: string; until: number } | null;
  chatMessages: ChatMessage[];
  npcEvents: NpcEvent[];
  season: SeasonInfo | null;
  seasonScore: SeasonScore | null;
  seasonCosmetics: SeasonCosmetic[];
  mentorPairs: { mentor_agent_id: string; mentee_agent_id: string }[];
  activeNpcBuffs: Record<string, number>;
  /** 上次客户端挂机 tick 时间（performance.now） */
  lastIdleClientTick: number;

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
  sendAgentToLeisure: (type: 'dine' | 'massage' | 'poker', agentId?: string, cost?: number) => Promise<boolean>;
  sendAgentToFacility: (action: 'dine' | 'massage' | 'poker' | 'rest', opts?: { agentId?: string; nodeId?: string; cost?: number; skipCost?: boolean }) => Promise<boolean>;
  createAgent: (draft: CustomAgentDraft) => Promise<boolean>;
  openModal: (id: ModalId) => void;
  closeModal: () => void;
  flyToZone: (zone: ZoneId) => void;
  resetCamera: () => void;
  setFollowAgent: (id: string | null) => void;
  setCameraLookAt: (x: number, z: number, opts?: { zoom?: number; overview?: boolean }) => void;
  setCameraZoom: (zoom: number) => void;
  panCamera: (dx: number, dz: number) => void;
  initAgents: () => void;
  syncLifeState: () => Promise<void>;
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
  earnPoints: (amount: number, reason?: string) => void;
  trySpendPoints: (amount: number) => { ok: boolean; balance: number };
  saveCustomAgentSoul: (agentId: string, content: string) => Promise<boolean>;
  tickIdlePoints: (now: number) => void;
  claimDailyTask: (taskId: string) => Promise<boolean>;
  buyShopItem: (itemId: string) => Promise<boolean>;
  speakForAgent: (agentId: string, context?: string, activity?: string | null) => Promise<void>;
  setAgentBubble: (agentId: string | null, text: string, until: number) => void;
  applyLifeState: (state: Partial<LifeState>) => void;
  syncSeats: () => Promise<void>;
  syncEngagement: () => Promise<void>;
  setChatMessages: (msgs: ChatMessage[]) => void;
  setNpcEvents: (ev: NpcEvent[]) => void;
  releaseAgentSeat: (agentId: string, seatId: string | null | undefined) => void;
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
  points: 200,
  dailyTasks: {},
  dailyTaskDefs: [],
  dailyDate: '',
  seatOccupancy: {},
  shopUnlocks: [],
  shopCatalog: [],
  facilityCosts: { ...FACILITY_BASE_COST },
  agentBubble: null,
  chatMessages: [],
  npcEvents: [],
  season: null,
  seasonScore: null,
  seasonCosmetics: [],
  mentorPairs: [],
  activeNpcBuffs: {},
  lastIdleClientTick: 0,

  setCameraMode: (m) => set({ cameraMode: m }),
  setQuality: (q) => set({ quality: q }),
  setEffectsOn: (v) => set({ effectsOn: v }),
  setSimSpeed: (s) => set({ simSpeed: s }),
  togglePause: () => set(s => ({ paused: !s.paused })),
  setDayMode: (d) => set({ dayMode: d }),
  selectAgent: (id, opts) => {
    set({
      selectedAgentId: id,
      selectedNpcId: null,
      selectedFacility: null,
      rightTab: opts?.tab ?? 'agent',
      panelTab: 'overview',
      rightPanelCollapsed: false,
    });
    if (id) get().speakForAgent(id, 'greeting');
  },
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
        set({ ...expand, sidebarActive: 'social', rightTab: 'social', rightPanelCollapsed: false });
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

  sendAgentToLeisure: async (type, agentId, cost) => {
    return get().sendAgentToFacility(type, { agentId, cost, skipCost: cost == null });
  },

  sendAgentToFacility: async (action, opts) => {
    const s = get();
    const id = opts?.agentId || s.selectedAgentId || Object.values(s.agents).sort((a, b) => b.stress - a.stress)[0]?.agentId;
    if (!id || !s.agents[id]) return false;

    const cost = opts?.cost ?? s.facilityCosts[action] ?? FACILITY_BASE_COST[action];
    if (!opts?.skipCost && cost > 0) {
      const disp = await lifeDispatch(action, cost);
      if (!disp.ok) {
        get().addMessage(`积分不足，需要 ${cost} 积分（当前 ${disp.balance}）`);
        return false;
      }
      set({ points: disp.balance });
    }

    const zoneMap = { dine: 'restaurant' as ZoneId, massage: 'spa' as ZoneId, poker: 'casino' as ZoneId, rest: 'hall' as ZoneId };
    const intentMap = { dine: 'dine' as const, massage: 'massage' as const, poker: 'poker' as const, rest: 'rest' as const };
    const nodeMap = { dine: OfficePath.dineByAgent, massage: OfficePath.massageByAgent, poker: OfficePath.pokerByAgent, rest: OfficePath.boothByAgent };

    const zone = zoneMap[action];
    const cam = ZONE_CAMERA[zone];
    const node = opts?.nodeId || nodeMap[action][id];
    if (!node) return false;

    if (!hasFreeSeat(action, id, s.seatOccupancy)) {
      const cost = opts?.cost ?? s.facilityCosts[action] ?? FACILITY_BASE_COST[action];
      await enqueueDispatch(id, action, opts?.nodeId || '', cost);
      get().addMessage(`${s.agents[id].data.name} 座位已满，已加入派遣队列`);
      return false;
    }

    let char = { ...s.agents[id], travelIntent: intentMap[action], activity: null, activityUntil: 0, userDispatched: true };
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
    get().addMessage(`${char.data.name} 已抵达${cam.label}${cost > 0 ? ` · -${cost} 积分` : ''}`);
    get().speakForAgent(id, action, action);
    return true;
  },

  createAgent: async (draft) => {
    const s = get();
    const customMeta = loadCustomAgentMeta();
    if (!canCreateAgentType(draft.agentType, customMeta)) {
      get().addMessage(createLimitMessage(draft.agentType));
      return false;
    }

    const apiRes = await lifeCreateAgent(draft);
    if (!apiRes.ok || !apiRes.agent) {
      get().addMessage(apiRes.error || '创建失败');
      return false;
    }

    const meta = normalizeAgentMeta(apiRes.agent);
    const id = meta.id;
    const slot = registerCustomAgentSlots(OfficePath, id, draft.agentType);
    if (!slot) {
      get().addMessage(createLimitMessage(draft.agentType));
      return false;
    }
    assignAgentSeatSlots(OfficePath);
    saveCustomAgentMeta({ ...customMeta, [id]: meta });
    if (apiRes.state) get().applyLifeState(apiRes.state);

    const pos = OfficePath.nodes[slot];
    const char: CharState = {
      agentId: id, x: pos.x, z: pos.z,
      pathQueue: [], pathIndex: 0, isWalking: false, destNode: null,
      activity: null, activityUntil: 0, travelIntent: null,
      state: 'idle', stress: 0,
      moveTimer: 0, nextMoveTime: 1500 + Math.random() * 2500,
      facing: draft.agentType === 'entertainment' ? 'e' : 'n',
      data: { ...meta, capital: draft.agentType === 'trading' ? 10000 : 0, initial_capital: 10000, pnl: 0, running: false },
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
    get().speakForAgent(id, 'greeting');
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
    Object.entries(customMeta).forEach(([id, meta]) => {
      if (!OfficePath.deskByAgent[id] && !OfficePath.boothByAgent[id]) {
        registerCustomAgentSlots(OfficePath, id, meta.agentType ?? 'trading');
      }
    });
    assignAgentSeatSlots(OfficePath);

    const agents: Record<string, CharState> = {};
    const allIds = new Set([...Object.keys(AGENT_META), ...Object.keys(customMeta)]);

    allIds.forEach(id => {
      const raw = AGENT_META[id] || customMeta[id];
      if (!raw) return;
      const meta = normalizeAgentMeta(raw);
      const nodeId = meta.agentType === 'entertainment'
        ? OfficePath.boothByAgent[id]
        : OfficePath.deskByAgent[id];
      if (!nodeId) return;
      const pos = OfficePath.nodes[nodeId];
      if (!pos) return;
      agents[id] = {
        agentId: id, x: pos.x, z: pos.z,
        pathQueue: [], pathIndex: 0, isWalking: false, destNode: null,
        activity: null, activityUntil: 0, travelIntent: null,
        state: 'idle', stress: 0,
        moveTimer: 0, nextMoveTime: 1500 + Math.random() * 2500,
        facing: meta.agentType === 'entertainment' ? 'e' : 'n',
        data: { ...meta },
      };
    });
    set({ agents });
  },

  syncLifeState: async () => {
    if (!isLoggedIn()) return;
    try {
      await lifeSessionStart().catch(() => {});
      let state = await fetchLifeState();
      const localMeta = loadCustomAgentMeta();
      const localPoints = loadPoints();
      if (Object.keys(localMeta).length && !Object.keys(state.custom_agents || {}).length) {
        const migrated = await migrateLifeState({
          points: localPoints,
          last_idle_tick: loadLastIdleTick(),
          custom_agents: localMeta,
        });
        state = migrated;
      }
      get().applyLifeState(state);
      if (state.custom_agents && Object.keys(state.custom_agents).length) {
        saveCustomAgentMeta(state.custom_agents);
        get().initAgents();
      }
      await get().syncSeats();
    } catch {
      /* 离线时沿用本地缓存 */
    }
  },

  syncSeats: async () => {
    try {
      const res = await fetchSeats();
      if (res.ok) set({ seatOccupancy: res.seats });
    } catch { /* ignore */ }
  },

  syncEngagement: async () => {
    try {
      const [seasonRes, evRes] = await Promise.all([fetchSeasonCurrent(), fetchNpcEvents()]);
      if (seasonRes.ok && seasonRes.season) {
        set({
          season: seasonRes.season,
          seasonScore: seasonRes.my_score ?? null,
          seasonCosmetics: seasonRes.cosmetics ?? [],
        });
      }
      if (evRes.ok) {
        const buffs: Record<string, number> = {};
        evRes.events.forEach(ev => { if (!ev.claimed) buffs[ev.buff_type] = ev.buff_value; });
        set({ npcEvents: evRes.events, activeNpcBuffs: buffs });
      }
      const mentorRes = await import('../lib/lifeEngagementApi').then(m => m.fetchMentorPairs());
      if (mentorRes.ok) set({ mentorPairs: mentorRes.pairs });
    } catch { /* ignore */ }
  },

  setChatMessages: (msgs) => set({ chatMessages: msgs }),
  setNpcEvents: (ev) => set({ npcEvents: ev }),

  releaseAgentSeat: (agentId, seatId) => {
    if (!seatId) return;
    releaseSeat(seatId, agentId).then(() => get().syncSeats()).catch(() => {});
  },

  applyLifeState: (state) => {
    set({
      points: state.points ?? get().points,
      dailyTasks: state.daily_tasks ?? get().dailyTasks,
      dailyTaskDefs: state.daily_task_defs ?? get().dailyTaskDefs,
      dailyDate: state.daily_date ?? get().dailyDate,
      shopUnlocks: state.shop_unlocks ?? get().shopUnlocks,
      shopCatalog: state.shop_catalog ?? get().shopCatalog,
      facilityCosts: state.facility_costs ?? get().facilityCosts,
    });
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
      if (agents[a.id].data.agentType === 'entertainment') return;
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

  earnPoints: (amount, reason) => {
    if (amount <= 0) return;
    set(s => ({ points: s.points + amount }));
    if (reason) get().addMessage(`+${amount} 积分 · ${reason}`);
  },

  trySpendPoints: (amount) => {
    const cur = get().points;
    if (amount > cur) return { ok: false, balance: cur };
    set({ points: cur - amount });
    return { ok: true, balance: cur - amount };
  },

  saveCustomAgentSoul: async (agentId, content) => {
    if (!agentId.startsWith('custom_')) return false;
    try {
      const r = await lifeSaveAgentSoul(agentId, content);
      if (!r.ok) return false;
    } catch {
      return false;
    }
    const agents = { ...get().agents };
    if (agents[agentId]) {
      agents[agentId] = { ...agents[agentId], data: { ...agents[agentId].data, soulMd: content } };
      set({ agents, soulMd: content });
    }
    const customMeta = loadCustomAgentMeta();
    if (customMeta[agentId]) {
      customMeta[agentId] = { ...customMeta[agentId], soulMd: content };
      saveCustomAgentMeta(customMeta);
    }
    return true;
  },

  tickIdlePoints: (now) => {
    const { paused, agents, lastIdleClientTick } = get();
    if (paused) return;
    if (document.visibilityState === 'hidden') return;
    if (now - lastIdleClientTick < 55_000) return;
    set({ lastIdleClientTick: now });
    const count = Object.keys(agents).length;
    if (count <= 0) return;
    lifeIdleTick(count).then(res => {
      if (res.earned > 0) {
        set({ points: res.balance });
        get().addMessage(`+${res.earned} 积分 · 挂机奖励（${Math.min(count, 5)} 位 Agent 在线）`);
        fetchLifeState().then(s => get().applyLifeState(s)).catch(() => {});
      }
    }).catch(() => {});
  },

  claimDailyTask: async (taskId) => {
    const res = await lifeClaimTask(taskId);
    if (!res.ok) {
      get().addMessage(res.error === 'not_complete' ? '任务尚未完成' : '领取失败');
      return false;
    }
    set({ points: res.balance });
    get().addMessage(`+${res.reward} 积分 · 每日任务奖励`);
    const state = await fetchLifeState();
    get().applyLifeState(state);
    return true;
  },

  buyShopItem: async (itemId) => {
    const res = await lifeShopBuy(itemId);
    if (!res.ok) {
      get().addMessage('积分不足或购买失败');
      return false;
    }
    set({ points: res.balance });
    const state = await fetchLifeState();
    get().applyLifeState(state);
    get().addMessage(`已解锁：${res.item?.label ?? itemId}`);
    return true;
  },

  speakForAgent: async (agentId, context = 'greeting', activity = null) => {
    const char = get().agents[agentId];
    if (!char) return;
    try {
      const res = await lifeAgentSpeak({
        agent_id: agentId,
        agent_name: char.data.name,
        soul_md: char.data.soulMd || get().soulMd || '',
        context,
        activity,
      });
      if (res.line) {
        get().setAgentBubble(agentId, res.line, performance.now() + 4500);
      }
    } catch { /* ignore */ }
  },

  setAgentBubble: (agentId, text, until) => set({
    agentBubble: agentId && text ? { agentId, text, until } : null,
  }),
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
  if (char.destNode && char.destNode !== nodeId && !char.activity) {
    store.releaseAgentSeat(char.agentId, char.destNode);
  }
  const fromZone = zoneAtPosition(char.x, char.z);
  const destZone = zoneForNode(nodeId) ?? zoneForIntent(char.travelIntent);

  if (destZone && isCrossZoneTravel(fromZone, nodeId, char.travelIntent)) {
    const now = performance.now();
    // 仅跟随镜头时不自动切区；自主漫步的 Agent 不抢用户视角
    if (store.followAgentId === char.agentId) {
      store.flyToZone(destZone);
    }
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
  const entertainment = char.data.agentType === 'entertainment';

  if (entertainment) {
    const r = Math.random();
    if (r > 0.75) return OfficePath.massageByAgent[char.agentId];
    if (r > 0.55) return OfficePath.dineByAgent[char.agentId];
    if (r > 0.35) return OfficePath.pokerByAgent[char.agentId];
    if (r > 0.15) return booth;
    return 'hall_coffee';
  }

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
    const store = useGameStore.getState();
    const seatId = resolveAvailableSeat('desk', node, char.agentId, store.seatOccupancy, now);
    if (!seatId) {
      store.addMessage(`${char.data.name} 工位已被占用`);
      return { ...char, destNode: null, isWalking: false, pathQueue: [] };
    }
    claimSeat(seatId, char.agentId, 'desk', 0).then(() => store.syncSeats()).catch(() => {});
    return {
      ...char, destNode: seatId, isWalking: false, pathQueue: [],
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

  const store = useGameStore.getState();
  const seatId = activity
    ? resolveAvailableSeat(activity, nodeId, char.agentId, store.seatOccupancy, now)
    : null;
  if (activity && !seatId) {
    store.addMessage(`${char.data.name} 找不到空座位，活动取消`);
    return { ...char, travelIntent: null, isWalking: false, pathQueue: [], destNode: null };
  }

  const slot = activity ? resolveActivitySlot(activity, seatId ?? nodeId, char.agentId) : null;
  let wx = char.x, wz = char.z;
  let facing = char.facing;
  let activityPose: CharState['activityPose'] = 'sit';
  if (slot && zone) {
    const w = paperToWorld(zone, slot.px, slot.py);
    wx = w.x; wz = w.z;
    facing = slot.facing;
    activityPose = slot.pose;
  }
  const until = now + dur + Math.random() * 5000;
  if (seatId && activity) {
    claimSeat(seatId, char.agentId, activity, Math.round(until)).then(res => {
      if (!res.ok) store.addMessage(`${char.data.name} 占座失败，座位可能已被占用`);
      store.syncSeats();
    }).catch(() => {});
  }
  if (zone && activity) {
    const greet = greetingForActivity(zone);
    const npc = npcForZone(zone);
    if (greet && npc) store.addMessage(`🐧 ${npc.name}：${greet}`);
    store.setNpcBubble(npc?.id ?? null, greet ?? '', now + 4500);
  }
  const started = {
    ...char, activity, activityUntil: until,
    travelIntent: null, isWalking: false, pathQueue: [], destNode: slot?.slotId ?? seatId ?? nodeId,
    x: wx, z: wz, facing, activityPose,
    stress: activity === 'massage' ? Math.max(0, char.stress - 50)
      : activity === 'dine' ? Math.max(0, char.stress - 30)
      : activity === 'poker' ? 0
      : activity === 'rest' ? Math.max(0, char.stress - 20) : char.stress,
  };
  useGameStore.getState().speakForAgent(char.agentId, activity ?? 'greeting', activity);
  if (zone && slot) {
    const ch = chatChannelForZone(zone, slot.slotId);
    tableSpeak(ch, char.agentId, char.data.name, char.data.soulMd || '').then(() => {
      import('../lib/lifeEngagementApi').then(m => m.fetchChat(ch, 0).then(r => {
        if (r.ok) store.setChatMessages(r.messages);
      }));
    }).catch(() => {});
  }
  return started;
}

/** 活动完成时发放积分（仅用户派遣） */
export function awardActivityPoints(
  activity: NonNullable<CharState['activity']>,
  agentName: string,
  userInitiated: boolean,
) {
  if (!userInitiated) return;
  lifeActivityComplete(activity, true).then(res => {
    if (res.earned > 0) {
      useGameStore.setState({ points: res.balance });
      useGameStore.getState().addMessage(`+${res.earned} 积分 · ${agentName} 完成${activityLabel(activity)}`);
    }
    fetchLifeState().then(s => useGameStore.getState().applyLifeState(s)).catch(() => {});
  }).catch(() => {});
}

function activityLabel(activity: NonNullable<CharState['activity']>) {
  return { rest: '休息', dine: '用餐', massage: '按摩', poker: '德州', idle: '活动' }[activity] ?? '活动';
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
