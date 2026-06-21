import type { RightTab, ZoneId } from '../store/useGameStore';

export const RIGHT_TAB_LABELS: Record<RightTab, string> = {
  hall: '交易大厅',
  object: '选中对象',
  agent: '交易 Agent',
  npc: '接待 NPC',
  facility: '休闲设施',
  assets: '资产持仓',
  strategy: '策略预览',
  messages: '交易日志',
  tasks: '每日任务',
  social: '社交大厅',
  events: '交易竞技',
};

const HALL_TABS: RightTab[] = ['hall', 'agent', 'assets', 'strategy', 'tasks', 'messages'];
const ARENA_TABS: RightTab[] = ['events'];
const LEISURE_TABS: RightTab[] = ['facility', 'agent'];

/** 按当前区域与侧栏上下文，决定右栏可见 Tab */
export function getRightTabsForContext(activeZone: ZoneId, sidebarActive: string): RightTab[] {
  if (activeZone === 'arena' || sidebarActive === 'events') return ARENA_TABS;
  if (activeZone === 'restaurant' || activeZone === 'spa' || activeZone === 'casino') return LEISURE_TABS;
  if (sidebarActive === 'social') return ['social', 'hall', 'agent'];
  if (sidebarActive === 'positions' || sidebarActive === 'warehouse') {
    return ['assets', 'hall', 'agent', 'strategy', 'messages'];
  }
  if (sidebarActive === 'logs') return ['messages', 'hall', 'agent', 'assets'];
  if (sidebarActive === 'tasks') return ['tasks', 'hall', 'agent'];
  if (sidebarActive === 'strategy') return ['strategy', 'agent', 'hall', 'assets'];
  if (sidebarActive === 'agents') return ['agent', 'hall', 'strategy', 'assets'];
  return HALL_TABS;
}
