/** 用户积分 — localStorage 持久化，用于休闲活动消费与挂机奖励 */

const STORAGE_KEY = 'trading-life-points';
const LAST_IDLE_KEY = 'trading-life-points-idle';

export const STARTING_POINTS = 10000;

/** 完成活动奖励 */
export const ACTIVITY_REWARDS: Record<'rest' | 'dine' | 'massage' | 'poker', number> = {
  rest: 10,
  dine: 15,
  massage: 25,
  poker: 20,
};

/** 挂机：每分钟每个在场 Agent 贡献的积分（上限见 tickIdlePoints） */
export const IDLE_POINTS_PER_AGENT_PER_MIN = 3;
export const IDLE_MAX_AGENTS_COUNTED = 5;
export const IDLE_TICK_MS = 60_000;

export function loadPoints(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return STARTING_POINTS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : STARTING_POINTS;
  } catch {
    return STARTING_POINTS;
  }
}

export function savePoints(points: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.max(0, Math.round(points))));
  } catch { /* ignore */ }
}

export function loadLastIdleTick(): number {
  try {
    const raw = localStorage.getItem(LAST_IDLE_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function saveLastIdleTick(ts: number) {
  try {
    localStorage.setItem(LAST_IDLE_KEY, String(ts));
  } catch { /* ignore */ }
}

export function calcIdleEarn(agentCount: number, elapsedMs: number): number {
  if (elapsedMs < IDLE_TICK_MS || agentCount <= 0) return 0;
  const minutes = Math.floor(elapsedMs / IDLE_TICK_MS);
  const agents = Math.min(agentCount, IDLE_MAX_AGENTS_COUNTED);
  return minutes * agents * IDLE_POINTS_PER_AGENT_PER_MIN;
}
