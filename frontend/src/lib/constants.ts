export const S = 0.01;
export const WORLD = { W: 56, H: 30, MID_X: 28, MID_Y: 15 };

export interface AgentMeta {
  id: string; name: string; icon: string; color: string;
  desc: string; strategy: string; market: string; interval: string; risk: string;
  /** 头饰 — 创建时可自定义 */
  hat?: HatStyle;
}

/** 俯视剪纸风头饰 */
export type HatStyle = 'none' | 'headband' | 'cap' | 'beanie' | 'tophat';

export const AGENT_META: Record<string, AgentMeta> = {
  xau: { id: 'xau', name: 'XAU Agent', icon: '🥇', color: '#FFD700', hat: 'beanie', desc: '黄金趋势交易', strategy: '趋势跟踪', market: 'XAUUSDT', interval: '15m/1h', risk: '中' },
  major: { id: 'major', name: 'Major Agent', icon: '₿', color: '#3B82F6', hat: 'cap', desc: '主流币趋势', strategy: '趋势+反转', market: 'BTC/ETH', interval: '1h/4h', risk: '中' },
  altcoin: { id: 'altcoin', name: 'Altcoin Agent', icon: '🪙', color: '#F59E0B', hat: 'headband', desc: '山寨波段', strategy: '波段动量', market: 'Alt', interval: '15m/1h', risk: '中高' },
  newcoin: { id: 'newcoin', name: 'Newcoin Agent', icon: '🚀', color: '#A855F7', hat: 'beanie', desc: '新币猎手', strategy: '趋势突破', market: '新币', interval: '5m/15m', risk: '高' },
  momentum: { id: 'momentum', name: 'Momentum Agent', icon: '⚡', color: '#EF4444', hat: 'tophat', desc: '动量快打', strategy: '动量追踪', market: '高波动', interval: '5m/15m', risk: '高' },
};

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
  /** 正在走向休闲目的地，到达后触发 activity */
  travelIntent?: 'rest' | 'massage' | 'dine' | 'poker' | null;
  state: 'idle' | 'scanning' | 'trading' | 'panic';
  stress: number;
  moveTimer: number;
  nextMoveTime: number;
  /** 朝向 — 决定正/背面渲染 */
  facing: 'n' | 's' | 'e' | 'w';
  /** 跨区过场中 — 不渲染空白地图行走 */
  inTransit?: boolean;
  transitUntil?: number;
  transitZone?: 'hall' | 'reception' | 'spa' | 'restaurant' | 'casino';
  data: AgentData;
}

export type CameraMode = 'ortho' | 'perspective';
export type QualityTier = 'low' | 'medium' | 'high';

export function p2(x: number, y: number) { return { x: x * S, z: y * S }; }
