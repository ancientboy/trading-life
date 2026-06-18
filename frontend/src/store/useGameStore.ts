import { create } from 'zustand';
import { AGENT_META } from '../lib/constants';
import type { AgentData, CameraMode, CharState, QualityTier, TradeRecord } from '../lib/constants';
import { normalizeAgentMeta } from '../lib/agentAppearance';
import type { AgentMeta } from '../lib/constants';
import { OfficePath } from '../lib/pathfinding';
import { WORLD_MAP, ZONE_CAMERA } from '../lib/worldMap';
import { SIDEBAR_TO_ZONE, ZONE_TO_RIGHT_TAB } from '../lib/zones';
import { HALL_DESKS_8, ensureHallPathGraph } from '../lib/hallLayout';
import { rebuildNavGraph, assignAgentSeatSlots } from '../lib/navGraph';
import { paperToWorld } from '../lib/zoneProjection';
import { syncFurnitureToPathfinding, getActivitySeatPaper, greetingForActivity, npcForZone, resolveActivitySlot } from '../lib/zoneFurniture';
import {
  loadCustomAgentMeta, saveCustomAgentMeta, registerCustomAgentSlots,
  canCreateAgentType, createLimitMessage, type CustomAgentDraft,
} from '../lib/customAgents';
import {
  fetchLifeState, migrateLifeState, lifeIdleTick, lifeSessionStart,
  lifeActivityComplete, lifeDispatch, lifeClaimTask, lifeShopBuy, lifeSetZoneSkin,
  lifeCreateAgent, lifeSaveAgentSoul, lifeSaveAgentAppearance, lifeAgentSpeak,
  fetchSeats, claimSeat, releaseSeat, claimDailyAllowance, type LifeState,
  fetchPortfolio, resetPortfolio, resetAgentPortfolio, updateAgentStrategy, type UserPortfolio,
} from '../lib/lifeApi';
import { resolveAvailableSeat, hasFreeSeat, mergeLocalSeatOccupancy, type SeatMap } from '../lib/seatRegistry';
import { loadPoints, loadLastIdleTick } from '../lib/pointsSystem';
import { FACILITY_BASE_COST } from '../lib/facilityCosts';
import type { LeisureTierId } from '../lib/leisureTiers';
import { DAILY_ALLOWANCE_AMOUNT, stressReliefFor } from '../lib/leisureTiers';
import { homeNodeForAgent } from '../lib/agentHome';
import { isLoggedIn, getStoredAccount } from '../lib/lifeAuth';
import {
  fetchSeasonCurrent, fetchNpcEvents, syncMood, tableSpeak, enqueueDispatch,
  chatChannelForZone, fetchPokerRoom, leavePokerRoom as apiLeavePokerRoom, type ChatMessage, type NpcEvent, type SeasonInfo, type SeasonScore, type SeasonCosmetic,
  type PokerRoom,
} from '../lib/lifeEngagementApi';
import { zoneAtPosition, invalidateCollisionCache } from '../lib/collision';
import { isCrossZoneTravel, zoneForNode, zoneForIntent } from '../lib/zoneTransit';
import {
  DEFAULT_ZONE_SKINS, effectiveZoneSkin, normalizeZoneSkins,
  type SkinZone,
} from '../lib/zoneSkins';

let seatSyncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSeatSync(fn: () => Promise<void>) {
  if (seatSyncTimer) clearTimeout(seatSyncTimer);
  seatSyncTimer = setTimeout(() => { fn().catch(() => {}); }, 2500);
}

export type RightTab = 'hall' | 'object' | 'agent' | 'npc' | 'facility' | 'assets' | 'strategy' | 'messages' | 'tasks' | 'social';
export type SidebarAction = 'hall' | 'agents' | 'strategy' | 'positions' | 'restaurant' | 'spa' | 'casino' | 'warehouse' | 'social' | 'logs' | 'tasks';
export type ModalId = 'workshop' | 'strategy' | 'market' | 'rank' | 'settings' | 'help' | 'dine' | 'massage' | 'poker' | 'poker_result' | 'shop' | 'scene' | 'tasks' | null;

export type PokerPlayerResult = {
  name: string;
  score: number;
  rank: number;
  won: number;
  is_npc?: boolean;
  hole_cards?: string[];
  best_cards?: string[];
  hand_name?: string;
  hand_combo?: string;
  hole_cards_display?: string[];
  best_cards_display?: string[];
};

export type PokerHandResult = {
  results: PokerPlayerResult[];
  community_cards?: string[];
  community_cards_display?: string[];
  won: number;
  net: number;
  buyIn: number;
  pot?: number;
  balance?: number;
  tie?: boolean;
  winners_count?: number;
};
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
  /** 工坊打开模式：list=编辑已有，create=新建 */
  workshopMode: 'list' | 'create';
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
  /** 用户模拟盘资产仓库 */
  userPortfolio: UserPortfolio | null;
  tradeFeed: { agentId: string; agentName: string; trade: TradeRecord }[];
  profileSchema: { key: string; label: string; type: string; min?: number; max?: number; step?: number }[];
  profileConfig: Record<string, unknown>;
  soulMd: string;
  messages: { text: string; time: string }[];
  npcBubble: { npcId: string; text: string; until: number } | null;
  /** 用户积分 — 后端持久化 */
  points: number;
  dailyTasks: LifeState['daily_tasks'];
  dailyTaskDefs: LifeState['daily_task_defs'];
  dailyDate: string;
  seatOccupancy: SeatMap;
  shopUnlocks: string[];
  shopCatalog: LifeState['shop_catalog'];
  /** 各区域当前选用的场景皮肤 */
  zoneSkins: Record<SkinZone, string>;
  facilityCosts: Record<string, number>;
  dailyAllowanceClaimed: boolean;
  dailyAllowanceAmount: number;
  agentBubble: { agentId: string; text: string; until: number } | null;
  chatMessages: ChatMessage[];
  npcEvents: NpcEvent[];
  season: SeasonInfo | null;
  seasonScore: SeasonScore | null;
  seasonCosmetics: SeasonCosmetic[];
  mentorPairs: { mentor_agent_id: string; mentee_agent_id: string }[];
  activeNpcBuffs: Record<string, number>;
  pokerHandResult: PokerHandResult | null;
  /** 牌桌发牌动画截止时间戳 */
  pokerTableDealingUntil: number;
  /** 当前多人德州房间（等待/进行中） */
  pokerRoom: PokerRoom | null;
  /** 上次客户端挂机 tick 时间（performance.now） */
  lastIdleClientTick: number;
  /** 当前用户可操作（派遣/编辑）的 Agent */
  operableAgentIds: string[];
  isAdmin: boolean;

  canOperateAgent: (id: string) => boolean;

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
  sendAgentToLeisure: (type: 'dine' | 'massage' | 'poker', agentId?: string, tierId?: LeisureTierId, cost?: number) => Promise<boolean>;
  sendAgentToFacility: (action: 'dine' | 'massage' | 'poker' | 'rest', opts?: { agentId?: string; nodeId?: string; cost?: number; skipCost?: boolean; tierId?: LeisureTierId }) => Promise<boolean>;
  sendAgentToDesk: (agentId?: string, seatNodeId?: string) => Promise<boolean>;
  createAgent: (draft: CustomAgentDraft) => Promise<boolean>;
  openModal: (id: Exclude<ModalId, null>) => void;
  openWorkshop: (mode?: 'list' | 'create') => void;
  closeModal: () => void;
  showPokerResult: (result: PokerHandResult) => void;
  setPokerTableDealingUntil: (until: number) => void;
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
  applyUserPortfolio: (data: UserPortfolio) => void;
  syncUserPortfolio: () => Promise<void>;
  resetUserPortfolio: () => Promise<boolean>;
  resetAgentSim: (agentId: string) => Promise<boolean>;
  updateTradingStrategy: (agentId: string, body: {
    strategy_preset: string; strategy?: string; market?: string; interval?: string; risk?: string;
  }) => Promise<boolean>;
  setTicker: (t: Record<string, number>) => void;
  setProfile: (schema: GameStore['profileSchema'], config: Record<string, unknown>, soul: string) => void;
  patchChar: (id: string, patch: Partial<CharState>) => void;
  addMessage: (text: string) => void;
  setNpcBubble: (npcId: string | null, text: string, until: number) => void;
  earnPoints: (amount: number, reason?: string) => void;
  trySpendPoints: (amount: number) => { ok: boolean; balance: number };
  saveCustomAgentSoul: (agentId: string, content: string) => Promise<boolean>;
  saveCustomAgentAppearance: (agentId: string, appearance: { headwear: import('../lib/agentAppearance').AgentHeadwear; hatStyle: import('../lib/agentAppearance').HatStyleId; color: string }) => Promise<boolean>;
  tickIdlePoints: (now: number) => void;
  claimDailyTask: (taskId: string) => Promise<boolean>;
  claimDailyAllowance: () => Promise<boolean>;
  buyShopItem: (itemId: string) => Promise<boolean>;
  setZoneSkin: (zone: SkinZone, skinId: string) => Promise<boolean>;
  speakForAgent: (agentId: string, context?: string, activity?: string | null) => Promise<void>;
  setAgentBubble: (agentId: string | null, text: string, until: number) => void;
  applyLifeState: (state: Partial<LifeState>) => void;
  syncSeats: () => Promise<void>;
  syncEngagement: () => Promise<void>;
  applyPokerRoom: (room: PokerRoom | null) => void;
  syncPokerRoom: () => Promise<void>;
  clearPokerRoom: () => void;
  leavePokerRoom: () => Promise<void>;
  seatAgentAtPoker: (agentId: string, seatId?: string) => Promise<boolean>;
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
  workshopMode: 'list',
  followAgentId: null,
  cameraLookAt: { x: ZONE_CAMERA.hall.x, z: ZONE_CAMERA.hall.z },
  cameraZoom: WORLD_MAP.zoneZoom,
  mapOverview: false,
  agents: {},
  ticker: {},
  overview: {},
  userPortfolio: null,
  tradeFeed: [],
  profileSchema: [],
  profileConfig: {},
  soulMd: '',
  messages: [],
  npcBubble: null,
  points: 200,
  dailyTasks: {},
  dailyTaskDefs: [],
  dailyDate: '',
  seatOccupancy: {},
  shopUnlocks: [],
  shopCatalog: [],
  zoneSkins: { ...DEFAULT_ZONE_SKINS },
  facilityCosts: { ...FACILITY_BASE_COST },
  dailyAllowanceClaimed: false,
  dailyAllowanceAmount: DAILY_ALLOWANCE_AMOUNT,
  agentBubble: null,
  chatMessages: [],
  npcEvents: [],
  season: null,
  seasonScore: null,
  seasonCosmetics: [],
  mentorPairs: [],
  activeNpcBuffs: {},
  pokerHandResult: null,
  pokerTableDealingUntil: 0,
  pokerRoom: null,
  lastIdleClientTick: 0,
  operableAgentIds: [],
  isAdmin: false,

  canOperateAgent: (id) => get().operableAgentIds.includes(id),

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
        const operable = Object.keys(s.agents).filter(id => get().canOperateAgent(id));
        const firstId = (s.selectedAgentId && get().canOperateAgent(s.selectedAgentId) ? s.selectedAgentId : operable[0]) || Object.keys(s.agents)[0] || null;
        const openCreate = operable.length === 0;
        set({
          rightPanelCollapsed: true,
          sidebarActive: 'agents',
          activeZone: 'hall',
          rightTab: 'agent',
          selectedAgentId: firstId,
          activeModal: 'workshop',
          workshopMode: openCreate ? 'create' : 'list',
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
  openModal: (id) => set({ activeModal: id, rightPanelCollapsed: true }),
  openWorkshop: (mode = 'list') => set({ activeModal: 'workshop', workshopMode: mode, rightPanelCollapsed: true }),
  closeModal: () => set({ activeModal: null, workshopMode: 'list', pokerHandResult: null, pokerTableDealingUntil: 0 }),
  showPokerResult: (result) => set({
    pokerHandResult: result, activeModal: 'poker_result', rightPanelCollapsed: true, pokerTableDealingUntil: 0,
  }),
  setPokerTableDealingUntil: (until) => set({ pokerTableDealingUntil: until }),
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

  sendAgentToLeisure: async (type, agentId, tierId = 'a', cost) => {
    if (type === 'poker') {
      return get().sendAgentToFacility('poker', { agentId, skipCost: true });
    }
    const tierCost = cost ?? 0;
    return get().sendAgentToFacility(type, {
      agentId,
      tierId,
      cost: tierCost,
      skipCost: tierCost <= 0,
    });
  },

  sendAgentToDesk: async (agentId, seatNodeId) => {
    const s = get();
    const id = agentId || s.selectedAgentId
      || Object.values(s.agents).filter(a => get().canOperateAgent(a.agentId)).sort((a, b) => b.stress - a.stress)[0]?.agentId;
    if (!id || !s.agents[id]) return false;
    if (!get().canOperateAgent(id)) {
      get().addMessage(`${s.agents[id].data.name} 是系统 Agent，请前往工坊创建你自己的 Agent`);
      return false;
    }
    const node = seatNodeId || OfficePath.deskByAgent[id];
    if (!node || !OfficePath.nodes[node]) {
      get().addMessage('未找到可用工位');
      return false;
    }
    const now = performance.now();
    let char: CharState = {
      ...s.agents[id],
      travelIntent: null,
      activity: null,
      activityUntil: 0,
      userDispatched: true,
      isWalking: false,
      pathQueue: [],
      pathIndex: 0,
      inTransit: false,
    };
    const mergedSeats = mergeLocalSeatOccupancy(s.seatOccupancy, s.agents, now);
    const seatId = resolveAvailableSeat('desk', node, id, mergedSeats, now);
    if (!seatId) {
      get().addMessage('该工位已被占用');
      return false;
    }
    const pos = OfficePath.nodes[seatId];
    if (!pos) {
      get().addMessage('未找到可用工位');
      return false;
    }
    claimSeat(seatId, id, 'desk', 0).then(() => get().syncSeats()).catch(() => {});
    char = {
      ...char,
      destNode: seatId,
      x: pos.x,
      z: pos.z,
      activityPose: 'desk',
      facing: 'n',
      userDispatched: false,
    };
    const deskDef = HALL_DESKS_8.find(d => d.seatId === seatId);
    const deskLabel = deskDef?.id.replace('desk_', '').toUpperCase() ?? '工位';

    set({
      agents: { ...s.agents, [id]: char },
      selectedAgentId: id,
      followAgentId: null,
      activeZone: 'hall',
      sidebarActive: 'hall',
      rightTab: 'agent',
      rightPanelCollapsed: false,
      activeModal: null,
      cameraLookAt: { x: ZONE_CAMERA.hall.x, z: ZONE_CAMERA.hall.z },
      cameraZoom: WORLD_MAP.zoneZoom,
      mapOverview: false,
    });
    get().addMessage(`${char.data.name} 已派遣至 ${deskLabel} 工位（免费）`);
    return true;
  },

  sendAgentToFacility: async (action, opts) => {
    const s = get();
    const id = opts?.agentId || s.selectedAgentId || Object.values(s.agents).sort((a, b) => b.stress - a.stress)[0]?.agentId;
    if (!id || !s.agents[id]) return false;
    if (!get().canOperateAgent(id)) {
      get().addMessage(`${s.agents[id].data.name} 是系统 Agent，请前往工坊创建你自己的 Agent`);
      return false;
    }

    const skipCost = opts?.skipCost ?? (FACILITY_BASE_COST[action] === 0);
    const cost = opts?.cost ?? s.facilityCosts[action] ?? FACILITY_BASE_COST[action];
    if (!skipCost && cost > 0) {
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

    if (!hasFreeSeat(action, id, mergeLocalSeatOccupancy(s.seatOccupancy, s.agents))) {
      const queueCost = FACILITY_BASE_COST[action] ?? 0;
      await enqueueDispatch(id, action, opts?.nodeId || '', queueCost);
      get().addMessage(`${s.agents[id].data.name} 座位已满，已加入派遣队列`);
      return false;
    }

    const mergedSeats = mergeLocalSeatOccupancy(s.seatOccupancy, s.agents);
    const resolvedSeat = resolveAvailableSeat(action, node, id, mergedSeats) ?? node;

    let char = {
      ...s.agents[id],
      travelIntent: intentMap[action],
      activity: null,
      activityUntil: 0,
      userDispatched: true,
      leisureTier: opts?.tierId ?? 'a',
    };
    char = teleportAgentToDestination(char, resolvedSeat, performance.now());

    set({
      agents: { ...s.agents, [id]: char },
      selectedAgentId: id,
      followAgentId: null,
      activeZone: zone,
      sidebarActive: zone === 'hall' ? 'hall' : zone,
      rightTab: action === 'rest' ? 'hall' : 'facility',
      selectedFacility: action === 'rest' ? null : LEISURE_FACILITY[zone as keyof typeof LEISURE_FACILITY] ?? null,
      rightPanelCollapsed: action === 'poker' ? true : false,
      activeModal: action === 'poker' ? 'poker' : null,
      cameraLookAt: { x: cam.x, z: cam.z },
      cameraZoom: WORLD_MAP.zoneZoom,
      mapOverview: false,
    });
    get().addMessage(`${char.data.name} 已抵达${cam.label}${!skipCost && cost > 0 ? ` · -${cost} 积分` : ' · 免费'}`);
    get().speakForAgent(id, action, action);
    return true;
  },

  createAgent: async (draft) => {
    const s = get();
    const accountId = getStoredAccount()?.id;
    const customMeta = loadCustomAgentMeta(accountId);
    if (!canCreateAgentType(draft.agentType, customMeta)) {
      get().addMessage(createLimitMessage(draft.agentType));
      return false;
    }

    const apiRes = await lifeCreateAgent(draft);
    if (!apiRes.ok || !apiRes.agent) {
      get().addMessage(apiRes.error || '创建失败');
      return false;
    }

    const meta = normalizeAgentMeta({ ...apiRes.agent, owner: 'user' });
    const id = meta.id;
    const slot = registerCustomAgentSlots(OfficePath, id, draft.agentType);
    if (!slot) {
      get().addMessage(createLimitMessage(draft.agentType));
      return false;
    }
    assignAgentSeatSlots(OfficePath);
    saveCustomAgentMeta({ ...customMeta, [id]: meta }, accountId);
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
    await get().syncUserPortfolio();
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
    const customMeta = loadCustomAgentMeta(getStoredAccount()?.id);
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
    const accountId = getStoredAccount()?.id;
    try {
      await lifeSessionStart().catch(() => {});
      let state = await fetchLifeState();
      const localMeta = loadCustomAgentMeta(accountId);
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
        const owned = Object.fromEntries(
          Object.entries(state.custom_agents).map(([k, v]) => [k, normalizeAgentMeta({ ...v, owner: 'user' })]),
        );
        saveCustomAgentMeta(owned, accountId);
      }
      get().initAgents();
      await get().syncSeats();
      await get().syncUserPortfolio();
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

  applyPokerRoom: (room) => set({ pokerRoom: room }),

  syncPokerRoom: async () => {
    const rid = get().pokerRoom?.id;
    if (!rid) return;
    try {
      const r = await fetchPokerRoom(rid);
      if (!r.ok || !r.room) {
        set({ pokerRoom: null });
        return;
      }
      if (r.room.status === 'settled' || r.room.status === 'closed') set({ pokerRoom: null });
      else set({ pokerRoom: r.room });
    } catch { /* ignore */ }
  },

  clearPokerRoom: () => set({ pokerRoom: null }),

  leavePokerRoom: async () => {
    const rid = get().pokerRoom?.id;
    set({ pokerRoom: null });
    if (!rid) return;
    try {
      const r = await apiLeavePokerRoom(rid);
      if (r.message) get().addMessage(r.message);
    } catch { /* ignore */ }
  },

  seatAgentAtPoker: async (agentId, seatId) => {
    const ok = await get().sendAgentToFacility('poker', {
      agentId, nodeId: seatId, skipCost: true,
    });
    if (ok && get().activeZone !== 'casino') get().flyToZone('casino');
    return ok;
  },

  setChatMessages: (msgs) => set({ chatMessages: msgs }),
  setNpcEvents: (ev) => set({ npcEvents: ev }),

  releaseAgentSeat: (agentId, seatId) => {
    if (!seatId) return;
    releaseSeat(seatId, agentId).then(() => scheduleSeatSync(() => get().syncSeats())).catch(() => {});
  },

  applyLifeState: (state) => {
    const perms = state.permissions;
    const operable = perms?.operable_agent_ids ?? [];
    const shopUnlocks = state.shop_unlocks ?? get().shopUnlocks;
    const rawSkins = state.zone_skins ?? (state.stats?.zone_skins as Record<string, string> | undefined);
    const normalized = normalizeZoneSkins(rawSkins);
    const zoneSkins = { ...DEFAULT_ZONE_SKINS };
    for (const z of Object.keys(zoneSkins) as SkinZone[]) {
      zoneSkins[z] = effectiveZoneSkin(z, normalized, shopUnlocks);
    }
    const patch: Partial<GameStore> = {
      points: state.points ?? get().points,
      dailyTasks: state.daily_tasks ?? get().dailyTasks,
      dailyTaskDefs: state.daily_task_defs ?? get().dailyTaskDefs,
      dailyDate: state.daily_date ?? get().dailyDate,
      shopUnlocks,
      shopCatalog: state.shop_catalog ?? get().shopCatalog,
      zoneSkins,
      facilityCosts: state.facility_costs ?? get().facilityCosts,
      dailyAllowanceClaimed: state.daily_allowance?.claimed_today ?? get().dailyAllowanceClaimed,
      dailyAllowanceAmount: state.daily_allowance?.amount ?? DAILY_ALLOWANCE_AMOUNT,
      operableAgentIds: operable,
      isAdmin: perms?.is_admin ?? false,
    };
    set(patch);
    const curSel = get().selectedAgentId;
    if (curSel && operable.length && !operable.includes(curSel)) {
      set({ selectedAgentId: operable[0] ?? null });
    }
  },

  updateFromOverview: (data) => {
    const prev = get();
    if (Object.keys(prev.agents).length === 0) {
      get().initAgents();
    }
    const agents = { ...get().agents };

    (data.agents || []).forEach((a) => {
      if (!agents[a.id]) return;
      if (get().canOperateAgent(a.id)) return;
      if (agents[a.id].data.agentType === 'entertainment') return;
      const stress = Math.min(100, Math.max(0, -(a.pnl || 0) / 20 + (a.is_circuit_break ? 40 : 0)));
      let state: CharState['state'] = 'idle';
      if (a.is_circuit_break) state = 'panic';
      else if (a.positions?.length) state = 'trading';
      else if (a.running) state = 'scanning';
      agents[a.id] = { ...agents[a.id], data: { ...agents[a.id].data, ...a }, stress, state };
    });

    set({ agents });
  },

  applyUserPortfolio: (data) => {
    if (!data?.ok) return;
    const prev = get();
    if (Object.keys(prev.agents).length === 0) {
      get().initAgents();
    }
    const agents = { ...get().agents };
    const tradeFeed: GameStore['tradeFeed'] = [];

    (data.agents || []).forEach((a) => {
      if (!agents[a.id]) return;
      const patch: Partial<AgentData> = {
        capital: a.capital,
        initial_capital: a.initial_capital,
        pnl: a.pnl,
        pnl_pct: a.pnl_pct,
        trades: a.trades,
        wins: a.wins,
        win_rate: a.win_rate,
        positions: a.positions,
        trades_history: a.trades_history,
        running: a.running,
        is_circuit_break: a.is_circuit_break,
        strategy: a.strategy,
        market: a.market,
        interval: a.interval,
        risk: a.risk,
        strategyPreset: a.strategy_preset,
      };
      const stress = Math.min(100, Math.max(0, -(a.pnl || 0) / 20 + (a.is_circuit_break ? 40 : 0)));
      let state: CharState['state'] = 'idle';
      if (a.is_circuit_break) state = 'panic';
      else if (a.positions?.length) state = 'trading';
      else if (a.running) state = 'scanning';
      agents[a.id] = { ...agents[a.id], data: { ...agents[a.id].data, ...patch }, stress, state };
      (a.trades_history || []).slice(0, 20).forEach(trade => {
        tradeFeed.push({ agentId: a.id, agentName: a.name || agents[a.id].data.name, trade });
      });
    });

    tradeFeed.sort((a, b) => {
      const ta = a.trade.closed_at || a.trade.opened_at || '';
      const tb = b.trade.closed_at || b.trade.opened_at || '';
      return tb.localeCompare(ta);
    });

    const selectedAgentId = (() => {
      if (prev.selectedAgentId && get().canOperateAgent(prev.selectedAgentId)) return prev.selectedAgentId;
      const operable = Object.keys(agents).filter(id => get().canOperateAgent(id));
      if (operable.length) return operable[0];
      return prev.selectedAgentId || Object.keys(agents)[0] || null;
    })();

    set({
      agents,
      selectedAgentId,
      userPortfolio: data,
      tradeFeed: tradeFeed.slice(0, 80),
      overview: {
        total_pnl: data.total_pnl,
        total_wr: data.total_wr,
        total_capital: data.total_capital,
        total_initial: data.initial_balance,
        total_pnl_pct: data.total_pnl_pct,
        total_trades: data.total_trades,
      },
    });
  },

  syncUserPortfolio: async () => {
    if (!isLoggedIn()) return;
    try {
      const data = await fetchPortfolio();
      if (data.ok) get().applyUserPortfolio(data);
    } catch { /* ignore */ }
  },

  resetUserPortfolio: async () => {
    try {
      const data = await resetPortfolio();
      if (!data.ok) {
        get().addMessage(data.error || '重置失败');
        return false;
      }
      get().applyUserPortfolio(data);
      get().addMessage('已重置模拟盘：5万 USDT 已恢复，交易记录已清空');
      return true;
    } catch {
      get().addMessage('重置失败，请稍后重试');
      return false;
    }
  },

  resetAgentSim: async (agentId) => {
    try {
      const res = await resetAgentPortfolio(agentId);
      if (!res.ok || !res.portfolio) {
        get().addMessage(res.error || '重置失败');
        return false;
      }
      get().applyUserPortfolio(res.portfolio);
      get().addMessage(res.message || '已重置该 Agent 模拟盘');
      return true;
    } catch {
      get().addMessage('重置失败，请稍后重试');
      return false;
    }
  },

  updateTradingStrategy: async (agentId, body) => {
    try {
      const res = await updateAgentStrategy(agentId, body);
      if (!res.ok || !res.portfolio) {
        get().addMessage(res.error || '策略更新失败');
        return false;
      }
      if (res.agent) {
        const agents = { ...get().agents };
        if (agents[agentId]) {
          agents[agentId] = { ...agents[agentId], data: { ...agents[agentId].data, ...res.agent } };
          set({ agents });
        }
        const accountId = getStoredAccount()?.id;
        const customMeta = loadCustomAgentMeta(accountId);
        if (customMeta[agentId]) {
          customMeta[agentId] = { ...customMeta[agentId], ...res.agent };
          saveCustomAgentMeta(customMeta, accountId);
        }
      }
      get().applyUserPortfolio(res.portfolio);
      get().addMessage('策略已更新');
      return true;
    } catch {
      get().addMessage('策略更新失败');
      return false;
    }
  },

  setTicker: (t) => set({ ticker: t }),
  setProfile: (schema, config, soul) => set({ profileSchema: schema, profileConfig: config, soulMd: soul }),
  patchChar: (id, patch) => set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], ...patch } } })),
  addMessage: (text) => set(s => ({ messages: [...s.messages.slice(-49), { text, time: new Date().toLocaleTimeString() }] })),
  setNpcBubble: (npcId, text, until) => set({
    npcBubble: npcId && text ? { npcId, text, until } : null,
  }),

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
    const customMeta = loadCustomAgentMeta(getStoredAccount()?.id);
    if (customMeta[agentId]) {
      customMeta[agentId] = { ...customMeta[agentId], soulMd: content };
      saveCustomAgentMeta(customMeta, getStoredAccount()?.id);
    }
    return true;
  },

  saveCustomAgentAppearance: async (agentId, appearance) => {
    if (!agentId.startsWith('custom_')) return false;
    try {
      const r = await lifeSaveAgentAppearance(agentId, appearance);
      if (!r.ok) {
        if (r.error) get().addMessage(r.error);
        return false;
      }
    } catch {
      return false;
    }
    const agents = { ...get().agents };
    if (agents[agentId]) {
      agents[agentId] = {
        ...agents[agentId],
        data: { ...agents[agentId].data, ...appearance },
      };
      set({ agents });
    }
    const customMeta = loadCustomAgentMeta(getStoredAccount()?.id);
    if (customMeta[agentId]) {
      customMeta[agentId] = { ...customMeta[agentId], ...appearance };
      saveCustomAgentMeta(customMeta, getStoredAccount()?.id);
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

  claimDailyAllowance: async () => {
    const res = await claimDailyAllowance();
    if (!res.ok) {
      get().addMessage(res.error === 'already_claimed' ? '今日每日积分已领取' : '领取失败');
      return false;
    }
    set({ points: res.balance, dailyAllowanceClaimed: true });
    get().addMessage(`+${res.amount ?? DAILY_ALLOWANCE_AMOUNT} 积分 · 每日免费领取`);
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
    if (res.state) get().applyLifeState(res.state);
    else {
      const state = await fetchLifeState();
      get().applyLifeState(state);
    }
    get().addMessage(`已解锁：${res.item?.label ?? itemId}`);
    if (res.item?.type === 'zone_skin') {
      get().addMessage('请到顶部导航「场景装扮」切换各区域风格');
      get().openModal('scene');
    }
    return true;
  },

  setZoneSkin: async (zone, skinId) => {
    const res = await lifeSetZoneSkin(zone, skinId);
    if (!res.ok) {
      get().addMessage(res.error ?? '切换皮肤失败');
      return false;
    }
    if (res.state) get().applyLifeState(res.state);
    else if (res.zone_skins) {
      const shopUnlocks = get().shopUnlocks;
      const normalized = normalizeZoneSkins(res.zone_skins);
      const zoneSkins = { ...DEFAULT_ZONE_SKINS };
      for (const z of Object.keys(zoneSkins) as SkinZone[]) {
        zoneSkins[z] = effectiveZoneSkin(z, normalized, shopUnlocks);
      }
      set({ zoneSkins });
    }
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
    if (store.followAgentId === char.agentId) {
      store.flyToZone(destZone);
    }
    // 跨区一律静默传送，不使用全屏过场
    return teleportAgentToDestination(
      { ...char, destNode: nodeId, isWalking: false, pathQueue: [], pathIndex: 0, inTransit: false },
      nodeId,
      now,
    );
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
      intent === 'poker' ? (char.userDispatched ? 1_800_000 : 12000)
      : intent === 'massage' ? 10000 : intent === 'rest' ? 9000 : 9000);
  }
  if (node === OfficePath.boothByAgent[char.agentId] || node?.startsWith('rest_l')) return startActivity(char, 'rest', now, 9000);
  if (node === OfficePath.massageByAgent[char.agentId] || node?.startsWith('bed_')) return startActivity(char, 'massage', now, 10000);
  if (node === OfficePath.dineByAgent[char.agentId] || node?.startsWith('dine_')) return startActivity(char, 'dine', now, 9000);
  if (node === OfficePath.pokerByAgent[char.agentId] || node?.startsWith('poker_s')) {
    return startActivity(char, 'poker', now, char.userDispatched ? 1_800_000 : 12000);
  }
  if (node?.startsWith('seat_')) {
    const store = useGameStore.getState();
    const mergedSeats = mergeLocalSeatOccupancy(store.seatOccupancy, store.agents, now);
    const seatId = resolveAvailableSeat('desk', node, char.agentId, mergedSeats, now);
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
  const mergedSeats = mergeLocalSeatOccupancy(store.seatOccupancy, store.agents, now);
  const seatId = activity
    ? resolveAvailableSeat(activity, nodeId, char.agentId, mergedSeats, now)
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
      if (!res.ok && char.userDispatched) store.addMessage(`${char.data.name} 占座失败，座位可能已被占用`);
    }).catch(() => {});
  }
  if (zone && activity) {
    const greet = greetingForActivity(zone);
    const npc = npcForZone(zone);
    if (greet && npc) {
      if (char.userDispatched) store.addMessage(`🐧 ${npc.name}：${greet}`);
      store.setNpcBubble(npc?.id ?? null, greet ?? '', now + 4500);
    }
  }
  const relief = activity === 'dine' ? stressReliefFor('dine', char.leisureTier)
    : activity === 'massage' ? stressReliefFor('massage', char.leisureTier)
    : activity === 'rest' ? 0.2 : 0;
  const started = {
    ...char, activity, activityUntil: until, activityStartedAt: now,
    travelIntent: null, isWalking: false, pathQueue: [], destNode: slot?.slotId ?? seatId ?? nodeId,
    x: wx, z: wz, facing, activityPose,
    stress: relief > 0 ? Math.max(0, char.stress * (1 - relief))
      : activity === 'poker' ? char.stress : char.stress,
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
  if (activity === 'poker') return;
  lifeActivityComplete(activity, true).then(res => {
    if (res.earned > 0) {
      useGameStore.setState({ points: res.balance });
      useGameStore.getState().addMessage(`+${res.earned} 积分 · ${agentName} 完成${activityLabel(activity)}`);
    }
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
  return { ...assignPath({ ...char, userDispatched: false }, node), travelIntent: intent };
}
