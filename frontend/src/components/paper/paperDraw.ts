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

/** 角色统一入口 — 根据朝向渲染正/背/侧面；就座时绘制坐姿 */
export function drawAgent(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; trading?: boolean; walking?: boolean; t?: number;
    activity?: AgentActivity; facing?: AgentFacing; sitting?: boolean;
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
) {
  const act = opts.activity;
  if (act === 'massage') {
    drawAgentTop(ctx, x, y, color, { ...opts, facing: 's' });
    return;
  }
  if (opts.sitting || act === 'dine' || act === 'poker' || act === 'rest') {
    drawAgentSitting(ctx, x, y, color, opts);
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
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
) {
  const t = opts.t ?? 0;
  const py = y - 4;
  const hw = agentHw(opts);
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 20, 18, 0, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 8, 30, 24, 0.1);
  ctx.save(); ctx.translate(x, 0);
  drawPenguinBody(ctx, py - 2);
  if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, py - 2, color, 'front');
  drawPenguinFace(ctx, py - 2);
  if (hw.headwear === 'hat') drawAgentHat2d(ctx, py - 2, hw.hatStyle, color, 'front');
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

/** 咖啡休息区 — vertical 竖向贴边 */
export function drawCoffeeZone(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number,
  vertical = true,
) {
  const cw = (vertical ? 52 : 130) * s;
  const ch = (vertical ? 118 : 52) * s;
  dropShadow(ctx, x, y, cw, ch, 0.09);
  ctx.fillStyle = '#f5f0e8';
  rrect(ctx, x - cw / 2, y - ch / 2, cw, ch, 10 * s); ctx.fill();
  ctx.strokeStyle = '#ddd4c8'; ctx.lineWidth = 1; ctx.stroke();

  if (vertical) {
    ctx.fillStyle = '#4a4a4a';
    rrect(ctx, x - 14 * s, y - ch / 2 + 10 * s, 28 * s, 32 * s, 4 * s); ctx.fill();
    ctx.fillStyle = '#666';
    rrect(ctx, x - 10 * s, y - ch / 2 + 14 * s, 20 * s, 8 * s, 2 * s); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const cy = y - ch / 2 + 52 * s + i * 16 * s;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(x, cy + 4 * s, 6 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8B6914';
      ctx.beginPath(); ctx.ellipse(x, cy + 2 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = 'rgba(180,180,180,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, cy - 4 * s);
        ctx.quadraticCurveTo(x + 3 * s, cy - 10 * s - Math.sin(t * 3) * 2, x - 2 * s, cy - 12 * s);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#6b8e4e';
    ctx.beginPath(); ctx.ellipse(x, y + ch / 2 - 14 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
    drawFacilityLabel(ctx, x + cw / 2 + 18 * s, y, '☕ 咖啡区', s);
  } else {
    ctx.fillStyle = '#4a4a4a';
    rrect(ctx, x - cw / 2 + 8 * s, y - 16 * s, 28 * s, 32 * s, 4 * s); ctx.fill();
    ctx.fillStyle = '#666';
    rrect(ctx, x - cw / 2 + 12 * s, y - 12 * s, 20 * s, 8 * s, 2 * s); ctx.fill();
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

  dropShadow(ctx, x, y, 240 * s, 180 * s, 0.1);
  ctx.fillStyle = '#2d5a3d';
  ctx.beginPath(); ctx.ellipse(x, y, 110 * s, 75 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8b6914'; ctx.lineWidth = 3 * s; ctx.stroke();
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
