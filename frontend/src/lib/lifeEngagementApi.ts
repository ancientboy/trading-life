import { getAuthToken } from './lifeAuth';

const API = '/trading/api/life';

function headers(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function parse<T>(r: Response): Promise<T> {
  const text = await r.text();
  try {
    const data = JSON.parse(text) as T & { detail?: unknown; ok?: boolean };
    if (!r.ok) {
      const detail = data.detail;
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map(d => (d as { msg?: string }).msg).filter(Boolean).join('；')
        : `请求失败 (${r.status})`;
      return { ...data, ok: false, error: msg } as T;
    }
    return data as T;
  } catch {
    return { ok: false, error: r.ok ? '响应解析失败' : `请求失败 (${r.status})` } as T;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    return parse<T>(r);
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    if (err.name === 'AbortError') return { ok: false, error: '同步超时，请重试', timedOut: true } as T;
    return { ok: false, error: '网络错误，请检查连接后重试' } as T;
  }
}

// ─── Phase 1 Social ───
export async function fetchChat(channel: string, since = 0) {
  const r = await fetch(`${API}/social/chat/${encodeURIComponent(channel)}?since=${since}`, { headers: headers() });
  return parse<{ ok: boolean; messages: ChatMessage[] }>(r);
}

export async function postChat(channel: string, body: string, agentId = '') {
  const r = await fetch(`${API}/social/chat`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ channel, body, agent_id: agentId }),
  });
  return parse<{
    ok: boolean; id?: number; created_at?: number;
    agent_replies?: Array<{ id: number; body: string; agent_id: string; kind: string; created_at: number }>;
  }>(r);
}

export async function syncMood(agents: { agent_id: string; stress: number; mood_tag?: string; zone?: string; channel?: string }[]) {
  const r = await fetch(`${API}/social/mood/sync`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agents }),
  });
  return parse<{ ok: boolean }>(r);
}

export async function fetchMoodZone(zone: string) {
  const r = await fetch(`${API}/social/mood/zone/${zone}`, { headers: headers() });
  return parse<{ ok: boolean; avg_stress: number; agents: unknown[] }>(r);
}

export async function fetchMentorPairs() {
  const r = await fetch(`${API}/social/mentor`, { headers: headers() });
  return parse<{ ok: boolean; pairs: { mentor_agent_id: string; mentee_agent_id: string }[] }>(r);
}

export async function pairMentor(mentorAgentId: string, menteeAgentId: string) {
  const r = await fetch(`${API}/social/mentor/pair`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ mentor_agent_id: mentorAgentId, mentee_agent_id: menteeAgentId }),
  });
  return parse<{ ok: boolean; error?: string }>(r);
}

export async function fetchNpcEvents() {
  const r = await fetch(`${API}/social/events`, { headers: headers() });
  return parse<{ ok: boolean; events: NpcEvent[] }>(r);
}

export async function claimNpcEvent(eventId: string) {
  const r = await fetch(`${API}/social/events/${eventId}/claim`, { method: 'POST', headers: headers() });
  return parse<{ ok: boolean; reward?: number; balance?: number; buff_type?: string; error?: string }>(r);
}

export async function tableSpeak(
  channel: string, agentId: string, agentName: string, soulMd: string,
  opts?: {
    context?: string; activity?: string | null; stress?: number; mood_tag?: string;
    decision_mode?: string; nearby_names?: string[]; target_agent_name?: string;
  },
) {
  const r = await fetch(`${API}/social/table-speak`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      channel, agent_id: agentId, agent_name: agentName, soul_md: soulMd,
      ...opts,
    }),
  });
  return parse<{ ok: boolean; line?: string; created_at?: number; message_id?: number }>(r);
}

export async function agentBrainSpeak(opts: {
  agent_id: string;
  agent_name: string;
  soul_md: string;
  channel?: string;
  context?: string;
  activity?: string | null;
  stress?: number;
  mood_tag?: string;
  decision_mode?: string;
  nearby_names?: string[];
  target_agent_name?: string;
  post_to_chat?: boolean;
  remember?: boolean;
}) {
  const r = await fetch(`${API}/social/agent-brain/speak`, {
    method: 'POST', headers: headers(), body: JSON.stringify(opts),
  });
  return parse<{
    ok: boolean; line?: string;
    chat?: { id: number; body: string; agent_id: string; created_at: number };
  }>(r);
}

export async function agentBrainDialogue(opts: {
  channel: string;
  agent_a_id: string; agent_a_name: string; agent_a_soul: string;
  agent_b_id: string; agent_b_name: string; agent_b_soul: string;
  rounds?: number;
}) {
  const r = await fetch(`${API}/social/agent-brain/dialogue`, {
    method: 'POST', headers: headers(), body: JSON.stringify(opts),
  });
  return parse<{
    ok: boolean; messages?: Array<{ id: number; body: string; agent_id: string; created_at: number }>;
    turns?: number; error?: string;
  }>(r);
}

export async function agentBrainTeaParty(opts: {
  channel: string; zone: string;
  agents: Array<{ agent_id: string; name: string; soul_md: string }>;
  topic?: string;
}) {
  const r = await fetch(`${API}/social/agent-brain/tea-party`, {
    method: 'POST', headers: headers(), body: JSON.stringify(opts),
  });
  return parse<{
    ok: boolean; messages?: Array<{ id: number; body: string; agent_id: string; created_at: number }>;
    topic?: string; error?: string;
  }>(r);
}

export async function fetchAgentMemories(agentId: string) {
  const r = await fetch(`${API}/social/agent-brain/memory/${encodeURIComponent(agentId)}`, { headers: headers() });
  return parse<{ ok: boolean; memories: Array<{ id: number; kind: string; summary: string; created_at: number }> }>(r);
}

export interface ChatMessage {
  id: number; channel: string; user_id: string; display_name: string;
  agent_id: string; body: string; kind: string; created_at: number;
}

export interface NpcEvent {
  id: string; zone: string; npc_id: string; title: string; body: string;
  buff_type: string; buff_value: number; reward_points: number; claimed?: boolean;
}

// ─── Phase 2 PvP ───
export async function listPokerRooms() {
  const r = await fetch(`${API}/pvp/poker/rooms`, { headers: headers() });
  return parse<{ ok: boolean; rooms: PokerRoom[] }>(r);
}

export async function createPokerRoom(buyIn = 30, agentId = '', gameMode: 'classic' | 'advanced' = 'classic') {
  const r = await fetch(`${API}/pvp/poker/rooms`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ buy_in: buyIn, agent_id: agentId, game_mode: gameMode }),
  });
  return parse<{
    ok: boolean; room_id?: string; room_code?: string; buy_in?: number; seat_id?: string;
    room?: PokerRoom; message?: string; error?: string;
  }>(r);
}

export async function fetchPokerRoom(roomId: string) {
  const r = await fetch(`${API}/pvp/poker/rooms/${encodeURIComponent(roomId)}`, { headers: headers() });
  return parse<{ ok: boolean; room?: PokerRoom; error?: string }>(r);
}

export async function fetchMyPokerRoom() {
  const r = await fetch(`${API}/pvp/poker/rooms/mine`, { headers: headers() });
  return parse<{ ok: boolean; room?: PokerRoom | null; error?: string }>(r);
}

export async function joinPokerRoom(roomId: string, agentId: string, seatId = '') {
  const r = await fetch(`${API}/pvp/poker/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_id: agentId, seat_id: seatId }),
  });
  return parse<{
    ok: boolean; error?: string; balance?: number; seat_id?: string; already_joined?: boolean;
    room_id?: string; room_code?: string; room?: PokerRoom; message?: string;
  }>(r);
}

export async function joinPokerRoomByCode(roomCode: string, agentId: string, seatId = '') {
  const r = await fetch(`${API}/pvp/poker/rooms/join-by-code`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ room_code: roomCode, agent_id: agentId, seat_id: seatId }),
  });
  return parse<{
    ok: boolean; error?: string; seat_id?: string;
    room_id?: string; room_code?: string; room?: PokerRoom; message?: string;
  }>(r);
}

export async function leavePokerRoom(roomId: string) {
  const r = await fetch(`${API}/pvp/poker/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: 'POST', headers: headers(),
  });
  return parse<{ ok: boolean; closed?: boolean; message?: string; error?: string }>(r);
}

export async function changePokerSeat(roomId: string, seatId: string) {
  const r = await fetch(`${API}/pvp/poker/rooms/${encodeURIComponent(roomId)}/seat`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ seat_id: seatId }),
  });
  return parse<{
    ok: boolean; error?: string; seat_id?: string; room?: PokerRoom; message?: string;
  }>(r);
}

export async function startPokerRoom(roomId: string) {
  const r = await fetch(`${API}/pvp/poker/rooms/${encodeURIComponent(roomId)}/start`, { method: 'POST', headers: headers() });
  return parse<{
    ok: boolean; mode?: string; balance?: number; won?: number; net?: number; cost?: number; pot?: number;
    room_id?: string;
    game?: AdvancedPokerGame;
    community_cards?: string[];
    tie?: boolean; winners_count?: number;
    results?: Array<{ user_id: string; name: string; score: number; rank: number; won: number; is_npc?: boolean }>;
    error?: string;
    highlight_broadcast?: { hand_name: string; won: number; pot: number } | null;
  }>(r);
}

export async function playPokerRound(roomId: string) {
  const r = await fetch(`${API}/pvp/poker/rooms/${roomId}/play`, { method: 'POST', headers: headers() });
  return parse<{
    ok: boolean;
    results?: Array<{ user_id: string; name: string; score: number; rank: number; won: number; is_npc?: boolean }>;
    winner?: unknown; pot?: number; won?: number; net?: number; cost?: number; balance?: number; error?: string;
  }>(r);
}

export type PokerApiPlayerResult = {
  user_id?: string;
  name: string;
  score: number;
  rank: number;
  won: number;
  is_npc?: boolean;
  hole_cards?: string[];
  best_cards?: string[];
  hand_name?: string;
  hand_combo?: string;
};

/** 单人练习：1 真人 + 3 NPC，立即开牌 */
export async function pokerSolo(agentId: string, buyIn = 30) {
  return fetchJson<{
    ok: boolean; mode?: string; room_id?: string; balance?: number; won?: number; pot?: number; net?: number;
    community_cards?: string[];
    results?: PokerApiPlayerResult[];
    error?: string; cost?: number;
    tie?: boolean; winners_count?: number;
    highlight_broadcast?: { hand_name: string; won: number; pot: number } | null;
    first_win?: boolean;
  }>(`${API}/pvp/poker/solo`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_id: agentId, buy_in: buyIn }),
  }, 45000);
}

/** 快速加入：有公开房则进房，满员自动开牌；无房则单人 vs NPC */
export async function pokerQuickJoin(agentId: string, buyIn = 30) {
  const r = await fetch(`${API}/pvp/poker/quick-join`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_id: agentId, buy_in: buyIn }),
  });
  return parse<{
    ok: boolean; mode?: string; room_id?: string; room_code?: string; balance?: number; won?: number; pot?: number;
    message?: string; players?: number; joined?: boolean; buy_in?: number; seat_id?: string; room?: PokerRoom;
    results?: Array<{ user_id: string; name: string; score: number; rank: number; won: number; is_npc?: boolean }>;
    error?: string; cost?: number;
  }>(r);
}

export async function listSeatAuctions() {
  const r = await fetch(`${API}/pvp/seats/auctions`, { headers: headers() });
  return parse<{ ok: boolean; auctions: SeatAuction[] }>(r);
}

export async function bidSeat(seatId: string, amount: number) {
  const r = await fetch(`${API}/pvp/seats/${seatId}/bid`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ amount }),
  });
  return parse<{ ok: boolean; bid?: number; balance?: number; error?: string }>(r);
}

export async function enqueueDispatch(agentId: string, action: string, nodeId = '', cost = 0) {
  const r = await fetch(`${API}/pvp/dispatch/enqueue`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ agent_id: agentId, action, node_id: nodeId, cost }),
  });
  return parse<{ ok: boolean; queue_id?: number }>(r);
}

export async function fetchDispatchQueue() {
  const r = await fetch(`${API}/pvp/dispatch/queue`, { headers: headers() });
  return parse<{ ok: boolean; queue: DispatchQueueItem[] }>(r);
}

export async function processDispatchQueue() {
  const r = await fetch(`${API}/pvp/dispatch/process`, { method: 'POST', headers: headers() });
  return parse<{ ok: boolean; processed: DispatchQueueItem[] }>(r);
}

export async function tradingPk(defenderId = '', stake = 50) {
  const r = await fetch(`${API}/pvp/trading-pk`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ defender_id: defenderId, stake }),
  });
  return parse<{ ok: boolean; winner_id?: string; won?: number; balance?: number; challenger_score?: number; defender_score?: number; error?: string }>(r);
}

export type GuessBetInfo = {
  direction: string; stake: number; payout?: number; won?: boolean; first_win?: boolean;
  pending_leverage?: { profit: number; source_round_id?: string; expires_at?: number };
};

export type PkResultInfo = {
  won: boolean;
  my_direction: 'up' | 'down';
  winner_side: string;
  opponent_name: string;
  stake: number;
  won_amount: number;
  streak?: number;
  round_id?: string;
};

export type GuessRoundState = {
  round_id: string;
  symbol: string;
  start_price: number;
  end_price?: number;
  status: string;
  pool_up: number;
  pool_down: number;
  total_pool: number;
  betting_open: boolean;
  seconds_left: number;
  my_bet?: GuessBetInfo | null;
  bets_count: number;
};

export type ArenaLeg = {
  leg: number; direction: string; return_pct: number;
  entry_price?: number; exit_price?: number; created_at?: number;
};

export type ArenaEntry = {
  user_id: string;
  agent_id: string;
  agent_name: string;
  display_name?: string;
  strategy_preset: string;
  is_npc?: number | boolean;
  direction: string;
  leverage: number;
  return_pct?: number;
  rank?: number;
  prize?: number;
  legs_count?: number;
  signal_summary?: string;
  recent_legs?: ArenaLeg[];
  all_legs?: ArenaLeg[];
};

export type ArenaRoundState = {
  round_id: string;
  symbol: string;
  status: string;
  duration_mode?: string;
  duration_label?: string;
  run_seconds?: number;
  leg_interval_sec?: number;
  entry_fee: number;
  prize_pool: number;
  spectate_pool: number;
  start_price: number;
  end_price?: number;
  seconds_left: number;
  join_seconds_left: number;
  entries: ArenaEntry[];
  my_entry?: ArenaEntry | null;
  my_spectator_bets?: Array<{ pick_user_id: string; pick_rank?: number; stake: number; payout?: number }>;
  can_join: boolean;
  can_spectate_bet: boolean;
  first_podium?: boolean;
};

export type ArenaWinRateEntry = {
  user_id: string;
  display_name: string;
  entries: number;
  wins: number;
  podium?: number;
  win_rate: number;
  best_return?: number;
  rank: number;
};

export type PublicArenaLive = {
  ok: boolean;
  current?: ArenaRoundState;
  highlights?: Array<Record<string, unknown>>;
  win_rate_board?: ArenaWinRateEntry[];
  message?: string;
  error?: string;
};

export async function fetchGuessRound() {
  const r = await fetch(`${API}/pvp/trading/guess`, { headers: headers() });
  return parse<{
    ok: boolean; current?: GuessRoundState;
    last_settled?: Record<string, unknown>;
    last_my_bet?: GuessBetInfo;
    last_pk_result?: PkResultInfo | null;
    error?: string;
  }>(r);
}

export async function placeGuessBet(direction: 'up' | 'down', stake: number) {
  const r = await fetch(`${API}/pvp/trading/guess/bet`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ direction, stake }),
  });
  return parse<{ ok: boolean; current?: GuessRoundState; balance?: number; error?: string }>(r);
}

export async function fetchArenaRound() {
  const r = await fetch(`${API}/pvp/trading/arena`, { headers: headers() });
  return parse<{ ok: boolean; current?: ArenaRoundState; last_settled?: ArenaRoundState; error?: string }>(r);
}

export async function joinArena(agentId: string) {
  const r = await fetch(`${API}/pvp/trading/arena/join`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_id: agentId }),
  });
  return parse<{ ok: boolean; current?: ArenaRoundState; balance?: number; message?: string; error?: string }>(r);
}

export async function arenaSpectateBet(pickUserId: string, stake: number, pickRank = 1) {
  const r = await fetch(`${API}/pvp/trading/arena/spectate-bet`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ pick_user_id: pickUserId, stake, pick_rank: pickRank }),
  });
  return parse<{ ok: boolean; current?: ArenaRoundState; balance?: number; message?: string; error?: string }>(r);
}

export async function fetchArenaWinRate(limit = 15) {
  const r = await fetch(`${API}/pvp/trading/arena/win-rate?limit=${limit}`, { headers: headers() });
  return parse<{ ok: boolean; entries?: ArenaWinRateEntry[]; error?: string }>(r);
}

export async function fetchPublicArenaLive() {
  const r = await fetch(`${API}/public/trading/arena/live`);
  return parse<PublicArenaLive>(r);
}

export async function fetchArenaLeaderboard(limit = 10) {
  const r = await fetch(`${API}/pvp/trading/arena/leaderboard?limit=${limit}`, { headers: headers() });
  return parse<{ ok: boolean; highlights?: Array<Record<string, unknown>>; error?: string }>(r);
}

export type TradingModesState = {
  pending_leverage?: { profit: number; source_round_id?: string; expires_at?: number } | null;
  leverage_uses_left?: number;
  leverage_10x_left?: number;
  faction?: string | null;
  faction_status?: {
    day_key: string;
    bull: { net_pnl: number; contrib: number; members: number; lead_pct: number };
    bear: { net_pnl: number; contrib: number; members: number; lead_pct: number };
    leading: string;
    settle_hour: number;
  };
  comeback?: { active?: boolean; seed?: number; balance?: number; rounds_left?: number } | null;
  personality?: {
    title: string; primary: string; secondary: string; tier: string; score: number;
    dimensions: Record<string, number>; chat_prefix?: string;
  };
  pk_streak?: number;
  pk_best_streak?: number;
  my_pk_room?: Record<string, unknown> | null;
};

export async function fetchTradingModes() {
  const r = await fetch(`${API}/pvp/trading/modes`, { headers: headers() });
  return parse<{ ok: boolean; error?: string } & TradingModesState>(r);
}

export async function placeLeverageBet(direction: 'up' | 'down', leverage: number, sourceRoundId = '') {
  const r = await fetch(`${API}/pvp/trading/guess/leverage`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ direction, leverage, source_round_id: sourceRoundId }),
  });
  return parse<{ ok: boolean; message?: string; modes?: TradingModesState; error?: string }>(r);
}

export async function placePkBet(direction: 'up' | 'down', stake: number, vsAi = true) {
  const r = await fetch(`${API}/pvp/trading/pk/bet`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ direction, stake, vs_ai: vsAi }),
  });
  return parse<{ ok: boolean; message?: string; room_id?: string; modes?: TradingModesState; balance?: number; error?: string }>(r);
}

export async function joinFaction(faction: 'bull' | 'bear') {
  const r = await fetch(`${API}/pvp/trading/faction/join`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ faction }),
  });
  return parse<{ ok: boolean; faction?: string; modes?: TradingModesState; error?: string }>(r);
}

export async function fetchFactionStatus() {
  const r = await fetch(`${API}/pvp/trading/faction/status`, { headers: headers() });
  return parse<{ ok: boolean; status?: TradingModesState['faction_status']; my_faction?: string; error?: string }>(r);
}

export async function fetchComebackStatus() {
  const r = await fetch(`${API}/pvp/trading/comeback/status`, { headers: headers() });
  return parse<{ ok: boolean; triggered?: boolean; modes?: TradingModesState; error?: string }>(r);
}

export async function placeComebackBet(direction: 'up' | 'down') {
  const r = await fetch(`${API}/pvp/trading/comeback/bet`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ direction }),
  });
  return parse<{ ok: boolean; message?: string; modes?: TradingModesState; error?: string }>(r);
}

export async function fetchPkStreakBoard() {
  const r = await fetch(`${API}/pvp/trading/pk/streak-board`, { headers: headers() });
  return parse<{ ok: boolean; entries?: Array<{ user_id: string; display_name: string; wins: number; rank: number }>; error?: string }>(r);
}

export interface PokerRoomPlayer {
  user_id: string; agent_id: string; seat_id: string; buy_in?: number; score?: number; rank?: number;
  display_name?: string; agent_name?: string; user_name?: string;
  color?: string; headwear?: string; hat_style?: string; is_npc?: boolean;
}

export interface PokerRoom {
  id: string; room_code?: string; status: string; pot: number; buy_in: number;
  game_mode?: 'classic' | 'advanced';
  spectator?: boolean;
  human_count?: number; player_names?: string[]; players: PokerRoomPlayer[];
}

export interface AdvancedPokerPlayer {
  seat_index: number; user_id: string; agent_id: string; seat_id: string;
  name: string; is_npc: boolean; stack: number; hole_cards: string[];
  folded: boolean; all_in: boolean; bet_street: number; eliminated: boolean;
  poker_preset?: string;
}

export interface AdvancedPokerEvent {
  seq: number; kind: string;
  seat_index?: number; name?: string; action?: string; amount?: number;
  phase?: string; community?: string[];
  hand_name?: string; reason?: string;
}

export interface AdvancedPokerGame {
  room_id: string; buy_in: number; hand_number: number;
  phase: string; status: string; community: string[];
  pot: number; current_bet: number; actor_index: number; actor_name: string;
  button_index: number; big_blind: number; small_blind: number;
  players: AdvancedPokerPlayer[];
  winners_last_hand: Array<{ seat_index: number; name: string; amount: number; hand_name?: string }>;
  events: AdvancedPokerEvent[];
  event_count: number;
  last_reasoning?: { seat_index: number; name: string; action: string; amount?: number; reason: string };
}

export interface PokerProfile {
  preset: string; label?: string;
  vpip: number; pfr: number; aggression: number; bluff_freq: number; fold_to_raise: number;
  notes?: string;
  stats?: { hands: number; wins: number; vpip_hits?: number; pfr_hits?: number };
}

export async function fetchPokerPresets() {
  const r = await fetch(`${API}/pvp/poker/presets`, { headers: headers() });
  return parse<{ ok: boolean; presets: Array<{ id: string; label: string }>; advanced_buy_ins: number[]; classic_buy_ins: number[] }>(r);
}

export async function startAiSpectator(agentId: string, buyIn = 1000, numPlayers = 4) {
  return fetchJson<{
    ok: boolean; room_id?: string; buy_in?: number; balance?: number; message?: string;
    game?: AdvancedPokerGame; settlement?: { results: Array<{ name: string; stack: number; rank: number; won: number }>; winner?: { name: string } };
    error?: string;
  }>(`${API}/pvp/poker/ai-spectator/start`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ agent_id: agentId, buy_in: buyIn, num_players: numPlayers }),
  }, 45000);
}

export async function fetchAdvancedPokerState(
  roomId: string,
  sinceSeq = 0,
  opts?: { autoRun?: boolean; maxSteps?: number; useLlm?: boolean; runUntilComplete?: boolean },
) {
  const params = new URLSearchParams({ since_seq: String(sinceSeq) });
  if (opts?.autoRun === false) params.set('auto_run', 'false');
  if (opts?.maxSteps != null) params.set('max_steps', String(opts.maxSteps));
  if (opts?.useLlm) params.set('use_llm', 'true');
  // run_until_complete 会阻塞整局在单次请求内，易导致前端长时间卡在加载页，不再使用
  return fetchJson<{
    ok: boolean; room_id?: string; game?: AdvancedPokerGame; status?: string;
    settlement?: { results: Array<{ name: string; stack: number; rank: number; won: number; eliminated: boolean }>; winner?: { name: string }; balance?: number; net?: number; won?: number };
    error?: string; timedOut?: boolean;
  }>(
    `${API}/pvp/poker/rooms/${encodeURIComponent(roomId)}/advanced/state?${params}`,
    { headers: headers() },
    45000,
  );
}

export async function fetchAgentPokerProfile(agentId: string) {
  const r = await fetch(`${API}/agents/${encodeURIComponent(agentId)}/poker-profile`, { headers: headers() });
  return parse<{ ok: boolean; profile: PokerProfile; presets: string[]; error?: string }>(r);
}

export async function parseAgentPokerStyle(agentId: string, text: string) {
  const r = await fetch(`${API}/agents/${encodeURIComponent(agentId)}/poker-style/parse`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ text }),
  });
  return parse<{ ok: boolean; profile?: PokerProfile; source?: string; message?: string; error?: string }>(r);
}

export async function feedbackAgentPokerStyle(agentId: string, feedback: string) {
  const r = await fetch(`${API}/agents/${encodeURIComponent(agentId)}/poker-style/feedback`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ feedback }),
  });
  return parse<{ ok: boolean; profile?: PokerProfile; message?: string; error?: string }>(r);
}

export async function setAgentPokerPreset(agentId: string, preset: string) {
  const r = await fetch(`${API}/agents/${encodeURIComponent(agentId)}/poker-profile`, {
    method: 'PUT', headers: headers(), body: JSON.stringify({ preset }),
  });
  return parse<{ ok: boolean; profile?: PokerProfile; error?: string }>(r);
}

export interface SeatAuction {
  seat_id: string; high_bid: number; high_bidder: string; ends_at: number;
}

export interface DispatchQueueItem {
  id: number; agent_id: string; action: string; node_id: string; cost: number; status: string;
}

// ─── Phase 3 Season ───
export async function fetchSeasonCurrent() {
  const r = await fetch(`${API}/season/current`, { headers: headers() });
  return parse<{ ok: boolean; season?: SeasonInfo; my_score?: SeasonScore; guild?: GuildInfo; cosmetics?: SeasonCosmetic[] }>(r);
}

export async function fetchSeasonLeaderboard(metric = 'points', limit = 20) {
  const r = await fetch(`${API}/season/leaderboard?metric=${metric}&limit=${limit}`, { headers: headers() });
  return parse<{ ok: boolean; entries: LeaderboardEntry[]; season_id?: string }>(r);
}

export async function createGuild(name: string) {
  const r = await fetch(`${API}/season/guilds`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ name }),
  });
  return parse<{ ok: boolean; guild_id?: string; error?: string }>(r);
}

export async function listGuilds() {
  const r = await fetch(`${API}/season/guilds`, { headers: headers() });
  return parse<{ ok: boolean; guilds: GuildInfo[] }>(r);
}

export async function joinGuild(guildId: string) {
  const r = await fetch(`${API}/season/guilds/join`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ guild_id: guildId }),
  });
  return parse<{ ok: boolean; error?: string }>(r);
}

export async function buySeasonCosmetic(itemId: string) {
  const r = await fetch(`${API}/season/shop/buy`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ item_id: itemId }),
  });
  return parse<{ ok: boolean; balance?: number; error?: string; item?: SeasonCosmetic }>(r);
}

export interface SeasonInfo {
  id: string; name: string; starts_at: number; ends_at: number; status: string;
}

export interface SeasonScore {
  points_earned: number; social_score: number; pvp_wins: number; pnl_score: number; rank: number;
}

export interface GuildInfo {
  id: string; name: string; leader_id: string; score: number; member_count?: number; role?: string;
}

export interface SeasonCosmetic {
  item_id: string; label: string; item_type: string; item_value: string; cost: number;
}

export interface LeaderboardEntry {
  rank: number; user_id: string; name: string;
  points_earned: number; social_score: number; pvp_wins: number; pnl_score: number;
}

/** 根据区域/活动解析聊天频道 */
export function chatChannelForZone(zone: string, nodeId?: string | null): string {
  if (zone === 'casino') return 'poker_table';
  if (zone === 'arena') return 'arena_pit';
  if (zone === 'restaurant' && nodeId?.startsWith('dine_')) return nodeId.split('_c')[0] ? nodeId.replace(/_c\d+$/, '') : 'restaurant';
  if (zone === 'spa' && nodeId?.startsWith('bed_')) return nodeId;
  if (zone === 'hall' && nodeId?.startsWith('rest_l')) return nodeId;
  return zone;
}

// ─── 增长 / 裂变 ───

export type WeeklyReportData = {
  week_key: string;
  week_label: string;
  display_name: string;
  poker_games: number;
  poker_wins: number;
  points_net: number;
  points_won: number;
  best_hand_name: string;
  best_hand_cat: number;
  trading_trades?: number;
  trading_wins?: number;
  trading_pnl?: number;
  best_trade_pnl?: number;
  arena_entries?: number;
  arena_wins?: number;
  season_name?: string;
  season_points?: number;
  season_social?: number;
  season_pvp_wins?: number;
  season_rank_hint?: number | null;
  current_points?: number;
};

export type PokerHighlightItem = {
  id: number;
  user_id: string;
  display_name: string;
  hand_name: string;
  hand_combo?: string;
  community?: string[];
  hole_cards?: string[];
  won: number;
  pot: number;
  room_id?: string;
  created_at: number;
};

export async function fetchReferralInfo() {
  const r = await fetch(`${API}/growth/referral`, { headers: headers() });
  return parse<{
    ok: boolean; invite_code?: string; invites_count?: number; poker_rewards?: number;
    invitees?: Array<{ invitee_id: string; name: string; registered_at: string; poker_done: boolean }>;
    pending_poker_invitees?: Array<{ invitee_id: string; name: string; registered_at: string; poker_done: boolean }>;
    rewards?: { invitee_signup: number; inviter_signup: number; inviter_first_poker: number };
    error?: string;
  }>(r);
}

export async function remindInviteePoker(inviteeId: string) {
  const r = await fetch(`${API}/growth/referral/remind`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ invitee_id: inviteeId }),
  });
  return parse<{ ok: boolean; message?: string; error?: string }>(r);
}

export async function fetchWeeklyReport() {
  const r = await fetch(`${API}/growth/weekly-report`, { headers: headers() });
  return parse<{ ok: boolean; report?: WeeklyReportData; error?: string }>(r);
}

export async function fetchPokerHighlights(sinceId = 0) {
  const r = await fetch(`${API}/growth/poker/highlights?since_id=${sinceId}&limit=15`, { headers: headers() });
  return parse<{ ok: boolean; highlights?: PokerHighlightItem[]; latest_id?: number; error?: string }>(r);
}

export async function fetchGrowthNotifications() {
  const r = await fetch(`${API}/growth/notifications`, { headers: headers() });
  return parse<{ ok: boolean; messages?: string[] }>(r);
}

export async function fetchPublicTradingDemo() {
  const r = await fetch(`${API}/public/trading/demo`);
  return parse<TradingDemoResult>(r);
}

export type TradingDemoTrade = {
  agent: string;
  symbol: string;
  direction: string;
  pnl_amount: number;
  reason?: string;
  closed_at?: string;
};

export type TradingDemoResult = {
  ok: boolean;
  demo?: boolean;
  symbol?: string;
  price?: number;
  closes?: number[];
  trades?: TradingDemoTrade[];
  message?: string;
  error?: string;
};

export async function fetchPublicPokerDemo() {
  const r = await fetch(`${API}/public/poker/demo`);
  return parse<PokerDemoResult>(r);
}

export type PokerDemoPlayer = {
  name: string;
  rank: number;
  won: number;
  is_npc?: boolean;
  hole_cards?: string[];
  best_cards?: string[];
  hand_name?: string;
  hand_combo?: string;
};

export type PokerDemoResult = {
  ok: boolean;
  demo?: boolean;
  community_cards?: string[];
  results?: PokerDemoPlayer[];
  pot?: number;
  buy_in?: number;
  tie?: boolean;
  message?: string;
  error?: string;
};

export async function fetchPublicRoomPreview(roomCode: string) {
  const code = roomCode.replace(/\D/g, '').slice(0, 5);
  const r = await fetch(`${API}/public/poker/rooms/${encodeURIComponent(code)}/preview`);
  return parse<{
    ok: boolean; room_id?: string; room_code?: string; status?: string;
    buy_in?: number; game_mode?: string; human_count?: number; max_players?: number; error?: string;
  }>(r);
}

export async function fetchPublicSpectateState(roomId: string, sinceSeq = 0) {
  const params = new URLSearchParams({ since_seq: String(sinceSeq), max_steps: '1' });
  return fetchJson<{
    ok: boolean; room_id?: string; buy_in?: number; game?: AdvancedPokerGame; status?: string; error?: string;
  }>(
    `${API}/public/poker/rooms/${encodeURIComponent(roomId)}/spectate?${params}`,
    { headers: { 'Content-Type': 'application/json' } },
    45000,
  );
}

export async function fetchPublicSeasonLeaderboard(metric = 'points') {
  const r = await fetch(`${API}/public/season/leaderboard?metric=${encodeURIComponent(metric)}&limit=20`);
  return parse<{ ok: boolean; entries: LeaderboardEntry[]; metric?: string }>(r);
}

export async function fetchPublicSeasonInfo() {
  const r = await fetch(`${API}/public/season/info`);
  return parse<{ ok: boolean; season?: { id: string; name: string; ends_at: number } | null }>(r);
}
