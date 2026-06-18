/** Canvas 2D 剪纸绘制工具 — 对齐灵犀 144 office-engine.js */

import { getPokerTableSprite } from '../../lib/pokerTableSprite';
import { getMassageBedSprite } from '../../lib/massageBedSprite';
import { getDiningTableSprite } from '../../lib/diningTableSprite';
import { getRestSofaSprite } from '../../lib/restSofaSprite';
import { outfitForRole, type NpcRole } from '../../lib/npcOutfits';
import { DEFAULT_SCARF, scarfColorsFromAccent, type ScarfPalette } from '../../lib/scarfColors';
import {
  drawAgentHat2d, drawAgentScarf2d,
  type AgentHeadwear, type HatStyleId,
} from '../../lib/agentAppearance';

export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function dropShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a = 0.1) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, w / 2, h / 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawDesk(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  opts: { active?: boolean; chartSeed?: number; t?: number } = {},
) {
  const monitorActive = opts.active ?? false;
  const t = opts.t ?? 0;
  const seed = opts.chartSeed ?? 1;
  const dw = 82 * s, dh = 50 * s, r = 6 * s, side = 4 * s;
  dropShadow(ctx, x, y + side / 2, dw, dh);
  ctx.fillStyle = '#e2e2e2';
  ctx.beginPath();
  ctx.moveTo(x + dw / 2, y - dh / 2);
  ctx.lineTo(x + dw / 2, y + dh / 2);
  ctx.lineTo(x + dw / 2, y + dh / 2 + side);
  ctx.lineTo(x - dw / 2, y + dh / 2 + side);
  ctx.lineTo(x - dw / 2, y + dh / 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fafafa';
  rrect(ctx, x - dw / 2, y - dh / 2, dw, dh, r); ctx.fill();
  ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.stroke();

  const mw = 36 * s, mh = 22 * s;
  const mx = x - mw / 2, my = y - dh / 2 - mh - 4 * s;
  ctx.fillStyle = '#2a2a2a';
  rrect(ctx, mx, my, mw, mh, 4 * s); ctx.fill();
  ctx.fillStyle = monitorActive ? '#0a1520' : '#141820';
  rrect(ctx, mx + 2 * s, my + 2 * s, mw - 4 * s, mh - 4 * s, 3 * s); ctx.fill();
  drawMiniChart(ctx, mx + 3 * s, my + 3 * s, mw - 6 * s, mh - 6 * s, seed, t, monitorActive);
}

export function drawBooth(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const w = 200 * s, h = 130 * s;
  dropShadow(ctx, x, y, w, h, 0.08);
  ctx.fillStyle = '#c8baa8';
  rrect(ctx, x - w / 2, y - h / 2 - 20 * s, w, 28 * s, 6 * s); ctx.fill();
  ctx.fillStyle = '#8b7355';
  rrect(ctx, x - w / 2 + 12 * s, y - h / 2 + 20 * s, w - 24 * s, 36 * s, 8 * s); ctx.fill();
  ctx.fillStyle = '#d4c8b8';
  rrect(ctx, x - w / 2 + 20 * s, y - h / 2 + 8 * s, w - 40 * s, 14 * s, 4 * s); ctx.fill();
}

export type AgentFacing = 'n' | 's' | 'e' | 'w';
export type AgentActivity = 'rest' | 'massage' | 'dine' | 'poker' | null;

function drawMiniChart(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  seed: number, t: number, active: boolean,
) {
  const n = Math.max(6, Math.floor(w / 5));
  const scroll = active ? Math.floor(t * 3) % 3 : 0;
  for (let i = 0; i < n; i++) {
    const idx = i + scroll;
    const bull = ((seed + idx * 7) % 5) > 1;
    const bodyH = (3 + ((seed + idx * 13) % 7)) * (h / 14);
    const cx = x + (i + 0.5) * (w / n);
    const base = y + h * (0.35 + ((seed + idx) % 5) * 0.08) + Math.sin(t * 2 + idx + seed) * (active ? 1.2 : 0);
    ctx.strokeStyle = bull ? '#48D093' : '#56A3FF';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, base - bodyH);
    ctx.lineTo(cx, base + bodyH * 0.3);
    ctx.stroke();
    ctx.fillRect(cx - 1.2, base - bodyH, 2.4, bodyH);
  }
  if (active) {
    ctx.strokeStyle = 'rgba(72,208,147,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath();
    let ly = y + h * 0.5;
    for (let i = 0; i < n; i++) {
      const cx = x + (i + 0.5) * (w / n);
      const ny = y + h * (0.3 + ((seed + i * 3) % 4) * 0.12) + Math.sin(t * 4 + i) * 2;
      if (i === 0) ctx.moveTo(cx, ny); else ctx.lineTo(cx, ny);
      ly = ny;
    }
    ctx.stroke();
  }
}

/** 角色统一入口 — 根据朝向/姿势渲染正/背/侧面；就座/躺卧时绘制对应姿态 */
export function drawAgent(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; trading?: boolean; walking?: boolean; t?: number;
    activity?: AgentActivity; facing?: AgentFacing; sitting?: boolean;
    pose?: 'stand' | 'sit' | 'lie' | 'desk';
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
) {
  const act = opts.activity;
  const pose = opts.pose ?? (act === 'massage' ? 'lie' : (opts.sitting || act === 'dine' || act === 'poker' || act === 'rest') ? 'sit' : 'stand');
  if (pose === 'lie') {
    drawAgentTop(ctx, x, y, color, { ...opts, facing: 's', activity: act ?? 'massage' });
    return;
  }
  if (pose === 'sit' || pose === 'desk') {
    drawAgentSitting(ctx, x, y, color, { ...opts, pose, activity: act });
    return;
  }
  const facing = opts.facing ?? 's';
  if (facing === 'n') drawAgentBack(ctx, x, y, color, opts);
  else if (facing === 's') drawAgentFront(ctx, x, y, color, opts);
  else drawAgentSide(ctx, x, y, color, opts, facing);
}

function drawAgentSitting(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; t?: number; activity?: AgentActivity; facing?: AgentFacing;
    pose?: 'sit' | 'desk';
    headwear?: AgentHeadwear; hatStyle?: HatStyleId; trading?: boolean;
  },
) {
  const t = opts.t ?? 0;
  const facing = opts.facing ?? 's';
  const py = y + (opts.activity === 'dine' ? Math.abs(Math.sin(t * 3)) * 1.5 : 0);
  const hw = agentHw(opts);
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 20, 18, 0, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 6, 30, 22, 0.1);
  ctx.save(); ctx.translate(x, 0);
  if (facing === 'e' || facing === 'w') {
    const flip = facing === 'w' ? -1 : 1;
    ctx.fillStyle = PENGUIN.foot;
    ctx.beginPath(); ctx.ellipse(flip * 6, py + 10, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    drawPenguinBody(ctx, py - 4, true);
    if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, py - 4, color, 'side', flip);
    drawPenguinFace(ctx, py - 4, true, flip);
    if (hw.headwear === 'hat') drawAgentHat2d(ctx, py - 6, hw.hatStyle, color, 'side', flip);
  } else if (facing === 'n') {
    drawPenguinBody(ctx, py - 4);
    if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, py - 4, color, 'back');
    else if (hw.headwear === 'hat') drawAgentHat2d(ctx, py - 6, hw.hatStyle, color, 'back');
  } else {
    drawPenguinBody(ctx, py - 2);
    if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, py - 2, color, 'front');
    drawPenguinFace(ctx, py - 2);
    if (hw.headwear === 'hat') drawAgentHat2d(ctx, py - 4, hw.hatStyle, color, 'front');
    if (opts.pose === 'desk' || opts.trading) {
      ctx.fillStyle = '#4285F4';
      ctx.fillRect(-14, py - 18, 28, 5);
      ctx.fillStyle = '#1e1e22';
      ctx.fillRect(-10, py - 16, 20, 3);
    }
  }
  ctx.restore();
  drawActivityBadge(ctx, x, py, opts.activity, t);
}

function walkPhase(t: number, walking: boolean) {
  return walking ? t * 10 : 0;
}

const PENGUIN = {
  black: '#1a1a1a',
  white: '#f7f7f7',
  belly: '#f2f2f2',
  beak: '#f5a623',
  foot: '#f5a623',
  scarfGreen: '#3d9e46',
  scarfRed: '#d94c4c',
  scarfBlue: '#4285f4',
};

/** 围脖 + 垂坠条纹；Agent 传 palette，NPC 用默认色 */
function drawPenguinScarf(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  tail = false, palette: ScarfPalette = DEFAULT_SCARF,
) {
  const stripes = tail ? palette.tail : palette.wrap;
  const n = tail ? 4 : 6;
  const sh = h / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = stripes[i % 2];
    ctx.fillRect(x - w / 2, y + i * sh, w, sh + 0.5);
  }
}

function drawPenguinFace(ctx: CanvasRenderingContext2D, py: number, profile = false, flip = 1) {
  if (profile) {
    ctx.fillStyle = PENGUIN.white;
    ctx.beginPath(); ctx.ellipse(flip * 5, py - 2, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PENGUIN.black;
    ctx.beginPath(); ctx.arc(flip * 5, py - 2, 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = PENGUIN.white;
    ctx.beginPath(); ctx.ellipse(-5, py - 2, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, py - 2, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PENGUIN.black;
    ctx.beginPath(); ctx.arc(-5, py - 2, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, py - 2, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = PENGUIN.beak;
  ctx.beginPath();
  if (profile) {
    ctx.moveTo(flip * 8, py + 1); ctx.lineTo(flip * 12, py + 4); ctx.lineTo(flip * 8, py + 6);
  } else {
    ctx.moveTo(0, py + 2); ctx.lineTo(-3, py + 7); ctx.lineTo(3, py + 7);
  }
  ctx.closePath(); ctx.fill();
}

function drawPenguinBody(ctx: CanvasRenderingContext2D, py: number, profile = false) {
  ctx.fillStyle = PENGUIN.black;
  ctx.beginPath(); ctx.ellipse(profile ? 2 : 0, py + 2, profile ? 12 : 15, profile ? 17 : 19, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN.belly;
  ctx.beginPath(); ctx.ellipse(profile ? 4 : 0, py + 7, profile ? 7 : 10, profile ? 9 : 11, 0, 0, Math.PI * 2); ctx.fill();
}

function agentHw(opts: { headwear?: AgentHeadwear; hatStyle?: HatStyleId }) {
  return { headwear: opts.headwear ?? 'scarf' as AgentHeadwear, hatStyle: opts.hatStyle ?? 'beanie' as HatStyleId };
}

function drawHeadwearFront(ctx: CanvasRenderingContext2D, py: number, color: string, hw: ReturnType<typeof agentHw>) {
  if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, py, color, 'front');
  drawPenguinFace(ctx, py - 2);
  if (hw.headwear === 'hat') drawAgentHat2d(ctx, py - 2, hw.hatStyle, color, 'front');
}

function drawHeadwearBack(ctx: CanvasRenderingContext2D, py: number, color: string, hw: ReturnType<typeof agentHw>) {
  if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, py, color, 'back');
  else drawAgentHat2d(ctx, py - 2, hw.hatStyle, color, 'back');
}

function drawHeadwearSide(ctx: CanvasRenderingContext2D, py: number, color: string, hw: ReturnType<typeof agentHw>, flip: number) {
  if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, py, color, 'side', flip);
  drawPenguinFace(ctx, py - 2, true, flip);
  if (hw.headwear === 'hat') drawAgentHat2d(ctx, py - 2, hw.hatStyle, color, 'side', flip);
}

/** 手脚摆动 — 参考 144 office-engine */
function drawWalkLimbs(
  ctx: CanvasRenderingContext2D, py: number, facing: AgentFacing,
  walking: boolean, t: number, _color: string,
) {
  const phase = walkPhase(t, walking);
  const swing = walking ? Math.sin(phase) * 5 : 0;
  const bounce = walking ? Math.abs(Math.sin(phase)) * 2 : 0;
  const vert = facing === 'n' || facing === 's';

  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = PENGUIN.black;
  ctx.fillStyle = PENGUIN.foot;
  if (vert) {
    ctx.beginPath(); ctx.ellipse(-5, py + 18 - bounce + swing, 5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, py + 18 - bounce - swing, 5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-11, py + 2); ctx.lineTo(-14 - swing * 0.6, py + 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, py + 2); ctx.lineTo(14 + swing * 0.6, py + 12); ctx.stroke();
  } else {
    const flip = facing === 'w' ? -1 : 1;
    ctx.beginPath(); ctx.ellipse(flip * (-4 + swing * 0.5), py + 18 - bounce, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(flip * (4 - swing * 0.5), py + 18 - bounce, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(flip * 10, py + 2); ctx.lineTo(flip * (14 + swing * 0.5), py + 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(flip * 6, py); ctx.lineTo(flip * (2 - swing * 0.4), py + 10); ctx.stroke();
  }
}

/** 背面 — 圆头 + 后脑围巾 + 手脚 */
function drawAgentBack(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; walking?: boolean; t?: number; activity?: AgentActivity; facing?: AgentFacing;
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
) {
  const t = opts.t ?? 0;
  const walking = !!opts.walking;
  const bob = walking ? Math.abs(Math.sin(walkPhase(t, walking))) * 2.5 : 0;
  const py = y + bob;
  const hw = agentHw(opts);
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 18, 22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 6, 32, 36, 0.12);
  ctx.save(); ctx.translate(x, 0);
  drawWalkLimbs(ctx, py, 'n', walking, t, color);
  drawPenguinBody(ctx, py);
  drawHeadwearBack(ctx, py, color, hw);
  ctx.restore();
  drawActivityBadge(ctx, x, py, opts.activity, t);
}

/** 正面 — 圆脸 + 双眼 + 围巾 + 手脚 */
function drawAgentFront(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; trading?: boolean; walking?: boolean; t?: number;
    activity?: AgentActivity; headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
) {
  const t = opts.t ?? 0;
  const walking = !!opts.walking;
  let bob = 0;
  if (walking) bob = Math.abs(Math.sin(walkPhase(t, walking))) * 2.5;
  else if (opts.trading) bob = Math.sin(t * 4) * 1.5;
  else if (opts.activity === 'dine') bob = Math.abs(Math.sin(t * 3)) * 1.5;
  const py = y + bob;
  const hw = agentHw(opts);

  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 18, 22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 6, 32, 36, 0.12);
  ctx.save(); ctx.translate(x, 0);
  drawWalkLimbs(ctx, py, 's', walking, t, color);
  drawPenguinBody(ctx, py);
  drawHeadwearFront(ctx, py, color, hw);
  ctx.restore();
  if (opts.trading) {
    ctx.fillStyle = '#4285F4';
    ctx.fillRect(x + 12, py - 12, 9, 6);
  }
  drawActivityBadge(ctx, x, py, opts.activity, t);
}

/** 侧面 + 手脚 */
function drawAgentSide(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; walking?: boolean; t?: number; activity?: AgentActivity;
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
  facing: 'e' | 'w',
) {
  const t = opts.t ?? 0;
  const walking = !!opts.walking;
  const bob = walking ? Math.abs(Math.sin(walkPhase(t, walking))) * 2.5 : 0;
  const py = y + bob;
  const hw = agentHw(opts);
  const flip = facing === 'w' ? -1 : 1;
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 16, 22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 6, 28, 34, 0.12);
  ctx.save(); ctx.translate(x, 0);
  drawWalkLimbs(ctx, py, facing, walking, t, color);
  drawPenguinBody(ctx, py, true);
  drawHeadwearSide(ctx, py, color, hw, flip);
  ctx.restore();
  drawActivityBadge(ctx, x, py, opts.activity, t);
}

function drawActivityBadge(ctx: CanvasRenderingContext2D, x: number, py: number, act: AgentActivity | undefined, t: number) {
  ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  if (act === 'rest') ctx.fillText('💤', x + 14, py - 18 + Math.sin(t * 2) * 2);
  if (act === 'dine') ctx.fillText('🍽️', x + 15, py - 16 + Math.sin(t * 4) * 2);
  if (act === 'poker') {
    const chip = Math.floor(t * 2) % 3;
    ctx.fillText(['🃏', '🎲', '♠️'][chip], x + 14, py - 17);
  }
}

/** 俯视（按摩等） */
export function drawAgentTop(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; walking?: boolean; t?: number;
    activity?: AgentActivity; facing?: AgentFacing;
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
) {
  const t = opts.t ?? 0;
  const hw = agentHw(opts);
  const bob = opts.walking ? Math.abs(Math.sin(t * 10)) * 3 : Math.sin(t * 1.5) * 1;
  const py = y + bob;
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, py, 22, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 4, 28, 28, 0.12);
  ctx.fillStyle = PENGUIN.black;
  ctx.beginPath(); ctx.ellipse(x, py + 2, 18, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN.belly;
  ctx.beginPath(); ctx.ellipse(x, py + 4, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
  if (hw.headwear === 'scarf') {
    drawPenguinScarf(ctx, x, py - 1, 20, 5, false, scarfColorsFromAccent(color));
  } else {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x, py - 2, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (opts.activity === 'massage') {
    ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('✨', x + 14, py - 10 + Math.sin(t * 5) * 2);
  }
}

/** 大型滚动行情屏 */
export function drawMarketBigScreen(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  items: { label: string; price: string; up?: boolean }[], t: number, s: number,
) {
  dropShadow(ctx, x, y, w, h, 0.1);
  ctx.fillStyle = '#1e1e22';
  rrect(ctx, x - w / 2, y - h / 2, w, h, 10 * s); ctx.fill();
  ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#4285F4';
  rrect(ctx, x - w / 2, y - h / 2, w, 22 * s, 10 * s); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.max(11, 13 * s)}px Inter,sans-serif`; ctx.textAlign = 'left';
  ctx.fillText('实时行情', x - w / 2 + 12 * s, y - h / 2 + 15 * s);

  const rowH = 26 * s;
  const innerH = h - 28 * s;
  const totalH = items.length * rowH;
  const scroll = totalH > innerH ? (t * 28) % totalH : 0;

  ctx.save();
  rrect(ctx, x - w / 2 + 6 * s, y - h / 2 + 24 * s, w - 12 * s, innerH, 6 * s);
  ctx.clip();

  for (let pass = 0; pass < 2; pass++) {
    items.forEach((item, i) => {
      const ry = y - h / 2 + 28 * s + i * rowH - scroll + pass * totalH;
      if (ry < y - h / 2 + 20 * s || ry > y + h / 2 - 4 * s) return;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent';
      ctx.fillRect(x - w / 2 + 8 * s, ry - rowH * 0.35, w - 16 * s, rowH);
      ctx.fillStyle = '#9ab0c8';
      ctx.font = `600 ${Math.max(10, 12 * s)}px Inter,sans-serif`; ctx.textAlign = 'left';
      ctx.fillText(item.label, x - w / 2 + 14 * s, ry + 4 * s);
      ctx.fillStyle = item.up === false ? '#56A3FF' : '#48D093';
      ctx.font = `700 ${Math.max(10, 12 * s)}px monospace`; ctx.textAlign = 'right';
      ctx.fillText(item.price, x + w / 2 - 14 * s, ry + 4 * s);
    });
  }
  ctx.restore();
}

/** 咖啡休息区 */
export function drawCoffeeZone(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  const cw = 130 * s, ch = 52 * s;
  dropShadow(ctx, x, y, cw, ch, 0.09);
  ctx.fillStyle = '#f5f0e8';
  rrect(ctx, x - cw / 2, y - ch / 2, cw, ch, 10 * s); ctx.fill();
  ctx.strokeStyle = '#ddd4c8'; ctx.lineWidth = 1; ctx.stroke();
  // 咖啡机
  ctx.fillStyle = '#4a4a4a';
  rrect(ctx, x - cw / 2 + 8 * s, y - 16 * s, 28 * s, 32 * s, 4 * s); ctx.fill();
  ctx.fillStyle = '#666';
  rrect(ctx, x - cw / 2 + 12 * s, y - 12 * s, 20 * s, 8 * s, 2 * s); ctx.fill();
  // 杯列
  for (let i = 0; i < 4; i++) {
    const cx = x - cw / 2 + 48 * s + i * 18 * s;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(cx, y + 4 * s, 6 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8B6914';
    ctx.beginPath(); ctx.ellipse(cx, y + 2 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
    if (i === 0) {
      ctx.strokeStyle = 'rgba(180,180,180,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y - 4 * s);
      ctx.quadraticCurveTo(cx + 3 * s, y - 10 * s - Math.sin(t * 3) * 2, cx - 2 * s, y - 12 * s);
      ctx.stroke();
    }
  }
  drawFacilityLabel(ctx, x, y + ch / 2 + 14 * s, '☕ 咖啡区', s);
}

export function drawZoneTransitOverlay(
  ctx: CanvasRenderingContext2D, cw: number, ch: number, t: number, label: string,
) {
  ctx.fillStyle = 'rgba(244,242,237,0.92)';
  ctx.fillRect(0, 0, cw, ch);
  const cx = cw / 2, cy = ch / 2;
  const step = Math.sin(t * 8) * 6;
  ctx.fillStyle = '#3d3530';
  ctx.font = '600 15px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy - 36);
  ctx.font = '12px Inter,sans-serif'; ctx.fillStyle = '#8a7e72';
  ctx.fillText('正在前往…', cx, cy - 16);
  for (let i = 0; i < 3; i++) {
    const ox = (i - 1) * 22 + step * (i === 1 ? 0 : 1);
    ctx.beginPath(); ctx.ellipse(cx + ox, cy + 18, 8, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = i === 1 ? '#1a1a1a' : '#888';
    ctx.fill();
  }
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 40, cy + 40);
  ctx.lineTo(cx - 20 + step, cy + 40); ctx.lineTo(cx - 28 + step, cy + 32); ctx.moveTo(cx - 20 + step, cy + 40);
  ctx.lineTo(cx - 28 + step, cy + 48); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 40, cy + 40);
  ctx.lineTo(cx + 20 - step, cy + 40); ctx.lineTo(cx + 28 - step, cy + 32); ctx.moveTo(cx + 20 - step, cy + 40);
  ctx.lineTo(cx + 28 - step, cy + 48); ctx.stroke();
}

export function drawNavArrow(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, dir: 'n' | 's' | 'e' | 'w', bob: number) {
  const py = y + Math.sin(bob * 2.5) * 2;
  const w = 68, h = 26;
  ctx.fillStyle = 'rgba(255,252,247,0.92)';
  ctx.strokeStyle = 'rgba(212,175,55,0.75)'; ctx.lineWidth = 1;
  rrect(ctx, x - w / 2, py - h / 2, w, h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d4af37';
  ctx.beginPath();
  const ax = x - 22, ay = py;
  const s = 5;
  if (dir === 's') { ctx.moveTo(ax, ay + s); ctx.lineTo(ax - s, ay - s); ctx.lineTo(ax + s, ay - s); }
  else if (dir === 'n') { ctx.moveTo(ax, ay - s); ctx.lineTo(ax - s, ay + s); ctx.lineTo(ax + s, ay + s); }
  else if (dir === 'e') { ctx.moveTo(ax + s, ay); ctx.lineTo(ax - s, ay - s); ctx.lineTo(ax - s, ay + s); }
  else { ctx.moveTo(ax - s, ay); ctx.lineTo(ax + s, ay - s); ctx.lineTo(ax + s, ay + s); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5a5048'; ctx.font = '600 11px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, x + 6, py + 4);
}

export function drawFacilityLabel(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, scale: number, hover = false) {
  ctx.font = `600 ${Math.max(9, 10 * scale)}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = hover ? '#3d3530' : 'rgba(61,53,48,0.55)';
  ctx.fillText(label, x, y);
}

export function drawRoundTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y, 80 * s, 80 * s);
  ctx.fillStyle = '#c9b896';
  ctx.beginPath(); ctx.ellipse(x, y, 55 * s, 38 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a8f62';
  ctx.beginPath(); ctx.ellipse(x, y, 38 * s, 26 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawMassageBed(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const sprite = getMassageBedSprite();
  if (sprite) {
    const w = 108 * s;
    const h = w * (sprite.naturalHeight / sprite.naturalWidth);
    ctx.drawImage(sprite, x - w / 2, y - h / 2, w, h);
    return;
  }

  dropShadow(ctx, x, y, 90 * s, 40 * s);
  ctx.fillStyle = '#c4a882';
  rrect(ctx, x - 45 * s, y - 12 * s, 90 * s, 24 * s, 5 * s); ctx.fill();
  ctx.fillStyle = '#fff';
  rrect(ctx, x - 40 * s, y - 9 * s, 80 * s, 18 * s, 4 * s); ctx.fill();
}

export function drawDiningTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const sprite = getDiningTableSprite();
  if (sprite) {
    const w = 132 * s;
    const h = w * (sprite.naturalHeight / sprite.naturalWidth);
    dropShadow(ctx, x, y, w, h * 0.9, 0.1);
    ctx.drawImage(sprite, x - w / 2, y - h / 2, w, h);
    return;
  }

  dropShadow(ctx, x, y, 70 * s, 70 * s);
  ctx.fillStyle = '#d4c8b8';
  ctx.beginPath(); ctx.ellipse(x, y, 32 * s, 32 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c0b4a4'; ctx.lineWidth = 1; ctx.stroke();
}

export function drawChair(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, facing: 'n' | 's' | 'e' | 'w' = 's') {
  dropShadow(ctx, x, y + 4 * s, 24 * s, 20 * s, 0.08);
  ctx.fillStyle = '#8b7355';
  rrect(ctx, x - 10 * s, y - 6 * s, 20 * s, 14 * s, 3 * s); ctx.fill();
  ctx.fillStyle = '#a08060';
  const back = facing === 'n' ? -8 : facing === 's' ? 8 : 0;
  rrect(ctx, x - 10 * s, y + back * s - 4 * s, 20 * s, 6 * s, 2 * s); ctx.fill();
}

export function drawRestBooth(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false) {
  const sprite = getRestSofaSprite();
  if (sprite) {
    const w = 168 * s;
    const h = w * (sprite.naturalHeight / sprite.naturalWidth);
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  dropShadow(ctx, x, y, 160 * s, 90 * s, 0.08);
  ctx.fillStyle = '#d4c8b8';
  rrect(ctx, x - 70 * s, y - 20 * s, 140 * s, 40 * s, 8 * s); ctx.fill();
  ctx.fillStyle = '#c8baa8';
  rrect(ctx, x - 75 * s, y - 28 * s, 30 * s, 56 * s, 6 * s); ctx.fill();
  rrect(ctx, x + 45 * s, y - 28 * s, 30 * s, 56 * s, 6 * s); ctx.fill();
  ctx.fillStyle = '#faf6ef';
  ctx.beginPath(); ctx.ellipse(x, y + 8 * s, 22 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawPokerTable8(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number,
) {
  const sprite = getPokerTableSprite();
  if (sprite) {
    const w = 240 * s;
    const h = 172 * s;
    dropShadow(ctx, x, y, w, h * 0.85, 0.1);
    ctx.save();
    ctx.translate(x, y);
    // 原图荷官托盘在下方；旋转 180° 使有牌/发牌侧朝向画布上方荷官 Jack (py≈160)
    ctx.rotate(Math.PI);
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  dropShadow(ctx, x, y, 240 * s, 180 * s, 0.14);
  ctx.fillStyle = '#8b6914';
  ctx.beginPath(); ctx.ellipse(x, y, 118 * s, 80 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2d5a3d';
  ctx.beginPath(); ctx.ellipse(x, y, 110 * s, 75 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 3 * s; ctx.stroke();
  ctx.fillStyle = '#1a4030';
  ctx.beginPath(); ctx.ellipse(x, y, 95 * s, 62 * s, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 1; i <= 8; i++) {
    const ang = -Math.PI / 2 + ((i - 1) / 8) * Math.PI * 2;
    const lx = x + Math.cos(ang) * 62 * s;
    const ly = y + Math.sin(ang) * 42 * s;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(lx, ly, 9 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3d3530';
    ctx.font = `700 ${Math.max(8, 10 * s)}px Inter,sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(String(i), lx, ly + 3 * s);
  }
  const cards = ['🂡', '🂱', '🃁', '🃑'];
  cards.forEach((c, i) => {
    ctx.font = `${14 * s}px sans-serif`;
    ctx.fillText(c, x - 24 * s + i * 16 * s, y + Math.sin(t * 2 + i) * 2 * s);
  });
  ctx.fillStyle = 'rgba(212,175,55,0.85)';
  ctx.font = `600 ${Math.max(9, 11 * s)}px Inter,sans-serif`;
  ctx.fillText('TEXAS HOLD\'EM', x, y + 4 * s);
}

function drawNpcClothing2d(ctx: CanvasRenderingContext2D, py: number, role: NpcRole) {
  const o = outfitForRole(role);
  if (o.vestColor) {
    ctx.fillStyle = o.vestColor;
    ctx.beginPath(); ctx.ellipse(0, py + 8, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (o.apronColor) {
    ctx.fillStyle = o.apronColor;
    ctx.beginPath();
    ctx.moveTo(-10, py + 4); ctx.lineTo(10, py + 4);
    ctx.lineTo(8, py + 16); ctx.lineTo(-8, py + 16);
    ctx.closePath(); ctx.fill();
  }
  if (o.badgeColor) {
    ctx.fillStyle = o.badgeColor;
    ctx.beginPath(); ctx.arc(0, py + 6, 3, 0, Math.PI * 2); ctx.fill();
  }
  if (o.bowtie) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(-3, py + 2, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3, py + 2, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (o.prop === 'cards') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10, py + 4, 8, 10);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.5; ctx.strokeRect(10, py + 4, 8, 10);
  }
  if (o.prop === 'tray') {
    ctx.fillStyle = '#d4c8b8';
    ctx.beginPath(); ctx.ellipse(12, py + 8, 7, 3, 0.3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawNpcHat2d(ctx: CanvasRenderingContext2D, py: number, role: NpcRole) {
  const o = outfitForRole(role);
  ctx.fillStyle = o.hatColor;
  switch (o.hat) {
    case 'concierge':
      ctx.fillRect(-8, py - 18, 16, 5);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-5, py - 22, 10, 4);
      break;
    case 'chef':
      ctx.beginPath(); ctx.ellipse(0, py - 20, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, py - 26, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'headband':
      ctx.fillRect(-10, py - 16, 20, 4);
      break;
    case 'dealer':
      ctx.beginPath(); ctx.ellipse(0, py - 20, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-7, py - 26, 14, 6);
      break;
  }
}

export function drawNpc(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  opts: { npcRole: NpcRole; color: string; name: string; wave: number },
) {
  const bob = Math.sin(opts.wave * 3) * 2;
  const py = y + bob;
  dropShadow(ctx, x, py + 6, 34, 38, 0.12);
  ctx.save(); ctx.translate(x, 0);
  drawPenguinBody(ctx, py);
  drawPenguinScarf(ctx, 0, py + 1, 22, 7);
  drawPenguinScarf(ctx, -10, py + 6, 6, 9, true);
  drawNpcClothing2d(ctx, py, opts.npcRole);
  drawPenguinFace(ctx, py - 2);
  drawNpcHat2d(ctx, py, opts.npcRole);
  ctx.restore();
  ctx.fillStyle = '#3d3530';
  ctx.font = '600 10px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(opts.name.split(' ')[0], x, py - 22);
}

export function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, s: number) {
  const maxW = 140 * s;
  ctx.font = `600 ${Math.max(9, 10 * s)}px Inter,sans-serif`;
  const tw = Math.min(maxW, ctx.measureText(text).width + 16 * s);
  const th = 28 * s;
  ctx.fillStyle = 'rgba(255,252,247,0.96)';
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1;
  rrect(ctx, x - tw / 2, y - th - 8 * s, tw, th, 8 * s); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6 * s, y - 8 * s); ctx.lineTo(x, y); ctx.lineTo(x + 6 * s, y - 8 * s);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3d3530'; ctx.textAlign = 'center';
  ctx.fillText(text.length > 18 ? text.slice(0, 17) + '…' : text, x, y - th + 6 * s);
}

/* ─── Casino VIP lounge decor ─── */

const VIP = {
  gold: '#d4af37',
  goldDim: '#8b6914',
  walnut: '#2a2220',
  walnutLight: '#3d322c',
  burgundy: '#5c2438',
  velvet: '#4a1e32',
  velvetDeep: '#321428',
  rugBase: '#5a2838',
  rugPattern: '#c9a227',
  lampGlow: 'rgba(255,196,120,0.35)',
  cream: '#f5efe6',
};

function drawOvalRug(
  ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, s: number,
) {
  dropShadow(ctx, x, y + 4 * s, rx * 2 * s, ry * 2 * s, 0.12);
  ctx.fillStyle = VIP.rugBase;
  ctx.beginPath(); ctx.ellipse(x, y, rx * s, ry * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = VIP.goldDim; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.ellipse(x, y, rx * s, ry * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = VIP.rugPattern; ctx.lineWidth = 1 * s;
  for (let ring = 0.75; ring > 0.2; ring -= 0.18) {
    ctx.beginPath(); ctx.ellipse(x, y, rx * ring * s, ry * ring * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = VIP.gold;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rx * 0.82 * s, y + Math.sin(a) * ry * 0.82 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRunnerRug(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], s: number) {
  ctx.strokeStyle = VIP.rugBase;
  ctx.lineWidth = 28 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.stroke();
  ctx.strokeStyle = VIP.goldDim;
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  ctx.strokeStyle = VIP.rugPattern;
  ctx.lineWidth = 1 * s;
  ctx.setLineDash([6 * s, 8 * s]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawCasinoVipBackdrop(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number; scale: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  dayMode: 'day' | 'night',
) {
  const w = cam.cw, h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.65);
  if (dayMode === 'night') {
    grd.addColorStop(0, '#3d322c');
    grd.addColorStop(1, '#1a1412');
  } else {
    grd.addColorStop(0, '#3d322c');
    grd.addColorStop(1, '#221a18');
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  // 墙面与 VIP 隔断
  const wallTop = toScreen(360, 40);
  ctx.fillStyle = VIP.velvetDeep;
  rrect(ctx, wallTop.x - ws(340), wallTop.y - ws(8), ws(680), ws(90), ws(4)); ctx.fill();
  ctx.strokeStyle = VIP.gold; ctx.lineWidth = ws(2);
  ctx.beginPath();
  ctx.moveTo(wallTop.x - ws(320), wallTop.y + ws(78));
  ctx.lineTo(wallTop.x + ws(320), wallTop.y + ws(78));
  ctx.stroke();

  // VIP 招牌
  ctx.fillStyle = VIP.gold;
  ctx.font = `700 ${Math.max(11, ws(14))}px Georgia,serif`;
  ctx.textAlign = 'center';
  ctx.fillText('◆  VIP 德州厅  ◆', wallTop.x, wallTop.y + ws(42));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(245,239,230,0.55)';
  ctx.fillText('PRIVATE POKER LOUNGE', wallTop.x, wallTop.y + ws(58));

  // 侧墙窗帘
  [[90, 320], [630, 320]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    ctx.fillStyle = VIP.velvet;
    rrect(ctx, p.x - ws(18), p.y - ws(120), ws(36), ws(240), ws(4)); ctx.fill();
    ctx.strokeStyle = VIP.goldDim; ctx.lineWidth = ws(1);
    for (let i = 0; i < 5; i++) {
      const ly = p.y - ws(100) + i * ws(48);
      ctx.beginPath(); ctx.moveTo(p.x - ws(14), ly); ctx.lineTo(p.x + ws(14), ly); ctx.stroke();
    }
  });
}

export function drawCasinoVipDecor(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  s: number,
  t: number,
) {
  // 入口红毯
  const runner = [
    toScreen(22, 320), toScreen(120, 300), toScreen(220, 260),
    toScreen(320, 220), toScreen(360, 200),
  ];
  drawRunnerRug(ctx, runner, s);

  // 主牌桌地毯
  const rug = toScreen(360, 340);
  drawOvalRug(ctx, rug.x, rug.y, 210, 155, s);

  // 角落 VIP 沙发区
  [
    { px: 118, py: 530, flip: false },
    { px: 602, py: 530, flip: true },
    { px: 118, py: 155, flip: false },
    { px: 602, py: 155, flip: true },
  ].forEach(({ px, py, flip }) => {
    const p = toScreen(px, py);
    drawVipSofa(ctx, p.x, p.y, s, flip);
    const tbl = toScreen(px + (flip ? -55 : 55), py + 20);
    drawSideTable(ctx, tbl.x, tbl.y, s);
    drawChipStack(ctx, tbl.x, tbl.y - ws(14), s);
  });

  // 荷官两侧落地灯 + 绿植
  [
    { px: 255, py: 145, kind: 'lamp' as const },
    { px: 465, py: 145, kind: 'lamp' as const },
    { px: 75, py: 420, kind: 'plant' as const },
    { px: 645, py: 420, kind: 'plant' as const },
  ].forEach(({ px, py, kind }) => {
    const p = toScreen(px, py);
    if (kind === 'lamp') drawFloorLamp(ctx, p.x, p.y, s, t);
    else drawDecorPlant(ctx, p.x, p.y, s);
  });

  // 吊灯
  const ch = toScreen(360, 195);
  drawChandelier(ctx, ch.x, ch.y, s, t);

  // 吧台摆件（筹码柜）
  const bar = toScreen(360, 580);
  drawChipCabinet(ctx, bar.x, bar.y, s);
}

export function drawVipSofa(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false) {
  dropShadow(ctx, x, y, 130 * s, 70 * s, 0.14);
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = VIP.burgundy;
  rrect(ctx, -58 * s, -22 * s, 116 * s, 44 * s, 10 * s); ctx.fill();
  ctx.fillStyle = VIP.velvetDeep;
  rrect(ctx, -62 * s, -30 * s, 28 * s, 58 * s, 8 * s); ctx.fill();
  rrect(ctx, 34 * s, -30 * s, 28 * s, 58 * s, 8 * s); ctx.fill();
  ctx.fillStyle = VIP.gold;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.arc(i * 22 * s, -18 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = VIP.cream;
  ctx.beginPath(); ctx.ellipse(0, 6 * s, 20 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawSideTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y + 2 * s, 36 * s, 28 * s, 0.1);
  ctx.fillStyle = VIP.walnutLight;
  ctx.beginPath(); ctx.ellipse(x, y, 18 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = VIP.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.fillStyle = VIP.walnut;
  ctx.fillRect(x - 2 * s, y, 4 * s, 14 * s);
}

export function drawChipStack(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const colors = ['#d4af37', '#c0392b', '#2d5a3d', '#1a1a1a'];
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(x, y - i * 3 * s, 8 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
  });
}

export function drawFloorLamp(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  const glow = 0.85 + Math.sin(t * 3) * 0.15;
  ctx.fillStyle = `rgba(255,190,100,${0.12 * glow})`;
  ctx.beginPath(); ctx.ellipse(x, y + 20 * s, 45 * s, 35 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = VIP.walnutLight;
  ctx.fillRect(x - 2 * s, y, 4 * s, 38 * s);
  ctx.fillStyle = VIP.gold;
  ctx.beginPath();
  ctx.moveTo(x - 14 * s, y - 2 * s);
  ctx.lineTo(x + 14 * s, y - 2 * s);
  ctx.lineTo(x + 10 * s, y - 18 * s);
  ctx.lineTo(x - 10 * s, y - 18 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,220,160,${0.9 * glow})`;
  ctx.beginPath(); ctx.ellipse(x, y - 20 * s, 8 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawDecorPlant(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y + 8 * s, 28 * s, 20 * s, 0.08);
  ctx.fillStyle = '#6b4423';
  ctx.beginPath();
  ctx.moveTo(x - 12 * s, y + 10 * s);
  ctx.lineTo(x + 12 * s, y + 10 * s);
  ctx.lineTo(x + 10 * s, y + 28 * s);
  ctx.lineTo(x - 10 * s, y + 28 * s);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = VIP.goldDim; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#2d6a3e';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.45;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * 16 * s, y - 8 * s + Math.sin(a) * 10 * s, 14 * s, 8 * s, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#3d8a50';
  ctx.beginPath(); ctx.ellipse(x, y - 18 * s, 10 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawChandelier(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  ctx.strokeStyle = VIP.gold; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.moveTo(x, y - 30 * s); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = VIP.gold;
  ctx.beginPath(); ctx.ellipse(x, y - 32 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = -2; i <= 2; i++) {
    const cx = x + i * 14 * s;
    const spark = 0.6 + Math.sin(t * 4 + i) * 0.4;
    ctx.fillStyle = `rgba(255,230,160,${spark})`;
    ctx.beginPath(); ctx.arc(cx, y + 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = VIP.gold; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + 4 * s); ctx.stroke();
  }
}

export function drawChipCabinet(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y, 100 * s, 40 * s, 0.1);
  ctx.fillStyle = VIP.walnutLight;
  rrect(ctx, x - 50 * s, y - 18 * s, 100 * s, 36 * s, 6 * s); ctx.fill();
  ctx.strokeStyle = VIP.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    drawChipStack(ctx, x + i * 18 * s, y - 6 * s, s * 0.85);
  }
  ctx.fillStyle = VIP.cream;
  ctx.font = `600 ${Math.max(7, 8 * s)}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('筹码柜', x, y + 14 * s);
}

export function drawVipChair(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, facing: 'n' | 's' | 'e' | 'w' = 's') {
  dropShadow(ctx, x, y + 4 * s, 26 * s, 22 * s, 0.1);
  ctx.fillStyle = VIP.velvetDeep;
  rrect(ctx, x - 11 * s, y - 5 * s, 22 * s, 15 * s, 4 * s); ctx.fill();
  ctx.strokeStyle = VIP.goldDim; ctx.lineWidth = 0.8 * s; ctx.stroke();
  const back = facing === 'n' ? -9 : facing === 's' ? 9 : 0;
  ctx.fillStyle = VIP.burgundy;
  rrect(ctx, x - 11 * s, y + back * s - 5 * s, 22 * s, 7 * s, 3 * s); ctx.fill();
  ctx.fillStyle = VIP.gold;
  ctx.beginPath(); ctx.arc(x, y + back * s - 2 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
}

export function drawCasinoAmbientLights(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
) {
  const table = toScreen(360, 330);
  const grd = ctx.createRadialGradient(table.x, table.y, 0, table.x, table.y, ws(280));
  grd.addColorStop(0, 'rgba(255,200,120,0.18)');
  grd.addColorStop(0.5, 'rgba(212,175,55,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, cam.cw, cam.ch);
}

/* ─── Spa zen lounge decor ─── */

const SPA = {
  lavender: '#9b87c4',
  lavenderDeep: '#6b5b8a',
  sage: '#5a8a6a',
  sageDeep: '#3d6a52',
  bamboo: '#c4a574',
  bambooDark: '#8b7355',
  cream: '#f8f4ef',
  stone: '#d8d0c8',
  teal: '#6aabb8',
  glow: 'rgba(180,150,220,0.28)',
};

function drawBambooScreen(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, h: number, flip = false,
) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  dropShadow(ctx, 0, h * 0.35 * s, 36 * s, h * s, 0.08);
  ctx.fillStyle = SPA.bambooDark;
  rrect(ctx, -16 * s, -h * 0.45 * s, 32 * s, h * s, 4 * s); ctx.fill();
  ctx.strokeStyle = SPA.bamboo; ctx.lineWidth = 1.2 * s;
  for (let i = 0; i < 7; i++) {
    const ly = -h * 0.38 * s + i * (h * 0.11 * s);
    ctx.beginPath(); ctx.moveTo(-12 * s, ly); ctx.lineTo(12 * s, ly); ctx.stroke();
  }
  ctx.strokeStyle = SPA.sageDeep; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(-14 * s, -h * 0.45 * s); ctx.lineTo(-14 * s, h * 0.55 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14 * s, -h * 0.45 * s); ctx.lineTo(14 * s, h * 0.55 * s); ctx.stroke();
  ctx.restore();
}

function drawSpaCandle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  const flicker = 0.7 + Math.sin(t * 5 + x * 0.01) * 0.3;
  ctx.fillStyle = `rgba(200,170,255,${0.14 * flicker})`;
  ctx.beginPath(); ctx.ellipse(x, y - 8 * s, 18 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SPA.cream;
  rrect(ctx, x - 4 * s, y - 2 * s, 8 * s, 14 * s, 2 * s); ctx.fill();
  ctx.fillStyle = `rgba(255,220,180,${0.95 * flicker})`;
  ctx.beginPath(); ctx.ellipse(x, y - 6 * s, 3 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
}

function drawTowelRack(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y, 50 * s, 36 * s, 0.08);
  ctx.strokeStyle = SPA.bambooDark; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(x - 22 * s, y); ctx.lineTo(x + 22 * s, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 18 * s, y); ctx.lineTo(x - 18 * s, y + 22 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 18 * s, y); ctx.lineTo(x + 18 * s, y + 22 * s); ctx.stroke();
  const colors = ['#f5f0ea', '#e8e0f0', '#eef5f0'];
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    rrect(ctx, x - 16 * s + i * 14 * s, y - 10 * s, 12 * s, 18 * s, 2 * s); ctx.fill();
  });
}

function drawAromaDiffuser(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  dropShadow(ctx, x, y, 24 * s, 20 * s, 0.06);
  ctx.fillStyle = SPA.stone;
  ctx.beginPath(); ctx.ellipse(x, y + 4 * s, 10 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SPA.teal;
  ctx.beginPath(); ctx.ellipse(x, y, 8 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  const drift = Math.sin(t * 2) * 4 * s;
  ctx.strokeStyle = `rgba(155,135,196,${0.35 + Math.sin(t * 3) * 0.15})`;
  ctx.lineWidth = 1.5 * s;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + drift, y - 8 * s);
    ctx.quadraticCurveTo(x + 6 * s + i * 3 * s, y - 18 * s - i * 6 * s, x + 12 * s, y - 28 * s - i * 8 * s);
    ctx.stroke();
  }
}

function drawZenPlant(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y + 6 * s, 30 * s, 18 * s, 0.07);
  ctx.fillStyle = SPA.stone;
  ctx.beginPath();
  ctx.moveTo(x - 14 * s, y + 8 * s);
  ctx.lineTo(x + 14 * s, y + 8 * s);
  ctx.lineTo(x + 10 * s, y + 22 * s);
  ctx.lineTo(x - 10 * s, y + 22 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = SPA.sage;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(x + i * 10 * s, y - 4 * s, 12 * s, 6 * s, i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = SPA.sageDeep;
  ctx.beginPath(); ctx.ellipse(x, y - 14 * s, 6 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
}

function drawSpaFloorMat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number) {
  dropShadow(ctx, x, y, w * s, h * s, 0.06);
  ctx.fillStyle = '#e8e0d4';
  rrect(ctx, x - (w / 2) * s, y - (h / 2) * s, w * s, h * s, 6 * s); ctx.fill();
  ctx.strokeStyle = SPA.bamboo; ctx.lineWidth = 1 * s;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(155,135,196,0.25)'; ctx.lineWidth = 0.8 * s;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x - (w / 2 - 8) * s, y + i * 10 * s);
    ctx.lineTo(x + (w / 2 - 8) * s, y + i * 10 * s);
    ctx.stroke();
  }
}

export function drawSpaZenBackdrop(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number; scale: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  dayMode: 'day' | 'night',
) {
  const w = cam.cw, h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.7);
  if (dayMode === 'night') {
    grd.addColorStop(0, '#3a3548');
    grd.addColorStop(1, '#252030');
  } else {
    grd.addColorStop(0, '#ebe8f2');
    grd.addColorStop(1, '#ddd6e8');
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const header = toScreen(310, 42);
  ctx.fillStyle = dayMode === 'night' ? '#2a2438' : '#f0ebe6';
  rrect(ctx, header.x - ws(280), header.y - ws(6), ws(560), ws(72), ws(6)); ctx.fill();
  ctx.strokeStyle = SPA.lavender; ctx.lineWidth = ws(1.5);
  ctx.beginPath();
  ctx.moveTo(header.x - ws(250), header.y + ws(58));
  ctx.lineTo(header.x + ws(250), header.y + ws(58));
  ctx.stroke();

  ctx.fillStyle = SPA.lavenderDeep;
  ctx.font = `700 ${Math.max(11, ws(14))}px Georgia,serif`;
  ctx.textAlign = 'center';
  ctx.fillText('☯  禅意理疗馆  ☯', header.x, header.y + ws(32));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(107,91,138,0.65)';
  ctx.fillText('ZEN SPA & WELLNESS LOUNGE', header.x, header.y + ws(48));

  [[55, 300, false], [565, 300, true]].forEach(([px, py, flip]) => {
    const p = toScreen(px, py);
    drawBambooScreen(ctx, p.x, p.y, cam.scale, 2.2, flip);
  });
}

export function drawSpaVipDecor(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  s: number,
  t: number,
) {
  // 中央走道地垫
  [
    { px: 310, py: 340, w: 340, h: 48 },
    { px: 310, py: 200, w: 280, h: 36 },
  ].forEach(({ px, py, w, h }) => {
    const p = toScreen(px, py);
    drawSpaFloorMat(ctx, p.x, p.y, w, h, s);
  });

  // 每排床位下方小地毯
  [
    { px: 130, py: 300 }, { px: 310, py: 300 }, { px: 490, py: 300 },
    { px: 130, py: 460 }, { px: 310, py: 460 }, { px: 490, py: 460 },
  ].forEach(({ px, py }) => {
    const p = toScreen(px, py);
    ctx.fillStyle = 'rgba(155,135,196,0.12)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, ws(58), ws(38), 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(155,135,196,0.28)'; ctx.lineWidth = 1 * s;
    ctx.stroke();
  });

  // 角落装饰
  [
    { px: 72, py: 175, kind: 'plant' as const },
    { px: 548, py: 175, kind: 'plant' as const },
    { px: 72, py: 520, kind: 'candle' as const },
    { px: 548, py: 520, kind: 'candle' as const },
    { px: 310, py: 155, kind: 'diffuser' as const },
    { px: 95, py: 380, kind: 'towel' as const },
    { px: 525, py: 380, kind: 'towel' as const },
  ].forEach(({ px, py, kind }) => {
    const p = toScreen(px, py);
    if (kind === 'plant') drawZenPlant(ctx, p.x, p.y, s);
    else if (kind === 'candle') drawSpaCandle(ctx, p.x, p.y, s, t);
    else if (kind === 'diffuser') drawAromaDiffuser(ctx, p.x, p.y, s, t);
    else drawTowelRack(ctx, p.x, p.y, s);
  });

  // 侧墙柔光条
  [[40, 340], [580, 340]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    const lg = ctx.createLinearGradient(p.x, p.y - ws(100), p.x, p.y + ws(100));
    lg.addColorStop(0, 'rgba(155,135,196,0)');
    lg.addColorStop(0.5, 'rgba(155,135,196,0.18)');
    lg.addColorStop(1, 'rgba(155,135,196,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(p.x - ws(8), p.y - ws(110), ws(16), ws(220));
  });
}

export function drawSpaAmbientLights(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
) {
  const center = toScreen(310, 340);
  const grd = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, ws(320));
  grd.addColorStop(0, 'rgba(180,160,220,0.16)');
  grd.addColorStop(0.45, 'rgba(106,171,184,0.08)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, cam.cw, cam.ch);

  [[130, 260], [490, 420]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    const spot = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, ws(90));
    spot.addColorStop(0, 'rgba(200,180,240,0.12)');
    spot.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spot;
    ctx.beginPath(); ctx.arc(p.x, p.y, ws(90), 0, Math.PI * 2); ctx.fill();
  });
}

export function drawSpaMassageBed(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, hover = false,
) {
  const sprite = getMassageBedSprite();
  if (sprite) {
    const w = 118 * s;
    const h = w * (sprite.naturalHeight / sprite.naturalWidth);
    if (hover) {
      ctx.strokeStyle = 'rgba(155,135,196,0.75)'; ctx.lineWidth = 2.5 * s;
      rrect(ctx, x - w / 2 - 4 * s, y - h / 2 - 4 * s, w + 8 * s, h + 8 * s, 8 * s);
      ctx.stroke();
    }
    dropShadow(ctx, x, y, w, h * 0.85, 0.1);
    ctx.drawImage(sprite, x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = SPA.lavender;
    ctx.beginPath(); ctx.ellipse(x, y - h * 0.38, 6 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }

  dropShadow(ctx, x, y, 100 * s, 44 * s, 0.1);
  if (hover) {
    ctx.strokeStyle = 'rgba(155,135,196,0.75)'; ctx.lineWidth = 2 * s;
    rrect(ctx, x - 52 * s, y - 18 * s, 104 * s, 36 * s, 8 * s); ctx.stroke();
  }
  ctx.fillStyle = SPA.bambooDark;
  rrect(ctx, x - 48 * s, y - 14 * s, 96 * s, 28 * s, 6 * s); ctx.fill();
  ctx.fillStyle = SPA.cream;
  rrect(ctx, x - 44 * s, y - 11 * s, 88 * s, 22 * s, 5 * s); ctx.fill();
  ctx.fillStyle = '#fff';
  rrect(ctx, x - 38 * s, y - 8 * s, 76 * s, 16 * s, 4 * s); ctx.fill();
  ctx.fillStyle = SPA.lavender;
  rrect(ctx, x - 10 * s, y - 16 * s, 20 * s, 8 * s, 3 * s); ctx.fill();
}
