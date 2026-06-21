import type { ZoneId } from '../store/useGameStore';

/** 休闲/派遣活动 → 目标分区（单一事实来源） */
export const ACTIVITY_ZONE_MAP: Record<string, ZoneId> = {
  dine: 'restaurant',
  massage: 'spa',
  poker: 'casino',
  rest: 'hall',
};

export function zoneForActivity(activity: string | null | undefined): ZoneId | null {
  if (!activity) return null;
  return ACTIVITY_ZONE_MAP[activity] ?? null;
}
