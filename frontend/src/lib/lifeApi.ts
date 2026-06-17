import { getLifeUserId } from './lifeUser';
import type { AgentMeta } from './constants';
import type { CustomAgentDraft } from './customAgents';

const API = '/trading/api/life';

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Life-User-Id': getLifeUserId(),
  };
}

export interface LifeState {
  points: number;
  last_idle_tick: number;
  daily_date: string;
  daily_tasks: Record<string, { progress: number; claimed: boolean }>;
  daily_task_defs: { id: string; label: string; target: number; reward: number; kind: string; activity?: string }[];
  shop_unlocks: string[];
  shop_catalog: { id: string; type: string; value: string; cost: number; label: string }[];
  custom_agents: Record<string, AgentMeta>;
  activity_rewards: Record<string, number>;
  facility_costs: Record<string, number>;
  limits: { max_entertainment: number; max_trading_custom: number };
  stats: Record<string, unknown>;
}

async function parse<T>(r: Response): Promise<T> {
  return r.json() as Promise<T>;
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

export async function lifeIdleTick(agentCount: number, elapsedMs: number) {
  const r = await fetch(`${API}/points/idle`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_count: agentCount, elapsed_ms: elapsedMs }),
  });
  return parse<{ ok: boolean; balance: number; earned: number }>(r);
}

export async function lifeActivityComplete(activity: string) {
  const r = await fetch(`${API}/activity/complete`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ activity }),
  });
  return parse<{ ok: boolean; balance: number; earned: number }>(r);
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
  return parse<{ ok: boolean; balance: number; item?: LifeState['shop_catalog'][0]; error?: string }>(r);
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
