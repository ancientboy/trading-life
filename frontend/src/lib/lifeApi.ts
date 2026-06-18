import { getAuthToken } from './lifeAuth';
import type { AgentMeta } from './constants';
import type { CustomAgentDraft } from './customAgents';

const API = '/trading/api/life';

function headers(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export interface LifeState {
  points: number;
  last_idle_tick: number;
  daily_date: string;
  daily_tasks: Record<string, { progress: number; claimed: boolean }>;
  daily_task_defs: { id: string; label: string; target: number; reward: number; kind: string; activity?: string; icon?: string }[];
  shop_unlocks: string[];
  shop_catalog: { id: string; type: string; value: string; cost: number; label: string; legacy?: boolean }[];
  custom_agents: Record<string, AgentMeta>;
  activity_rewards: Record<string, number>;
  facility_costs: Record<string, number>;
  leisure_tier_costs?: Record<string, Record<string, number>>;
  daily_allowance?: { amount: number; claimed_today: boolean };
  limits: { max_entertainment: number; max_trading_custom: number };
  permissions?: {
    is_admin: boolean;
    operable_agent_ids: string[];
    system_agent_ids: string[];
  };
  stats: Record<string, unknown>;
  zone_skins?: Record<string, string>;
  zone_skin_catalog?: Record<string, { id: string; label: string; free?: boolean; shop_ids?: string[] }[]>;
}

async function parse<T>(r: Response): Promise<T> {
  return r.json() as Promise<T>;
}

function extractApiError(data: Record<string, unknown>, fallback: string): string {
  const detail = data.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: string }).msg) : ''))
      .filter(Boolean);
    if (msgs.length) return msgs.join('；');
  }
  if (typeof data.error === 'string') return data.error;
  return fallback;
}

async function parseAuth<T extends { ok?: boolean; error?: string }>(r: Response): Promise<T> {
  const data = await r.json() as T & { detail?: unknown; error?: string };
  if (!r.ok) {
    return {
      ...data,
      ok: false,
      error: extractApiError(data as Record<string, unknown>, r.status === 401 ? '请先登录' : '请求失败'),
    };
  }
  return data;
}

export async function fetchLifeState(): Promise<LifeState & { ok?: boolean }> {
  const r = await fetch(`${API}/state`, { headers: headers() });
  return parse(r);
}

export async function migrateLifeState(payload: {
  points?: number;
  last_idle_tick?: number;
  custom_agents?: Record<string, AgentMeta>;
  shop_unlocks?: string[];
}) {
  const r = await fetch(`${API}/migrate`, {
    method: 'POST', headers: headers(), body: JSON.stringify(payload),
  });
  return parse<{ ok: boolean; points: number } & LifeState>(r);
}

export async function lifeSpend(amount: number, reason = '') {
  const r = await fetch(`${API}/points/spend`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ amount, reason }),
  });
  return parse<{ ok: boolean; balance: number; error?: string }>(r);
}

export async function lifeEarn(amount: number, reason = '') {
  const r = await fetch(`${API}/points/earn`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ amount, reason }),
  });
  return parse<{ ok: boolean; balance: number; earned: number }>(r);
}

export async function claimDailyAllowance() {
  const r = await fetch(`${API}/points/daily-claim`, { method: 'POST', headers: headers() });
  return parse<{ ok: boolean; balance: number; amount: number; error?: string }>(r);
}

export async function lifeIdleTick(agentCount: number) {
  const r = await fetch(`${API}/points/idle`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_count: agentCount, elapsed_ms: 0 }),
  });
  return parse<{ ok: boolean; balance: number; earned: number; daily_cap?: boolean }>(r);
}

export async function lifeSessionStart() {
  const r = await fetch(`${API}/session/start`, { method: 'POST', headers: headers() });
  return parse<{ ok: boolean; balance: number }>(r);
}

export async function lifeActivityComplete(activity: string, userInitiated = false) {
  const r = await fetch(`${API}/activity/complete`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ activity, user_initiated: userInitiated }),
  });
  return parse<{ ok: boolean; balance: number; earned: number }>(r);
}

export async function authRegister(username: string, password: string, displayName = '') {
  const r = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, display_name: displayName }),
  });
  return parseAuth<{
    ok: boolean; token?: string;
    account?: { id: string; username: string; display_name: string };
    state?: LifeState; error?: string;
  }>(r);
}

export async function authLogin(username: string, password: string) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return parseAuth<{
    ok: boolean; token?: string;
    account?: { id: string; username: string; display_name: string };
    state?: LifeState; error?: string;
  }>(r);
}

export async function authLogout() {
  const r = await fetch(`${API}/auth/logout`, { method: 'POST', headers: headers() });
  return parse<{ ok: boolean }>(r);
}

export async function authMe() {
  const r = await fetch(`${API}/auth/me`, { headers: headers() });
  return parse<{
    ok: boolean;
    account?: { id: string; username: string; display_name: string };
    state?: LifeState;
  }>(r);
}

export async function lifeDispatch(action: string, cost?: number) {
  const r = await fetch(`${API}/dispatch`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ action, cost }),
  });
  return parse<{ ok: boolean; balance: number; cost?: number; error?: string }>(r);
}

export async function lifeClaimTask(taskId: string) {
  const r = await fetch(`${API}/tasks/claim`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ task_id: taskId }),
  });
  return parse<{ ok: boolean; balance: number; reward?: number; error?: string }>(r);
}

export async function lifeShopBuy(itemId: string) {
  const r = await fetch(`${API}/shop/buy`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ item_id: itemId }),
  });
  return parse<{ ok: boolean; balance: number; item?: LifeState['shop_catalog'][0]; error?: string; state?: LifeState }>(r);
}

export async function lifeSetZoneSkin(zone: string, skinId: string) {
  const r = await fetch(`${API}/zone-skins`, {
    method: 'PUT', headers: headers(), body: JSON.stringify({ zone, skinId }),
  });
  return parse<{ ok: boolean; zone_skins?: Record<string, string>; state?: LifeState; error?: string }>(r);
}

export async function lifeCreateAgent(draft: CustomAgentDraft) {
  const r = await fetch(`${API}/agents`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      agentType: draft.agentType,
      name: draft.name,
      headwear: draft.headwear,
      hatStyle: draft.hatStyle,
      color: draft.color,
      desc: draft.desc,
      soul: draft.soul,
      strategy: draft.strategy,
      market: draft.market,
      interval: draft.interval,
      risk: draft.risk,
    }),
  });
  return parse<{ ok: boolean; agent?: AgentMeta; state?: LifeState; error?: string }>(r);
}

export async function lifeSaveAgentSoul(agentId: string, content: string) {
  const r = await fetch(`${API}/agents/${agentId}/soul`, {
    method: 'PUT', headers: headers(), body: JSON.stringify({ content }),
  });
  return parse<{ ok: boolean; message?: string }>(r);
}

export async function lifeSaveAgentAppearance(
  agentId: string,
  appearance: { headwear: string; hatStyle: string; color: string },
) {
  const r = await fetch(`${API}/agents/${agentId}/appearance`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(appearance),
  });
  return parse<{ ok: boolean; message?: string; agent?: AgentMeta; error?: string }>(r);
}

export async function lifeAgentSpeak(opts: {
  agent_id: string;
  agent_name: string;
  soul_md: string;
  context?: string;
  activity?: string | null;
}) {
  const r = await fetch(`${API}/agent-speak`, {
    method: 'POST', headers: headers(), body: JSON.stringify(opts),
  });
  return parse<{ ok: boolean; line: string }>(r);
}

export interface SeatOccupant {
  user_id: string;
  agent_id: string;
  activity: string;
  until_ts: number;
}

export async function fetchSeats() {
  const r = await fetch(`${API}/seats`, { headers: headers() });
  return parse<{ ok: boolean; seats: Record<string, SeatOccupant> }>(r);
}

export async function claimSeat(seatId: string, agentId: string, activity: string, untilTs: number) {
  const r = await fetch(`${API}/seats/claim`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ seat_id: seatId, agent_id: agentId, activity, until_ts: untilTs }),
  });
  return parse<{ ok: boolean; seat_id?: string; error?: string; occupied_by?: string }>(r);
}

export async function releaseSeat(seatId: string, agentId: string) {
  const r = await fetch(`${API}/seats/release`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ seat_id: seatId, agent_id: agentId }),
  });
  return parse<{ ok: boolean; error?: string }>(r);
}
