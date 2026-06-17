import { getAuthToken } from './lifeAuth';

const API = '/trading/api/life';

function headers(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function parse<T>(r: Response): Promise<T> {
  return r.json() as Promise<T>;
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
  return parse<{ ok: boolean; id?: number; created_at?: number }>(r);
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

export async function tableSpeak(channel: string, agentId: string, agentName: string, soulMd: string) {
  const r = await fetch(`${API}/social/table-speak`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ channel, agent_id: agentId, agent_name: agentName, soul_md: soulMd }),
  });
  return parse<{ ok: boolean; line?: string; created_at?: number }>(r);
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

export async function createPokerRoom(buyIn = 30) {
  const r = await fetch(`${API}/pvp/poker/rooms`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ buy_in: buyIn }),
  });
  return parse<{ ok: boolean; room_id?: string; buy_in?: number }>(r);
}

export async function joinPokerRoom(roomId: string, agentId: string, seatId = '') {
  const r = await fetch(`${API}/pvp/poker/rooms/${roomId}/join`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ agent_id: agentId, seat_id: seatId }),
  });
  return parse<{ ok: boolean; error?: string; balance?: number; seat_id?: string }>(r);
}

export async function playPokerRound(roomId: string) {
  const r = await fetch(`${API}/pvp/poker/rooms/${roomId}/play`, { method: 'POST', headers: headers() });
  return parse<{ ok: boolean; results?: unknown[]; winner?: unknown; pot?: number; error?: string }>(r);
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

export interface PokerRoom {
  id: string; status: string; pot: number; buy_in: number; players: { user_id: string; agent_id: string; seat_id: string }[];
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
