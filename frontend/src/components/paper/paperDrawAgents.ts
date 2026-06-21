/** Canvas 2D 角色绘制 — 企鹅/牛马/服装统一入口 */
import { DEFAULT_SCARF, scarfColorsFromAccent } from '../../lib/scarfColors';
import {
  drawAgentHat2d, drawAgentScarf2d, resolveAppearance, type AgentAppearanceState,
  type AgentHeadwear, type HatStyleId, drawScarfStripes,
} from '../../lib/agentAppearance';
import { drawAgentOutfitFull2d, drawOutfitAccessories2d, drawOutfitLimbs2d, outfitReplacesBaseCharacter, type OutfitId } from '../../lib/agentOutfits';
import { drawNiumaCharacter2d, drawNiumaAccessories2d, drawNiumaLimbs2d, drawPenguinBody, drawPenguinFace, PENGUIN_PALETTE, type NiumaSkinId } from '../../lib/agentSpecies';
import { dropShadow, rrect } from './paperDrawUtils';

export type AgentFacing = 'n' | 's' | 'e' | 'w';
export type AgentActivity = 'rest' | 'massage' | 'dine' | 'poker' | null;

/** 角色统一入口 — 根据朝向/姿势渲染正/背/侧面；就座/躺卧时绘制对应姿态 */
export function drawAgent(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; trading?: boolean; walking?: boolean; t?: number;
    activity?: AgentActivity; facing?: AgentFacing; sitting?: boolean;
    pose?: 'stand' | 'sit' | 'lie' | 'desk';
    headwear?: AgentHeadwear; hatStyle?: HatStyleId;
    outfitId?: OutfitId | NiumaSkinId; speciesId?: string; hairStyle?: string;
    scarfEnabled?: boolean; hatEnabled?: boolean;
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
  const ap = resolveDrawAppearance({ ...opts, color });
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 20, 18, 0, 0, Math.PI * 2); ctx.stroke();
  }
  dropShadow(ctx, x, py + 6, 30, 22, 0.1);
  ctx.save(); ctx.translate(x, 0);
  if (facing === 'e' || facing === 'w') {
    const flip = facing === 'w' ? -1 : 1;
    ctx.fillStyle = PENGUIN_PALETTE.foot;
    ctx.beginPath(); ctx.ellipse(flip * 6, py + 10, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    drawAgentTorso(ctx, py - 4, color, ap, 'side', flip);
    drawAgentHeadLayer(ctx, py - 4, color, ap, 'side', flip);
  } else if (facing === 'n') {
    drawAgentTorso(ctx, py - 4, color, ap, 'back');
    drawAgentHeadLayer(ctx, py - 4, color, ap, 'back');
  } else {
    drawAgentTorso(ctx, py - 2, color, ap, 'front');
    drawAgentHeadLayer(ctx, py - 2, color, ap, 'front');
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

  ctx.fillStyle = PENGUIN_PALETTE.foot;
  ctx.beginPath(); ctx.ellipse(10, 14, 7, 3.5, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(18, 12, 6, 3, 0.1, 0, Math.PI * 2); ctx.fill();

  const ap = resolveDrawAppearance({ ...opts, color });
  drawAgentTorso(ctx, -2, color, ap, 'side', 1);
  drawAgentHeadLayer(ctx, -2, color, ap, 'side', 1);

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
    ctx.fillStyle = PENGUIN_PALETTE.white;
    ctx.beginPath(); ctx.ellipse(flip * 5, py - 2, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PENGUIN_PALETTE.black;
    ctx.beginPath(); ctx.arc(flip * 5, py - 2, 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = PENGUIN_PALETTE.white;
    ctx.beginPath(); ctx.ellipse(-5, py - 2, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, py - 2, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PENGUIN_PALETTE.black;
    ctx.beginPath(); ctx.arc(-5, py - 2, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, py - 2, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = PENGUIN_PALETTE.beak;
  ctx.beginPath();
  if (profile) {
    ctx.moveTo(flip * 8, py + 1); ctx.lineTo(flip * 12, py + 4); ctx.lineTo(flip * 8, py + 6);
  } else {
    ctx.moveTo(0, py + 2); ctx.lineTo(-3, py + 7); ctx.lineTo(3, py + 7);
  }
  ctx.closePath(); ctx.fill();
}

function drawPenguinBody(ctx: CanvasRenderingContext2D, py: number, profile = false, showBelly = true) {
  ctx.fillStyle = PENGUIN_PALETTE.black;
  ctx.beginPath(); ctx.ellipse(profile ? 2 : 0, py + 2, profile ? 12 : 15, profile ? 17 : 19, 0, 0, Math.PI * 2); ctx.fill();
  if (showBelly) {
    ctx.fillStyle = PENGUIN_PALETTE.belly;
    ctx.beginPath(); ctx.ellipse(profile ? 4 : 0, py + 7, profile ? 7 : 10, profile ? 9 : 11, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function resolveDrawAppearance(opts: { speciesId?: string; outfitId?: OutfitId | NiumaSkinId; hairStyle?: string; scarfEnabled?: boolean; hatEnabled?: boolean; headwear?: AgentHeadwear; hatStyle?: HatStyleId; color?: string }): AgentAppearanceState {
  return resolveAppearance(opts);
}

function drawAgentTorso(
  ctx: CanvasRenderingContext2D, py: number, color: string, ap: AgentAppearanceState,
  view: 'front' | 'back' | 'side', flip = 1, anim?: { swing: number; bounce: number },
) {
  if (ap.speciesId === 'niuma') {
    drawNiumaCharacter2d(ctx, py, ap.outfitId as NiumaSkinId, view, flip, anim?.swing ?? 0, anim?.bounce ?? 0);
    return;
  }
  if (outfitReplacesBaseCharacter(ap.outfitId as OutfitId)) {
    drawAgentOutfitFull2d(ctx, py, ap.outfitId as OutfitId, color, view, flip);
  } else {
    drawPenguinBody(ctx, py, view === 'side', view !== 'back');
  }
}

function drawAgentHeadLayer(ctx: CanvasRenderingContext2D, py: number, color: string, ap: AgentAppearanceState, view: 'front' | 'back' | 'side', flip = 1) {
  if (ap.speciesId === 'niuma') {
    drawNiumaAccessories2d(ctx, py, ap.hairStyle, color, view, flip);
    return;
  }
  if (outfitReplacesBaseCharacter(ap.outfitId as OutfitId)) {
    drawOutfitAccessories2d(ctx, py, ap.outfitId as OutfitId, color, ap.scarfEnabled, ap.hatEnabled, ap.hatStyle, view, flip);
    return;
  }
  if (view === 'front') {
    if (ap.scarfEnabled) drawAgentScarf2d(ctx, py, color, 'front');
    drawPenguinFace(ctx, py - 2);
    if (ap.hatEnabled) drawAgentHat2d(ctx, py - 2, ap.hatStyle, color, 'front');
  } else if (view === 'back') {
    if (ap.scarfEnabled) drawAgentScarf2d(ctx, py, color, 'back');
    if (ap.hatEnabled) drawAgentHat2d(ctx, py - 2, ap.hatStyle, color, 'back');
  } else {
    if (ap.scarfEnabled) drawAgentScarf2d(ctx, py, color, 'side', flip);
    drawPenguinFace(ctx, py - 2, true, flip);
    if (ap.hatEnabled) drawAgentHat2d(ctx, py - 2, ap.hatStyle, color, 'side', flip);
  }
}

/** 手脚摆动 — 参考 144 office-engine */
function drawWalkLimbs(
  ctx: CanvasRenderingContext2D, py: number, facing: AgentFacing,
  walking: boolean, t: number, color: string, ap: AgentAppearanceState,
) {
  const phase = walkPhase(t, walking);
  const swing = walking ? Math.sin(phase) * 5 : 0;
  const bounce = walking ? Math.abs(Math.sin(phase)) * 2 : 0;
  if (ap.speciesId === 'niuma') {
    drawNiumaLimbs2d(ctx, py, facing, swing, bounce);
    return;
  }
  if (drawOutfitLimbs2d(ctx, py, ap.outfitId as OutfitId, color, facing, walking, t, swing, bounce)) return;

  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = PENGUIN_PALETTE.black;
  ctx.fillStyle = PENGUIN_PALETTE.foot;
  const vert = facing === 'n' || facing === 's';
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

function niumaUsesSprite(_ap: AgentAppearanceState, _view: 'front' | 'back' | 'side'): boolean {
  return false;
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
  const ap = resolveDrawAppearance({ ...opts, color });
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 18, 22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  const spriteBack = niumaUsesSprite(ap, 'back');
  if (!spriteBack) dropShadow(ctx, x, py + 6, 32, 36, 0.12);
  ctx.save(); ctx.translate(x, 0);
  const phase = walkPhase(t, walking);
  const anim = { swing: walking ? Math.sin(phase) * 5 : 0, bounce: walking ? Math.abs(Math.sin(phase)) * 2 : 0 };
  if (!spriteBack) drawWalkLimbs(ctx, py, 'n', walking, t, color, ap);
  drawAgentTorso(ctx, py, color, ap, 'back', 1, anim);
  drawAgentHeadLayer(ctx, py, color, ap, 'back');
  ctx.restore();
  drawActivityBadge(ctx, x, py, opts.activity, t);
}

/** 正面 — 圆脸 + 双眼 + 围巾 + 手脚 */
function drawAgentFront(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string,
  opts: {
    selected?: boolean; trading?: boolean; walking?: boolean; t?: number;
    activity?: AgentActivity; headwear?: AgentHeadwear; hatStyle?: HatStyleId;
    outfitId?: OutfitId | NiumaSkinId; speciesId?: string; hairStyle?: string;
    scarfEnabled?: boolean; hatEnabled?: boolean;
  },
) {
  const t = opts.t ?? 0;
  const walking = !!opts.walking;
  let bob = 0;
  if (walking) bob = Math.abs(Math.sin(walkPhase(t, walking))) * 2.5;
  else if (opts.trading) bob = Math.sin(t * 4) * 1.5;
  else if (opts.activity === 'dine') bob = Math.abs(Math.sin(t * 3)) * 1.5;
  const py = y + bob;
  const ap = resolveDrawAppearance({ ...opts, color });

  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 18, 22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  const spriteFront = niumaUsesSprite(ap, 'front');
  if (!spriteFront) dropShadow(ctx, x, py + 6, 32, 36, 0.12);
  ctx.save(); ctx.translate(x, 0);
  const phase = walkPhase(t, walking);
  const anim = { swing: walking ? Math.sin(phase) * 5 : 0, bounce: walking ? Math.abs(Math.sin(phase)) * 2 : 0 };
  if (!spriteFront) drawWalkLimbs(ctx, py, 's', walking, t, color, ap);
  drawAgentTorso(ctx, py, color, ap, 'front', 1, anim);
  drawAgentHeadLayer(ctx, py, color, ap, 'front');
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
  const ap = resolveDrawAppearance({ ...opts, color });
  const flip = facing === 'w' ? -1 : 1;
  if (opts.selected) {
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, py, 16, 22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  const spriteSide = niumaUsesSprite(ap, 'side');
  if (!spriteSide) dropShadow(ctx, x, py + 6, 28, 34, 0.12);
  ctx.save(); ctx.translate(x, 0);
  const phase = walkPhase(t, walking);
  const anim = { swing: walking ? Math.sin(phase) * 5 : 0, bounce: walking ? Math.abs(Math.sin(phase)) * 2 : 0 };
  if (!spriteSide) drawWalkLimbs(ctx, py, facing, walking, t, color, ap);
  drawAgentTorso(ctx, py, color, ap, 'side', flip, anim);
  drawAgentHeadLayer(ctx, py, color, ap, 'side', flip);
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
  const ap = resolveDrawAppearance({ ...opts, color });
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
  ctx.fillStyle = PENGUIN_PALETTE.black;
  ctx.beginPath(); ctx.ellipse(0, 0, 24, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN_PALETTE.belly;
  ctx.beginPath(); ctx.ellipse(2, 2, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN_PALETTE.black;
  ctx.beginPath(); ctx.ellipse(-18, -2, 9, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN_PALETTE.white;
  ctx.beginPath(); ctx.ellipse(-19, -3, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PENGUIN_PALETTE.beak;
  ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-28, 2); ctx.lineTo(-24, 4); ctx.closePath(); ctx.fill();
  if (ap.scarfEnabled) {
    drawScarfStripes(ctx, -14, -4, 12, 4, false, scarfColorsFromAccent(color));
  }
  if (ap.hatEnabled) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(-18, -6, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  if (opts.activity === 'massage') {
    ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('✨', x + 20, py - 12 + Math.sin(t * 5) * 2);
  }
}
