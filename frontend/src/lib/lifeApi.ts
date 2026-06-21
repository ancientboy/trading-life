import { getAuthToken } from './lifeAuth';
import type { AgentMeta, TradeRecord } from './constants';
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

export async function lifeIdleTick(agentCount?: number) {
  const r = await fetch(`${API}/points/idle`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_count: agentCount ?? 0, elapsed_ms: 0 }),
  });
  return parse<{ ok: boolean; balance: number; earned: number; daily_cap?: boolean; agent_count?: number; owned_agent_count?: number }>(r);
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

export async function authRegister(username: string, password: string, displayName = '', inviteCode = '') {
  const r = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, display_name: displayName, invite_code: inviteCode }),
  });
  return parseAuth<{
    ok: boolean; token?: string;
    account?: { id: string; username: string; display_name: string };
    state?: LifeState; error?: string; invite_message?: string;
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
  const data = await r.json() as {
    ok: boolean; balance: number; item?: LifeState['shop_catalog'][0];
    error?: string; already_owned?: boolean; state?: LifeState; detail?: unknown;
  };
  if (!r.ok) {
    return { ok: false, balance: data.balance ?? 0, error: extractApiError(data as Record<string, unknown>, '购买失败') };
  }
  return data;
}

export async function lifeSetZoneSkin(zone: string, skinId: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${API}/zone-skins`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ zone, skinId }), signal: ctrl.signal,
    });
    clearTimeout(timer);
    return parse<{ ok: boolean; zone_skins?: Record<string, string>; state?: LifeState; error?: string }>(r);
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    if (err.name === 'AbortError') return { ok: false, error: '切换皮肤超时，请重试' };
    return { ok: false, error: '网络错误' };
  }
}

export async function lifeQuickCreateAgent(
  name = '小企鹅',
  agentType: 'entertainment' | 'trading' = 'entertainment',
) {
  const r = await fetch(`${API}/agents/quick-create`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ name, agentType }),
  });
  return parse<{ ok: boolean; agent?: AgentMeta; state?: LifeState; error?: string; quick?: boolean }>(r);
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
      strategyPreset: draft.strategyPreset || (draft.agentType === 'trading' ? 'major' : ''),
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
  appearance: {
    speciesId?: string;
    outfitId?: string;
    hairStyle?: string;
    scarfEnabled?: boolean;
    hatEnabled?: boolean;
    headwear: string;
    hatStyle: string;
    color: string;
  },
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

export interface PortfolioAgentView {
  id: string;
  name: string;
  strategy_preset: string;
  strategy: string;
  market: string;
  interval: string;
  risk: string;
  leverage?: number;
  threshold_pct?: number;
  soul_bias_tags?: string[];
  max_positions?: number;
  strategy_snapshot?: { applied_at?: string; pnl?: number; trades?: number; wins?: number; capital?: number };
  capital: number;
  initial_capital: number;
  pnl: number;
  pnl_pct: number;
  trades: number;
  wins: number;
  win_rate: number;
  positions: import('./constants').Position[];
  trades_history: import('./constants').TradeRecord[];
  running: boolean;
  is_circuit_break: boolean;
  owner: string;
}

export interface UserPortfolio {
  ok: boolean;
  cash: number;
  initial_balance: number;
  total_capital: number;
  total_pnl: number;
  total_pnl_pct: number;
  total_trades: number;
  total_wins: number;
  total_wr: number;
  agents: PortfolioAgentView[];
  strategy_presets?: { id: string; label: string; strategy: string; market: string; interval: string; risk: string }[];
  source?: string;
  system_agents_note?: string;
  first_trading_win?: boolean;
  first_trade_hook?: boolean;
  latest_win?: TradeRecord & { agent_id?: string; agent_name?: string };
  trading_banter?: string | null;
  agent_duels?: AgentDuel[];
  error?: string;
}

export type AgentDuel = {
  symbol: string;
  agent_a_id: string;
  agent_a_name: string;
  agent_a_direction: string;
  agent_a_pnl: number;
  agent_b_id: string;
  agent_b_name: string;
  agent_b_direction: string;
  agent_b_pnl: number;
};

export type KlineCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export async function fetchMarketKlines(symbol = 'BTCUSDT', interval = '15m', limit = 80) {
  const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
  const r = await fetch(`${API}/portfolio/market/klines?${q}`, { headers: headers() });
  return parse<{ ok: boolean; symbol?: string; interval?: string; candles?: KlineCandle[]; error?: string }>(r);
}

export async function fetchPortfolio(): Promise<UserPortfolio> {
  const r = await fetch(`${API}/portfolio`, { headers: headers() });
  return parse(r);
}

export async function fetchPortfolioPresets() {
  const r = await fetch(`${API}/portfolio/presets`, { headers: headers() });
  return parse<{ ok: boolean; presets: { id: string; label: string; strategy: string; market: string; interval: string; risk: string }[] }>(r);
}

export async function resetPortfolio(): Promise<UserPortfolio> {
  const r = await fetch(`${API}/portfolio/reset`, { method: 'POST', headers: headers() });
  return parse(r);
}

export async function resetAgentPortfolio(agentId: string) {
  const r = await fetch(`${API}/portfolio/agents/${agentId}/reset`, { method: 'POST', headers: headers() });
  return parse<{ ok: boolean; message?: string; portfolio?: UserPortfolio; error?: string }>(r);
}

export async function updateAgentStrategy(agentId: string, body: {
  strategy_preset: string;
  strategy?: string;
  market?: string;
  interval?: string;
  risk?: string;
  leverage?: number;
  threshold_pct?: number;
  max_positions?: number;
  soul_md?: string;
}) {
  const r = await fetch(`${API}/portfolio/agents/${agentId}/strategy`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(body),
  });
  return parse<{ ok: boolean; agent?: AgentMeta; portfolio?: UserPortfolio; error?: string }>(r);
}

export interface ParsedStrategyConfig {
  strategy_preset: string;
  strategy?: string;
  market?: string;
  interval?: string;
  risk?: string;
  leverage?: number;
  threshold_pct?: number;
  max_positions?: number;
  soul_summary?: string;
}

export async function parseStrategyPreference(agentId: string, preferenceText: string) {
  const r = await fetch(`${API}/portfolio/agents/${agentId}/strategy/parse-preference`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ preference_text: preferenceText }),
  });
  return parse<{
    ok: boolean;
    config?: ParsedStrategyConfig;
    source?: string;
    message?: string;
    error?: string;
  }>(r);
}

export async function submitStrategyFeedback(agentId: string, feedbackText: string) {
  const r = await fetch(`${API}/portfolio/agents/${agentId}/strategy/feedback`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ feedback_text: feedbackText }),
  });
  return parse<{ ok: boolean; agent?: AgentMeta; portfolio?: UserPortfolio; message?: string; error?: string }>(r);
}

export async function lifeQuickCreateDual(name = '小企鹅') {
  const r = await fetch(`${API}/agents/quick-create-dual`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ name }),
  });
  return parse<{
    ok: boolean;
    entertainment?: AgentMeta;
    trading?: AgentMeta;
    trading_error?: string;
    state?: LifeState;
    error?: string;
  }>(r);
}
