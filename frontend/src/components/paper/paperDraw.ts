/** Canvas 2D 剪纸绘制工具 — 对齐灵犀 144 office-engine.js */

import { PAPER } from '../../lib/zoneProjection';
import { casinoSeatSlotAngle, CASINO_PLAYER_SEATS } from '../../lib/zoneFurniture';
import { outfitForRole, type NpcRole } from '../../lib/npcOutfits';
import { DEFAULT_SCARF, scarfColorsFromAccent, type ScarfPalette } from '../../lib/scarfColors';
import {
  drawAgentHat2d, drawAgentScarf2d,
  type AgentHeadwear, type HatStyleId,
} from '../../lib/agentAppearance';
import {
  cantonesePalette, hallRestPalette, spaPalette, vipPalette, receptionPalette,
  type CantonesePalette, type SpaPalette, type VipPalette, type ReceptionPalette,
} from '../../lib/zoneSkins';

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
  opts: { active?: boolean; chartSeed?: number; t?: number; skinKey?: string } = {},
) {
  const monitorActive = opts.active ?? false;
  const t = opts.t ?? 0;
  const seed = opts.chartSeed ?? 1;
  const premium = opts.skinKey === 'gold';
  const dw = 82 * s, dh = 50 * s, r = 6 * s, side = 4 * s;
  const woodTop = premium ? '#c9a86c' : '#e8e0d4';
  const woodSide = premium ? '#8b6914' : '#c8baa8';
  const woodLeg = premium ? '#6b5010' : '#a89888';

  dropShadow(ctx, x, y + side / 2, dw + 8 * s, dh + 8 * s, 0.1);
  // 桌腿
  ctx.fillStyle = woodLeg;
  rrect(ctx, x - dw / 2 + 6 * s, y + dh / 2 - 2 * s, 8 * s, 14 * s, 2 * s); ctx.fill();
  rrect(ctx, x + dw / 2 - 14 * s, y + dh / 2 - 2 * s, 8 * s, 14 * s, 2 * s); ctx.fill();
  // 侧板
  ctx.fillStyle = woodSide;
  ctx.beginPath();
  ctx.moveTo(x + dw / 2, y - dh / 2);
  ctx.lineTo(x + dw / 2, y + dh / 2);
  ctx.lineTo(x + dw / 2, y + dh / 2 + side);
  ctx.lineTo(x - dw / 2, y + dh / 2 + side);
  ctx.lineTo(x - dw / 2, y + dh / 2);
  ctx.closePath(); ctx.fill();
  // 桌面
  ctx.fillStyle = woodTop;
  rrect(ctx, x - dw / 2, y - dh / 2, dw, dh, r); ctx.fill();
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.45)' : '#ddd4c8';
  ctx.lineWidth = premium ? 1.2 * s : 1; ctx.stroke();
  // 键盘
  ctx.fillStyle = '#3a3a3a';
  rrect(ctx, x - 18 * s, y + 4 * s, 36 * s, 10 * s, 2 * s); ctx.fill();
  ctx.fillStyle = '#555';
  for (let i = 0; i < 5; i++) {
    rrect(ctx, x - 14 * s + i * 6 * s, y + 6 * s, 4 * s, 3 * s, 1 * s); ctx.fill();
  }
  // 咖啡杯
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(x + 24 * s, y + 2 * s, 5 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8B6914';
  ctx.beginPath(); ctx.ellipse(x + 24 * s, y + 1 * s, 3.5 * s, 2.5 * s, 0, 0, Math.PI * 2); ctx.fill();

  const mw = 36 * s, mh = 22 * s;
  const mx = x - mw / 2, my = y - dh / 2 - mh - 4 * s;
  ctx.fillStyle = premium ? '#1a1408' : '#2a2a2a';
  rrect(ctx, mx, my, mw, mh, 4 * s); ctx.fill();
  ctx.fillStyle = monitorActive ? '#0a1520' : '#141820';
  rrect(ctx, mx + 2 * s, my + 2 * s, mw - 4 * s, mh - 4 * s, 3 * s); ctx.fill();
  drawMiniChart(ctx, mx + 3 * s, my + 3 * s, mw - 6 * s, mh - 6 * s, seed, t, monitorActive);
  // 副屏
  if (premium) {
    const sw = 18 * s, sh = 14 * s;
    ctx.fillStyle = '#1a1408';
    rrect(ctx, mx + mw + 4 * s, my + 4 * s, sw, sh, 2 * s); ctx.fill();
    ctx.fillStyle = monitorActive ? '#0a1520' : '#141820';
    rrect(ctx, mx + mw + 5 * s, my + 5 * s, sw - 2 * s, sh - 2 * s, 2 * s); ctx.fill();
  }
  // 显示器支架
  ctx.fillStyle = '#444';
  rrect(ctx, x - 4 * s, y - dh / 2 - 3 * s, 8 * s, 4 * s, 1 * s); ctx.fill();
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
    blanket?: boolean;
  },
) {
  const act = opts.activity;
  const pose = opts.pose ?? (act === 'massage' ? 'lie' : (opts.sitting || act === 'dine' || act === 'poker' || act === 'rest') ? 'sit' : 'stand');
  if (pose === 'lie') {
    drawAgentTop(ctx, x, y, color, { ...opts, facing: 's', activity: act ?? 'massage', blanket: opts.blanket });
    return;
  }
  if (act === 'rest' && (pose === 'sit' || !opts.pose)) {
    drawAgentResting(ctx, x, y, color, opts);
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
    drawPenguinBody(ctx, py - 4, false, false);
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

/** 休息包厢 — 侧向倚靠沙发，带呼吸与打盹动效 */
function drawAgentResting(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; t?: number; facing?: AgentFacing;
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
  },
) {
  const t = opts.t ?? 0;
  const facing = opts.facing === 'w' ? 'w' : 'e';
  const flip = facing === 'w' ? -1 : 1;
  const breathe = Math.sin(t * 1.5) * 1.8;
  const nod = Math.sin(t * 0.9) * 0.04;
  const py = y + breathe;

  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 24, 20, 0, 0, Math.PI * 2); ctx.stroke();
  }

  dropShadow(ctx, x, py + 8, 46, 18, 0.1);
  ctx.fillStyle = 'rgba(200,188,168,0.45)';
  rrect(ctx, x - 28, py + 2, 56, 14, 5); ctx.fill();

  ctx.save();
  ctx.translate(x, py);
  ctx.scale(flip, 1);
  ctx.rotate(-0.18 + nod);

  ctx.fillStyle = PENGUIN.foot;
  ctx.beginPath(); ctx.ellipse(10, 14, 7, 3.5, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(18, 12, 6, 3, 0.1, 0, Math.PI * 2); ctx.fill();

  drawPenguinBody(ctx, -2, true);
  const hw = agentHw(opts);
  if (hw.headwear === 'scarf') drawAgentScarf2d(ctx, -2, color, 'side', 1);
  drawPenguinFace(ctx, -2, true, 1);
  if (hw.headwear === 'hat') drawAgentHat2d(ctx, -4, hw.hatStyle, color, 'side', 1);

  ctx.restore();

  const zzzPhase = (t * 0.8) % 3;
  ctx.font = `${Math.max(9, 11)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(107,91,138,0.85)';
  if (zzzPhase > 0.2) ctx.fillText('z', x + 16 + Math.sin(t * 2) * 2, py - 20);
  if (zzzPhase > 1.0) ctx.fillText('z', x + 22 + Math.sin(t * 2 + 1) * 2, py - 28);
  if (zzzPhase > 1.8) ctx.fillText('Z', x + 28 + Math.sin(t * 2 + 2) * 2, py - 36);

  drawActivityBadge(ctx, x, py, 'rest', t);
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

function drawPenguinBody(ctx: CanvasRenderingContext2D, py: number, profile = false, showBelly = true) {
  ctx.fillStyle = PENGUIN.black;
  ctx.beginPath(); ctx.ellipse(profile ? 2 : 0, py + 2, profile ? 12 : 15, profile ? 17 : 19, 0, 0, Math.PI * 2); ctx.fill();
  if (showBelly) {
    ctx.fillStyle = PENGUIN.belly;
    ctx.beginPath(); ctx.ellipse(profile ? 4 : 0, py + 7, profile ? 7 : 10, profile ? 9 : 11, 0, 0, Math.PI * 2); ctx.fill();
  }
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
  drawPenguinBody(ctx, py, false, false);
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

/** 俯视（按摩躺卧） */
export function drawAgentTop(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; walking?: boolean; t?: number;
    activity?: AgentActivity; facing?: AgentFacing;
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
    blanket?: boolean;
  },
) {
  const t = opts.t ?? 0;
  const hw = agentHw(opts);
  const breathe = Math.sin(t * 1.8) * 0.8;
  const py = y + breathe;
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 30, 18, 0, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 2, 52, 22, 0.1);
  ctx.save();
  ctx.translate(x, py);
  ctx.rotate(-0.08);
  if (opts.blanket) {
    ctx.fillStyle = 'rgba(210,195,235,0.92)';
    rrect(ctx, -26, -9, 52, 18, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(155,135,196,0.45)'; ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = PENGUIN.black;
  ctx.beginPath(); ctx.ellipse(0, 0, 24, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN.belly;
  ctx.beginPath(); ctx.ellipse(2, 2, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN.black;
  ctx.beginPath(); ctx.ellipse(-18, -2, 9, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN.white;
  ctx.beginPath(); ctx.ellipse(-19, -3, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN.beak;
  ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-28, 2); ctx.lineTo(-24, 4); ctx.closePath(); ctx.fill();
  if (hw.headwear === 'scarf') {
    drawPenguinScarf(ctx, -14, -4, 12, 4, false, scarfColorsFromAccent(color));
  } else if (hw.headwear === 'hat') {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(-18, -6, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  if (opts.activity === 'massage') {
    ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('✨', x + 20, py - 12 + Math.sin(t * 5) * 2);
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
export function drawCoffeeZone(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, skinKey = 'default') {
  const premium = skinKey === 'gold';
  const cw = 130 * s, ch = 52 * s;
  dropShadow(ctx, x, y, cw + 10 * s, ch + 10 * s, 0.1);
  // 吧台
  ctx.fillStyle = premium ? '#8b6914' : '#c8baa8';
  rrect(ctx, x - cw / 2, y - ch / 2, cw, ch, 10 * s); ctx.fill();
  ctx.fillStyle = premium ? '#f8f0e0' : '#f5f0e8';
  rrect(ctx, x - cw / 2 + 3 * s, y - ch / 2 + 3 * s, cw - 6 * s, ch - 6 * s, 8 * s); ctx.fill();
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.5)' : '#ddd4c8'; ctx.lineWidth = 1; ctx.stroke();
  // 咖啡机
  ctx.fillStyle = premium ? '#2a2218' : '#4a4a4a';
  rrect(ctx, x - cw / 2 + 8 * s, y - 16 * s, 28 * s, 32 * s, 4 * s); ctx.fill();
  ctx.fillStyle = premium ? '#d4af37' : '#666';
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
  // 小绿植
  ctx.fillStyle = '#6b8e4e';
  ctx.beginPath(); ctx.ellipse(x + cw / 2 - 16 * s, y - 8 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8b6914';
  rrect(ctx, x + cw / 2 - 20 * s, y + 2 * s, 8 * s, 10 * s, 2 * s); ctx.fill();
  drawFacilityLabel(ctx, x, y + ch / 2 + 14 * s, '☕ 咖啡区', s);
}

/** 交易大厅软装 — 地毯、绿植、壁灯 */
export function drawHallInteriorDecor(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number; scale: number; panX: number; panY: number },
  skinKey: string,
  t: number,
) {
  const pal = hallRestPalette(skinKey);
  const premium = skinKey === 'gold';
  const ws = (v: number) => v * cam.scale;
  const pt = (px: number, py: number) => camToScreen(cam, px, py);

  // 工位区地毯
  const rugCx = 340, rugCy = 310, rugW = 560, rugH = 280;
  const rug = pt(rugCx, rugCy);
  ctx.save();
  ctx.fillStyle = premium ? 'rgba(201,168,108,0.18)' : 'rgba(180,160,130,0.12)';
  ctx.beginPath();
  ctx.ellipse(rug.x, rug.y, ws(rugW / 2), ws(rugH / 2), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.25)' : 'rgba(160,140,110,0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 走道分隔线
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.15)' : 'rgba(180,170,155,0.2)';
  ctx.lineWidth = 1;
  const aisleL = pt(60, 350);
  const aisleR = pt(660, 350);
  ctx.beginPath();
  ctx.moveTo(aisleL.x, aisleL.y);
  ctx.lineTo(aisleR.x, aisleR.y);
  ctx.stroke();

  // 角落绿植
  const plants = [{ px: 68, py: 175 }, { px: 640, py: 175 }, { px: 68, py: 480 }, { px: 640, py: 480 }];
  plants.forEach((p, i) => {
    const s = pt(p.px, p.py);
    dropShadow(ctx, s.x, s.y + ws(8), ws(24), ws(16), 0.08);
    ctx.fillStyle = '#8b6914';
    rrect(ctx, s.x - ws(8), s.y + ws(2), ws(16), ws(14), ws(3)); ctx.fill();
    ctx.fillStyle = i % 2 === 0 ? '#5a8a4a' : '#6b9e55';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - ws(4), ws(14), ws(18), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90,138,74,0.6)';
    ctx.beginPath();
    ctx.ellipse(s.x - ws(6), s.y - ws(8), ws(10), ws(12), -0.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // 墙面装饰条
  ctx.fillStyle = premium ? 'rgba(212,175,55,0.12)' : 'rgba(180,160,130,0.15)';
  const topBar = pt(360, 42);
  rrect(ctx, topBar.x - ws(300), topBar.y - ws(6), ws(600), ws(12), ws(4)); ctx.fill();

  // 吊灯
  [180, 360, 540].forEach((px, i) => {
    const lp = pt(px, 130);
    const glow = 0.35 + Math.sin(t * 2 + i) * 0.08;
    ctx.fillStyle = `rgba(212,175,55,${glow * (premium ? 1.2 : 0.7)})`;
    ctx.beginPath(); ctx.arc(lp.x, lp.y, ws(6), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lp.x, lp.y - ws(18)); ctx.lineTo(lp.x, lp.y - ws(6)); ctx.stroke();
  });
}

function camToScreen(cam: { cw: number; ch: number; scale: number; panX: number; panY: number }, px: number, py: number) {
  const cx = PAPER.zoneW / 2 + cam.panX;
  const cy = PAPER.zoneH / 2 + cam.panY;
  return {
    x: cam.cw / 2 + (px - cx) * cam.scale,
    y: cam.ch / 2 + (py - cy) * cam.scale,
  };
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

/** 前厅接待区软装 */
export function drawReceptionInterior(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number; scale: number; panX: number; panY: number },
  skinKey: string,
  t: number,
  hoverId: string | null,
) {
  const pal = receptionPalette(skinKey);
  const ws = (v: number) => v * cam.scale;
  const pt = (px: number, py: number) => {
    const cx = PAPER.zoneW / 2 + cam.panX;
    const cy = PAPER.zoneH / 2 + cam.panY;
    return { x: cam.cw / 2 + (px - cx) * cam.scale, y: cam.ch / 2 + (py - cy) * cam.scale };
  };

  const floor = pt(360, 320);
  const grd = ctx.createRadialGradient(floor.x, floor.y, 0, floor.x, floor.y, ws(280));
  grd.addColorStop(0, pal.floorLight);
  grd.addColorStop(1, pal.floorDark);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, cam.cw, cam.ch);

  [[120, 180], [600, 180], [120, 500], [600, 500]].forEach(([px, py]) => {
    const p = pt(px, py);
    ctx.fillStyle = pal.plant;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, ws(16), ws(20), 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.wood;
    rrect(ctx, p.x - ws(6), p.y + ws(4), ws(12), ws(14), ws(3)); ctx.fill();
  });

  const wall = pt(360, 120);
  ctx.fillStyle = pal.wall;
  rrect(ctx, wall.x - ws(280), wall.y - ws(30), ws(560), ws(60), ws(8)); ctx.fill();
  ctx.strokeStyle = pal.accent; ctx.lineWidth = ws(2);
  rrect(ctx, wall.x - ws(276), wall.y - ws(26), ws(552), ws(52), ws(6)); ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.font = `700 ${Math.max(14, ws(18))}px Inter,sans-serif`; ctx.textAlign = 'center';
  ctx.fillText('交易人生', wall.x, wall.y + ws(6));

  const desk = pt(360, 400);
  dropShadow(ctx, desk.x, desk.y, ws(220), ws(70), 0.12);
  ctx.fillStyle = pal.desk;
  rrect(ctx, desk.x - ws(110), desk.y - ws(22), ws(220), ws(44), ws(10)); ctx.fill();
  ctx.fillStyle = pal.deskTop;
  rrect(ctx, desk.x - ws(104), desk.y - ws(18), ws(208), ws(36), ws(8)); ctx.fill();
  ctx.strokeStyle = pal.accent; ctx.lineWidth = ws(skinKey === 'luxury' ? 2 : 1);
  rrect(ctx, desk.x - ws(104), desk.y - ws(18), ws(208), ws(36), ws(8)); ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.font = `600 ${Math.max(10, ws(12))}px Inter,sans-serif`;
  ctx.fillText('接待台', desk.x, desk.y + ws(5));
  if (hoverId === 'recv_ctr') {
    ctx.strokeStyle = 'rgba(212,175,55,0.65)'; ctx.lineWidth = 2.5;
    rrect(ctx, desk.x - ws(112), desk.y - ws(24), ws(224), ws(48), ws(10)); ctx.stroke();
  }

  [[240, 480], [480, 480]].forEach(([px, py], i) => {
    const p = pt(px, py);
    ctx.fillStyle = pal.seat;
    rrect(ctx, p.x - ws(18), p.y - ws(10), ws(36), ws(20), ws(5)); ctx.fill();
    ctx.fillStyle = pal.wood;
    rrect(ctx, p.x - ws(18), p.y + (i === 0 ? -ws(18) : ws(8)), ws(36), ws(8), ws(2)); ctx.fill();
  });

  const lamp = pt(360, 260);
  const glow = 0.4 + Math.sin(t * 2) * 0.08;
  ctx.fillStyle = `rgba(212,175,55,${glow * (skinKey === 'luxury' ? 1.2 : 0.8)})`;
  ctx.beginPath(); ctx.arc(lamp.x, lamp.y, ws(8), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.accent; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lamp.x, lamp.y - ws(28)); ctx.lineTo(lamp.x, lamp.y - ws(8)); ctx.stroke();
}

export function drawRoundTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y, 80 * s, 80 * s);
  ctx.fillStyle = '#c9b896';
  ctx.beginPath(); ctx.ellipse(x, y, 55 * s, 38 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a8f62';
  ctx.beginPath(); ctx.ellipse(x, y, 38 * s, 26 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawMassageBed(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, skinKey = 'default') {
  const pal = spaPalette(skinKey);
  dropShadow(ctx, x, y, 100 * s, 44 * s, 0.1);
  ctx.fillStyle = pal.bambooDark;
  rrect(ctx, x - 48 * s, y + 6 * s, 96 * s, 10 * s, 4 * s); ctx.fill();
  ctx.fillStyle = pal.bamboo;
  rrect(ctx, x - 46 * s, y + 4 * s, 92 * s, 8 * s, 3 * s); ctx.fill();
  ctx.fillStyle = pal.cream;
  rrect(ctx, x - 44 * s, y - 10 * s, 88 * s, 22 * s, 6 * s); ctx.fill();
  ctx.fillStyle = '#fff';
  rrect(ctx, x - 40 * s, y - 8 * s, 80 * s, 18 * s, 5 * s); ctx.fill();
  ctx.fillStyle = pal.lavender;
  rrect(ctx, x - 38 * s, y - 6 * s, 18 * s, 14 * s, 4 * s); ctx.fill();
  ctx.fillStyle = pal.teal;
  ctx.beginPath(); ctx.arc(x + 32 * s, y - 2 * s, 5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.sage;
  rrect(ctx, x + 28 * s, y + 2 * s, 3 * s, 8 * s, 1 * s); ctx.fill();
}

export function drawDiningTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, skinKey = 'default') {
  const pal = cantonesePalette(skinKey);
  dropShadow(ctx, x, y, 110 * s, 85 * s, 0.12);
  ctx.fillStyle = pal.wood;
  ctx.fillRect(x - 5 * s, y + 12 * s, 10 * s, 18 * s);
  ctx.fillStyle = pal.woodLight;
  ctx.beginPath(); ctx.ellipse(x, y + 6 * s, 48 * s, 36 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.tableTop;
  ctx.beginPath(); ctx.ellipse(x, y, 42 * s, 32 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = skinKey === 'premium' ? 2.5 * s : 1.8 * s;
  ctx.beginPath(); ctx.ellipse(x, y, 40 * s, 30 * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = pal.crimsonDeep;
  ctx.beginPath(); ctx.ellipse(x, y, 18 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.goldDim;
  ctx.beginPath(); ctx.ellipse(x, y, 14 * s, 10 * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fffef8';
  rrect(ctx, x - 8 * s, y - 6 * s, 16 * s, 12 * s, 2 * s); ctx.fill();
  ctx.fillStyle = pal.crimson;
  ctx.beginPath(); ctx.arc(x - 2 * s, y - 2 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const ang = -0.8 + i * 0.8;
    const dx = Math.cos(ang) * 22 * s;
    const dy = Math.sin(ang) * 16 * s;
    ctx.fillStyle = pal.jade;
    ctx.beginPath(); ctx.ellipse(x + dx, y + dy, 5 * s, 4 * s, ang, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.gold;
    ctx.beginPath(); ctx.ellipse(x + dx, y + dy - 2 * s, 4 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (skinKey === 'default' || skinKey === 'garden') {
    ctx.fillStyle = pal.crimson;
    ctx.font = `${Math.max(8, 10 * s)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('福', x + 28 * s, y - 22 * s);
  }
}

export function drawChair(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  facing: 'n' | 's' | 'e' | 'w' = 's', skinKey = 'default',
) {
  const pal = cantonesePalette(skinKey);
  dropShadow(ctx, x, y + 4 * s, 24 * s, 20 * s, 0.08);
  const seatColor = skinKey === 'modern' ? pal.woodLight : skinKey === 'premium' ? '#4a3020' : '#8b7355';
  const backColor = skinKey === 'modern' ? pal.jade : skinKey === 'premium' ? pal.wood : '#a08060';
  const sw = 20 * s, sh = 14 * s, sr = 3 * s;
  ctx.fillStyle = seatColor;
  rrect(ctx, x - 10 * s, y - 6 * s, sw, sh, sr); ctx.fill();
  if (skinKey === 'premium') {
    ctx.strokeStyle = pal.gold; ctx.lineWidth = 1 * s;
    rrect(ctx, x - 10 * s, y - 6 * s, sw, sh, sr); ctx.stroke();
  }
  ctx.fillStyle = backColor;
  const bw = 20 * s, bh = 6 * s, br = 2 * s;
  if (facing === 'n') {
    rrect(ctx, x - 10 * s, y - 14 * s, bw, bh, br); ctx.fill();
  } else if (facing === 's') {
    rrect(ctx, x - 10 * s, y + 8 * s, bw, bh, br); ctx.fill();
  } else if (facing === 'e') {
    rrect(ctx, x - 16 * s, y - 4 * s, bh, bh + 2 * s, br); ctx.fill();
  } else {
    rrect(ctx, x + 10 * s, y - 4 * s, bh, bh + 2 * s, br); ctx.fill();
  }
}

export function drawRestBooth(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false, skinKey = 'default') {
  const pal = hallRestPalette(skinKey);
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);

  dropShadow(ctx, 0, 0, 170 * s, 95 * s, 0.1);
  ctx.fillStyle = pal.sofaArm;
  rrect(ctx, -78 * s, -32 * s, 28 * s, 58 * s, 6 * s); ctx.fill();
  rrect(ctx, -78 * s, -32 * s, 150 * s, 28 * s, 8 * s); ctx.fill();
  ctx.fillStyle = pal.sofa;
  rrect(ctx, -72 * s, -26 * s, 138 * s, 36 * s, 8 * s); ctx.fill();
  ctx.fillStyle = pal.cushion;
  ctx.beginPath(); ctx.ellipse(-40 * s, -6 * s, 22 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(20 * s, -6 * s, 20 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.ellipse(-40 * s, -8 * s, 14 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(20 * s, -8 * s, 12 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.sofaArm;
  rrect(ctx, 50 * s, -28 * s, 24 * s, 52 * s, 6 * s); ctx.fill();
  ctx.fillStyle = '#c8baa8';
  rrect(ctx, -20 * s, 18 * s, 44 * s, 22 * s, 4 * s); ctx.fill();
  ctx.fillStyle = '#faf6ef';
  ctx.beginPath(); ctx.ellipse(-18 * s, 14 * s, 8 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(6 * s, 14 * s, 7 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.fillRect(62 * s, -48 * s, 4 * s, 36 * s);
  ctx.beginPath(); ctx.ellipse(64 * s, -50 * s, 10 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  if (skinKey === 'gold' || skinKey === 'bamboo') {
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.5 * s;
    rrect(ctx, -72 * s, -26 * s, 138 * s, 36 * s, 8 * s); ctx.stroke();
  }
  ctx.restore();
}

function drawPokerChips(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, colors: string[], count = 4) {
  for (let i = 0; i < count; i++) {
    const ox = (i - (count - 1) / 2) * 7 * s;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath(); ctx.ellipse(x + ox, y - i * 2 * s, 7 * s, 3.5 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.6 * s;
    ctx.beginPath(); ctx.ellipse(x + ox, y - i * 2 * s, 5 * s, 2.5 * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

export function drawPokerTable8(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number,
  skinKey = 'default',
) {
  const pal = vipPalette(skinKey);
  const chipColors = skinKey === 'neon'
    ? ['#e040fb', '#00e5ff', '#ff4081', '#7c4dff']
    : skinKey === 'royal'
      ? ['#d4af37', '#8b0000', '#ffd700', '#4a0080']
      : ['#d4af37', '#c0392b', '#2980b9', '#27ae60'];

  dropShadow(ctx, x, y, 250 * s, 190 * s, 0.16);
  ctx.fillStyle = pal.walnutLight;
  ctx.beginPath(); ctx.ellipse(x, y, 122 * s, 84 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.goldDim;
  ctx.lineWidth = 5 * s;
  ctx.strokeStyle = pal.gold;
  ctx.beginPath(); ctx.ellipse(x, y, 116 * s, 78 * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = skinKey === 'neon' ? '#1a4038' : '#2d5a3d';
  ctx.beginPath(); ctx.ellipse(x, y, 108 * s, 72 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1 * s;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.ellipse(x, y + i * 14 * s, 96 * s, 8 * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = skinKey === 'neon' ? '#143028' : '#1a4030';
  ctx.beginPath(); ctx.ellipse(x, y, 92 * s, 58 * s, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#1a1a1a';
  rrect(ctx, x - 18 * s, y - 58 * s, 36 * s, 22 * s, 4 * s); ctx.fill();
  ctx.fillStyle = pal.gold;
  rrect(ctx, x - 14 * s, y - 54 * s, 28 * s, 6 * s, 2 * s); ctx.fill();
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#fffef8';
    rrect(ctx, x - 10 * s + i * 8 * s, y - 46 * s, 6 * s, 9 * s, 1 * s); ctx.fill();
  }

  const cards = ['🂡', '🂱', '🃁', '🃑'];
  cards.forEach((c, i) => {
    ctx.save();
    ctx.translate(x - 22 * s + i * 15 * s, y + Math.sin(t * 2 + i) * 2 * s);
    ctx.fillStyle = '#fffef8';
    rrect(ctx, -7 * s, -10 * s, 14 * s, 20 * s, 2 * s); ctx.fill();
    ctx.strokeStyle = '#c4b8a8'; ctx.lineWidth = 0.8 * s; ctx.stroke();
    ctx.font = `${Math.max(9, 12 * s)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(c, 0, 4 * s);
    ctx.restore();
  });

  drawPokerChips(ctx, x, y + 18 * s, s, chipColors, 5);
  drawPokerChips(ctx, x - 38 * s, y - 8 * s, s, chipColors.slice(1), 3);
  drawPokerChips(ctx, x + 38 * s, y - 8 * s, s, chipColors.slice(2), 3);

  drawPokerSeatNumbers(ctx, x, y, s);

  ctx.fillStyle = pal.gold;
  ctx.font = `700 ${Math.max(9, 11 * s)}px Inter,sans-serif`; ctx.textAlign = 'center';
  ctx.fillText('TEXAS HOLD\'EM', x, y + 38 * s);
}

/** 桌面顺时针 1–7 号位（跳过荷官正北） */
function drawPokerSeatNumbers(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  for (let seatNum = 1; seatNum <= CASINO_PLAYER_SEATS; seatNum++) {
    const ang = casinoSeatSlotAngle(seatNum);
    const lx = x + Math.cos(ang) * 62 * s;
    const ly = y + Math.sin(ang) * 42 * s;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.arc(lx, ly, 9 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,55,0.55)'; ctx.lineWidth = 0.8 * s; ctx.stroke();
    ctx.fillStyle = '#3d3530';
    ctx.font = `700 ${Math.max(8, 10 * s)}px Inter,sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(String(seatNum), lx, ly + 3 * s);
  }
}

/** 牌桌发牌动画 — 逐张落向桌面中心 */
export function drawPokerTableDealing(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number,
) {
  const faces = ['🂡', '🂱', '🃁', '🃑', '🂮'];
  for (let i = 0; i < 5; i++) {
    const progress = Math.min(1, Math.max(0, t * 2.2 - i * 0.28));
    if (progress <= 0) continue;
    const ang = -1.1 + i * 0.42;
    const dist = 38 * s * progress;
    const cx = x + Math.cos(ang) * dist;
    const cy = y + Math.sin(ang) * dist * 0.55 - progress * 10 * s;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang * 0.5);
    ctx.fillStyle = progress >= 0.95 ? '#fffef8' : '#d4c8b8';
    rrect(ctx, -11 * s, -15 * s, 22 * s, 30 * s, 3 * s);
    ctx.fill();
    ctx.strokeStyle = '#c4b8a8'; ctx.lineWidth = 1 * s; ctx.stroke();
    if (progress >= 0.95) {
      ctx.font = `${Math.max(10, 14 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(faces[i], 0, 4 * s);
    }
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(212,175,55,0.9)';
  ctx.font = `600 ${Math.max(10, 12 * s)}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🃏 荷官发牌中…', x, y - 48 * s);
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
  pal: VipPalette = vipPalette('default'),
) {
  dropShadow(ctx, x, y + 4 * s, rx * 2 * s, ry * 2 * s, 0.12);
  ctx.fillStyle = pal.rugBase;
  ctx.beginPath(); ctx.ellipse(x, y, rx * s, ry * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.goldDim; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.ellipse(x, y, rx * s, ry * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = pal.rugPattern; ctx.lineWidth = 1 * s;
  for (let ring = 0.75; ring > 0.2; ring -= 0.18) {
    ctx.beginPath(); ctx.ellipse(x, y, rx * ring * s, ry * ring * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = pal.gold;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rx * 0.82 * s, y + Math.sin(a) * ry * 0.82 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRunnerRug(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], s: number, pal: VipPalette = vipPalette('default')) {
  ctx.strokeStyle = pal.rugBase;
  ctx.lineWidth = 28 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.stroke();
  ctx.strokeStyle = pal.goldDim;
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  ctx.strokeStyle = pal.rugPattern;
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
  skinKey = 'default',
) {
  const P = vipPalette(skinKey);
  const w = cam.cw, h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.65);
  if (dayMode === 'night') {
    grd.addColorStop(0, P.backdropCenter);
    grd.addColorStop(1, '#1a1412');
  } else {
    grd.addColorStop(0, P.backdropCenter);
    grd.addColorStop(1, P.backdropEdge);
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const wallTop = toScreen(360, 40);
  ctx.fillStyle = P.velvetDeep;
  rrect(ctx, wallTop.x - ws(340), wallTop.y - ws(8), ws(680), ws(90), ws(4)); ctx.fill();
  ctx.strokeStyle = P.gold; ctx.lineWidth = ws(2);
  ctx.beginPath();
  ctx.moveTo(wallTop.x - ws(320), wallTop.y + ws(78));
  ctx.lineTo(wallTop.x + ws(320), wallTop.y + ws(78));
  ctx.stroke();

  ctx.fillStyle = P.gold;
  ctx.font = `700 ${Math.max(11, ws(14))}px Georgia,serif`;
  ctx.textAlign = 'center';
  ctx.fillText(skinKey === 'neon' ? '◆  NEON POKER  ◆' : '◆  VIP 德州厅  ◆', wallTop.x, wallTop.y + ws(42));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(245,239,230,0.55)';
  ctx.fillText(skinKey === 'neon' ? 'NEON NIGHT LOUNGE' : 'PRIVATE POKER LOUNGE', wallTop.x, wallTop.y + ws(58));

  [[90, 320], [630, 320]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    ctx.fillStyle = P.velvet;
    rrect(ctx, p.x - ws(18), p.y - ws(120), ws(36), ws(240), ws(4)); ctx.fill();
    ctx.strokeStyle = P.goldDim; ctx.lineWidth = ws(1);
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
  skinKey = 'default',
) {
  const P = vipPalette(skinKey);
  const runner = [
    toScreen(22, 320), toScreen(120, 300), toScreen(220, 260),
    toScreen(320, 220), toScreen(360, 200),
  ];
  drawRunnerRug(ctx, runner, s, P);

  const rug = toScreen(360, 340);
  drawOvalRug(ctx, rug.x, rug.y, 210, 155, s, P);

  [
    { px: 118, py: 530, flip: false },
    { px: 602, py: 530, flip: true },
    { px: 118, py: 155, flip: false },
    { px: 602, py: 155, flip: true },
  ].forEach(({ px, py, flip }) => {
    const p = toScreen(px, py);
    drawVipSofa(ctx, p.x, p.y, s, flip, P);
    const tbl = toScreen(px + (flip ? -55 : 55), py + 20);
    drawSideTable(ctx, tbl.x, tbl.y, s, P);
    drawChipStack(ctx, tbl.x, tbl.y - ws(14), s);
  });

  [
    { px: 255, py: 145, kind: 'lamp' as const },
    { px: 465, py: 145, kind: 'lamp' as const },
    { px: 75, py: 420, kind: 'plant' as const },
    { px: 645, py: 420, kind: 'plant' as const },
  ].forEach(({ px, py, kind }) => {
    const p = toScreen(px, py);
    if (kind === 'lamp') drawFloorLamp(ctx, p.x, p.y, s, t, P);
    else drawDecorPlant(ctx, p.x, p.y, s, P);
  });

  const ch = toScreen(360, 195);
  drawChandelier(ctx, ch.x, ch.y, s, t, P);

  const bar = toScreen(360, 580);
  drawChipCabinet(ctx, bar.x, bar.y, s, P);
}

export function drawVipSofa(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y, 130 * s, 70 * s, 0.14);
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = pal.burgundy;
  rrect(ctx, -58 * s, -22 * s, 116 * s, 44 * s, 10 * s); ctx.fill();
  ctx.fillStyle = pal.velvetDeep;
  rrect(ctx, -62 * s, -30 * s, 28 * s, 58 * s, 8 * s); ctx.fill();
  rrect(ctx, 34 * s, -30 * s, 28 * s, 58 * s, 8 * s); ctx.fill();
  ctx.fillStyle = pal.gold;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.arc(i * 22 * s, -18 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = pal.cream;
  ctx.beginPath(); ctx.ellipse(0, 6 * s, 20 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawSideTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y + 2 * s, 36 * s, 28 * s, 0.1);
  ctx.fillStyle = pal.walnutLight;
  ctx.beginPath(); ctx.ellipse(x, y, 18 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.fillStyle = pal.walnut;
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

export function drawFloorLamp(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, pal: VipPalette = vipPalette('default')) {
  const glow = 0.85 + Math.sin(t * 3) * 0.15;
  ctx.fillStyle = `rgba(255,190,100,${0.12 * glow})`;
  ctx.beginPath(); ctx.ellipse(x, y + 20 * s, 45 * s, 35 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.walnutLight;
  ctx.fillRect(x - 2 * s, y, 4 * s, 38 * s);
  ctx.fillStyle = pal.gold;
  ctx.beginPath();
  ctx.moveTo(x - 14 * s, y - 2 * s);
  ctx.lineTo(x + 14 * s, y - 2 * s);
  ctx.lineTo(x + 10 * s, y - 18 * s);
  ctx.lineTo(x - 10 * s, y - 18 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,220,160,${0.9 * glow})`;
  ctx.beginPath(); ctx.ellipse(x, y - 20 * s, 8 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawDecorPlant(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y + 8 * s, 28 * s, 20 * s, 0.08);
  ctx.fillStyle = '#6b4423';
  ctx.beginPath();
  ctx.moveTo(x - 12 * s, y + 10 * s);
  ctx.lineTo(x + 12 * s, y + 10 * s);
  ctx.lineTo(x + 10 * s, y + 28 * s);
  ctx.lineTo(x - 10 * s, y + 28 * s);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = pal.goldDim; ctx.lineWidth = 1; ctx.stroke();
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

export function drawChandelier(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, pal: VipPalette = vipPalette('default')) {
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.moveTo(x, y - 30 * s); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = pal.gold;
  ctx.beginPath(); ctx.ellipse(x, y - 32 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = -2; i <= 2; i++) {
    const cx = x + i * 14 * s;
    const spark = 0.6 + Math.sin(t * 4 + i) * 0.4;
    ctx.fillStyle = `rgba(255,230,160,${spark})`;
    ctx.beginPath(); ctx.arc(cx, y + 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.gold; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + 4 * s); ctx.stroke();
  }
}

export function drawChipCabinet(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y, 100 * s, 40 * s, 0.1);
  ctx.fillStyle = pal.walnutLight;
  rrect(ctx, x - 50 * s, y - 18 * s, 100 * s, 36 * s, 6 * s); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    drawChipStack(ctx, x + i * 18 * s, y - 6 * s, s * 0.85);
  }
  ctx.fillStyle = pal.cream;
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

/* ─── Cantonese restaurant decor ─── */

const YUE = {
  crimson: '#b83232',
  crimsonDeep: '#8a2424',
  gold: '#d4af37',
  goldDim: '#a88828',
  cream: '#faf3e8',
  wood: '#5c3d28',
  woodLight: '#8b5a3c',
  jade: '#3d7a62',
};

function drawChineseLantern(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, pal: CantonesePalette) {
  const sway = Math.sin(t * 2 + x * 0.02) * 3 * s;
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.2 * s;
  ctx.beginPath(); ctx.moveTo(x, y - 18 * s); ctx.lineTo(x + sway, y - 6 * s); ctx.stroke();
  dropShadow(ctx, x + sway, y, 16 * s, 22 * s, 0.1);
  ctx.fillStyle = pal.crimson;
  ctx.beginPath(); ctx.ellipse(x + sway, y, 14 * s, 18 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.fillStyle = pal.gold;
  ctx.beginPath(); ctx.ellipse(x + sway, y - 16 * s, 5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + sway, y + 16 * s, 4 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.goldDim;
  ctx.font = `700 ${Math.max(7, 8 * s)}px serif`; ctx.textAlign = 'center';
  ctx.fillText('福', x + sway, y + 3 * s);
}

function drawTeaStation(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: CantonesePalette) {
  dropShadow(ctx, x, y, 70 * s, 40 * s, 0.08);
  ctx.fillStyle = pal.wood;
  rrect(ctx, x - 35 * s, y - 8 * s, 70 * s, 16 * s, 4 * s); ctx.fill();
  ctx.fillStyle = pal.woodLight;
  rrect(ctx, x - 30 * s, y - 22 * s, 24 * s, 14 * s, 3 * s); ctx.fill();
  ctx.fillStyle = '#fff8f0';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.ellipse(x + 8 * s + i * 16 * s, y - 2 * s, 6 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = pal.goldDim;
  ctx.font = `600 ${Math.max(7, 8 * s)}px Inter,sans-serif`; ctx.textAlign = 'center';
  ctx.fillText('功夫茶', x, y + 14 * s);
}

function drawLazySusanHint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s: number, t: number) {
  ctx.strokeStyle = 'rgba(212,175,55,0.35)'; ctx.lineWidth = 1 * s;
  ctx.beginPath(); ctx.arc(x, y, r * s, t * 0.4, t * 0.4 + Math.PI * 1.2); ctx.stroke();
}

/** 餐桌上菜 — 多份菜品 */
export function drawTableDishes(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, count = 3,
) {
  const dishes = ['🥟', '🦐', '🥬', '🍚', '🍵'].slice(0, count);
  dishes.forEach((emoji, i) => {
    const ang = (i / dishes.length) * Math.PI * 2 + t * 0.3;
    const dx = Math.cos(ang) * 14 * s;
    const dy = Math.sin(ang) * 10 * s;
    ctx.font = `${Math.max(9, 11 * s)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(emoji, x + dx, y + dy + Math.sin(t * 3 + i) * 1.5);
  });
  ctx.fillStyle = 'rgba(184,50,50,0.35)';
  ctx.font = `600 ${Math.max(7, 8 * s)}px Inter,sans-serif`;
  ctx.fillText('已上菜', x, y - 18 * s);
}

/** 服务员端盘动画 */
export function drawWaiterServeMotion(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  s: number, progress: number, t: number,
) {
  const p = Math.min(1, Math.max(0, progress));
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const x = fromX + (toX - fromX) * ease;
  const y = fromY + (toY - fromY) * ease - Math.sin(p * Math.PI) * 8 * s;
  ctx.font = `${Math.max(12, 16 * s)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🍽️', x, y + Math.sin(t * 8) * 2);
  if (p < 0.95) {
    ctx.strokeStyle = 'rgba(232,121,169,0.35)'; ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY); ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** 按摩技师手势 */
export function drawMassageTherapistHands(
  ctx: CanvasRenderingContext2D, bedX: number, bedY: number, s: number, t: number,
) {
  const hx = bedX + 28 * s + Math.sin(t * 4) * 4 * s;
  const hy = bedY - 6 * s + Math.cos(t * 3.5) * 3 * s;
  ctx.font = `${Math.max(11, 14 * s)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🤲', hx, hy);
  ctx.font = `${Math.max(8, 10 * s)}px sans-serif`;
  ctx.fillStyle = 'rgba(107,91,138,0.75)';
  ctx.fillText('理疗中…', bedX, bedY - 22 * s);
}

export function drawCantoneseBackdrop(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number; scale: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  dayMode: 'day' | 'night',
  skinKey = 'default',
) {
  const pal = cantonesePalette(skinKey);
  const w = cam.cw, h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.72);
  grd.addColorStop(0, dayMode === 'night' ? pal.crimsonDeep : pal.floorLight);
  grd.addColorStop(1, dayMode === 'night' ? '#241810' : pal.floorDark);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);

  const header = toScreen(360, 48);
  ctx.fillStyle = pal.crimsonDeep;
  rrect(ctx, header.x - ws(300), header.y - ws(8), ws(600), ws(68), ws(6)); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = ws(2);
  ctx.strokeRect(header.x - ws(290), header.y - ws(4), ws(580), ws(58));

  ctx.fillStyle = pal.gold;
  ctx.font = `700 ${Math.max(12, ws(15))}px Georgia,serif`; ctx.textAlign = 'center';
  const title = skinKey === 'modern' ? '◆  现代粤菜馆  ◆' : '◆  广式粤菜馆  ◆';
  ctx.fillText(title, header.x, header.y + ws(28));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(250,243,232,0.75)';
  ctx.fillText(skinKey === 'modern' ? 'MODERN CANTONESE · 轻食 · 茶点' : 'CANTONESE CUISINE · 老火靓汤 · 烧味双拼', header.x, header.y + ws(46));
}

export function drawCantoneseDecor(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  s: number,
  t: number,
  skinKey = 'default',
) {
  const pal = cantonesePalette(skinKey);
  if (skinKey !== 'modern') {
    [[120, 120], [360, 110], [600, 120]].forEach(([px, py]) => {
      const p = toScreen(px, py);
      drawChineseLantern(ctx, p.x, p.y, s, t, pal);
    });
  } else {
    [[120, 120], [600, 120]].forEach(([px, py]) => {
      const p = toScreen(px, py);
      ctx.fillStyle = pal.jade;
      rrect(ctx, p.x - ws(10), p.y - ws(40), ws(20), ws(80), ws(4)); ctx.fill();
    });
  }

  [[85, 380], [635, 380]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    ctx.fillStyle = pal.wood;
    rrect(ctx, p.x - ws(14), p.y - ws(90), ws(28), ws(180), ws(3)); ctx.fill();
    ctx.strokeStyle = pal.goldDim; ctx.lineWidth = 1 * s;
    for (let i = 0; i < 6; i++) {
      ctx.strokeRect(p.x - ws(10), p.y - ws(80) + i * ws(28), ws(20), ws(22));
    }
  });

  const tea = toScreen(120, 555);
  drawTeaStation(ctx, tea.x, tea.y, s, pal);

  [[200, 280], [360, 280], [520, 280], [200, 470], [360, 470], [520, 470]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    drawLazySusanHint(ctx, p.x, p.y, 22, s, t);
  });

  ctx.fillStyle = skinKey === 'modern' ? 'rgba(90,152,136,0.08)' : 'rgba(184,50,50,0.06)';
  const aisle = toScreen(360, 340);
  ctx.beginPath(); ctx.ellipse(aisle.x, aisle.y, ws(280), ws(180), 0, 0, Math.PI * 2); ctx.fill();
}

export function drawCantoneseAmbientLights(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
) {
  const center = toScreen(360, 320);
  const grd = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, ws(340));
  grd.addColorStop(0, 'rgba(255,220,160,0.14)');
  grd.addColorStop(0.5, 'rgba(212,175,55,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, cam.cw, cam.ch);
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

function drawSpaFloorMat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number, pal: SpaPalette) {
  dropShadow(ctx, x, y, w * s, h * s, 0.06);
  ctx.fillStyle = pal.mat;
  rrect(ctx, x - (w / 2) * s, y - (h / 2) * s, w * s, h * s, 6 * s); ctx.fill();
  ctx.strokeStyle = pal.bamboo; ctx.lineWidth = 1 * s;
  ctx.stroke();
  ctx.strokeStyle = pal.glow; ctx.lineWidth = 0.8 * s;
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
  skinKey = 'default',
) {
  const pal = spaPalette(skinKey);
  const w = cam.cw, h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.7);
  if (dayMode === 'night') {
    grd.addColorStop(0, '#3a3548');
    grd.addColorStop(1, '#252030');
  } else {
    grd.addColorStop(0, pal.floorLight);
    grd.addColorStop(1, pal.floorDark);
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const header = toScreen(310, 42);
  ctx.fillStyle = dayMode === 'night' ? '#2a2438' : '#f0ebe6';
  rrect(ctx, header.x - ws(280), header.y - ws(6), ws(560), ws(72), ws(6)); ctx.fill();
  ctx.strokeStyle = pal.lavender; ctx.lineWidth = ws(1.5);
  ctx.beginPath();
  ctx.moveTo(header.x - ws(250), header.y + ws(58));
  ctx.lineTo(header.x + ws(250), header.y + ws(58));
  ctx.stroke();

  ctx.fillStyle = pal.lavenderDeep;
  ctx.font = `700 ${Math.max(11, ws(14))}px Georgia,serif`;
  ctx.textAlign = 'center';
  ctx.fillText(skinKey === 'tropical' ? '🌴  热带理疗馆  🌴' : '☯  禅意理疗馆  ☯', header.x, header.y + ws(32));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(107,91,138,0.65)';
  ctx.fillText(skinKey === 'tropical' ? 'TROPICAL SPA RETREAT' : 'ZEN SPA & WELLNESS LOUNGE', header.x, header.y + ws(48));

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
  skinKey = 'default',
) {
  const pal = spaPalette(skinKey);
  [
    { px: 310, py: 340, w: 340, h: 48 },
    { px: 310, py: 200, w: 280, h: 36 },
  ].forEach(({ px, py, w, h }) => {
    const p = toScreen(px, py);
    drawSpaFloorMat(ctx, p.x, p.y, w, h, s, pal);
  });

  [
    { px: 130, py: 260 }, { px: 310, py: 260 }, { px: 490, py: 260 },
    { px: 130, py: 420 }, { px: 310, py: 420 }, { px: 490, py: 420 },
  ].forEach(({ px, py }) => {
    const p = toScreen(px, py);
    ctx.fillStyle = pal.glow.replace('0.28', '0.12').replace('0.25', '0.12');
    ctx.beginPath(); ctx.ellipse(p.x, p.y, ws(58), ws(38), 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.glow; ctx.lineWidth = 1 * s;
    ctx.stroke();
  });

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

  [[40, 340], [580, 340]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    const lg = ctx.createLinearGradient(p.x, p.y - ws(100), p.x, p.y + ws(100));
    lg.addColorStop(0, 'rgba(155,135,196,0)');
    lg.addColorStop(0.5, pal.glow);
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
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, hover = false, skinKey = 'default',
) {
  if (hover) {
    ctx.strokeStyle = 'rgba(155,135,196,0.75)'; ctx.lineWidth = 2.5 * s;
    rrect(ctx, x - 56 * s, y - 22 * s, 112 * s, 44 * s, 8 * s); ctx.stroke();
  }
  drawMassageBed(ctx, x, y, s, skinKey);
}
