/** 禅意按摩区绘制 */
import { spaPalette, skinIsPremium, type SpaPalette } from '../../lib/zoneSkins';
import type { PaperCamera } from './renderZone';
import { dropShadow, rrect } from './paperDrawUtils';

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

