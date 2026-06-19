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

export function buildWeeklyReportLink(): string {
  return `${appBaseUrl()}?view=leaderboard`;
}

export type WeeklyReportData = {
  week_label: string;
  display_name: string;
  poker_games: number;
  poker_wins: number;
  points_net: number;
  points_won: number;
  best_hand_name: string;
  season_name?: string;
  season_points?: number;
  season_pvp_wins?: number;
  season_rank_hint?: number | null;
  current_points?: number;
};

export function buildWeeklyReportShareText(data: WeeklyReportData): string {
  const rank = data.season_rank_hint ? ` · 赛季约第 ${data.season_rank_hint} 名` : '';
  return `📊 我的交易人生本周战报（${data.week_label}）\n`
    + `🃏 德州 ${data.poker_games} 局 ${data.poker_wins} 胜 · 净 ${data.points_net >= 0 ? '+' : ''}${data.points_net} 积分\n`
    + `🏆 最佳牌型 ${data.best_hand_name}${rank}\n`
    + `当前积分 ${data.current_points ?? '—'}`;
}

export async function renderWeeklyReportCard(data: WeeklyReportData, linkUrl?: string): Promise<Blob> {
  const w = 640;
  const h = 360;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#2a3a6b');
  grad.addColorStop(1, '#1a2540');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('交易人生 · 本周战报', 24, 44);

  ctx.fillStyle = '#e3f2fd';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(data.display_name.slice(0, 12), 24, 88);

  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#bbdefb';
  ctx.fillText(`${data.week_label}${data.season_name ? ` · ${data.season_name}` : ''}`, 24, 118);

  const lines = [
    `🃏 德州 ${data.poker_games} 局 · ${data.poker_wins} 胜 · 净 ${data.points_net >= 0 ? '+' : ''}${data.points_net}`,
    `✨ 最佳牌型 ${data.best_hand_name}`,
    `🏆 赛季积分 ${data.season_points ?? 0} · PvP胜 ${data.season_pvp_wins ?? 0}`,
    data.season_rank_hint ? `📈 约第 ${data.season_rank_hint} 名` : '',
    `💰 当前 ${data.current_points ?? 0} 积分`,
  ].filter(Boolean);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '14px system-ui, sans-serif';
  let y = 156;
  for (const line of lines) {
    ctx.fillText(line.slice(0, 44), 24, y);
    y += 28;
  }

  const footerUrl = linkUrl || buildWeeklyReportLink();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(footerUrl.length > 46 ? `${footerUrl.slice(0, 44)}…` : footerUrl, 24, h - 12);

  try {
    const QRCode = (await import('qrcode')).default;
    const qrDataUrl = await QRCode.toDataURL(footerUrl, { width: 96, margin: 1, color: { dark: '#1a2540', light: '#ffffff' } });
    const qrImg = new Image();
    await new Promise<void>((resolve, reject) => {
      qrImg.onload = () => resolve();
      qrImg.onerror = () => reject(new Error('QR load failed'));
      qrImg.src = qrDataUrl;
    });
    ctx.fillStyle = '#fff';
    ctx.fillRect(w - 118, h - 118, 104, 104);
    ctx.drawImage(qrImg, w - 112, h - 112, 92, 92);
  } catch { /* optional */ }

  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png');
  });
}

export async function downloadWeeklyReportCard(data: WeeklyReportData, linkUrl?: string): Promise<void> {
  const blob = await renderWeeklyReportCard(data, linkUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trading-life-weekly-${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

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

export function buildHighlightShareText(h: PokerHighlightItem): string {
  return `🃏 全服高光！${h.display_name} · ${h.hand_name}${h.won ? ` · 赢得 ${h.won} 积分` : ''}`;
}

export async function renderHighlightShareCard(h: PokerHighlightItem, linkUrl?: string): Promise<Blob> {
  const pseudo: PokerHandResult = {
    results: [{
      name: h.display_name,
      score: 0,
      rank: 1,
      won: h.won,
      hand_name: h.hand_name,
      hand_combo: h.hand_combo,
      hole_cards: h.hole_cards,
      best_cards: h.hole_cards,
    }],
    community_cards: h.community,
    won: h.won,
    net: h.won,
    buyIn: 0,
    pot: h.pot,
  };
  return renderPokerShareCard(pseudo, linkUrl || appBaseUrl());
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
  if (d.view === 'leaderboard') sessionStorage.setItem('tl_pending_leaderboard', '1');
}

export function clearUrlParams(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  ['join', 'invite', 'view', 'room'].forEach(k => url.searchParams.delete(k));
  window.history.replaceState({}, '', url.pathname + url.hash);
}

/** 读取并合并 URL + sessionStorage 中的 Deep Link 意图（读后清除 storage） */
export function consumeDeepLinkIntent(): {
  spectate?: string;
  join?: string;
  leaderboard?: boolean;
  invite?: string;
} {
  const d = parseDeepLink();
  const spectate = sessionStorage.getItem('tl_pending_spectate')
    || (d.view === 'spectate' && d.room ? d.room : undefined)
    || undefined;
  const join = sessionStorage.getItem('tl_pending_join') || d.join || undefined;
  const leaderboard = sessionStorage.getItem('tl_pending_leaderboard') === '1' || d.view === 'leaderboard';
  const invite = sessionStorage.getItem('tl_pending_invite') || d.invite || undefined;

  sessionStorage.removeItem('tl_pending_spectate');
  sessionStorage.removeItem('tl_pending_join');
  sessionStorage.removeItem('tl_pending_leaderboard');
  return { spectate, join, leaderboard, invite };
}

/** 复制文本 — clipboard API 失败时用 textarea 降级 */
export async function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fallback below */ }
  }
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

export function isWeChatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

export async function shareOrCopy(opts: {
  title: string;
  text: string;
  url: string;
  /** 微信内提示用户右上角分享 */
  wechatHint?: boolean;
}): Promise<'shared' | 'copied' | 'failed'> {
  const payload = `${opts.text}\n${opts.url}`;
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
      return 'shared';
    } catch {
      /* cancelled or unsupported */
    }
  }
  const ok = await copyTextWithFallback(payload);
  if (ok && opts.wechatHint !== false && isWeChatBrowser()) {
    return 'copied';
  }
  return ok ? 'copied' : 'failed';
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

export async function renderPokerShareCard(data: PokerHandResult, linkUrl?: string): Promise<Blob> {
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

  const footerUrl = linkUrl || appBaseUrl();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px system-ui, sans-serif';
  const footer = footerUrl.length > 48 ? `${footerUrl.slice(0, 46)}…` : footerUrl;
  ctx.fillText(footer, 24, h - 28);
  ctx.fillText('扫码或打开链接加入', 24, h - 12);

  try {
    const QRCode = (await import('qrcode')).default;
    const qrDataUrl = await QRCode.toDataURL(footerUrl, {
      width: 96,
      margin: 1,
      color: { dark: '#1a4d32', light: '#ffffff' },
    });
    const qrImg = new Image();
    await new Promise<void>((resolve, reject) => {
      qrImg.onload = () => resolve();
      qrImg.onerror = () => reject(new Error('QR load failed'));
      qrImg.src = qrDataUrl;
    });
    ctx.fillStyle = '#fff';
    ctx.fillRect(w - 118, h - 118, 104, 104);
    ctx.drawImage(qrImg, w - 112, h - 112, 92, 92);
  } catch {
    /* QR optional */
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png');
  });
}

export async function downloadPokerShareCard(data: PokerHandResult, linkUrl?: string): Promise<void> {
  const blob = await renderPokerShareCard(data, linkUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trading-life-poker-${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

export function shareResultMessage(result: 'shared' | 'copied' | 'failed', wechat = isWeChatBrowser()): string {
  if (result === 'shared') return '已分享';
  if (result === 'copied') {
    return wechat ? '链接已复制 · 请粘贴到微信发送给好友' : '链接已复制';
  }
  return '复制失败，请长按链接手动复制';
}
