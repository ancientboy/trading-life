import type { AgentMeta, AgentType } from './constants';
import { normalizeAgentMeta, HAT_STYLE_IDS } from './agentAppearance';
import type { AgentHeadwear, HatStyleId } from './agentAppearance';
import { HALL_REST_BOOTHS } from './zoneFurniture';

/** 自定义 Agent 可分配的额外工位（第二排 6/7/8） */
export const EXTRA_DESK_NODES = ['seat_6', 'seat_7', 'seat_8'] as const;

const CUSTOM_KEY = 'trading-life-custom-agents';

export interface CustomAgentDraft {
  agentType: AgentType;
  name: string;
  headwear: AgentHeadwear;
  hatStyle: HatStyleId;
  color: string;
  desc: string;
  /** 娱乐 Agent 必填 */
  soul: string;
  strategy: string;
  market: string;
  interval: string;
  risk: string;
}

/** 娱乐 Agent 出生点 — 休息沙发，不占交易工位 */
export const ENTERTAINMENT_SPAWN_SEAT = 'rest_l_1_s1';

export const MAX_ENTERTAINMENT_AGENTS = 1;
export const MAX_TRADING_CUSTOM_AGENTS = 3;

export const DEFAULT_ENTERTAINMENT_SOUL = (name: string) => `# ${name || '我的企鹅'} 的灵魂

你是 ${name || '一只可爱的企鹅'}，生活在「交易人生」的世界里。

## 性格
- 活泼好奇，喜欢在各个区域闲逛
- 享受餐厅、按摩、沙发和德州扑克
- 用轻松幽默的方式陪伴用户

## 行为准则
- 不执行真实交易，专注休闲与互动
- 遇到用户时主动打招呼、分享见闻
- 保持积极心态，帮助缓解压力
`;

export const DEFAULT_TRADING_SOUL = (name: string) => `# ${name || '交易 Agent'} 的策略灵魂

你是 ${name || '一名交易员'}，专注加密货币市场。

## 交易原则
- 严格风控，单笔亏损不超过资金的 2%
- 顺势而为，不逆势加仓
- 信号不清晰时保持观望

## 性格
- 冷静理性，不受情绪左右
- 善于复盘，持续优化策略
`;

export function countCustomByType(meta: Record<string, import('./constants').AgentMeta>) {
  const ents = Object.values(meta).filter(a => a.agentType === 'entertainment').length;
  const trading = Object.values(meta).filter(a => a.agentType !== 'entertainment').length;
  return { entertainment: ents, trading };
}

export function canCreateAgentType(type: import('./constants').AgentType, meta: Record<string, import('./constants').AgentMeta>) {
  const c = countCustomByType(meta);
  if (type === 'entertainment') return c.entertainment < MAX_ENTERTAINMENT_AGENTS;
  return c.trading < MAX_TRADING_CUSTOM_AGENTS;
}

export function createLimitMessage(type: import('./constants').AgentType) {
  return type === 'entertainment'
    ? '娱乐 Agent 已达上限（最多 1 个）'
    : '交易 Agent 已达上限（最多 3 个）';
}

export function updateCustomAgentMeta(agentId: string, patch: Partial<import('./constants').AgentMeta>) {
  const all = loadCustomAgentMeta();
  if (!all[agentId]) return false;
  all[agentId] = { ...all[agentId], ...patch };
  saveCustomAgentMeta(all);
  return true;
}

export function loadCustomAgentMeta(): Record<string, AgentMeta> {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AgentMeta>;
    const out: Record<string, AgentMeta> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = normalizeAgentMeta(v);
    return out;
  } catch {
    return {};
  }
}

export function saveCustomAgentMeta(all: Record<string, AgentMeta>) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(all));
}

/** 注册自定义 Agent 槽位 — 娱乐不占工位，交易占 seat_6/7/8 */
export function registerCustomAgentSlots(
  OfficePath: {
    deskByAgent: Record<string, string>;
    boothByAgent: Record<string, string>;
    massageByAgent: Record<string, string>;
    dineByAgent: Record<string, string>;
    pokerByAgent: Record<string, string>;
  },
  agentId: string,
  agentType: import('./constants').AgentType,
): string | null {
  if (agentType === 'entertainment') {
    const booth = HALL_REST_BOOTHS[0];
    const seat = booth.seats[0];
    OfficePath.boothByAgent[agentId] = seat.id;
    return seat.id;
  }
  const deskNode = EXTRA_DESK_NODES.find(n => !Object.values(OfficePath.deskByAgent).includes(n));
  if (!deskNode) return null;
  OfficePath.deskByAgent[agentId] = deskNode;
  return deskNode;
}

export function nextCustomAgentId(existing: Record<string, unknown>): string {
  let n = 1;
  while (existing[`custom_${n}`]) n++;
  return `custom_${n}`;
}

export const APPEARANCE_PRESETS = {
  hatStyles: HAT_STYLE_IDS,
  colors: ['#FFD700', '#3B82F6', '#F59E0B', '#A855F7', '#EF4444', '#10B981', '#EC4899', '#06B6D4', '#6366F1', '#E67E22'],
};
