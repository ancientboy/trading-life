import type { ZoneId } from '../store/useGameStore';

export type MessageScope = ZoneId | 'global';

export type ScopedMessage = { text: string; time: string; scope?: MessageScope };

const ARENA_HINTS = ['猜涨跌', 'PK', '大赛', '竞技', '封盘', '押涨', '押跌', '选手', '报名', '1v1', '杠杆', '逆袭', '阵营', '入座选手台'];
const CASINO_HINTS = ['德州', '扑克', '荷官', '牌局', '发牌', '买入', '锦标赛'];
const SPA_HINTS = ['按摩', '理疗', '技师', '禅意'];
const RESTAURANT_HINTS = ['用餐', '餐厅', '点餐', '粤菜', 'Lily', '服务员'];
const RECEPTION_HINTS = ['接待', '迎宾', '前厅', 'Gugu'];
const HALL_HINTS = ['休息沙发', '休息包厢', '工位', '交易大厅', '已派遣至', '占座', '结束休息', '返回工位', '返回休息区', '模拟盯盘', '入驻工位', '在大厅'];

/** 从文案推断消息所属区域；无法识别则视为全局 */
export function inferMessageScope(text: string): MessageScope {
  if (ARENA_HINTS.some(k => text.includes(k))) return 'arena';
  if (CASINO_HINTS.some(k => text.includes(k))) return 'casino';
  if (SPA_HINTS.some(k => text.includes(k))) return 'spa';
  if (RESTAURANT_HINTS.some(k => text.includes(k))) return 'restaurant';
  if (RECEPTION_HINTS.some(k => text.includes(k))) return 'reception';
  if (HALL_HINTS.some(k => text.includes(k))) return 'hall';
  return 'global';
}

/** 当前页面是否应展示该消息（严格：仅本区 + 全局） */
export function messageVisibleInZone(scope: MessageScope, activeZone: ZoneId): boolean {
  if (scope === 'global') return true;
  return scope === activeZone;
}

export function resolveMessageScope(msg: ScopedMessage): MessageScope {
  return msg.scope ?? inferMessageScope(msg.text);
}

export function filterMessagesForZone(messages: ScopedMessage[], activeZone: ZoneId): ScopedMessage[] {
  return messages.filter(m => messageVisibleInZone(resolveMessageScope(m), activeZone));
}

/** 非大厅时暂停 Agent 自主跨区休闲（用户正在专注某一区域） */
export function pauseBackgroundAgentAi(activeZone: ZoneId): boolean {
  return activeZone !== 'hall';
}
