import { scarfColorsFromAccent, type ScarfPalette } from './scarfColors';
import type { AgentMeta } from './constants';
import type { OutfitId } from './agentOutfits';
import { OUTFIT_CATALOG } from './agentOutfits';

export type AgentHeadwear = 'scarf' | 'hat';

export const HAT_STYLE_IDS = ['beanie', 'cap', 'top', 'bobble', 'beret'] as const;
export type HatStyleId = typeof HAT_STYLE_IDS[number];

export const HAT_STYLES: Record<HatStyleId, { label: string }> = {
  beanie: { label: '毛线帽' },
  cap: { label: '鸭舌帽' },
  top: { label: '礼帽' },
  bobble: { label: '毛球帽' },
  beret: { label: '贝雷帽' },
};

export interface AgentAppearanceState {
  outfitId: OutfitId;
  scarfEnabled: boolean;
  hatEnabled: boolean;
  hatStyle: HatStyleId;
  color: string;
  /** 兼容旧 API / 存储 */
  headwear: AgentHeadwear;
}

export function resolveAppearance(meta: Partial<AgentMeta>): AgentAppearanceState {
  let scarfEnabled = meta.scarfEnabled;
  let hatEnabled = meta.hatEnabled;
  if (scarfEnabled == null && hatEnabled == null) {
    if (meta.headwear === 'hat') {
      scarfEnabled = false;
      hatEnabled = true;
    } else {
      scarfEnabled = true;
      hatEnabled = false;
    }
  }
  scarfEnabled = scarfEnabled ?? true;
  hatEnabled = hatEnabled ?? false;
  const headwear: AgentHeadwear = hatEnabled && !scarfEnabled ? 'hat' : 'scarf';
  return {
    outfitId: (meta.outfitId as OutfitId) || 'default',
    scarfEnabled,
    hatEnabled,
    hatStyle: meta.hatStyle ?? 'beanie',
    color: meta.color ?? '#FFD700',
    headwear,
  };
}

export function normalizeAgentMeta(meta: Partial<AgentMeta> & { icon?: string }): AgentMeta {
  const agentType = meta.agentType ?? 'trading';
  const appearance = resolveAppearance(meta);
  return {
    id: meta.id ?? 'unknown',
    name: meta.name ?? 'Agent',
    color: appearance.color,
    headwear: appearance.headwear,
    hatStyle: appearance.hatStyle,
    outfitId: appearance.outfitId,
    scarfEnabled: appearance.scarfEnabled,
    hatEnabled: appearance.hatEnabled,
    desc: meta.desc ?? '',
    strategy: meta.strategy ?? (agentType === 'entertainment' ? '休闲陪伴' : ''),
    market: meta.market ?? (agentType === 'entertainment' ? '—' : ''),
    interval: meta.interval ?? (agentType === 'entertainment' ? '—' : ''),
    risk: meta.risk ?? (agentType === 'entertainment' ? '—' : '中'),
    agentType,
    soulMd: meta.soulMd ?? '',
  };
}

export function appearanceSummary(meta: Partial<AgentMeta>): string {
  const a = resolveAppearance(meta);
  const parts: string[] = [];
  if (a.outfitId !== 'default') parts.push(OUTFIT_CATALOG[a.outfitId].label);
  if (a.scarfEnabled) parts.push('围巾');
  if (a.hatEnabled) parts.push(HAT_STYLES[a.hatStyle].label);
  return parts.length ? parts.join(' · ') : '经典企鹅';
}

/** @deprecated 使用 appearanceSummary */
export function headwearLabel(headwear: AgentHeadwear, hatStyle: HatStyleId): string {
  return headwear === 'scarf' ? '条纹围巾' : HAT_STYLES[hatStyle].label;
}

function darken(hex: string, amt = 0.35): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = Math.max(0, parseInt(full.slice(0, 2), 16) * (1 - amt));
  const g = Math.max(0, parseInt(full.slice(2, 4), 16) * (1 - amt));
  const b = Math.max(0, parseInt(full.slice(4, 6), 16) * (1 - amt));
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** 2D 帽子 — front / back / side */
export function drawAgentHat2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  style: HatStyleId,
  color: string,
  view: 'front' | 'back' | 'side' = 'front',
  flip = 1,
) {
  const main = color;
  const shade = darken(color, 0.28);
  ctx.fillStyle = main;

  if (view === 'back') {
    switch (style) {
      case 'beanie':
      case 'bobble':
        ctx.beginPath(); ctx.ellipse(0, py - 14, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
        if (style === 'bobble') {
          ctx.beginPath(); ctx.arc(0, py - 22, 4, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'cap':
        ctx.beginPath(); ctx.ellipse(0, py - 13, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade;
        ctx.fillRect(-12, py - 10, 24, 3);
        break;
      case 'top':
        ctx.fillRect(-11, py - 24, 22, 14);
        ctx.fillStyle = shade;
        ctx.fillRect(-13, py - 11, 26, 4);
        break;
      case 'beret':
        ctx.beginPath(); ctx.ellipse(2, py - 14, 14, 5, 0.2, 0, Math.PI * 2); ctx.fill();
        break;
    }
    return;
  }

  if (view === 'side') {
    ctx.save();
    ctx.scale(flip, 1);
    switch (style) {
      case 'beanie':
      case 'bobble':
        ctx.beginPath(); ctx.ellipse(4, py - 14, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
        if (style === 'bobble') ctx.beginPath(), ctx.arc(4, py - 22, 3.5, 0, Math.PI * 2), ctx.fill();
        break;
      case 'cap':
        ctx.beginPath(); ctx.ellipse(5, py - 13, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade;
        ctx.fillRect(0, py - 8, 16, 3);
        break;
      case 'top':
        ctx.fillRect(-2, py - 24, 14, 14);
        ctx.fillStyle = shade;
        ctx.fillRect(-4, py - 11, 18, 3);
        break;
      case 'beret':
        ctx.beginPath(); ctx.ellipse(6, py - 14, 12, 4, 0.3, 0, Math.PI * 2); ctx.fill();
        break;
    }
    ctx.restore();
    return;
  }

  switch (style) {
    case 'beanie':
      ctx.beginPath(); ctx.ellipse(0, py - 14, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade;
      ctx.fillRect(-14, py - 8, 28, 3);
      break;
    case 'bobble':
      ctx.beginPath(); ctx.ellipse(0, py - 14, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(0, py - 23, 4.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'cap':
      ctx.beginPath(); ctx.ellipse(0, py - 13, 15, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.ellipse(0, py - 6, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'top':
      ctx.fillRect(-12, py - 25, 24, 15);
      ctx.fillStyle = shade;
      ctx.fillRect(-14, py - 11, 28, 4);
      break;
    case 'beret':
      ctx.beginPath(); ctx.ellipse(0, py - 15, 15, 6, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.ellipse(3, py - 13, 8, 2, -0.15, 0, Math.PI * 2); ctx.fill();
      break;
  }
}

function drawScarfStripes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tail: boolean,
  palette: ScarfPalette,
) {
  const stripes = tail ? palette.tail : palette.wrap;
  const n = tail ? 4 : 6;
  const sh = h / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = stripes[i % 2];
    ctx.fillRect(x - w / 2, y + i * sh, w, sh + 0.5);
  }
}

export function drawAgentScarf2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  color: string,
  view: 'front' | 'back' | 'side',
  flip = 1,
) {
  const palette = scarfColorsFromAccent(color);
  if (view === 'front') {
    drawScarfStripes(ctx, 0, py + 1, 24, 7, false, palette);
    drawScarfStripes(ctx, -11, py + 6, 7, 11, true, palette);
  } else if (view === 'back') {
    drawScarfStripes(ctx, 0, py - 2, 24, 6, false, palette);
    drawScarfStripes(ctx, 10, py + 2, 6, 10, true, palette);
  } else {
    drawScarfStripes(ctx, flip * 3, py + 1, 14, 7, false, palette);
  }
}

export { scarfColorsFromAccent };
