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
  if (zone === 'restaurant' && nodeId?.startsWith('dine_')) return nodeId.split('_c')[0] ? nodeId.replace(/_c\d+$/, '') : 'restaurant';
  if (zone === 'spa' && nodeId?.startsWith('bed_')) return nodeId;
  if (zone === 'hall' && nodeId?.startsWith('rest_l')) return nodeId;
  return zone;
}

// ─── 增长 / 裂变 ───

export async function fetchReferralInfo() {
  const r = await fetch(`${API}/growth/referral`, { headers: headers() });
  return parse<{
    ok: boolean; invite_code?: string; invites_count?: number; poker_rewards?: number;
    invitees?: Array<{ invitee_id: string; name: string; registered_at: string; poker_done: boolean }>;
    rewards?: { invitee_signup: number; inviter_signup: number; inviter_first_poker: number };
    error?: string;
  }>(r);
}

export async function fetchGrowthNotifications() {
  const r = await fetch(`${API}/growth/notifications`, { headers: headers() });
  return parse<{ ok: boolean; messages?: string[] }>(r);
}

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
