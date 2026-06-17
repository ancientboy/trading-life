import type { AgentMeta } from './constants';
import { normalizeAgentMeta, HAT_STYLE_IDS } from './agentAppearance';
import type { AgentHeadwear, HatStyleId } from './agentAppearance';

/** 自定义 Agent 可分配的额外工位（第二排 6/7/8） */
export const EXTRA_DESK_NODES = ['seat_6', 'seat_7', 'seat_8'] as const;

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

/** 注册自定义 Agent 到寻路图（仅分配工位，休闲座位由 assignAgentSeatSlots 统一分配） */
export function registerCustomAgentSlots(
  OfficePath: {
    deskByAgent: Record<string, string>;
    boothByAgent: Record<string, string>;
    massageByAgent: Record<string, string>;
    dineByAgent: Record<string, string>;
    pokerByAgent: Record<string, string>;
  },
  agentId: string,
  _index: number,
): string | null {
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
