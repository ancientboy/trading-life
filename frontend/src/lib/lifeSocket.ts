import { getAuthToken, isLoggedIn } from './lifeAuth';
import { useGameStore } from '../store/useGameStore';
import type {
  AdvancedPokerGame, ArenaRoundState, GuessRoundState, PokerRoom,
} from './lifeEngagementApi';
import { fetchAdvancedPokerState } from './lifeEngagementApi';

const WS_PATH = '/trading/api/life/ws';
const RECONNECT_MS = 3000;
const ADVANCED_TICK_TIMEOUT_MS = 45000;

export type AdvancedPokerStateResponse = {
  ok: boolean;
  room_id?: string;
  game?: AdvancedPokerGame;
  status?: string;
  settlement?: {
    results: Array<{ name: string; stack: number; rank: number; won: number; eliminated: boolean }>;
    winner?: { name: string };
    balance?: number;
    net?: number;
    won?: number;
  };
  error?: string;
  timedOut?: boolean;
  request_id?: string;
  push?: boolean;
};

type AdvancedPushListener = (payload: AdvancedPokerStateResponse) => void;

type WsEnvelope = {
  type: string;
  seq?: number;
  ts?: number;
  payload?: unknown;
};

type PendingAdvanced = {
  resolve: (value: AdvancedPokerStateResponse) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

class LifeSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private subscribed = new Set<string>();
  private lastSeq = 0;
  private _connected = false;
  private pendingAdvanced = new Map<string, PendingAdvanced>();
  private advancedPushListeners = new Map<string, Set<AdvancedPushListener>>();

  isConnected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (!isLoggedIn()) return;
    const token = getAuthToken();
    if (!token) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      this._connected = true;
      this.resubscribeAll();
    };

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsEnvelope;
        this.handleMessage(msg);
      } catch { /* ignore */ }
    };

    socket.onclose = () => {
      this._connected = false;
      this.ws = null;
      if (!this.intentionalClose && isLoggedIn()) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pendingAdvanced.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket closed'));
    }
    this.pendingAdvanced.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  onAdvancedPush(roomId: string, listener: AdvancedPushListener): () => void {
    const set = this.advancedPushListeners.get(roomId) ?? new Set();
    set.add(listener);
    this.advancedPushListeners.set(roomId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.advancedPushListeners.delete(roomId);
    };
  }

  requestAdvancedTick(
    roomId: string,
    sinceSeq = 0,
    opts?: { autoRun?: boolean; maxSteps?: number },
  ): Promise<AdvancedPokerStateResponse> {
    if (!this.isConnected()) {
      return Promise.reject(new Error('WebSocket not connected'));
    }
    const requestId = `adv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAdvanced.delete(requestId);
        resolve({ ok: false, error: '同步超时，请重试', timedOut: true });
      }, ADVANCED_TICK_TIMEOUT_MS);
      this.pendingAdvanced.set(requestId, { resolve, reject, timer });
      this.send({
        action: 'advanced.tick',
        request_id: requestId,
        room_id: roomId,
        since_seq: sinceSeq,
        auto_run: opts?.autoRun !== false,
        max_steps: opts?.maxSteps ?? 1,
      });
    });
  }

  syncSubscriptions(want: string[]): void {
    const wantSet = new Set(want.filter(Boolean));
    const toRemove = [...this.subscribed].filter(c => !wantSet.has(c));
    const toAdd = [...wantSet].filter(c => !this.subscribed.has(c));
    if (toRemove.length) this.unsubscribe(toRemove);
    if (toAdd.length) this.subscribe(toAdd);
  }

  private subscribe(channels: string[]): void {
    const fresh: string[] = [];
    for (const ch of channels) {
      if (!ch || this.subscribed.has(ch)) continue;
      this.subscribed.add(ch);
      fresh.push(ch);
    }
    if (fresh.length) {
      this.send({ action: 'subscribe', channels: fresh });
    }
  }

  private unsubscribe(channels: string[]): void {
    const removed: string[] = [];
    for (const ch of channels) {
      if (!this.subscribed.has(ch)) continue;
      this.subscribed.delete(ch);
      removed.push(ch);
    }
    if (removed.length) {
      this.send({ action: 'unsubscribe', channels: removed });
    }
  }

  private resubscribeAll(): void {
    const channels = [...this.subscribed];
    this.subscribed.clear();
    if (channels.length) {
      this.subscribe(channels);
    }
    syncLifeSocketSubscriptions();
  }

  private handleMessage(msg: WsEnvelope): void {
    const advPayload = msg.type === 'poker.advanced.state'
      ? msg.payload as AdvancedPokerStateResponse | undefined
      : undefined;
    const isAdvancedReply = !!(advPayload?.request_id && this.pendingAdvanced.has(advPayload.request_id));
    if (!isAdvancedReply) {
      if (msg.seq && msg.seq <= this.lastSeq) return;
      if (msg.seq) this.lastSeq = msg.seq;
    }

    switch (msg.type) {
      case 'poker.room.state':
        this.applyPokerState(msg.payload);
        break;
      case 'poker.advanced.state':
        this.applyAdvancedState(msg.payload as AdvancedPokerStateResponse);
        break;
      case 'arena.live':
        this.applyArenaState(msg.payload);
        break;
      case 'guess.current':
        this.applyGuessState(msg.payload);
        break;
      case 'ping':
        this.send({ action: 'pong' });
        break;
      default:
        break;
    }
  }

  private applyPokerState(payload: unknown): void {
    const data = payload as { ok?: boolean; room?: PokerRoom | null; error?: string };
    const store = useGameStore.getState();
    if (!data?.ok || !data.room) {
      if (store.pokerRoom) store.clearPokerRoom();
      return;
    }
    const room = data.room;
    if (room.status === 'settled' || room.status === 'closed') {
      store.clearPokerRoom();
      return;
    }
    store.applyPokerRoom(room);
  }

  private applyAdvancedState(payload: AdvancedPokerStateResponse): void {
    const requestId = payload.request_id;
    if (requestId && this.pendingAdvanced.has(requestId)) {
      const pending = this.pendingAdvanced.get(requestId)!;
      this.pendingAdvanced.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve(payload);
      return;
    }
    if (!payload.push || !payload.room_id) return;
    const listeners = this.advancedPushListeners.get(payload.room_id);
    if (!listeners?.size) return;
    listeners.forEach(fn => {
      try { fn(payload); } catch { /* ignore */ }
    });
  }

  private applyArenaState(payload: unknown): void {
    const data = payload as { ok?: boolean; current?: ArenaRoundState | null; last_settled?: ArenaRoundState | null };
    if (!data?.ok) return;
    useGameStore.setState({
      arenaLive: data.current ?? null,
      arenaPollMeta: { last_settled: data.last_settled ?? null },
    });
  }

  private applyGuessState(payload: unknown): void {
    const data = payload as {
      ok?: boolean;
      current?: GuessRoundState | null;
      last_settled?: Record<string, unknown> | null;
      last_my_bet?: import('../store/useGameStore').GuessPollMeta['last_my_bet'];
      last_pk_result?: import('../lib/lifeEngagementApi').PkResultInfo | null;
    };
    if (!data?.ok) return;
    useGameStore.setState({
      guessRound: data.current ?? null,
      guessPollMeta: {
        last_settled: data.last_settled ?? null,
        last_my_bet: data.last_my_bet ?? null,
        last_pk_result: data.last_pk_result ?? null,
      },
    });
  }
}

export const lifeSocket = new LifeSocket();

export function startLifeSocket(): void {
  lifeSocket.connect();
  syncLifeSocketSubscriptions();
}

export function stopLifeSocket(): void {
  lifeSocket.disconnect();
}

/** 根据当前游戏状态同步 WS 订阅频道 */
export function syncLifeSocketSubscriptions(): void {
  const st = useGameStore.getState();
  const want: string[] = ['arena:live', 'guess:current'];
  if (st.pokerRoom?.id && st.pokerRoom.status === 'waiting' && !st.pokerSpectateRoom) {
    want.push(`poker:room:${st.pokerRoom.id}`);
  }
  if (st.pokerSpectateRoom?.id) {
    want.push(`poker:advanced:${st.pokerSpectateRoom.id}`);
  }
  lifeSocket.syncSubscriptions(want);
}

export async function fetchAdvancedPokerStateSmart(
  roomId: string,
  sinceSeq = 0,
  opts?: { autoRun?: boolean; maxSteps?: number },
): Promise<AdvancedPokerStateResponse> {
  if (lifeSocket.isConnected()) {
    try {
      return await lifeSocket.requestAdvancedTick(roomId, sinceSeq, opts);
    } catch {
      /* fallback */
    }
  }
  return fetchAdvancedPokerState(roomId, sinceSeq, opts);
}

/** WS 断开时的 REST 兜底同步 */
export function runLifeSocketFallbackSync(): void {
  if (lifeSocket.isConnected()) return;
  const st = useGameStore.getState();
  st.syncTradingLive().catch(() => {});
  if (st.activeZone === 'casino' && !st.pokerSpectateRoom) {
    if (st.pokerRoom?.id && st.pokerRoom.status === 'waiting') {
      st.syncPokerRoom().catch(() => {});
    } else {
      st.restorePokerRoom().catch(() => {});
    }
  }
}
