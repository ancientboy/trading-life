import type { AgentMeta } from './constants';
import { normalizeAgentMeta, HAT_STYLE_IDS } from './agentAppearance';
import type { AgentHeadwear, HatStyleId } from './agentAppearance';

/** 自定义 Agent 可分配的额外工位（第二排 6/7/8） */
export const EXTRA_DESK_NODES = ['seat_6', 'seat_7', 'seat_8'] as const;
const LEISURE_POOL = {
  booth: ['rest_l_1', 'rest_l_2'],
  massage: ['bed_1', 'bed_2', 'bed_3', 'bed_4', 'bed_5', 'bed_6'],
  dine: ['dine_1', 'dine_2', 'dine_3', 'dine_4', 'dine_5', 'dine_6'],
  poker: ['poker_s1', 'poker_s2', 'poker_s3', 'poker_s4', 'poker_s5', 'poker_s6', 'poker_s7', 'poker_s8'],
};

const CUSTOM_KEY = 'trading-life-custom-agents';

export interface CustomAgentDraft {
  name: string;
  headwear: AgentHeadwear;
  hatStyle: HatStyleId;
  color: string;
  desc: string;
  strategy: string;
  market: string;
  interval: string;
  risk: string;
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

/** 注册自定义 Agent 到寻路图（工位 + 休闲位） */
export function registerCustomAgentSlots(
  OfficePath: {
    deskByAgent: Record<string, string>;
    boothByAgent: Record<string, string>;
    massageByAgent: Record<string, string>;
    dineByAgent: Record<string, string>;
    pokerByAgent: Record<string, string>;
  },
  agentId: string,
  index: number,
): string | null {
  const deskNode = EXTRA_DESK_NODES.find(n => !Object.values(OfficePath.deskByAgent).includes(n));
  if (!deskNode) return null;

  const i = index % 3;
  OfficePath.deskByAgent[agentId] = deskNode;
  OfficePath.boothByAgent[agentId] = LEISURE_POOL.booth[i];
  OfficePath.massageByAgent[agentId] = LEISURE_POOL.massage[i % LEISURE_POOL.massage.length];
  OfficePath.dineByAgent[agentId] = LEISURE_POOL.dine[i % LEISURE_POOL.dine.length];
  OfficePath.pokerByAgent[agentId] = LEISURE_POOL.poker[i];
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
