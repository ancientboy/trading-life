export const S = 0.01;
export const WORLD = { W: 56, H: 30, MID_X: 28, MID_Y: 15 };

export const AGENT_META: Record<string, AgentMeta> = {
  xau: { id: 'xau', name: 'XAU Agent', color: '#FFD700', headwear: 'scarf', hatStyle: 'beanie', desc: '黄金趋势交易', strategy: '趋势跟踪', market: 'XAUUSDT', interval: '15m/1h', risk: '中', agentType: 'trading', owner: 'system' },
  major: { id: 'major', name: 'Major Agent', color: '#3B82F6', headwear: 'hat', hatStyle: 'cap', desc: '主流币趋势', strategy: '趋势+反转', market: 'BTC/ETH', interval: '1h/4h', risk: '中', agentType: 'trading', owner: 'system' },
  altcoin: { id: 'altcoin', name: 'Altcoin Agent', color: '#F59E0B', headwear: 'scarf', hatStyle: 'beanie', desc: '山寨波段', strategy: '波段动量', market: 'Alt', interval: '15m/1h', risk: '中高', agentType: 'trading', owner: 'system' },
  newcoin: { id: 'newcoin', name: 'Newcoin Agent', color: '#A855F7', headwear: 'hat', hatStyle: 'bobble', desc: '新币猎手', strategy: '趋势突破', market: '新币', interval: '5m/15m', risk: '高', agentType: 'trading', owner: 'system' },
  momentum: { id: 'momentum', name: 'Momentum Agent', color: '#EF4444', headwear: 'hat', hatStyle: 'top', desc: '动量快打', strategy: '动量追踪', market: '高波动', interval: '5m/15m', risk: '高', agentType: 'trading', owner: 'system' },
};

/** 系统内置 Agent（归属 admin，全员可见） */
export const SYSTEM_AGENT_IDS = Object.keys(AGENT_META);

export type AgentType = 'trading' | 'entertainment';

export interface AgentMeta {
  id: string; name: string; color: string;
  headwear: 'scarf' | 'hat';
  hatStyle: 'beanie' | 'cap' | 'top' | 'bobble' | 'beret';
  desc: string; strategy: string; market: string; interval: string; risk: string;
  /** trading=策略交易；entertainment=纯娱乐陪伴 */
  agentType?: AgentType;
  /** system=系统内置（admin）；user=当前用户自建 */
  owner?: 'system' | 'user';
  /** 自定义 Agent 的 SOUL 文档（本地存储） */
  soulMd?: string;
  /** 策略预设：xau/major/altcoin/newcoin/momentum/custom */
  strategyPreset?: string;
  leverage?: number;
  thresholdPct?: number;
  maxPositions?: number;
}

export interface Position {
  symbol: string;
  direction: string;
  entry_price?: number;
  quantity?: number;
  leverage?: number;
  stop_loss?: number;
  entry_type?: string;
  entry_reasoning?: string;
}

export interface TradeRecord {
  symbol: string;
  direction: string;
  entry_price?: number;
  exit_price?: number;
  quantity?: number;
  leverage?: number;
  pnl_pct?: number;
  pnl_amount?: number;
  reason?: string;
  opened_at?: string;
  closed_at?: string;
  agent_type?: string;
}

export interface AgentData extends AgentMeta {
  capital?: number; initial_capital?: number; pnl?: number; pnl_pct?: number;
  trades?: number; wins?: number; win_rate?: number;
  running?: boolean; is_circuit_break?: boolean; consecutive_losses?: number;
  positions?: Position[];
  pending_orders?: unknown[];
  trades_history?: TradeRecord[];
}

export interface Personality {
  risk: number; patience: number; panic: number; greed: number;
}

export interface CharState {
  agentId: string;
  x: number; z: number;
  pathQueue: { x: number; z: number }[];
  pathIndex: number;
  isWalking: boolean;
  destNode: string | null;
  activity: 'idle' | 'rest' | 'massage' | 'dine' | 'poker' | null;
  activityUntil: number;
  /** 活动开始时间 — 用于上菜/按摩等服务动画 */
  activityStartedAt?: number;
  /** 正在走向休闲目的地，到达后触发 activity */
  travelIntent?: 'rest' | 'massage' | 'dine' | 'poker' | null;
  state: 'idle' | 'scanning' | 'trading' | 'panic';
  stress: number;
  moveTimer: number;
  nextMoveTime: number;
  /** 朝向 — 决定正/背面渲染 */
  facing: 'n' | 's' | 'e' | 'w';
  /** 当前活动姿势 */
  activityPose?: 'stand' | 'sit' | 'lie' | 'desk';
  /** 跨区过场中 — 不渲染空白地图行走 */
  inTransit?: boolean;
  transitUntil?: number;
  transitZone?: 'hall' | 'reception' | 'spa' | 'restaurant' | 'casino';
  /** 用户主动派遣的活动才发放积分奖励 */
  userDispatched?: boolean;
  /** 休闲服务分档 a/b/c */
  leisureTier?: 'a' | 'b' | 'c';
  data: AgentData;
}

export type CameraMode = 'ortho' | 'perspective';
export type QualityTier = 'low' | 'medium' | 'high';

export function p2(x: number, y: number) { return { x: x * S, z: y * S }; }
