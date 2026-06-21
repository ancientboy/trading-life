import type { ZoneId } from '../store/useGameStore';

export type MessageScope = ZoneId | 'global';

const ARENA_HINTS = ['猜涨跌', 'PK', '大赛', '竞技', '封盘', '押涨', '押跌', '选手', '报名', '1v1', '杠杆', '逆袭', '阵营'];
const HALL_HINTS = ['休息沙发', '休息包厢', '工位', '交易大厅', '已派遣至', '占座'];
const SPA_HINTS = ['按摩', '理疗', '技师'];
const RESTAURANT_HINTS = ['用餐', '餐厅', '点餐', '粤菜'];
const CASINO_HINTS = ['德州', '扑克', '荷官', '牌局', '发牌'];

/** 从文案推断消息所属区域；无法识别则视为全局 */
export function inferMessageScope(text: string): MessageScope {
  if (ARENA_HINTS.some(k => text.includes(k))) return 'arena';
  if (SPA_HINTS.some(k => text.includes(k))) return 'spa';
  if (RESTAURANT_HINTS.some(k => text.includes(k))) return 'restaurant';
  if (CASINO_HINTS.some(k => text.includes(k))) return 'casino';
  if (HALL_HINTS.some(k => text.includes(k))) return 'hall';
  return 'global';
}

/** 当前页面是否应展示该消息 */
export function messageVisibleInZone(scope: MessageScope, activeZone: ZoneId): boolean {
  if (scope === 'global') return true;
  if (scope === activeZone) return true;
  if (activeZone === 'arena') return false;
  if (activeZone === 'hall' && scope === 'reception') return true;
  return false;
}
