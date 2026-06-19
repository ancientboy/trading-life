/** 裂变分享 — Deep Link、复制、分享卡 */
import type { PokerHandResult } from '../store/useGameStore';

const BASE_PATH = '/trading/life/';

export function appBaseUrl(): string {
  if (typeof window === 'undefined') return BASE_PATH;
  return `${window.location.origin}${BASE_PATH}`;
}

export function buildJoinLink(roomCode: string): string {
  const code = roomCode.replace(/\D/g, '').slice(0, 5);
  return `${appBaseUrl()}?join=${code}`;
}

export function buildSpectateLink(roomId: string): string {
  return `${appBaseUrl()}?view=spectate&room=${encodeURIComponent(roomId)}`;
}

export function buildInviteLink(code: string): string {
  return `${appBaseUrl()}?invite=${encodeURIComponent(code.trim().toUpperCase())}`;
}

export function buildLeaderboardLink(): string {
  return `${appBaseUrl()}?view=leaderboard`;
}

export function parseDeepLink(search?: string): {
  join?: string;
  invite?: string;
  view?: string;
  room?: string;
} {
  const params = new URLSearchParams(search ?? (typeof window !== 'undefined' ? window.location.search : ''));
  return {
    join: params.get('join') ?? undefined,
    invite: params.get('invite') ?? undefined,
    view: params.get('view') ?? undefined,
    room: params.get('room') ?? undefined,
  };
}

export function persistDeepLink(): void {
  const d = parseDeepLink();
  if (d.join) sessionStorage.setItem('tl_pending_join', d.join);
  if (d.invite) sessionStorage.setItem('tl_pending_invite', d.invite);
  if (d.view === 'spectate' && d.room) sessionStorage.setItem('tl_pending_spectate', d.room);
}

export function clearUrlParams(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  ['join', 'invite', 'view', 'room'].forEach(k => url.searchParams.delete(k));
  window.history.replaceState({}, '', url.pathname + url.hash);
}

export async function shareOrCopy(opts: { title: string; text: string; url: string }): Promise<'shared' | 'copied'> {
  const payload = `${opts.text}\n${opts.url}`;
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
      return 'shared';
    } catch {
      /* user cancelled or unsupported */
    }
  }
  await navigator.clipboard.writeText(payload);
  return 'copied';
}

const CARD_SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

function cardLabel(c: string): string {
  if (!c || c === '??') return '?';
  const m = c.match(/^(\d+|[ajqk])([shdc])$/i);
  if (!m) return c;
  const rank = m[1].toUpperCase().replace('10', 'T');
  return `${rank}${CARD_SUIT[m[2].toLowerCase()] ?? m[2]}`;
}

export function buildPokerShareText(data: PokerHandResult): string {
  const me = data.results.find(r => !r.is_npc);
  const top = data.results.find(r => r.rank === 1);
  const won = data.won > 0;
  const hand = top?.hand_name || top?.hand_combo || '';
  const community = (data.community_cards ?? []).map(cardLabel).join(' ');
  if (me && won) {
    return `🃏 我在交易人生德州扑克获胜！${me.hand_name || hand} · 赢得 ${data.won} 积分${community ? ` · 公共牌 ${community}` : ''}`;
  }
  if (top) {
    return `🃏 交易人生德州局 · ${top.name} ${top.hand_name || hand} 夺冠${community ? ` · ${community}` : ''}`;
  }
  return '🃏 交易人生 · 德州扑克精彩一局';
}

export async function renderPokerShareCard(data: PokerHandResult): Promise<Blob> {
  const me = data.results.find(r => !r.is_npc);
  const top = data.results.find(r => r.rank === 1);
  const won = data.won > 0;
  const w = 640;
  const h = 360;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#1a4d32');
  grad.addColorStop(1, '#0f3320');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('交易人生 · 德州扑克', 24, 44);

  ctx.fillStyle = '#e8f5e9';
  ctx.font = 'bold 28px system-ui, sans-serif';
  const headline = won && me
    ? `🎉 ${me.name} 获胜 +${data.won}`
    : top
      ? `👑 ${top.name} · ${top.hand_name || top.hand_combo || '冠军'}`
      : '精彩一局';
  ctx.fillText(headline.slice(0, 28), 24, 96);

  const community = data.community_cards ?? [];
  if (community.length) {
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#a5d6a7';
    ctx.fillText(`公共牌 ${community.map(cardLabel).join(' ')}`, 24, 136);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '14px system-ui, sans-serif';
  let y = 168;
  for (const r of data.results.slice(0, 4)) {
    const line = `${r.rank}. ${r.name}${r.won ? ` +${r.won}` : ''} · ${r.hand_name || r.hand_combo || ''}`;
    ctx.fillText(line.slice(0, 52), 24, y);
    y += 28;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('扫码或打开链接加入 · trading-life', 24, h - 24);

  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png');
  });
}

export async function downloadPokerShareCard(data: PokerHandResult): Promise<void> {
  const blob = await renderPokerShareCard(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trading-life-poker-${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
